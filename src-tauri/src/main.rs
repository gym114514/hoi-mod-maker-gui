// HOI Mod Maker - Tauri backend
// Handles file system operations, HOI4 script parsing, and validation

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod parser;
mod validator;

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Validation error: {0}")]
    Validation(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ========================================================================
// STREAMING FOCUS TREE PARSER — No recursion, minimal memory
// ========================================================================
// Scans line-by-line, tracks brace depth, captures focus blocks directly.
// No AST, no tokenization, no recursion — impossible to stack overflow.
// Memory usage: O(focus_count × avg_focus_size), NOT O(file_size).

/// Count net brace depth change in a line, respecting strings and comments.
fn count_net_braces(line: &str) -> i32 {
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;
    for ch in line.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if in_string {
            if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
        } else if ch == '"' {
            in_string = true;
        } else if ch == '#' {
            break; // rest is comment
        } else if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
        }
    }
    depth
}

/// Extract a simple value after `key = ` from a trimmed line.
fn extract_line_value(line: &str, key: &str) -> Option<String> {
    let prefix = format!("{} = ", key);
    if line.starts_with(&prefix) {
        let val = line[prefix.len()..].trim();
        // Strip inline comments (#)
        let val = if let Some(hash_pos) = val.find('#') {
            val[..hash_pos].trim()
        } else {
            val
        };
        // Strip surrounding quotes
        if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
            Some(val[1..val.len() - 1].to_string())
        } else {
            Some(val.to_string())
        }
    } else {
        None
    }
}

/// Capture lines of a sub-block (everything between `{` and matching `}`).
/// `start_idx` points to the line containing the opening `{`.
/// Returns the inner lines (excluding the opening `{` and closing `}` lines).
/// Advances `start_idx` past the closing `}`.
fn capture_sub_block_lines<'a>(lines: &[&'a str], start_idx: &mut usize) -> Vec<&'a str> {
    let mut inner = Vec::new();
    let mut depth: i32 = 0;
    let mut started = false;
    let mut i = *start_idx;

    while i < lines.len() {
        let net = count_net_braces(lines[i]);
        if !started {
            // The first line has the opening brace
            depth += net;
            started = true;
            if depth <= 0 {
                // Single-line block: both { and } on same line
                // Extract content between first { and matching }
                let line = lines[i];
                if let Some(open_pos) = line.find('{') {
                    let after_open = &line[open_pos + 1..];
                    let mut brace_depth = 1i32;
                    let mut end_pos = after_open.len();
                    for (bi, ch) in after_open.char_indices() {
                        if ch == '{' { brace_depth += 1; }
                        else if ch == '}' { brace_depth -= 1; }
                        if brace_depth == 0 { end_pos = bi; break; }
                    }
                    let content = after_open[..end_pos].trim();
                    if !content.is_empty() {
                        inner.push(content);
                    }
                }
                *start_idx = i;
                return inner;
            }
        } else {
            depth += net;
            if depth <= 0 {
                // Closing brace reached — don't include this line
                *start_idx = i;
                return inner;
            }
            inner.push(lines[i]);
        }
        i += 1;
    }

    *start_idx = i;
    inner
}

/// Capture a sub-block as a single joined string (for available, completion_reward, etc.)
fn capture_sub_block_text(lines: &[&str], start_idx: &mut usize) -> Option<String> {
    let inner = capture_sub_block_lines(lines, start_idx);
    if inner.is_empty() {
        None
    } else {
        // Strip consistent leading whitespace so content is "normalized"
        // This prevents double-indentation when re-exporting
        let min_indent = inner.iter()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.len() - l.trim_start().len())
            .min()
            .unwrap_or(0);
        let normalized: Vec<String> = inner.iter()
            .map(|l| {
                if l.len() > min_indent { l[min_indent..].to_string() }
                else { l.trim().to_string() }
            })
            .collect();
        Some(normalized.join("\n"))
    }
}

/// Parse prerequisite block lines into groups of focus IDs.
/// HOI4 format examples:
///   prerequisite = { focus = ITA_xxx }               → one group ["ITA_xxx"]
///   prerequisite = { focus = A focus = B focus = C } → one group ["A","B","C"] (AND)
///   Multiple prerequisite = {} blocks → OR between groups
///
/// The key insight: `focus = ID` has NO braces around the ID.
fn parse_prerequisite_from_lines(lines: &[&str]) -> Vec<Vec<String>> {
    // Each `prerequisite = { ... }` block is one group (AND within, OR between)
    // Within a block: `focus = ID` entries are AND (all must be completed)
    let mut groups: Vec<Vec<String>> = Vec::new();

    // Join all lines into one string for easier parsing
    let combined = lines.iter().map(|l| l.trim()).collect::<Vec<_>>().join(" ");

    // Extract all `focus = <ID>` entries in this block
    let mut current_group: Vec<String> = Vec::new();
    let mut remaining = combined.as_str();

    while !remaining.is_empty() {
        // Find "focus ="
        if let Some(pos) = remaining.find("focus") {
            let after = &remaining[pos + 5..]; // skip "focus"
            let after = after.trim_start();
            if after.starts_with('=') {
                let after_eq = &after[1..].trim_start();
                // Read the ID token (until whitespace or })
                let id_end = after_eq.find(|c: char| c.is_whitespace() || c == '}' || c == '#').unwrap_or(after_eq.len());
                let id = after_eq[..id_end].trim_matches('"').to_string();
                if !id.is_empty() {
                    current_group.push(id);
                }
                remaining = &after_eq[id_end.min(after_eq.len())..];
                continue;
            }
            remaining = after;
        } else {
            break;
        }
    }

    if !current_group.is_empty() {
        groups.push(current_group);
    }

    groups
}

/// Parse mutually_exclusive block lines.
/// HOI4 format: mutually_exclusive = { focus = ID1 focus = ID2 ... }
/// No braces around IDs.
fn parse_mutually_exclusive_from_lines(lines: &[&str]) -> Vec<String> {
    let mut result = Vec::new();

    // Join all lines into one string for easier parsing
    let combined = lines.iter().map(|l| l.trim()).collect::<Vec<_>>().join(" ");

    let mut remaining = combined.as_str();
    while !remaining.is_empty() {
        if let Some(pos) = remaining.find("focus") {
            let after = &remaining[pos + 5..];
            let after = after.trim_start();
            if after.starts_with('=') {
                let after_eq = &after[1..].trim_start();
                let id_end = after_eq.find(|c: char| c.is_whitespace() || c == '}' || c == '#').unwrap_or(after_eq.len());
                let id = after_eq[..id_end].trim_matches('"').to_string();
                if !id.is_empty() {
                    result.push(id);
                }
                remaining = &after_eq[id_end.min(after_eq.len())..];
                continue;
            }
            remaining = after;
        } else {
            break;
        }
    }

    result
}

/// Parse search_filters block lines.
fn parse_search_filters_from_lines(lines: &[&str]) -> Vec<String> {
    let mut result = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        // Filters can be bare identifiers or quoted strings
        for token in trimmed.split_whitespace() {
            let token = token.trim_matches('"').to_string();
            if !token.is_empty() && token != "focus" && !token.contains('=') && !token.contains('{') && !token.contains('}') {
                result.push(token);
            }
        }
    }
    result
}

/// Parse an offset block: offset = { id = xxx x = n y = n trigger = { ... } }
fn parse_offset_block(lines: &[&str], start_idx: &mut usize) -> Option<FocusOffset> {
    let block_lines = capture_sub_block_lines(lines, start_idx);
    let combined = block_lines.iter().map(|l| l.trim()).collect::<Vec<_>>().join(" ");
    
    let mut id = String::new();
    let mut x = 0i32;
    let mut y = 0i32;
    let mut trigger: Option<String> = None;
    
    // Simple parse: extract key = value pairs
    let remaining = combined.as_str();
    // Extract id
    if let Some(pos) = remaining.find("id") {
        let after = &remaining[pos..];
        if let Some(eq_pos) = after.find('=') {
            let val = after[eq_pos+1..].trim();
            let end = val.find(|c: char| c.is_whitespace() || c == '}').unwrap_or(val.len());
            id = val[..end].trim_matches('"').to_string();
        }
    }
    // Extract x
    if let Some(pos) = combined.find(" x ") {
        let after = &combined[pos+3..];
        if let Some(eq_pos) = after.find('=') {
            let val = after[eq_pos+1..].trim();
            let end = val.find(|c: char| c.is_whitespace() || c == '}').unwrap_or(val.len());
            x = val[..end].parse().unwrap_or(0);
        }
    }
    // Extract y
    if let Some(pos) = combined.find(" y ") {
        let after = &combined[pos+3..];
        if let Some(eq_pos) = after.find('=') {
            let val = after[eq_pos+1..].trim();
            let end = val.find(|c: char| c.is_whitespace() || c == '}').unwrap_or(val.len());
            y = val[..end].parse().unwrap_or(0);
        }
    }
    // Extract trigger (if present)
    if combined.contains("trigger") {
        // Find trigger content between { and matching }
        if let Some(trigger_pos) = combined.find("trigger") {
            let after = &combined[trigger_pos+7..];
            if let Some(open) = after.find('{') {
                let content = &after[open+1..];
                let mut depth = 1i32;
                let mut end = 0;
                for (i, ch) in content.char_indices() {
                    if ch == '{' { depth += 1; }
                    else if ch == '}' { depth -= 1; }
                    if depth == 0 { end = i; break; }
                }
                trigger = Some(content[..end].trim().to_string());
            }
        }
    }
    
    if id.is_empty() { return None; }
    Some(FocusOffset { id, x, y, trigger })
}

/// Parse a focus block (collected lines) into a FocusExtract.
fn parse_focus_block(lines: &[&str]) -> Option<FocusExtract> {
    let mut id = String::new();
    let mut icon = None;
    let mut x = 0i32;
    let mut y = 0i32;
    let mut cost = None;
    let mut relative_position_id = None;
    let mut prerequisite: Vec<Vec<String>> = Vec::new();
    let mut mutually_exclusive: Vec<String> = Vec::new();
    let mut available = None;
    let mut bypass = None;
    let mut completion_reward = None;
    let mut select_effect = None;
    let mut hidden_effect = None;
    let mut search_filters: Vec<String> = Vec::new();
    let mut inner_circle = None;
    let mut continuous = None;
    let mut dynamic = None;
    let mut cancel_if_invalid = None;
    let mut continue_if_invalid = None;
    let mut available_if_capitulated = None;
    let mut allow_branch = None;
    let mut offset: Vec<FocusOffset> = Vec::new();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();

        // Skip empty lines, comments, and the opening "focus = {" line
        if line.is_empty() || line.starts_with('#') || line.starts_with("focus") && line.contains('{') && !line.contains("focus_tree") {
            i += 1;
            continue;
        }

        // Simple key = value pairs
        if let Some(v) = extract_line_value(line, "id") {
            id = v;
        } else if let Some(v) = extract_line_value(line, "icon") {
            icon = Some(v);
        } else if let Some(v) = extract_line_value(line, "x") {
            x = v.parse().unwrap_or(0);
        } else if let Some(v) = extract_line_value(line, "y") {
            y = v.parse().unwrap_or(0);
        } else if let Some(v) = extract_line_value(line, "cost") {
            cost = Some(v.parse().unwrap_or(1));
        } else if let Some(v) = extract_line_value(line, "relative_position_id") {
            relative_position_id = Some(v);
        } else if line.starts_with("inner_circle") {
            inner_circle = Some(line.contains("yes"));
        } else if line.starts_with("continuous") && !line.starts_with("continue") {
            continuous = Some(line.contains("yes"));
        } else if line.starts_with("dynamic") {
            dynamic = Some(line.contains("yes"));
        } else if line.starts_with("cancel_if_invalid") {
            cancel_if_invalid = Some(!line.contains("no"));
        } else if line.starts_with("continue_if_invalid") {
            continue_if_invalid = Some(line.contains("yes"));
        } else if line.starts_with("available_if_capitulated") {
            available_if_capitulated = Some(line.contains("yes"));
        } else if line.starts_with("allow_branch") && line.contains("=") {
            allow_branch = capture_sub_block_text(lines, &mut i);
        } else if line.starts_with("offset") && line.contains("=") && line.contains('{') {
            if let Some(off) = parse_offset_block(lines, &mut i) {
                offset.push(off);
            }
        }
        // Block properties: capture everything between key = { and matching }
        else if line.starts_with("available") && !line.starts_with("available_if") && line.contains("=") {
            available = capture_sub_block_text(lines, &mut i);
        } else if line.starts_with("bypass") && line.contains("=") {
            bypass = capture_sub_block_text(lines, &mut i);
        } else if line.starts_with("completion_reward") && line.contains("=") {
            completion_reward = capture_sub_block_text(lines, &mut i);
        } else if line.starts_with("select_effect") && line.contains("=") {
            select_effect = capture_sub_block_text(lines, &mut i);
        } else if line.starts_with("hidden_effect") && line.contains("=") {
            hidden_effect = capture_sub_block_text(lines, &mut i);
        } else if line.starts_with("prerequisite") && line.contains("=") {
            let block_lines = capture_sub_block_lines(lines, &mut i);
            let groups = parse_prerequisite_from_lines(&block_lines);
            prerequisite.extend(groups);
        } else if line.starts_with("mutually_exclusive") && line.contains("=") {
            let block_lines = capture_sub_block_lines(lines, &mut i);
            let ids = parse_mutually_exclusive_from_lines(&block_lines);
            mutually_exclusive.extend(ids);
        } else if line.starts_with("search_filters") && line.contains("=") {
            let block_lines = capture_sub_block_lines(lines, &mut i);
            search_filters = parse_search_filters_from_lines(&block_lines);
        }
        // Skip unknown keys (ai_will_do, offset, etc.)

        i += 1;
    }

    if id.is_empty() {
        return None;
    }

    Some(FocusExtract {
        id,
        icon,
        x,
        y,
        cost,
        relative_position_id,
        prerequisite,
        mutually_exclusive,
        available,
        bypass,
        completion_reward,
        select_effect,
        hidden_effect,
        search_filters,
        inner_circle,
        continuous,
        dynamic,
        cancel_if_invalid,
        continue_if_invalid,
        available_if_capitulated,
        allow_branch,
        offset,
    })
}

/// Streaming focus tree parser — scans line-by-line, zero recursion.
/// Finds `focus = { ... }` blocks within `focus_tree = { ... }` and extracts them.
fn parse_focus_tree_streaming(content: &str) -> Result<Vec<FocusExtract>, AppError> {
    // Safety limit
    if content.len() > 10 * 1024 * 1024 {
        return Err(AppError::Parse(format!(
            "File too large: {} bytes (max 10MB)",
            content.len()
        )));
    }

    let mut focuses: Vec<FocusExtract> = Vec::new();
    let mut brace_depth: i32 = 0;
    let mut in_focus_tree = false;
    let mut focus_tree_start_depth: i32 = 0;

    // State for current focus block being captured
    let mut in_focus = false;
    let mut focus_start_depth: i32 = 0;
    let mut focus_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        let net = count_net_braces(line);
        let prev_depth = brace_depth;
        brace_depth += net;

        if !in_focus_tree {
            // Look for focus_tree = { ... }
            let trimmed = line.trim();
            if trimmed.starts_with("focus_tree") && trimmed.contains('=') && net > 0 {
                in_focus_tree = true;
                focus_tree_start_depth = prev_depth;
            }
            continue;
        }

        // We're inside focus_tree block
        if brace_depth <= focus_tree_start_depth {
            // focus_tree block ended
            in_focus_tree = false;
            continue;
        }

        if !in_focus {
            // Look for "focus = {" — but NOT "focus_tree"
            let trimmed = line.trim();
            let looks_like_focus = (trimmed.starts_with("focus =") || trimmed.starts_with("focus=") || trimmed.starts_with("focus\t"))
                && !trimmed.starts_with("focus_tree")
                && net > 0; // Must have opening brace on this line

            if looks_like_focus {
                in_focus = true;
                focus_start_depth = prev_depth;
                focus_lines.clear();
                focus_lines.push(line);
            }
        } else {
            // Inside a focus block — collect lines
            focus_lines.push(line);

            if brace_depth <= focus_start_depth {
                // Focus block ended
                in_focus = false;
                if let Some(focus) = parse_focus_block(&focus_lines) {
                    focuses.push(focus);
                    if focuses.len() > 2000 {
                        return Err(AppError::Parse(
                            "Too many focuses (>2000). File may be malformed.".into(),
                        ));
                    }
                }
                focus_lines.clear();
            }
        }
    }

    // Handle unclosed focus at EOF
    if in_focus {
        if let Some(focus) = parse_focus_block(&focus_lines) {
            focuses.push(focus);
        }
    }

    Ok(focuses)
}

// ---------- Focus Extraction Types ----------

#[derive(Serialize)]
struct FocusTreeOutput {
    focuses: Vec<FocusExtract>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusExtract {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    x: i32,
    y: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    cost: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    relative_position_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    prerequisite: Vec<Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    mutually_exclusive: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    available: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bypass: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completion_reward: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    select_effect: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hidden_effect: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    search_filters: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    inner_circle: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    continuous: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dynamic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancel_if_invalid: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    continue_if_invalid: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    available_if_capitulated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allow_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    offset: Vec<FocusOffset>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FocusOffset {
    id: String,
    x: i32,
    y: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    trigger: Option<String>,
}

// ---------- Tauri Commands ----------

#[tauri::command]
fn parse_file(path: String) -> Result<String, AppError> {
    let content = std::fs::read_to_string(&path)?;
    // Use streaming parser for all files now — much safer
    let sample = content.chars().take(2000).collect::<String>().to_lowercase();
    if sample.contains("focus_tree") {
        let focuses = parse_focus_tree_streaming(&content)?;
        let json = serde_json::to_string(&FocusTreeOutput { focuses })
            .map_err(|e| AppError::Parse(e.to_string()))?;
        Ok(json)
    } else {
        // For non-focus-tree files, still use old parser
        let ast = parser::parse_hoi4_file(&content, &path)?;
        let json = serde_json::to_string(&ast)
            .map_err(|e| AppError::Parse(e.to_string()))?;
        Ok(json)
    }
}

/// 解析一段任意 HOI4 代码字符串为 AST（供只读积木渲染等前端用途）。
/// 复用完整版 parser，支持比较运算符 / 作用域引用 / 数组块 / 数字 key。
#[tauri::command]
fn parse_code_ast(code: String) -> Result<parser::Hoi4Ast, AppError> {
    parser::parse_hoi4_file(&code, "<code>")
}

#[tauri::command]
fn parse_focus_tree_cmd(path: String) -> Result<String, AppError> {
    println!("[RUST] parse_focus_tree_cmd: {}", path);
    let content = std::fs::read_to_string(&path)?;
    let focuses = parse_focus_tree_streaming(&content)?;
    let count = focuses.len();
    let json = serde_json::to_string(&FocusTreeOutput { focuses })
        .map_err(|e| AppError::Parse(e.to_string()))?;
    println!("[RUST] parse_focus_tree_cmd OK: {} focuses", count);
    Ok(json)
}

#[tauri::command]
fn parse_ideas_cmd(path: String) -> Result<String, AppError> {
    let content = std::fs::read_to_string(&path)?;
    let ast = parser::parse_hoi4_file(&content, &path)?;
    let json =
        serde_json::to_string_pretty(&ast).map_err(|e| AppError::Parse(e.to_string()))?;
    Ok(json)
}

#[tauri::command]
fn validate_file(path: String) -> Result<validator::ValidationResult, AppError> {
    println!("[RUST] validate_file: {}", path);
    let content = std::fs::read_to_string(&path)?;
    validator::validate_file(&content, &path)
}

#[tauri::command]
fn serialize_to_hoi4(ast: String, path: String) -> Result<(), AppError> {
    let parsed_ast: parser::Hoi4Ast =
        serde_json::from_str(&ast).map_err(|e| AppError::Parse(e.to_string()))?;
    let output = parser::serialize_ast(&parsed_ast);
    std::fs::write(&path, output)?;
    Ok(())
}

#[tauri::command]
fn export_focus_tree_cmd(path: String, json: String) -> Result<String, AppError> {
    println!("[RUST] export_focus_tree_cmd: {} ({} bytes JSON)", path, json.len());
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FocusTreeJson {
        focuses: Vec<FocusJson>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)]
    struct FocusJson {
        id: String,
        #[serde(default)]
        icon: Option<String>,
        #[serde(default)]
        x: i32,
        #[serde(default)]
        y: i32,
        #[serde(default)]
        cost: Option<i32>,
        #[serde(default)]
        relative_position_id: Option<String>,
        #[serde(default)]
        prerequisite: Vec<Vec<String>>,
        #[serde(default)]
        mutually_exclusive: Vec<String>,
        #[serde(default)]
        available: Option<String>,
        #[serde(default)]
        bypass: Option<String>,
        #[serde(default)]
        cancel_if_invalid: Option<bool>,
        #[serde(default)]
        continue_if_invalid: Option<bool>,
        #[serde(default)]
        available_if_capitulated: Option<bool>,
        #[serde(default)]
        allow_branch: Option<String>,
        #[serde(default)]
        completion_reward: Option<String>,
        #[serde(default)]
        select_effect: Option<String>,
        #[serde(default)]
        complete_tooltip: Option<String>,
        #[serde(default)]
        hidden_effect: Option<String>,
        #[serde(default)]
        search_filters: Vec<String>,
        #[serde(default)]
        inner_circle: Option<bool>,
        #[serde(default)]
        continuous: Option<bool>,
        #[serde(default)]
        dynamic: Option<bool>,
        #[serde(default)]
        offset: Vec<FocusJsonOffset>,
    }

    #[derive(serde::Deserialize, serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct FocusJsonOffset {
        id: String,
        #[serde(default)]
        x: i32,
        #[serde(default)]
        y: i32,
        #[serde(default)]
        trigger: Option<String>,
    }

    let tree: FocusTreeJson =
        serde_json::from_str(&json).map_err(|e| AppError::Parse(format!("JSON parse error: {}", e)))?;

    let mut lines: Vec<String> = vec![
        "focus_tree = {".into(),
        "    id = custom_focus".into(),
        "    country = { factor = 0 modifier = { add = 10 tag = CUSTOM } }".into(),
        "    default = no".into(),
        "".into(),
    ];

    for focus in &tree.focuses {
        lines.push("    focus = {".into());
        lines.push(format!("        id = {}", focus.id));
        lines.push(format!(
            "        icon = {}",
            focus.icon.as_deref().unwrap_or("GFX_focus_generic")
        ));
        lines.push(format!("        x = {}", focus.x));
        lines.push(format!("        y = {}", focus.y));
        lines.push(format!("        cost = {}", focus.cost.unwrap_or(1).max(1)));

        if let Some(ref rel) = focus.relative_position_id {
            if !rel.is_empty() {
                lines.push(format!("        relative_position_id = {}", rel));
            }
        }

        // HOI4 prerequisite format:
        // Each OR group is a separate prerequisite = { ... } block
        // Inside: focus = ID1 focus = ID2 (multiple focuses = OR logic)
        for group in &focus.prerequisite {
            if !group.is_empty() {
                let focus_entries: Vec<String> = group
                    .iter()
                    .map(|id| format!("focus = {}", id))
                    .collect();
                lines.push(format!("        prerequisite = {{ {} }}", focus_entries.join(" ")));
            }
        }

        // HOI4 mutually_exclusive format:
        // Each mutually_exclusive is a separate block with one focus
        for ex_id in &focus.mutually_exclusive {
            lines.push(format!("        mutually_exclusive = {{ focus = {} }}", ex_id));
        }

        if let Some(ref avail) = focus.available {
            if !avail.is_empty() {
                lines.push("        available = {".into());
                lines.push(format!("            {}", avail));
                lines.push("        }".into());
            }
        }

        if let Some(ref reward) = focus.completion_reward {
            if !reward.is_empty() {
                lines.push("        completion_reward = {".into());
                for line in reward.lines() {
                    lines.push(format!("            {}", line));
                }
                lines.push("        }".into());
            }
        }

        if !focus.search_filters.is_empty() {
            lines.push(format!(
                "        search_filters = {{ {} }}",
                focus.search_filters.join(" ")
            ));
        }

        if focus.inner_circle.unwrap_or(false) {
            lines.push("        inner_circle = yes".into());
        }
        if focus.continuous.unwrap_or(false) {
            lines.push("        continuous = yes".into());
        }
        if focus.dynamic.unwrap_or(false) {
            lines.push("        dynamic = yes".into());
        }
        if !focus.cancel_if_invalid.unwrap_or(true) {
            lines.push("        cancel_if_invalid = no".into());
        }
        if focus.continue_if_invalid.unwrap_or(false) {
            lines.push("        continue_if_invalid = yes".into());
        }
        if focus.available_if_capitulated.unwrap_or(false) {
            lines.push("        available_if_capitulated = yes".into());
        }
        if let Some(ref ab) = focus.allow_branch {
            if !ab.trim().is_empty() {
                lines.push("        allow_branch = {".into());
                for line in ab.trim().lines() {
                    lines.push(format!("            {}", line.trim()));
                }
                lines.push("        }".into());
            }
        }

        for off in &focus.offset {
            lines.push("        offset = {".into());
            lines.push(format!("            id = {}", off.id));
            lines.push(format!("            x = {}", off.x));
            lines.push(format!("            y = {}", off.y));
            if let Some(ref t) = off.trigger {
                if !t.trim().is_empty() {
                    lines.push("            trigger = {".into());
                    for line in t.trim().lines() {
                        lines.push(format!("                {}", line.trim()));
                    }
                    lines.push("            }".into());
                }
            }
            lines.push("        }".into());
        }

        lines.push("    }".into());
        lines.push(String::new());
    }

    lines.push("}".into());

    let output = lines.join("\n");
    std::fs::write(&path, &output)?;
    println!("[RUST] export_focus_tree_cmd OK: {} bytes", output.len());

    Ok(format!(
        "已导出到: {}\n共 {} 个焦点节点",
        path,
        tree.focuses.len()
    ))
}

#[tauri::command]
fn read_dir_recursive(dir: String, extension: String) -> Result<Vec<String>, AppError> {
    let mut files = Vec::new();
    read_dir_recursive_impl(PathBuf::from(&dir), &extension, &mut files)?;
    Ok(files)
}

fn read_dir_recursive_impl(dir: PathBuf, ext: &str, files: &mut Vec<String>) -> Result<(), AppError> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            read_dir_recursive_impl(path, ext, files)?;
        } else if let Some(ext_str) = path.extension() {
            if ext_str.to_string_lossy().eq_ignore_ascii_case(ext) {
                files.push(path.to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn get_file_preview(path: String) -> Result<String, AppError> {
    let content = std::fs::read_to_string(&path)?;
    Ok(content)
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), AppError> {
    std::fs::write(&path, content)?;
    Ok(())
}

#[tauri::command]
fn read_text_file_cmd(path: String) -> Result<String, AppError> {
    Ok(std::fs::read_to_string(&path)?)
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), AppError> {
    std::fs::create_dir_all(&path)?;
    Ok(())
}

/// Detects the file type by peeking at file content keywords
#[tauri::command]
fn detect_file_type(path: String) -> Result<String, AppError> {
    let content = std::fs::read_to_string(&path)?;
    let sample = content.chars().take(2000).collect::<String>().to_lowercase();

    if sample.contains("focus_tree") {
        return Ok("focus_tree".to_string());
    }
    if sample.contains("focus = {") || sample.contains("focus ={") {
        return Ok("focus_tree".to_string());
    }

    if sample.contains("= {\n    name")
        || sample.contains("= {\n\tname")
        || sample.contains("= {\r\n    name")
        || sample.contains("= {\r\n\tname")
    {
        if sample.contains("picture =")
            || sample.contains("modifier =")
            || sample.contains("allowed =")
            || sample.contains("trait =")
        {
            return Ok("ideas".to_string());
        }
    }

    if sample.contains("country_event")
        || sample.contains("news_event")
        || sample.contains("character_event")
        || sample.contains("battle_event")
    {
        return Ok("events".to_string());
    }

    if sample.contains("decision =")
        || sample.contains("category =")
    {
        return Ok("decisions".to_string());
    }

    if sample.contains(" l_english")
        || sample.contains(" l_simp_chinese")
        || sample.contains(" l_russian")
        || sample.contains(" l_german")
    {
        return Ok("localisation".to_string());
    }

    if path.to_lowercase().contains(".mod") || sample.contains("name =")
    {
        let lower = path.to_lowercase();
        if lower.ends_with(".mod") || lower.contains("descriptor") {
            return Ok("descriptor".to_string());
        }
    }

    Ok("other".to_string())
}

/// Creates full mod project directory structure on disk
#[tauri::command]
fn create_project_dirs(base_path: String) -> Result<Vec<String>, AppError> {
    let dirs = vec![
        "common/national_focus",
        "common/ideas",
        "common/national_ideas",
        "common/events",
        "common/decisions",
        "common/characters",
        "localisation/english",
        "localisation/simp_chinese",
        "history/countries",
        "history/states",
        "map/strategicregions",
        "interface",
        "gfx/fonts",
        "gfx/loadingscreens",
        "music",
        "sound",
        "events",
    ];

    let mut created = Vec::new();
    for dir in &dirs {
        let full = format!("{}/{}", base_path, dir);
        std::fs::create_dir_all(&full)?;
        created.push(full);
    }

    let mod_name = std::path::Path::new(&base_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("my_mod")
        .to_string();
    let descriptor_path = format!("{}/{}.mod", base_path, mod_name);
    let descriptor_content = format!(
        r#"name = "{}"
version = "1.0.0"
tags = {{
    "National Focus"
    "Gameplay"
}}
supported_version = "1.14.*"
"#,
        mod_name.replace('_', " ").replace('-', " ")
    );
    std::fs::write(&descriptor_path, descriptor_content)?;
    created.push(descriptor_path);

    let readme_path = format!("{}/README.txt", base_path);
    let readme_content = format!(
        r#"# {} - HOI4 Mod

Created with HOI Mod Maker
===================================

Directory Structure:
- common/national_focus/  → 国策树文件
- common/ideas/           → 国家精神文件
- common/events/          → 事件文件
- common/decisions/       → 决议文件
- localisation/english/   → 英文本地化
- localisation/simp_chinese/ → 中文本地化

Getting Started:
1. Edit your mod in common/national_focus/
2. Add ideas in common/ideas/
3. Test with HOI4 dev mode
4. Package as .mod for distribution
"#,
        mod_name.replace('_', " ").replace('-', " ")
    );
    std::fs::write(&readme_path, readme_content)?;
    created.push(readme_path);

    Ok(created)
}

// ---------- LSP-like Commands ----------
// 数据源：src/data/entries.json（与前端只读积木编辑器共用同一份知识库），编译期内嵌

use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(serde::Deserialize)]
struct EntryJson {
    #[serde(default)]
    desc_zh: Option<String>,
    #[serde(default)]
    scopes: Option<Vec<String>>,
    // 新数据格式（DATA_INTERFACE.md）：markdown 为主显示文本，params 为 LLM 猜测参数（带 source 标注）
    #[serde(default)]
    markdown: Option<String>,
    #[serde(default)]
    params: Vec<EntryParam>,
}

/// LLM 猜测的参数（非官方），source 恒为 "llm_guess_non_official"
#[derive(serde::Deserialize)]
struct EntryParam {
    #[serde(default)]
    key: String,
    #[serde(default)]
    #[allow(dead_code)]
    r#type: String, // int / float / bool / string / token / block / date
    #[serde(default)]
    desc: String,
    #[serde(default)]
    required: bool,
    #[serde(default)]
    default: String,
    #[serde(default)]
    source: String,
}

#[derive(Default)]
struct KnowledgeBase {
    effect: HashMap<String, EntryJson>,
    trigger: HashMap<String, EntryJson>,
    variable: HashMap<String, EntryJson>,
}

fn knowledge_base() -> &'static KnowledgeBase {
    static KB: OnceLock<KnowledgeBase> = OnceLock::new();
    KB.get_or_init(|| {
        #[derive(serde::Deserialize)]
        struct Raw {
            #[serde(default)]
            effect: HashMap<String, EntryJson>,
            #[serde(default)]
            trigger: HashMap<String, EntryJson>,
            #[serde(default)]
            variable: HashMap<String, EntryJson>,
        }
        let raw: Raw = serde_json::from_str(include_str!("../../src/data/entries.json"))
            .expect("内置 entries.json 解析失败");
        KnowledgeBase {
            effect: raw.effect,
            trigger: raw.trigger,
            variable: raw.variable,
        }
    })
}

/// 按 key 查知识库，优先级 effect → trigger → variable，带大小写兜底。
/// 返回 (条目, 类别名)。
/// key 生命周期与 kb 解耦：key 通常来自调用方短命借用。
fn lookup_entry<'a, 'k>(kb: &'a KnowledgeBase, key: &'k str) -> Option<(&'a EntryJson, &'static str)> {
    if let Some(e) = kb.effect.get(key) {
        return Some((e, "effect"));
    }
    if let Some(e) = kb.trigger.get(key) {
        return Some((e, "trigger"));
    }
    if let Some(e) = kb.variable.get(key) {
        return Some((e, "variable"));
    }
    for (table, kind) in [
        (&kb.effect, "effect"),
        (&kb.trigger, "trigger"),
        (&kb.variable, "variable"),
    ] {
        if let Some((_, e)) = table
            .iter()
            .find(|(k, _)| k.to_lowercase() == key.to_lowercase())
        {
            return Some((e, kind));
        }
    }
    None
}

fn scopes_suffix(scopes: &Option<Vec<String>>) -> String {
    match scopes {
        Some(s) if !s.is_empty() => format!(" · {}", s.join(", ")),
        _ => String::new(),
    }
}

// entries.json 不覆盖 focus 结构字段 —— 结构词表与 hover 文档（与补全词表对齐）
const FOCUS_FIELDS: &[&str] = &[
    "id", "icon", "x", "y", "cost", "prerequisite", "mutually_exclusive",
    "relative_position_id", "available", "bypass", "cancel", "completion_reward",
    "select_effect", "hidden_effect", "search_filters", "ai_will_do",
    "cancel_if_invalid", "continue_if_invalid", "available_if_capitulated",
    "inner_circle", "continuous", "dynamic", "will_lead_to_war_with",
    "allow_branch",
];
const TREE_FIELDS: &[&str] = &[
    "focus", "focus_tree", "country", "focus_tree_id", "default",
    "shared_focus", "inner_circle_focus",
];

fn struct_docs() -> &'static HashMap<&'static str, &'static str> {
    static DOCS: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    DOCS.get_or_init(|| {
        HashMap::from([
            ("id", "**id** = xxx\n\n国策唯一 ID（本文件内全局唯一）"),
            ("icon", "**icon** = GFX_focus_xxx\n\n国策图标"),
            ("x", "**x** = N\n\n国策在树中的横坐标"),
            ("y", "**y** = N\n\n国策在树中的纵坐标"),
            ("cost", "**cost** = N\n\n完成该国策所需政治点数（默认 1）"),
            ("prerequisite", "**prerequisite** = { focus = xxx }\n\n前置国策 (AND 关系)"),
            ("mutually_exclusive", "**mutually_exclusive** = { focus = xxx }\n\n互斥国策"),
            ("relative_position_id", "**relative_position_id** = xxx\n\n相对定位基准国策"),
            ("available", "**available** = { ... }\n\n国策解锁条件"),
            ("bypass", "**bypass** = { ... }\n\n跳过国策的条件"),
            ("cancel", "**cancel** = { ... }\n\n取消国策的效果"),
            ("completion_reward", "**completion_reward** = { ... }\n\n国策完成时执行的效果"),
            ("select_effect", "**select_effect** = { ... }\n\n选择国策时执行的效果"),
            ("hidden_effect", "**hidden_effect** = { ... }\n\n隐藏效果（不显示在国策面板）"),
            ("search_filters", "**search_filters** = { FOCUS_FILTER_XXX }\n\n搜索分类标签"),
            ("ai_will_do", "**ai_will_do** = { factor = N }\n\nAI 选择该国策的权重"),
            ("cancel_if_invalid", "**cancel_if_invalid** = yes/no\n\n条件失效自动取消"),
            ("continue_if_invalid", "**continue_if_invalid** = yes/no\n\n条件失效后继续执行"),
            ("available_if_capitulated", "**available_if_capitulated** = yes/no\n\n即使已投降仍可用"),
            ("inner_circle", "**inner_circle** = yes/no\n\n内环国策"),
            ("continuous", "**continuous** = yes/no\n\n连续焦点（可持续激活）"),
            ("dynamic", "**dynamic** = yes/no\n\n动态国策（AI 自动生成）"),
            ("will_lead_to_war_with", "**will_lead_to_war_with** = TAG\n\n完成国策将与该国开战"),
            ("allow_branch", "**allow_branch** = { ... }\n\n允许生成分支的条件"),
            ("focus_tree", "**focus_tree** = { ... }\n\n国策树定义块"),
            ("focus", "**focus** = { ... }\n\n单个国策定义块"),
            ("country", "**country** = { factor = N }\n\n国策树归属国家（factor 为权重）"),
            ("focus_tree_id", "**focus_tree_id** = xxx\n\n国策树 ID"),
            ("default", "**default** = yes/no\n\n是否默认国策树"),
            ("shared_focus", "**shared_focus** = xxx\n\n共享国策（引用其他树的国策）"),
            ("inner_circle_focus", "**inner_circle_focus** = xxx\n\n内环国策引用"),
        ])
    })
}

#[derive(serde::Serialize)]
struct CompletionItem {
    label: String,
    /// "effect" | "trigger" | "variable" | "property" | "class"
    kind: String,
    detail: String,
    documentation: String,
}

fn completion_item(name: &str, kind: &str, detail: &str, doc: &str) -> CompletionItem {
    CompletionItem {
        label: name.to_string(),
        kind: kind.to_string(),
        detail: detail.to_string(),
        documentation: doc.to_string(),
    }
}

/// 完整词表（供前端 Monarch tokenizer 动态生成染色规则）：
/// 结构词表（class/property）+ entries 知识库三类，与补全/hover 共用同一数据源。
#[tauri::command]
fn get_token_vocabulary() -> Result<HashMap<String, Vec<String>>, AppError> {
    let kb = knowledge_base();
    Ok(HashMap::from([
        (
            "class".to_string(),
            TREE_FIELDS.iter().map(|s| s.to_string()).collect(),
        ),
        (
            "property".to_string(),
            FOCUS_FIELDS.iter().map(|s| s.to_string()).collect(),
        ),
        ("effect".to_string(), kb.effect.keys().cloned().collect()),
        ("trigger".to_string(), kb.trigger.keys().cloned().collect()),
        ("variable".to_string(), kb.variable.keys().cloned().collect()),
    ]))
}

#[derive(serde::Serialize)]
struct DiagnosticItem {
    line: usize,
    message: String,
    severity: String,
}

#[tauri::command]
fn get_completions(content: String, line: usize, column: usize) -> Result<Vec<CompletionItem>, AppError> {
    let lines: Vec<&str> = content.lines().collect();
    if line == 0 || line > lines.len() {
        return Ok(vec![]);
    }
    println!("line: {}, column: {}", line, column);
    let line_content = lines[line - 1];
    // column: Monaco 传入 1‑based 逻辑字符列，转为 0‑based 字符索引
    let char_pos = column.saturating_sub(1);
    let byte_offset = line_content
        .char_indices()
        .nth(char_pos)
        .map(|(b, _)| b)
        .unwrap_or(line_content.len());
    let before_cursor = &line_content[..byte_offset];
    let indent = line_content.len() - line_content.trim_start().len();
    use regex::Regex; 
    let re = Regex::new(r"[a-zA-Z_]\w*$").unwrap();
    let typed = re.find(before_cursor)
        .map(|m| m.as_str())
        .unwrap_or("");

    println!("before cursor: {}", before_cursor);
    println!("typed: {}", typed);

    let kb = knowledge_base();
    let mut items: Vec<CompletionItem> = Vec::new();

    if indent >= 8 {
        // 效果/条件块内（available/completion_reward 等）：全量 entries 知识库
        for (kind, table) in [
            ("effect", &kb.effect),
            ("trigger", &kb.trigger),
            ("variable", &kb.variable),
        ] {
            for (name, e) in table.iter() {
                if name.starts_with(typed) {
                    // 文档优先 markdown（新格式主文本），desc_zh 兜底
                    let doc = e
                        .markdown
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .or(e.desc_zh.as_deref())
                        .unwrap_or("");
                    items.push(completion_item(
                        name,
                        kind,
                        &format!("{}{}", kind, scopes_suffix(&e.scopes)),
                        doc,
                    ));
                }
            }
        }
    } else if indent >= 4 {
        // focus 字段级
        for f in FOCUS_FIELDS {
            if f.starts_with(typed) {
                items.push(completion_item(
                    f,
                    "property",
                    "focus field",
                    struct_docs().get(*f).copied().unwrap_or(""),
                ));
            }
        }
    } else {
        // tree 级
        for f in TREE_FIELDS {
            if f.starts_with(typed) {
                items.push(completion_item(
                    f,
                    "class",
                    "tree element",
                    struct_docs().get(*f).copied().unwrap_or(""),
                ));
            }
        }
    }

    // 限制数量，避免下拉过长
    items.truncate(200);
    Ok(items)
}

// ---------- 块路径扫描（参数着色/悬停的共用底座） ----------
// 参数名不具备全局唯一性，须按“路径 父块名/参数key”索引（如 free_building_slots/size）。
// 因此需要在一段文本上重建“每个标识符所处的嵌套命名块路径”。
// 采用逐字符扫描（复用 count_net_braces 的字符串/注释感知思路），不触碰 parser.rs。

/// 一个已标记出所在块路径的标识符（key 位置）
struct IdentTok {
    /// 1-based 行号
    line: usize,
    /// 0-based 行内 UTF-16 起始列
    start_char: usize,
    /// token 长度（UTF-16 单元）
    length: usize,
    text: String,
    /// 当前所在的命名块栈（内层在后），如 ["focus", "available", "free_building_slots"]
    path: Vec<String>,
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}
fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == ':' || c == '-'
}

/// 单遍扫描文本，为每个处于 key 位置的标识符生成 (文本, 块路径)。
/// 规则：
///   - 字符串/注释内容被跳过；
///   - 前一个有效字符是 `{` / `[` / 行首 → 标识符视为 key 位置；
///   - key 紧跟 `{` 或 `= {` → 是块名（压栈，不产出）；否则是叶子参数 key（产出，带当前栈）。
/// 列坐标按 UTF-16 code unit 计数，与 Monaco 语义 token 的列一致。
fn scan_idents_with_paths(content: &str) -> Vec<IdentTok> {
    let chars: Vec<char> = content.chars().collect();
    let mut out: Vec<IdentTok> = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut line = 1usize;
    let mut col = 0usize; // UTF-16 列
    let mut i = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    let mut prev: char = '\n'; // 行首视为语句起点
    // key 位置标识符后，若判定为块名，先记录待压栈名，等 `{` 出现时压入
    let mut pending_block: Option<String> = None;

    while i < chars.len() {
        let c = chars[i];
        let cw = c.len_utf16() as usize;
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            if c == '\n' {
                line += 1;
                col = 0;
                prev = '\n';
            } else {
                col += cw;
            }
            i += 1;
            continue;
        }
        match c {
            '#' => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            '"' => {
                in_string = true;
                prev = '"';
                col += cw;
                i += 1;
            }
            '\n' => {
                line += 1;
                col = 0;
                prev = '\n';
                i += 1;
            }
            c if c.is_whitespace() => {
                col += cw;
                i += 1;
            }
            '{' => {
                // 若有待压栈块名则压入，否则压匿名空名（占位，遇到 } 弹出）
                stack.push(pending_block.take().unwrap_or_default());
                prev = '{';
                col += cw;
                i += 1;
            }
            '}' => {
                pending_block = None;
                stack.pop();
                prev = '}';
                col += cw;
                i += 1;
            }
            '[' => {
                pending_block = None;
                prev = '[';
                col += cw;
                i += 1;
            }
            ']' => {
                prev = ']';
                col += cw;
                i += 1;
            }
            // '=' 不清 pending：块名探测（key = {）就是让 pending 存到 '{' 前的 '=' 之后。
            // 而 '<' '>' 是比较运算符，其后不会是块，需清 pending（防御式）。
            '=' => {
                prev = '=';
                col += cw;
                i += 1;
            }
            '<' | '>' => {
                pending_block = None;
                prev = '=';
                col += cw;
                i += 1;
            }
            ',' => {
                pending_block = None;
                prev = ',';
                col += cw;
                i += 1;
            }
            c if is_ident_start(c) => {
                let start_line = line;
                let start_col = col;
                let mut j = i;
                while j < chars.len() && is_ident_char(chars[j]) {
                    col += chars[j].len_utf16() as usize;
                    j += 1;
                }
                let text: String = chars[i..j].iter().collect();
                let len = col - start_col;
                let key_pos = matches!(prev, '{' | '[' | '\n');
                if key_pos {
                    // 探测是否块名：key 紧跟 `{` 或 `= {`
                    let mut k = j;
                    while k < chars.len() && chars[k].is_whitespace() && chars[k] != '\n' {
                        k += 1;
                    }
                    let block_open = match chars.get(k).copied() {
                        Some('{') => true,
                        Some('=') => {
                            let mut k2 = k + 1;
                            while k2 < chars.len() && chars[k2].is_whitespace() && chars[k2] != '\n'
                            {
                                k2 += 1;
                            }
                            chars.get(k2).copied() == Some('{')
                        }
                        _ => false,
                    };
                    if block_open {
                        pending_block = Some(text);
                    } else {
                        out.push(IdentTok {
                            line: start_line,
                            start_char: start_col,
                            length: len,
                            text,
                            path: stack.clone(),
                        });
                    }
                    prev = '=';
                } else {
                    // 值位置的标识符：不作为参数
                    prev = 'v';
                }
                i = j;
            }
            _ => {
                pending_block = None;
                prev = c;
                col += cw;
                i += 1;
            }
        }
    }
    out
}

/// 在块路径中从内向外查找“最近的、其 params 含 key 的条目”。
/// 返回 (匹配到的参数, 父块在 path 中的下标)，避免第二个返回项的生命周期纠缠。
fn find_param_in_path<'a>(
    kb: &'a KnowledgeBase,
    path: &[String],
    key: &str,
) -> Option<(usize, &'a EntryParam)> {
    for (idx, parent) in path.iter().enumerate().rev() {
        if let Some((entry, _kind)) = lookup_entry(kb, parent) {
            if let Some(p) = entry.params.iter().find(|p| p.key == key) {
                return Some((idx, p));
            }
        }
    }
    None
}

/// 渲染单个参数行（悬停时每参数一条）。
fn render_param_line(p: &EntryParam) -> String {
    let req = if p.required { "必填" } else { "可选" };
    let typ = if p.r#type.is_empty() { "?" } else { &p.r#type };
    let dflt = if p.default.is_empty() {
        String::new()
    } else {
        format!(" · 默认 `{}`", p.default)
    };
    let mut s = format!("- `{}` : {} · {}{} · {}\n", p.key, typ, p.desc, dflt, req);
    // 若来源不是标准 LLM 猜测标记，则逐条照实标注，防止误标为官方
    if !p.source.is_empty() && p.source != "llm_guess_non_official" {
        s.push_str(&format!("  > 来源: {}\n", p.source));
    }
    s
}

#[tauri::command]
fn get_hover_info(content: String, line: usize, column: usize, word: String) -> Result<Option<String>, AppError> {
    let kb = knowledge_base();
    // 1) 上下文优先：若该词是某个外层命名块的参数，返回参数悬停（带 provenance 徽章）
    let idents = scan_idents_with_paths(&content);
    let col0 = column.saturating_sub(1); // Monaco 1-based → 0-based
    if let Some(ident) = idents.iter().find(|t| {
        t.line == line && t.text == word && col0 >= t.start_char && col0 <= t.start_char + t.length
    }) {
        if let Some((idx, p)) = find_param_in_path(kb, &ident.path, &word) {
            let parent = &ident.path[idx];
            let typ = if p.r#type.is_empty() { "?" } else { &p.r#type };
            let req = if p.required { "必填" } else { "可选" };
            let dflt = if p.default.is_empty() {
                String::new()
            } else {
                format!(" · 默认 `{}`", p.default)
            };
            // 标题即路径 `父块名/key`，并强制标注 LLM 猜测（DATA_INTERFACE.md 义务）
            let out = format!(
                "**`{parent}/{word}`** : {typ} · {req}{dflt}\n\n{}\n\n> ⚠️ LLM 猜测, 非官方文档",
                p.desc
            );
            return Ok(Some(out));
        }
    }
    // 2) 回落到条目悬停（effect/trigger/variable）或结构字段
    if let Some((entry, kind)) = lookup_entry(kb, &word) {
        let scopes = scopes_suffix(&entry.scopes);
        let desc = match &entry.markdown {
            // 新格式：markdown 为主显示文本
            Some(md) if !md.is_empty() => md,
            _ => entry.desc_zh.as_deref().unwrap_or(""),
        };
        let mut out = format!("**{}** · {}{}\n\n{}", word, kind, scopes, desc);
        // 参数悬停：DATA_INTERFACE.md 强制标注 provenance —— LLM 猜测，非官方文档
        if !entry.params.is_empty() {
            out.push_str("\n\n**参数**（LLM 猜测, 非官方文档）\n");
            for p in &entry.params {
                out.push_str(&render_param_line(p));
            }
        }
        return Ok(Some(out));
    }
    if let Some(doc) = struct_docs().get(word.as_str()) {
        return Ok(Some((*doc).to_string()));
    }
    Ok(None)
}

/// 语义 token：前端据此给命中知识的参数着色（单一“param”类，type_index 恒 0）。
#[derive(serde::Serialize)]
struct SemanticToken {
    /// 0-based 行号
    line: usize,
    /// 0-based 行内 UTF-16 起始列
    start_char: usize,
    /// 长度（UTF-16 单元）
    length: usize,
    /// legend 索引（单一 param 类 → 恒 0）
    type_index: usize,
    /// 修饰位掩码（恒 0）
    modifiers: usize,
}

/// 计算全文语义 token：识别“处于某 effect/trigger 块内、且是其主要参数的 key”并标记为 param。
/// 只发射 param 类；条目名/结构字段的染色继续由 Monarch 负责，避免重复覆盖。
/// 返回按 (line, start_char) 升序排序的列表，便于前端扁平增量编码。
#[tauri::command]
fn get_semantic_tokens(content: String) -> Result<Vec<SemanticToken>, AppError> {
    let kb = knowledge_base();
    let mut toks = Vec::new();
    for id in scan_idents_with_paths(&content) {
        if find_param_in_path(kb, &id.path, &id.text).is_some() {
            toks.push(SemanticToken {
                line: id.line - 1, // 0-based
                start_char: id.start_char,
                length: id.length,
                type_index: 0,
                modifiers: 0,
            });
        }
    }
    toks.sort_by(|a, b| (a.line, a.start_char).cmp(&(b.line, b.start_char)));
    Ok(toks)
}

#[tauri::command]
fn validate_focus_tree(content: String) -> Result<Vec<DiagnosticItem>, AppError> {
    let lines: Vec<&str> = content.lines().collect();
    let mut errors = Vec::new();

    // ---- 1. Bracket balance ----
    let mut brace_depth = 0i32;
    for (i, line) in lines.iter().enumerate() {
        let stripped = line.split('#').next().unwrap_or("");
        for ch in stripped.chars() {
            match ch {
                '{' => brace_depth += 1,
                '}' => brace_depth -= 1,
                _ => {}
            }
        }
        if brace_depth < 0 {
            errors.push(DiagnosticItem {
                line: i + 1,
                message: "多余的 '}' — 左括号不匹配".to_string(),
                severity: "error".to_string(),
            });
            // Reset to avoid cascading errors
            brace_depth = 0;
        }
    }
    if brace_depth > 0 {
        errors.push(DiagnosticItem {
            line: lines.len(),
            message: format!("缺少 {} 个 '}}' — 右括号不匹配", brace_depth),
            severity: "error".to_string(),
        });
    }

    // ---- 2. Collect focus IDs ----
    // Match: id = xxx (at focus-level indent, typically 4-8 spaces)
    let mut focus_ids = std::collections::HashSet::new();
    for line in &lines {
        let trimmed = line.trim();
        let indent = line.len() - line.trim_start().len();
        // Only match focus-level id fields (indent 4-12, not deeply nested)
        if indent >= 4 && indent <= 12 && trimmed.starts_with("id") && trimmed.contains('=') {
            // Make sure it's "id =" not "some_id ="
            let after_id = &trimmed[2..];
            if after_id.starts_with('=') || after_id.starts_with(' ') || after_id.starts_with('\t') {
                if let Some(val) = trimmed.split('=').nth(1) {
                    let id: String = val.chars()
                        .skip_while(|c| c.is_whitespace())
                        .take_while(|c| !c.is_whitespace() && *c != '}' && *c != '{' && *c != '"')
                        .collect();
                    let id = id.trim_matches('"').trim();
                    if !id.is_empty() {
                        focus_ids.insert(id.to_string());
                    }
                }
            }
        }
    }

    // ---- 3. Check prerequisite/mutually_exclusive references ----
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if !(trimmed.starts_with("prerequisite") || trimmed.starts_with("mutually_exclusive")) {
            continue;
        }
        if !trimmed.contains("focus") {
            continue;
        }
        // Extract all focus = xxx on this line
        let mut pos = 0;
        while pos < trimmed.len() {
            if let Some(rel) = trimmed[pos..].find("focus") {
                let abs = pos + rel;
                let after = &trimmed[abs + 5..];
                // Must be followed by = (not "focus_tree" etc.)
                let after_trimmed = after.trim_start();
                if !after_trimmed.starts_with('=') {
                    pos = abs + 5;
                    continue;
                }
                let eq_rel = after.find('=').unwrap();
                let after_eq = &after[eq_rel + 1..];
                let val: String = after_eq.chars()
                    .skip_while(|c| c.is_whitespace())
                    .take_while(|c| !c.is_whitespace() && *c != '}' && *c != '{' && *c != '"')
                    .collect();
                let val = val.trim_matches('"').trim();
                if !val.is_empty() && !focus_ids.contains(val) {
                    errors.push(DiagnosticItem {
                        line: i + 1,
                        message: format!("引用了不存在的 focus ID: '{}'" , val),
                        severity: "error".to_string(),
                    });
                }
                pos = abs + 5 + eq_rel + 1;
            } else {
                break;
            }
        }
    }

    // ---- 4. Spelling checks ----
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Only check lines that look like key = value (have = sign)
        if !trimmed.contains('=') {
            continue;
        }

        // Extract the key (before =)
        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim();

            // Skip quoted strings and comments
            if key.starts_with('"') || key.starts_with('#') {
                continue;
            }

            // Common typos
            let typo_map: &[(&str, &str)] = &[
                ("completition_reward", "completion_reward"),
                ("compeltion_reward", "completion_reward"),
                ("compleation_reward", "completion_reward"),
                ("mutually_exlusive", "mutually_exclusive"),
                ("mutally_exclusive", "mutually_exclusive"),
                ("mutualy_exclusive", "mutually_exclusive"),
                ("prerequisit", "prerequisite"),
                ("prequisite", "prerequisite"),
                ("prerequisitie", "prerequisite"),
                ("cancel_if_invald", "cancel_if_invalid"),
                ("cancel_if_invaid", "cancel_if_invalid"),
                ("availabe", "available"),
                ("avaliable", "available"),
                ("completetion_reward", "completion_reward"),
                ("relative_positon_id", "relative_position_id"),
                ("relative_postion_id", "relative_position_id"),
                ("mutually_exculsive", "mutually_exclusive"),
            ];

            for &(typo, correction) in typo_map {
                if key == typo {
                    errors.push(DiagnosticItem {
                        line: i + 1,
                        message: format!("拼写错误？'{}' → '{}'" , typo, correction),
                        severity: "warning".to_string(),
                    });
                    break;
                }
            }

            // Warn about unknown top-level keys (indent <= 4, not a known field)
            let indent = line.len() - line.trim_start().len();
            if indent <= 4 && !key.is_empty() {
                let known_tree_keys = [
                    "focus_tree", "country", "focus_tree_id", "default",
                    "initial_show_position", "continuous_focus_position",
                    "focus", "shared_focus", "inner_circle_focus",
                    "id", "icon", "x", "y", "cost", "prerequisite",
                    "mutually_exclusive", "relative_position_id", "available",
                    "bypass", "cancel", "completion_reward", "search_filters",
                    "ai_will_do", "cancel_if_invalid", "continue_if_invalid",
                    "available_if_capitulated", "inner_circle", "continuous",
                    "will_lead_to_war_with", "tag", "factor", "modifier",
                    "add", "limit", "base",
                ];
                // Only warn for very suspicious keys (long, no underscores, looks like typo)
                // Skip for now — too many false positives
                let _ = known_tree_keys;
            }
        }
    }

    Ok(errors)
}

// ---------- File Management Commands ----------

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), AppError> {
    std::fs::rename(&old_path, &new_path)?;
    Ok(())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), AppError> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(&p)?;
    } else {
        std::fs::remove_file(&p)?;
    }
    Ok(())
}

#[tauri::command]
fn create_file(path: String, content: Option<String>) -> Result<(), AppError> {
    let c = content.unwrap_or_default();
    std::fs::write(&path, c)?;
    Ok(())
}

#[tauri::command]
fn create_dir(path: String) -> Result<(), AppError> {
    std::fs::create_dir_all(&path)?;
    Ok(())
}

// ---------- App Entry ----------

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            parse_file,
            parse_code_ast,
            parse_focus_tree_cmd,
            parse_ideas_cmd,
            validate_file,
            serialize_to_hoi4,
            export_focus_tree_cmd,
            read_dir_recursive,
            get_file_preview,
            write_text_file,
            read_text_file_cmd,
            ensure_dir,
            detect_file_type,
            create_project_dirs,
            get_completions,
            get_hover_info,
            get_token_vocabulary,
            get_semantic_tokens,
            validate_focus_tree,
            rename_file,
            delete_file,
            create_file,
            create_dir,
        ])
        .setup(|app| {
            println!("HOI Mod Maker started successfully!");
            let _window = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------- 知识库冒烟测试 ----------
// 验证：1) 编译期内嵌的 entries.json 能被正确解析；2) kind 分类存在；
//        3) hover 能渲染 markdown 与参数 provenance 徽章。
#[cfg(test)]
mod kb_tests {
    use super::*;

    #[test]
    fn kb_parses_and_hovers() {
        let kb = knowledge_base();
        let total = kb.effect.len() + kb.trigger.len() + kb.variable.len();
        assert!(total > 1000, "条目数过少: {}", total);

        // 挑一个确定带参数的 trigger 验证 markdown 与参数
        let (entry, kind) = lookup_entry(&kb, "can_construct_building")
            .expect("can_construct_building 应在知识库中");
        assert_eq!(kind, "trigger");
        assert!(
            entry.markdown.as_deref().unwrap_or("").contains("建造建筑"),
            "markdown 应为中文描述"
        );
        assert!(!entry.params.is_empty(), "应含 LLM 猜测参数");

        // 悬停在条目名上时，回落到条目 hover（含参数列表 + provenance 徽章）
        let content = "can_construct_building = land_facility\n".to_string();
        let hover = get_hover_info(content, 1, 1, "can_construct_building".to_string())
            .expect("hover 不应失败")
            .expect("can_construct_building 应有 hover");
        assert!(hover.contains("LLM 猜测, 非官方文档"), "必须标注 provenance");
        assert!(hover.contains("land_facility"), "应列出参数名");
    }

    #[test]
    fn vocabulary_matches_data() {
        let kb = knowledge_base();
        let vocab = get_token_vocabulary().expect("vocabulary 不应失败");
        assert_eq!(vocab["effect"].len(), kb.effect.len());
        assert_eq!(vocab["trigger"].len(), kb.trigger.len());
        assert_eq!(vocab["variable"].len(), kb.variable.len());
    }

    /// 参数悬停应通过“路径 父块名/参数key”解析：free_building_slots 块内的 size
    #[test]
    fn param_hover_by_path() {
        let content = "focus = {\n    available = {\n        free_building_slots = {\n            building = industrial_complex\n            size > 5\n        }\n    }\n}\n";
        // size 在第 5 行（1-based），列 13（1-based，size 起始）—— 用 Monaco 列约定
        let hover = get_hover_info(content.to_string(), 5, 13, "size".to_string())
            .expect("hover 不应失败")
            .expect("size 应命中参数悬停");
        assert!(
            hover.contains("free_building_slots/size"),
            "标题应含路径，实际: {}",
            hover
        );
        assert!(hover.contains("LLM 猜测, 非官方文档"), "必须标注 provenance");
        assert!(hover.contains("必填"), "size 是必填参数");
    }

    /// 语义 token：处于条目块内的参数 key 被标记为 param；值位置的同名不作。
    #[test]
    fn semantic_tokens_param() {
        let content = "free_building_slots = {\n    building = industrial_complex\n    size > 5\n}\n";
        let toks = get_semantic_tokens(content.to_string()).expect("语义 token 不应失败");
        // 应标记 building(2行) 与 size(3行)，列按 0-based
        let keys: Vec<(usize, usize)> = toks.iter().map(|t| (t.line, t.start_char)).collect();
        assert!(
            keys.contains(&(1, 4)),
            "building 应在行2(0-based 1) 列5(0-based 4)，实际 {:?}",
            keys
        );
        assert!(
            keys.contains(&(2, 4)),
            "size 应在行3(0-based 2) 列5(0-based 4)，实际 {:?}",
            keys
        );
        // 值 industrial_complex 不在 value 位置，不应被标记
        assert!(
            !keys.contains(&(1, 7)),
            "industrial_complex 是值，不应标记: {:?}",
            keys
        );
    }

    /// 块路径解析：嵌套块栈与 key 判定
    #[test]
    fn scan_path_detects_nesting() {
        let content = "focus = {\n  available = {\n    free_building_slots = {\n      size > 5\n    }\n  }\n}\n";
        let idents = scan_idents_with_paths(content);
        let size = idents
            .iter()
            .find(|i| i.text == "size")
            .expect("应有 size 叶子");
        assert_eq!(
            size.path,
            vec!["focus".to_string(), "available".to_string(), "free_building_slots".to_string()],
            "size 的块路径应完整"
        );
        // size 是叶子 key，不包含自己
        assert!(!size.path.iter().any(|p| p == "size"));
    }
}
