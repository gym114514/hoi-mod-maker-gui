#![allow(unused)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ai_will_do_state_machine() {
        // File with two ai_will_do blocks — second factor=0 should NOT trigger
        // false warnings on lines OUTSIDE the first ai_will_do block
        let content = r#"focus_tree = {
    focus = {
        id = TEST
        ai_will_do = { factor = 1 }
    }
    focus = {
        id = TEST2
        # This factor=0 should trigger a warning because we're inside ai_will_do
        ai_will_do = { factor = 0 }
    }
    focus = {
        id = TEST3
        # This factor=0 should NOT warn — it's outside any ai_will_do block
        cost = 0
    }
}"#;
        let result = validate_file(content, "test.txt").unwrap_or_else(|e| {
            panic!("validate_file returned error: {:?}", e);
        });
        
        eprintln!("FULL RESULT: valid={} errors={} warnings={}",
            result.valid, result.errors.len(), result.warnings.len());
        eprintln!("ALL WARNINGS:");
        for w in &result.warnings {
            eprintln!("  [{}] L{}: {}", w.code, w.line, w.message);
        }
        eprintln!("ALL ERRORS:");
        for e in &result.errors {
            eprintln!("  [{}] L{}: {}", e.code, e.line, e.message);
        }
        
        let ai_zero_warnings: Vec<_> = result.warnings.iter()
            .filter(|w| w.code == "AI_WILL_DO_ZERO")
            .collect();
        // Only 1 warning — the ai_will_do block with factor=0 (TEST2)
        // NOT the outer cost=0 (TEST3) which is correctly outside the block
        assert_eq!(ai_zero_warnings.len(), 1, "Expected exactly 1 AI_WILL_DO_ZERO warning");
        assert_eq!(ai_zero_warnings[0].line, 9, "Warning should be on line 9 (TEST2 ai_will_do factor=0)");
    }

    #[test]
    fn test_ai_will_do_nested_block() {
        let content = r#"focus_tree = {
    focus = {
        id = TEST
        ai_will_do = {
            factor = 0
            modifier = { add = 5 }
        }
        # After the block closes, factor=0 here should NOT trigger a warning
        cost = 0
    }
}"#;
        let result = validate_file(content, "test.txt").unwrap_or_else(|e| {
            panic!("validate_file returned error: {:?}", e);
        });
        
        eprintln!("FULL RESULT: valid={} errors={} warnings={}",
            result.valid, result.errors.len(), result.warnings.len());
        eprintln!("ALL WARNINGS:");
        for w in &result.warnings {
            eprintln!("  [{}] L{}: {}", w.code, w.line, w.message);
        }
        eprintln!("ALL ERRORS:");
        for e in &result.errors {
            eprintln!("  [{}] L{}: {}", e.code, e.line, e.message);
        }
        
        let ai_zero_warnings: Vec<_> = result.warnings.iter()
            .filter(|w| w.code == "AI_WILL_DO_ZERO")
            .collect();
        // The factor=0 INSIDE ai_will_do block should warn (line 5)
        // The cost=0 OUTSIDE the block should NOT warn
        assert_eq!(ai_zero_warnings.len(), 1, "Expected exactly 1 AI_WILL_DO_ZERO warning");
        assert_eq!(ai_zero_warnings[0].line, 5, "Warning should be on line 5 (inside ai_will_do)");
    }

    #[test]
    fn test_utf8_bom_skipped() {
        let content = "\u{feff}focus_tree = { id = test }";
        let result = validate_file(content, "test.txt").unwrap();
        // Should not crash, and BOM should not cause errors
        assert!(result.valid || result.errors.is_empty(), "UTF-8 BOM should not cause parse errors");
    }
}

// HOI4 file validator
// Checks for common syntax errors and HOI4-specific issues

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub line: usize,
    pub column: usize,
    pub message: String,
    pub code: String,
    pub severity: String,
}

impl Default for ValidationResult {
    fn default() -> Self {
        ValidationResult {
            valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }
}

// ---------- Validation Rules ----------

pub fn validate_file(content: &str, _path: &str) -> Result<ValidationResult, crate::AppError> {
    let mut result = ValidationResult::default();
    let lines: Vec<&str> = content.lines().collect();

    // Rule 1: Check bracket balance
    validate_bracket_balance(&lines, &mut result);

    // Rule 2: Check for common syntax errors
    validate_syntax(&lines, &mut result);

    // Rule 3: Check for ai_will_do defaults (common pitfall)
    validate_ai_will_do(&lines, &mut result);

    // Rule 4: Check for cancel_if_invalid defaults
    validate_cancel_if_invalid(&lines, &mut result);

    // Rule 5: Check for original_tag case sensitivity
    validate_original_tag(&lines, &mut result);

    // Rule 6: Check for empty blocks
    validate_empty_blocks(&lines, &mut result);

    result.valid = result.errors.is_empty();
    Ok(result)
}

fn validate_bracket_balance(lines: &[&str], result: &mut ValidationResult) {
    let mut brace_count = 0isize;
    let mut bracket_count = 0isize;
    let mut brace_line = 0;
    let mut bracket_line = 0;

    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        // Skip comments
        if trimmed.starts_with('#') || trimmed.starts_with("//") {
            continue;
        }

        for ch in trimmed.chars() {
            match ch {
                '{' => {
                    if brace_count == 0 {
                        brace_line = line_num + 1;
                    }
                    brace_count += 1;
                }
                '}' => {
                    brace_count -= 1;
                    if brace_count < 0 {
                        result.errors.push(ValidationIssue {
                            line: line_num + 1,
                            column: 1,
                            message: "Unmatched closing brace '}'".to_string(),
                            code: "BRACKET_MISMATCH".to_string(),
                            severity: "error".to_string(),
                        });
                        brace_count = 0;
                    }
                }
                '[' => {
                    if bracket_count == 0 {
                        bracket_line = line_num + 1;
                    }
                    bracket_count += 1;
                }
                ']' => {
                    bracket_count -= 1;
                    if bracket_count < 0 {
                        result.errors.push(ValidationIssue {
                            line: line_num + 1,
                            column: 1,
                            message: "Unmatched closing bracket ']'".to_string(),
                            code: "BRACKET_MISMATCH".to_string(),
                            severity: "error".to_string(),
                        });
                        bracket_count = 0;
                    }
                }
                _ => {}
            }
        }
    }

    if brace_count > 0 {
        result.errors.push(ValidationIssue {
            line: brace_line,
            column: 1,
            message: format!("Missing {} closing brace(s) '}}'", brace_count),
            code: "MISSING_BRACE".to_string(),
            severity: "error".to_string(),
        });
    }

    if bracket_count > 0 {
        result.warnings.push(ValidationIssue {
            line: bracket_line,
            column: 1,
            message: format!("Missing {} closing bracket(s) ']'", bracket_count),
            code: "MISSING_BRACKET".to_string(),
            severity: "warning".to_string(),
        });
    }
}

fn validate_syntax(lines: &[&str], result: &mut ValidationResult) {
    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Skip comments and empty lines
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Check for common typos
        let lower = trimmed.to_lowercase();

        // Check for = = instead of =
        if lower.contains("= =") {
            result.errors.push(ValidationIssue {
                line: line_num + 1,
                column: trimmed.find("= =").map(|p| p + 1).unwrap_or(1),
                message: "Double equals sign found (should be single '=')".to_string(),
                code: "DOUBLE_EQUALS".to_string(),
                severity: "error".to_string(),
            });
        }

        // Check for trailing = without value
        if trimmed.ends_with('=') {
            result.warnings.push(ValidationIssue {
                line: line_num + 1,
                column: trimmed.len(),
                message: "Line ends with '=' but no value follows".to_string(),
                code: "TRAILING_EQUALS".to_string(),
                severity: "warning".to_string(),
            });
        }

        // Check for tabs (non-standard in HOI4 files)
        if line.contains('\t') {
            result.warnings.push(ValidationIssue {
                line: line_num + 1,
                column: 1,
                message: "Tab character found (HOI4 uses spaces, not tabs)".to_string(),
                code: "TAB_CHARACTER".to_string(),
                severity: "warning".to_string(),
            });
        }

        // Check for BOM marker (UTF-8 BOM at start of file)
        if line_num == 0 && line.starts_with('\u{feff}') {
            result.warnings.push(ValidationIssue {
                line: 1,
                column: 1,
                message: "UTF-8 BOM marker found at start of file (may cause issues)".to_string(),
                code: "UTF8_BOM".to_string(),
                severity: "warning".to_string(),
            });
        }
    }
}

fn validate_ai_will_do(lines: &[&str], result: &mut ValidationResult) {
    let mut in_ai_will_do = false;
    let mut brace_depth = 0isize;
    let mut ai_brace_start = 0isize; // track brace depth when we entered ai_will_do
    let mut ai_line = 0;

    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Track brace depth
        let open_count = trimmed.matches('{').count() as isize;
        let close_count = trimmed.matches('}').count() as isize;
        brace_depth += open_count;
        brace_depth -= close_count;

        // Skip comment-only lines so they don't interfere with brace tracking
        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            let lower = trimmed.to_lowercase();

            if lower.contains("ai_will_do") {
                in_ai_will_do = true;
                ai_line = line_num + 1;
                ai_brace_start = brace_depth;
            }

            // Check if ai_will_do has a base value
            if in_ai_will_do && (lower.contains("factor") || lower.contains("base")) {
                // Extract the number after factor or base
                let find_keyword = |s: &str| s.find("factor").or_else(|| s.find("base"));
                if let Some(pos) = find_keyword(&lower) {
                    let after = &trimmed[pos..];
                    let parts: Vec<&str> = after.split_whitespace().collect();
                    if parts.len() >= 2 {
                        // parts[0]=keyword, parts[1]=optional "=", parts[2]=value
                        let value_idx = if parts[1] == "=" { 2 } else { 1 };
                        if let Some(val) = parts.get(value_idx) {
                            if let Ok(n) = val.parse::<f64>() {
                                if n == 0.0 {
                                    result.warnings.push(ValidationIssue {
                                        line: line_num + 1,
                                        column: 1,
                                        message: "ai_will_do has base/factor = 0 — this focus will never be chosen by AI".to_string(),
                                        code: "AI_WILL_DO_ZERO".to_string(),
                                        severity: "warning".to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Reset when we've exited the ai_will_do block
        if in_ai_will_do && brace_depth <= ai_brace_start && line_num > ai_line {
            in_ai_will_do = false;
        }
    }
}

fn validate_cancel_if_invalid(lines: &[&str], result: &mut ValidationResult) {
    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();

        // Check for cancel_if_invalid = yes (the default, sometimes needs to be no)
        if lower.contains("cancel_if_invalid") {
            if lower.contains("= no") || lower.contains("= false") {
                // This is often intentional but worth noting
                result.warnings.push(ValidationIssue {
                    line: line_num + 1,
                    column: 1,
                    message: "cancel_if_invalid = no 鈥?focus will remain even if conditions are no longer met".to_string(),
                    code: "CANCEL_IF_INVALID_NO".to_string(),
                    severity: "info".to_string(),
                });
            }
        }
    }
}

fn validate_original_tag(lines: &[&str], result: &mut ValidationResult) {
    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();

        // Check for original_tag usage with lowercase value
        if lower.contains("original_tag") {
            // Check if value is in lowercase (should be uppercase country tag)
            if let Some(pos) = lower.find("original_tag") {
                let after = &trimmed[pos..];
                let parts: Vec<&str> = after.split_whitespace().collect();
                if parts.len() >= 2 {
                    let val = parts[1].trim_matches(|c| c == '=' || c == '{' || c == '}');
                    if val.chars().any(|c| c.is_ascii_lowercase()) && val.len() >= 2 && val.len() <= 4 {
                        // Likely a country tag (2-4 chars) 鈥?check if it's lowercase
                        if !val.starts_with('{') {
                            result.warnings.push(ValidationIssue {
                                line: line_num + 1,
                                column: 1,
                                message: format!(
                                    "original_tag value '{}' may need to be uppercase (e.g., POL not pol)",
                                    val
                                ),
                                code: "ORIGINAL_TAG_CASE".to_string(),
                                severity: "warning".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }
}

fn validate_empty_blocks(lines: &[&str], result: &mut ValidationResult) {
    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Check for {} empty blocks (often unintentional)
        if trimmed.contains("{}") && !trimmed.contains("= {}") {
            result.warnings.push(ValidationIssue {
                line: line_num + 1,
                column: trimmed.find("{}").map(|p| p + 1).unwrap_or(1),
                message: "Empty block '{}' found 鈥?this may be unintentional".to_string(),
                code: "EMPTY_BLOCK".to_string(),
                severity: "warning".to_string(),
            });
        }
    }
}
