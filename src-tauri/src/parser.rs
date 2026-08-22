#![allow(unused)]
// HOI4 script file parser

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ParseError {
    #[error("Unmatched bracket at line {line}: {context}")]
    UnmatchedBracket { line: usize, context: String },
    #[error("Unexpected end of file")]
    UnexpectedEof,
    #[error("Invalid token: {0}")]
    InvalidToken(String),
}

impl serde::Serialize for ParseError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ---------- AST Types ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Hoi4Value {
    #[serde(rename = "string")]
    String { value: String },
    #[serde(rename = "number")]
    Number { value: f64, raw: String },
    #[serde(rename = "bool")]
    Bool { value: bool },
    #[serde(rename = "object")]
    Object { children: Vec<KeyValue> },
    #[serde(rename = "array")]
    Array { items: Vec<Hoi4Value> },
    #[serde(rename = "comment")]
    Comment { value: String },
    #[serde(rename = "empty")]
    Empty,
}

impl Hoi4Value {
    fn empty() -> Self { Hoi4Value::Empty }
    fn string(s: impl Into<String>) -> Self { Hoi4Value::String { value: s.into() } }
    fn number(n: f64, raw: impl Into<String>) -> Self { Hoi4Value::Number { value: n, raw: raw.into() } }
    fn bool(b: bool) -> Self { Hoi4Value::Bool { value: b } }
    fn object(children: Vec<KeyValue>) -> Self { Hoi4Value::Object { children } }
    fn array(items: Vec<Hoi4Value>) -> Self { Hoi4Value::Array { items } }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: Hoi4Value,
    pub is_block: bool,
    pub trailing_comment: Option<String>,
    /// 比较运算符 (trigger 语法 key > value), "=" 时为 None
    #[serde(default)]
    pub operator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hoi4Ast {
    pub children: Vec<KeyValue>,
    pub source: Option<String>,
}

impl Default for Hoi4Ast {
    fn default() -> Self { Hoi4Ast { children: Vec::new(), source: None } }
}

// ---------- Token Types ----------

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Ident(String),
    String(String),
    Number(String),
    Equals,
    OpenBrace,
    CloseBrace,
    OpenBracket,
    CloseBracket,
    /// 比较运算符: ">", "<", ">=", "<=" (trigger 语法 key > value)
    Operator(String),
    Comment(String),
    Eof,
}

// ---------- Lexer ----------

/// 单个 token 的源位置：1-based 行 + token 起始处的字符下标。
/// `col`（Monaco UTF-16 列）不在词法期间直接维护——词法有回退分支（数字/标识符重读），
/// 逐字累积列会被多算；改为记录 `pos`（字符下标），由 collect_ident_keys 用
/// 预先算好的 UTF-16 前缀表换算成列。行号由 advance() 单调累加，不受回退影响。
#[derive(Debug, Clone, Copy)]
pub struct Span {
    /// 1-based 行号
    pub line: usize,
    /// token 起始处的字符下标（input: Vec<char> 的下标）
    pub pos: usize,
}

pub struct SpannedTokens {
    pub tokens: Vec<Token>,
    pub spans: Vec<Span>,
}

pub struct Lexer {
    input: Vec<char>,
    pos: usize,
    line: usize,
    /// 每个真实返回 token 对应的源位置（与 tokenize 产物保持下标对齐；Eof 无 span）。
    pub spans: Vec<Span>,
}

impl Lexer {
    pub fn new(input: &str) -> Self {
        Lexer { input: input.chars().collect(), pos: 0, line: 1, spans: Vec::new() }
    }

    fn peek(&self) -> Option<char> { self.input.get(self.pos).copied() }
    
    fn advance(&mut self) -> Option<char> {
        let ch = self.input.get(self.pos).copied();
        self.pos += 1;
        if ch == Some('\n') { self.line += 1; }
        ch
    }

    fn skip_whitespace(&mut self) {
        // Skip UTF-8 BOM at very start of file (U+FEFF)
        if self.pos == 0 && self.input.first() == Some(&'\u{feff}') {
            self.advance();
        }
        while let Some(ch) = self.peek() {
            if ch.is_whitespace() { self.advance(); }
            else if ch == '#' { self.skip_comment(); }
            else { break; }
        }
    }

    fn skip_comment(&mut self) {
        while let Some(ch) = self.peek() {
            if ch == '\n' { break; }
            self.advance();
        }
    }

    fn read_string(&mut self, quote: char) -> String {
        self.advance();
        let mut result = String::new();
        let mut escaped = false;
        while let Some(ch) = self.peek() {
            if escaped {
                match ch {
                    '"' => result.push('"'),
                    '\\' => result.push('\\'),
                    'n' => result.push('\n'),
                    't' => result.push('\t'),
                    _ => result.push(ch),
                }
                escaped = false;
                self.advance();
            } else if ch == '\\' {
                escaped = true;
                self.advance();
            } else if ch == quote {
                self.advance();
                break;
            } else if ch == '\u{00a7}' || ch == '\u{00a9}' {
                // HOI4 colour codes: § (section sign) and © are part of the string
                result.push(ch);
                self.advance();
            } else {
                result.push(ch);
                self.advance();
            }
        }
        result
    }

    fn read_ident(&mut self) -> String {
        let mut result = String::new();
        while let Some(ch) = self.peek() {
            // ':' 是作用域引用分隔符 (mio:xxx, var:xxx, prev:prev), 属于标识符的一部分
            if ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == '.' || ch == ':' {
                result.push(ch);
                self.advance();
            } else { break; }
        }
        result
    }

    fn read_number(&mut self) -> String {
        let mut result = String::new();
        let mut has_dot = false;
        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                result.push(ch);
                self.advance();
            } else if ch == '.' && !has_dot {
                has_dot = true;
                result.push(ch);
                self.advance();
            } else if (ch == '-' || ch == '+') && result.is_empty() {
                result.push(ch);
                self.advance();
            } else { break; }
        }
        result
    }

    pub fn next_token(&mut self) -> Token {
        self.skip_whitespace();
        if self.pos >= self.input.len() { return Token::Eof; }

        // 记录 token 起始位置（行号在 advance 时单调累加，pos 为稳定字符下标）
        self.spans.push(Span { line: self.line, pos: self.pos });

        let ch = self.peek().unwrap();
        self.advance();
        
        match ch {
            '{' => Token::OpenBrace,
            '}' => Token::CloseBrace,
            '=' => Token::Equals,
            '[' => Token::OpenBracket,
            ']' => Token::CloseBracket,
            '>' | '<' => {
                // 比较运算符, 支持 ">=" / "<=" 组合
                let mut op = String::from(ch);
                if self.peek() == Some('=') {
                    op.push('=');
                    self.advance();
                }
                Token::Operator(op)
            }
            '#' => {
                let mut comment = String::new();
                while let Some(c) = self.peek() {
                    if c == '\n' { break; }
                    comment.push(c);
                    self.advance();
                }
                Token::Comment(comment.trim().to_string())
            }
            '"' | '\'' => Token::String(self.read_string(ch)),
            _ => {
                self.pos -= 1;
                if ch.is_ascii_digit() || ch == '-' {
                    Token::Number(self.read_number())
                } else {
                    let ident = self.read_ident();
                    if ident.is_empty() {
                        // 未识别的字符: 跳过而非死循环 (游标已回退, 必须前进)
                        self.advance();
                        eprintln!(
                            "[lexer] warning: skipping unrecognized character {:?} at line {}",
                            ch, self.line
                        );
                        // 该字符未产出 token，弹掉为它多记的 span，保持 spans 与 tokens 对齐
                        self.spans.pop();
                        return self.next_token();
                    }
                    match ident.to_lowercase().as_str() {
                        "yes" | "true" => Token::Ident("yes".into()),
                        "no" | "false" => Token::Ident("no".into()),
                        _ => Token::Ident(ident),
                    }
                }
            }
        }
    }

    pub fn tokenize(&mut self) -> Vec<Token> {
        let mut tokens = Vec::new();
        loop {
            let tok = self.next_token();
            if tok == Token::Eof { tokens.push(tok); break; }
            tokens.push(tok);
        }
        tokens
    }
}

/// 带源位置的词法分析：返回 tokens 及逐 token 的 Span（与 tokens 下标对齐）。
/// 末尾的 Eof 无对应 span（spans 比 tokens 少一项）。
pub fn lex_spanned(content: &str) -> SpannedTokens {
    let mut lexer = Lexer::new(content);
    let tokens = lexer.tokenize();
    let spans = std::mem::take(&mut lexer.spans);
    SpannedTokens { tokens, spans }
}

// ---------- Parser ----------

pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
    depth: usize,       // current recursion depth
    max_depth: usize,   // maximum allowed depth
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self { Parser { tokens, pos: 0, depth: 0, max_depth: 200 } }
    
    fn peek(&self) -> Option<&Token> { self.tokens.get(self.pos) }
    
    fn advance(&mut self) -> Option<Token> {
        if self.pos < self.tokens.len() {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            Some(tok)
        } else { None }
    }

    fn expect(&mut self, expected: &Token) -> Result<Token, ParseError> {
        let tok = self.advance().ok_or(ParseError::UnexpectedEof)?;
        match (&tok, expected) {
            (Token::OpenBrace, Token::OpenBrace) |
            (Token::CloseBrace, Token::CloseBrace) |
            (Token::OpenBracket, Token::OpenBracket) |
            (Token::CloseBracket, Token::CloseBracket) |
            (Token::Equals, Token::Equals) => Ok(tok),
            _ => Err(ParseError::InvalidToken(format!("Expected {:?}, got {:?}", expected, tok))),
        }
    }

    fn parse_value(&mut self) -> Result<Hoi4Value, ParseError> {
        let tok = self.advance().ok_or(ParseError::UnexpectedEof)?;
        match tok {
            Token::String(s) => Ok(Hoi4Value::string(s)),
            Token::Number(n) => Ok(Hoi4Value::number(n.parse().unwrap_or(0.0), n)),
            Token::Ident(id) => match id.to_lowercase().as_str() {
                "yes" | "true" => Ok(Hoi4Value::bool(true)),
                "no" | "false" => Ok(Hoi4Value::bool(false)),
                _ => Ok(Hoi4Value::string(id)),
            },
            Token::OpenBrace => {
                self.depth += 1;
                if self.depth > self.max_depth {
                    self.depth -= 1;
                    return Err(ParseError::InvalidToken(format!(
                        "Nesting too deep (>{}) — file may be malformed", self.max_depth
                    )));
                }
                let result = self.parse_block();
                self.depth -= 1;
                let children = result?;
                self.expect(&Token::CloseBrace)?;
                Ok(Hoi4Value::object(children))
            }
            Token::OpenBracket => {
                self.depth += 1;
                if self.depth > self.max_depth {
                    self.depth -= 1;
                    return Err(ParseError::InvalidToken(format!(
                        "Nesting too deep (>{}) — file may be malformed", self.max_depth
                    )));
                }
                let result = self.parse_array();
                self.depth -= 1;
                let items = result?;
                self.expect(&Token::CloseBracket)?;
                Ok(Hoi4Value::array(items))
            }
            Token::Comment(c) => Ok(Hoi4Value::Comment { value: c }),
            _ => Err(ParseError::InvalidToken(format!("Unexpected token: {:?}", tok))),
        }
    }

    fn parse_block(&mut self) -> Result<Vec<KeyValue>, ParseError> {
        let mut children = Vec::new();
        loop {
            match self.peek() {
                Some(Token::CloseBrace) | Some(Token::Eof) | None => break,
                Some(Token::Comment(_)) => { self.advance(); continue; }
                _ => {}
            }
            
            let key_tok = self.advance().ok_or(ParseError::UnexpectedEof)?;
            let key = match key_tok {
                Token::Ident(s) | Token::String(s) => s,
                // 数字亦可作 key: 数组风格块 { 6321 3295 } 与数字作用域引用 85 = { ... }
                Token::Number(s) => s,
                Token::Comment(_) => continue,
                t => return Err(ParseError::InvalidToken(format!("Expected key, got {:?}", t))),
            };

            let is_block = if matches!(self.peek(), Some(Token::Equals)) {
                self.advance();
                false
            } else { matches!(self.peek(), Some(Token::OpenBrace)) };

            // 比较运算符: key > value (trigger 语法)
            let operator = match self.peek() {
                Some(Token::Operator(op)) => {
                    let op = op.clone();
                    self.advance();
                    Some(op)
                }
                _ => None,
            };

            // 数组风格块 { A } / { A B }: 裸值后紧跟 "}", 无 key/value 结构。
            // 此时把裸值记为 Empty 值, 由外层循环统一处理 "}" (防崩, 语义近似)。
            if operator.is_none()
                && !is_block
                && matches!(self.peek(), Some(Token::CloseBrace))
            {
                children.push(KeyValue {
                    key,
                    value: Hoi4Value::Empty,
                    is_block: false,
                    trailing_comment: None,
                    operator: None,
                });
                continue;
            }

            let value = if matches!(self.peek(), Some(Token::OpenBrace)) && !is_block {
                self.advance();
                let block = self.parse_block()?;
                self.expect(&Token::CloseBrace)?;
                Hoi4Value::object(block)
            } else if matches!(self.peek(), Some(Token::OpenBracket)) {
                self.advance();
                let items = self.parse_array()?;
                self.expect(&Token::CloseBracket)?;
                Hoi4Value::array(items)
            } else {
                self.parse_value()?
            };

            children.push(KeyValue { key, value, is_block, trailing_comment: None, operator });
        }
        Ok(children)
    }

    fn parse_array(&mut self) -> Result<Vec<Hoi4Value>, ParseError> {
        let mut items = Vec::new();
        loop {
            match self.peek() {
                Some(Token::CloseBracket) | Some(Token::Eof) | None => break,
                Some(Token::Comment(_)) => { self.advance(); continue; }
                _ => items.push(self.parse_value()?),
            }
        }
        Ok(items)
    }

    pub fn parse(&mut self) -> Result<Hoi4Ast, ParseError> {
        Ok(Hoi4Ast { children: self.parse_block()?, source: None })
    }

    /// 错误定位: 当前 token 位置及其前后上下文 (调试用)
    pub fn error_context(&self, radius: usize) -> String {
        let lo = self.pos.saturating_sub(radius);
        let hi = (self.pos + radius).min(self.tokens.len());
        let ctx: Vec<String> = self.tokens[lo..hi]
            .iter()
            .map(|t| format!("{t:?}"))
            .collect();
        format!("{} {:?}", self.pos, ctx)
    }
}

// ---------- Public API ----------

pub fn parse_hoi4_file(content: &str, _path: &str) -> Result<Hoi4Ast, crate::AppError> {
    let mut lexer = Lexer::new(content);
    let tokens = lexer.tokenize();
    let mut parser = Parser::new(tokens);
    parser.parse().map_err(|e| crate::AppError::Parse(e.to_string()))
}

pub fn serialize_ast(ast: &Hoi4Ast) -> String {
    fn ser_val(v: &Hoi4Value, indent: usize) -> String {
        let sp = "    ".repeat(indent);
        match v {
            Hoi4Value::String { value } => format!("\"{}\"", value),
            Hoi4Value::Number { raw, .. } => raw.clone(),
            Hoi4Value::Bool { value } => if *value { "yes".into() } else { "no".into() },
            Hoi4Value::Empty => String::new(),
            Hoi4Value::Comment { value } => format!("# {}", value),
            Hoi4Value::Object { children } => {
                if children.is_empty() { return "{}".into(); }
                let inner: Vec<String> = children.iter().map(|kv| {
                    let vs = ser_val(&kv.value, indent + 1);
                    let op = kv.operator.as_deref().unwrap_or("=");
                    if kv.is_block { format!("{}\n{}", sp, kv.key) }
                    else { format!("{}{} {} {}", sp, kv.key, op, vs) }
                }).collect();
                format!("{{\n{}\n{}}}", inner.join("\n"), sp)
            }
            Hoi4Value::Array { items } => {
                let inner: Vec<String> = items.iter().map(|i| format!("{}    {}", sp, ser_val(i, indent + 1))).collect();
                format!("[\n{}\n{}]", inner.join("\n"), sp)
            }
        }
    }
    ast.children.iter().map(|kv| {
        let vs = ser_val(&kv.value, 0);
        let op = kv.operator.as_deref().unwrap_or("=");
        if kv.is_block { format!("{}\n{}", kv.key, vs) }
        else { format!("{} {} {}", kv.key, op, vs) }
    }).collect::<Vec<_>>().join("\n\n")
}

pub fn parse_focus_tree(content: &str) -> Result<Hoi4Ast, crate::AppError> {
    parse_hoi4_file(content, "focus_tree")
}

pub fn parse_ideas(content: &str) -> Result<Hoi4Ast, crate::AppError> {
    parse_hoi4_file(content, "ideas")
}

// ============================================================
// 宽容 key 采集（取代 main.rs 的 scan_idents_with_paths）
// ============================================================
//
// 目的：Monaco 悬停 / 语义着色需要「每个 key 标识符 + 源位置 + 块路径栈」。
// 旧实现是 main.rs 里一套独立字符扫描器，用 `prev` 字符启发式判断 key 位置，
// 在「一行多个 key = value」时（如 `add_power = 50 add_stab = 0.1`）会把前一个
// 值之后的 key 误判为值而跳过。这里复用真实词法器（字符串/注释/§©/转义/`>=`/bool/`[]`
// 已正确处理）与解析器语法（parse_block 的 key 判定天然支持单行多 key），
// 按语法宽松地走一遍，产出 key 列表 + Monaco 列 + 命名块路径栈。
// 宽容模式：语句解析失败不中止整体，跳过坏段继续处理下一个块（编辑器常在打半成品代码）。

/// 采集到的单个 key 标识符（含源位置 + 命名块路径栈）。
/// line: 1-based；start_char: 0-based UTF-16 列；length: UTF-16 单位；path: 外层命名块名（内层在后）。
#[derive(Debug, Clone)]
pub struct PositionedKey {
    pub line: usize,
    pub start_char: usize,
    pub length: usize,
    pub text: String,
    pub path: Vec<String>,
}

#[derive(Debug, Default)]
pub struct ParseOutcome {
    pub keys: Vec<PositionedKey>,
}

/// key 所在的 token 种类：仅标识符/字符串作为产出 key；数字 key（块权重/州ID）只占结构不产出。
#[derive(PartialEq, Clone, Copy)]
enum KeyKind {
    Ident,
    String,
    Number,
}

/// 宽松文法扫描器：镜像 Parser::parse_block 的 key 判定，但语句级错误不中止，
/// 而是 recover 跳到下一个块继续；同时记录每个 key 的命名块路径栈。
struct KeyScanner<'a> {
    toks: &'a [Token],
    /// 命名的含块名栈（内层在后）；仅命名的 `{` 块会 push。
    stack: Vec<String>,
    /// 与每个 `{` 开括号对齐：是否命名块（决定 `}` 时是否弹 stack）。
    named: Vec<bool>,
    /// 采集结果：(token 下标, text, path)。
    keys: Vec<(usize, String, Vec<String>)>,
    pos: usize,
}

fn utf16_len(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16() as usize).sum()
}

impl<'a> KeyScanner<'a> {
    fn new(sp: &'a SpannedTokens) -> Self {
        KeyScanner {
            toks: &sp.tokens,
            stack: Vec::new(),
            named: Vec::new(),
            keys: Vec::new(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<&Token> { self.toks.get(self.pos) }

    fn advance(&mut self) {
        if self.pos < self.toks.len() { self.pos += 1; }
    }

    /// 一个 `{` 开块：命名块压入块名栈，同时记录该开块是命名块（供 `}` 时弹栈）。
    fn open_named(&mut self, name: &str) {
        self.named.push(true);
        self.stack.push(name.to_string());
    }
    fn open_anon(&mut self) {
        self.named.push(false);
    }
    /// 一个 `}` 闭块：若对应开块是命名块则弹 stack。
    fn close_block(&mut self) {
        if self.named.pop().unwrap_or(false) {
            self.stack.pop();
        }
    }

    /// 记录一个 key 标识符（path = 当前命名块栈）。
    fn record(&mut self, token_idx: usize, text: &str) {
        self.keys.push((token_idx, text.to_string(), self.stack.clone()));
    }

    /// 顶层入口：宽容解析全部 token，产出所有 key 的下标/text/path。
    fn scan_all(&mut self) {
        // 顶层可能直接以 `{ ... }`（匿名块）开头，如 `{ building = X size > 0 }`
        if matches!(self.peek(), Some(Token::OpenBrace)) {
            self.open_anon();
            self.advance();
            self.parse_block();
            if matches!(self.peek(), Some(Token::CloseBrace)) {
                self.close_block();
                self.advance();
            }
        }
        self.parse_block();
    }

    /// 宽容版 parse_block：循环语句，语句解析失败则 recovery，直到块结束/文件尾。
    fn parse_block(&mut self) {
        loop {
            match self.peek() {
                None | Some(Token::Eof) | Some(Token::CloseBrace) => break,
                Some(Token::Comment(_)) => { self.advance(); continue; }
                _ => {}
            }
            if !self.parse_statement() {
                self.recover_block();
            }
        }
    }

    /// 解析一条 `key ...` 语句。返回 false 表示无法识别语句头，需 recovery。
    fn parse_statement(&mut self) -> bool {
        let key_idx = self.pos;
        let key_tok = match self.toks.get(self.pos) {
            Some(Token::Ident(s)) => (KeyKind::Ident, s.clone()),
            Some(Token::String(s)) => (KeyKind::String, s.clone()),
            Some(Token::Number(s)) => (KeyKind::Number, s.clone()),
            Some(Token::Comment(_)) => { self.advance(); return true; }
            _ => return false,
        };
        let (kind, key_text) = key_tok;
        self.advance(); // 消费 key token

        // 判断是否块名：`key =`（则看下一个）或裸 `key {`
        let is_named_block = if matches!(self.peek(), Some(Token::Equals)) {
            self.advance();
            matches!(self.peek(), Some(Token::OpenBrace))
        } else {
            matches!(self.peek(), Some(Token::OpenBrace))
        };

        // 可选比较运算符（trigger 语法 key > value）
        if matches!(self.peek(), Some(Token::Operator(_))) {
            self.advance();
        }

        // 记录 key（数字 key 只占结构、不产出）
        if kind != KeyKind::Number {
            self.record(key_idx, &key_text);
        }

        // 消费值。is_named_block 为真时已吃掉了 `=`（若有）且下一个是 `{`：
        // `key = { ... }` 与 `key { ... }` 都按命名块处理（旧扫描器语义一致）。
        if is_named_block {
            // 数字 key（块权重/州ID）虽占结构但不产出、也不作为命名的父块（与旧扫描器一致）
            if kind == KeyKind::Number {
                self.open_anon();
            } else {
                self.open_named(&key_text);
            }
            self.advance(); // '{'
            self.parse_block();
            if matches!(self.peek(), Some(Token::CloseBrace)) {
                self.close_block();
                self.advance();
            }
        } else if matches!(self.peek(), Some(Token::OpenBracket)) {
            self.skip_array_body();
        } else {
            // 标量值：消费一个值 token（标识符/数字/字符串/bool/注释/比较运算符）
            match self.peek() {
                Some(Token::Ident(_)) | Some(Token::Number(_)) | Some(Token::String(_))
                | Some(Token::Operator(_))
                | Some(Token::Comment(_)) => { self.advance(); }
                // 值位置遇到 `{`/`}`/Eof 等：宽容跳过，不阻塞（返回 true，语句已尽力消费）
                _ => {}
            }
        }
        true
    }

    /// 跳过数组体 `[ ... ]`（数组元素是值，不产生 key，直接跳到匹配 `]`）。
    fn skip_array_body(&mut self) {
        let mut depth = 0usize;
        loop {
            match self.peek() {
                None | Some(Token::Eof) => break,
                Some(Token::OpenBracket) => { depth += 1; self.advance(); }
                Some(Token::CloseBracket) => {
                    if depth == 0 { self.advance(); break; }
                    depth -= 1; self.advance();
                }
                _ => { self.advance(); }
            }
        }
    }

    /// 恢复：坏语句（无法识别语句头）→ 向后跳到下一个“看起来像语句起点”的 token
    /// （Ident/String/Number，作为新 key 继续解析），或当前块结束 `}` / 文件尾则停止。
    /// 这样坏段之后的有效兄弟块能继续被采集（「fail 就往后处理下一个块」）。
    fn recover_block(&mut self) {
        let mut guard = 0usize;
        loop {
            match self.peek() {
                None | Some(Token::Eof) | Some(Token::CloseBrace) => return,
                Some(Token::Ident(_)) | Some(Token::String(_)) | Some(Token::Number(_)) => return,
                _ => {
                    guard += 1;
                    if guard > self.toks.len() { return; } // 保证推进，防死循环
                    self.advance();
                }
            }
        }
    }
}

/// 把扫描结果按 span + UTF-16 前缀表换算成 PositionedKey（行/列/长度）。
fn to_positioned(tokens: &[Token], spans: &[Span], content: &str,
                 items: Vec<(usize, String, Vec<String>)>) -> Vec<PositionedKey> {
    if items.is_empty() { return Vec::new(); }
    // UTF-16 前缀表 与 行首字符下标
    let chars: Vec<char> = content.chars().collect();
    let mut utf16 = vec![0usize; chars.len() + 1];
    for i in 0..chars.len() {
        utf16[i + 1] = utf16[i] + chars[i].len_utf16() as usize;
    }
    let mut line_starts: Vec<usize> = vec![0];
    for (i, &c) in chars.iter().enumerate() {
        if c == '\n' { line_starts.push(i + 1); }
    }

    let mut out = Vec::with_capacity(items.len());
    for (idx, text, path) in items {
        let span = match spans.get(idx) {
            Some(s) => *s,
            None => continue, // 防御：无位置的 token（如 Eof）不应是 key
        };
        let line1 = span.line.max(1);
        let line_start = line_starts.get(line1 - 1).copied().unwrap_or(0);
        let line_start_col = utf16.get(line_start).copied().unwrap_or(0);
        let start_char = utf16.get(span.pos).copied().unwrap_or(line_start_col) - line_start_col;
        let length = utf16_len(&text);
        out.push(PositionedKey { line: line1, start_char, length, text, path });
    }
    out
}

/// 宽容模式入口：解析 content，产出所有「key 标识符」的位置与命名块路径栈。
/// 永不失败；残缺/错误代码尽力产出可解析部分的 key。
pub fn collect_ident_keys(content: &str) -> ParseOutcome {
    let sp = lex_spanned(content);
    let mut scanner = KeyScanner::new(&sp);
    scanner.scan_all();
    let keys = to_positioned(&sp.tokens, &sp.spans, content, scanner.keys);
    ParseOutcome { keys }
}
