use super::*;
use std::collections::{BTreeMap, HashSet};
#[derive(Clone)]
struct Token<'a> {
    text: &'a str,
    line: u32,
    column: u32,
    identifier: bool,
}
struct Cursor<'a> {
    text: &'a str,
    offset: usize,
    line: u32,
    column: u32,
}
impl Cursor<'_> {
    fn rest(&self) -> &str {
        &self.text[self.offset..]
    }
    fn advance(&mut self, bytes: usize) {
        let end = self.offset + bytes;
        for c in self.text[self.offset..end].chars() {
            if c == '\n' {
                self.line += 1;
                self.column = 0;
            } else {
                self.column += c.len_utf16() as u32;
            }
        }
        self.offset = end;
    }
}
fn identifier(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '$')
}
fn lex<'a>(text: &'a str, p: &SymbolProfile) -> (Vec<Token<'a>>, bool) {
    let mut c = Cursor {
        text,
        offset: 0,
        line: 0,
        column: 0,
    };
    let mut tokens: Vec<Token<'a>> = Vec::new();
    let mut partial = false;
    'source: while !c.rest().is_empty() {
        let ch = c.rest().chars().next().unwrap();
        if ch.is_whitespace() {
            c.advance(ch.len_utf8());
            continue;
        }
        for pair in &p.comments {
            if c.rest().starts_with(&pair[0]) {
                c.advance(pair[0].len());
                if p.nested_comments && pair[1] != "\n" {
                    let mut depth = 1;
                    while !c.rest().is_empty() && depth > 0 {
                        if c.rest().starts_with(&pair[0]) {
                            depth += 1;
                            if depth > 64 {
                                partial = true;
                                c.advance(c.rest().len());
                                break;
                            }
                            c.advance(pair[0].len());
                        } else if c.rest().starts_with(&pair[1]) {
                            depth -= 1;
                            c.advance(pair[1].len());
                        } else {
                            let ch = c.rest().chars().next().unwrap();
                            c.advance(ch.len_utf8());
                        }
                    }
                    partial |= depth > 0;
                } else if let Some(end) = c.rest().find(&pair[1]) {
                    c.advance(end + pair[1].len());
                } else {
                    partial |= pair[1] != "\n";
                    c.advance(c.rest().len());
                }
                continue 'source;
            }
        }
        for raw in &p.raw_strings {
            if c.rest().starts_with(&raw.prefix) {
                let remain = &c.rest()[raw.prefix.len()..];
                let count = remain
                    .bytes()
                    .take_while(|b| *b == raw.marker.as_bytes()[0])
                    .count();
                if count > 0
                    && count <= 16
                    && remain[count..].chars().next().is_some_and(identifier)
                {
                    // An unsupported prefixed identifier must not turn its prefix into a declaration.
                    c.advance(raw.prefix.len() + count);
                    while let Some(next) = c.rest().chars().next() {
                        if !identifier(next) {
                            break;
                        }
                        c.advance(next.len_utf8());
                    }
                    partial = true;
                    continue 'source;
                }
                if count <= 16 && remain[count..].starts_with(&raw.quote) {
                    let end = format!("{}{}", raw.quote, raw.marker.repeat(count));
                    c.advance(raw.prefix.len() + count + raw.quote.len());
                    if let Some(length) = c.rest().find(&end) {
                        c.advance(length + end.len());
                    } else {
                        partial = true;
                        c.advance(c.rest().len());
                    }
                    continue 'source;
                }
            }
        }
        for delimiter in &p.quoted_identifiers {
            if c.rest().starts_with(delimiter) {
                c.advance(delimiter.len());
                let start = c.offset;
                let line = c.line;
                let column = c.column;
                if let Some(end) = c.rest().find(delimiter) {
                    let name = &c.rest()[..end];
                    if name.len() <= 128 && !name.chars().any(char::is_control) {
                        tokens.push(Token {
                            text: &text[start..start + end],
                            line,
                            column,
                            identifier: true,
                        });
                    }
                    c.advance(end + delimiter.len());
                } else {
                    partial = true;
                    c.advance(c.rest().len());
                }
                continue 'source;
            }
        }
        if ch == '\'' && p.character_literals {
            let mut iter = c.rest()[1..].char_indices();
            if let Some((_, first)) = iter.next() {
                let end = if first == '\\' {
                    iter.next().map(|(i, ch)| 1 + i + ch.len_utf8())
                } else {
                    Some(1 + first.len_utf8())
                };
                if let Some(end) = end
                    && c.rest()[end..].starts_with('\'')
                {
                    c.advance(end + 1);
                    continue;
                }
            }
        }
        for delimiter in &p.strings {
            if c.rest().starts_with(delimiter) {
                c.advance(delimiter.len());
                let mut closed = false;
                while !c.rest().is_empty() {
                    if c.rest().starts_with(delimiter) {
                        c.advance(delimiter.len());
                        closed = true;
                        break;
                    }
                    let next = c.rest().chars().next().unwrap();
                    c.advance(next.len_utf8());
                    if next == '\\' && delimiter.len() == 1 && !c.rest().is_empty() {
                        let next = c.rest().chars().next().unwrap();
                        c.advance(next.len_utf8());
                    }
                }
                partial |= !closed;
                continue 'source;
            }
        }
        if ch == '/'
            && p.regex_literals
            && tokens
                .last()
                .is_none_or(|t| p.regex_start_after.iter().any(|value| value == t.text))
        {
            c.advance(1);
            let mut bracket = false;
            let mut closed = false;
            while !c.rest().is_empty() {
                let next = c.rest().chars().next().unwrap();
                c.advance(next.len_utf8());
                if next == '\\' && !c.rest().is_empty() {
                    let next = c.rest().chars().next().unwrap();
                    c.advance(next.len_utf8());
                    continue;
                }
                if next == '[' {
                    bracket = true;
                }
                if next == ']' {
                    bracket = false;
                }
                if next == '/' && !bracket {
                    closed = true;
                    break;
                }
                if next == '\n' {
                    break;
                }
            }
            partial |= !closed;
            while c
                .rest()
                .chars()
                .next()
                .is_some_and(|v| v.is_ascii_alphabetic())
            {
                c.advance(1);
            }
            continue;
        }
        let start = c.offset;
        let line = c.line;
        let column = c.column;
        let is_identifier = identifier(ch) && !ch.is_numeric();
        if is_identifier {
            c.advance(ch.len_utf8());
            while let Some(next) = c.rest().chars().next() {
                if !identifier(next) {
                    break;
                }
                c.advance(next.len_utf8());
            }
        } else if let Some(compound) = p
            .compound_tokens
            .iter()
            .find(|t| c.rest().starts_with(t.as_str()))
        {
            c.advance(compound.len());
        } else {
            c.advance(ch.len_utf8());
        }
        tokens.push(Token {
            text: &text[start..c.offset],
            line,
            column,
            identifier: is_identifier,
        });
    }
    (tokens, partial)
}
fn fact(token: &Token<'_>, kind: SymbolKind) -> Option<SymbolFact> {
    if !token.identifier || token.text.is_empty() || token.text.len() > 128 {
        return None;
    }
    Some(SymbolFact {
        name: token.text.into(),
        kind,
        range: SymbolRange {
            start: SymbolPosition {
                line: token.line,
                character: token.column,
            },
            end: SymbolPosition {
                line: token.line,
                character: token.column + token.text.encode_utf16().count() as u32,
            },
        },
    })
}
pub(super) fn extract(text: &str, p: &SymbolProfile) -> (Vec<SymbolFact>, bool) {
    if text.len() > MAX_SOURCE_BYTES {
        return (vec![], true);
    }
    let (t, mut partial) = lex(text, p);
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut type_bodies = BTreeMap::new();
    let mut stack = Vec::new();
    let mut statement = 0;
    for (i, token) in t.iter().enumerate() {
        if out.len() >= MAX_SYMBOLS_PER_FILE {
            partial = true;
            break;
        }
        if token.text == "{" {
            stack.push(type_bodies.get(&i).copied().unwrap_or(false));
            statement = i + 1;
        }
        if token.text == "}" {
            stack.pop();
            statement = i + 1;
        }
        if token.text == ";" {
            statement = i + 1;
        }
        for rule in p
            .declarations
            .iter()
            .filter(|rule| rule.keyword == token.text)
        {
            if i > 0 && t[i - 1].text == "." {
                continue;
            }
            let mut name = None;
            let mut angle = 0;
            for (j, next) in t.iter().enumerate().skip(i + 1).take(96) {
                if matches!(next.text, "{" | "}" | ";" | "=")
                    || matches!(rule.name_mode, NameMode::NextIdentifier)
                        && matches!(next.text, ":" | "#")
                {
                    break;
                }
                if next.text == "<" {
                    angle += 1;
                    continue;
                }
                if next.text == ">" {
                    angle = (angle - 1).max(0);
                    continue;
                }
                if next.text == "(" {
                    break;
                }
                if angle == 0 && next.identifier {
                    if p.excluded_names.iter().any(|name| name == next.text) {
                        if matches!(rule.name_mode, NameMode::NextIdentifier) {
                            break;
                        }
                        continue;
                    }
                    name = Some(j);
                    if matches!(rule.name_mode, NameMode::NextIdentifier) {
                        break;
                    }
                }
            }
            if let Some(name) = name {
                if let Some(value) = fact(&t[name], rule.kind.clone()) {
                    let key = (value.range.start.line, value.range.start.character);
                    if seen.insert(key) {
                        out.push(value);
                    }
                }
                if rule.opens_type
                    && let Some((body, _)) = t
                        .iter()
                        .enumerate()
                        .skip(name + 1)
                        .take(128)
                        .take_while(|(_, v)| v.text != ";")
                        .find(|(_, v)| v.text == "{")
                {
                    type_bodies.insert(body, true);
                }
            }
        }
        if p.methods
            && stack.last() == Some(&true)
            && token.identifier
            && t.get(i + 1).is_some_and(|v| v.text == "(")
            && !p.excluded_names.iter().any(|s| s == token.text)
        {
            if t[statement.min(i)..i].iter().any(|v| {
                p.rejected_method_prefixes
                    .iter()
                    .any(|value| value == v.text)
            }) {
                continue;
            }
            let mut depth = 0;
            let mut end = None;
            for (j, v) in t.iter().enumerate().skip(i + 1).take(256) {
                if v.text == "(" {
                    depth += 1;
                }
                if v.text == ")" {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(j);
                        break;
                    }
                }
            }
            if let Some(end) = end {
                let tail = if t
                    .get(end + 1)
                    .is_some_and(|v| p.method_tail_markers.iter().any(|m| m == v.text))
                {
                    t.iter()
                        .skip(end + 2)
                        .take(64)
                        .take_while(|v| {
                            v.identifier
                                || matches!(
                                    v.text,
                                    "." | "," | "<" | ">" | "[" | "]" | "?" | "&" | "{" | ";"
                                )
                        })
                        .find(|v| matches!(v.text, "{" | ";"))
                } else {
                    t.get(end + 1).filter(|v| matches!(v.text, "{" | ";"))
                };
                if tail.is_some_and(|v| v.text != ",")
                    && let Some(value) = fact(token, SymbolKind::Function)
                {
                    let key = (value.range.start.line, value.range.start.character);
                    if seen.insert(key) {
                        out.push(value);
                    }
                }
            }
        }
    }
    (out, partial)
}
