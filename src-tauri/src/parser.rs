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
    Comment(String),
    Eof,
}

// ---------- Lexer ----------

pub struct Lexer {
    input: Vec<char>,
    pos: usize,
    line: usize,
}

impl Lexer {
    pub fn new(input: &str) -> Self {
        Lexer { input: input.chars().collect(), pos: 0, line: 1 }
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
            if ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
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
        
        let ch = self.peek().unwrap();
        self.advance();
        
        match ch {
            '{' => Token::OpenBrace,
            '}' => Token::CloseBrace,
            '=' => Token::Equals,
            '[' => Token::OpenBracket,
            ']' => Token::CloseBracket,
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
                Token::Comment(_) => continue,
                t => return Err(ParseError::InvalidToken(format!("Expected key, got {:?}", t))),
            };

            let is_block = if matches!(self.peek(), Some(Token::Equals)) {
                self.advance();
                false
            } else { matches!(self.peek(), Some(Token::OpenBrace)) };

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

            children.push(KeyValue { key, value, is_block, trailing_comment: None });
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
                    if kv.is_block { format!("{}\n{} = {}", sp, kv.key, vs) }
                    else { format!("{}{} = {}", sp, kv.key, vs) }
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
        if kv.is_block { format!("{}\n{}", kv.key, vs) } else { format!("{} = {}", kv.key, vs) }
    }).collect::<Vec<_>>().join("\n\n")
}

pub fn parse_focus_tree(content: &str) -> Result<Hoi4Ast, crate::AppError> {
    parse_hoi4_file(content, "focus_tree")
}

pub fn parse_ideas(content: &str) -> Result<Hoi4Ast, crate::AppError> {
    parse_hoi4_file(content, "ideas")
}
