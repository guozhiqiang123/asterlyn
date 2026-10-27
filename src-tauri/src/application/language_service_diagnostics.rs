//! Fixed host-owned diagnostic profiles; no renderer/plugin command or executable authority.
use asterlyn_language_service::{TextPosition, utf16_offset};
use serde_json::{Value, json};
use std::path::Path;

#[derive(Clone, Copy)]
pub(super) enum DiagnosticProfile {
    TypeScript,
    RustPull,
    RustPush,
    StandardPull,
    StandardPush,
}
impl DiagnosticProfile {
    pub fn standard(pull: bool) -> Self {
        if pull {
            Self::StandardPull
        } else {
            Self::StandardPush
        }
    }
    pub fn new(rust: bool, pull: bool) -> Self {
        if !rust {
            Self::TypeScript
        } else if pull {
            Self::RustPull
        } else {
            Self::RustPush
        }
    }
    pub fn query_count(self) -> usize {
        match self {
            Self::TypeScript => 2,
            Self::RustPull | Self::StandardPull => 1,
            Self::RustPush | Self::StandardPush => 0,
        }
    }
    pub fn body_key(self) -> &'static str {
        match self {
            Self::TypeScript => "body",
            _ => "items",
        }
    }
    pub fn item(self, text: &str, value: &Value) -> Option<Value> {
        match self {
            Self::TypeScript => diagnostic_item(text, value),
            Self::RustPull | Self::RustPush => rust_diagnostic_item(text, value),
            _ => rust_diagnostic_item(text, value).map(|mut item| {
                item["source"] = json!("language-server");
                item
            }),
        }
    }
    pub fn push_items(self, text: &str, items: &[Value]) -> Vec<Value> {
        match self {
            Self::TypeScript => items.to_vec(),
            _ => items
                .iter()
                .filter_map(|value| self.item(text, value))
                .collect(),
        }
    }
    pub fn requests(self, uri: &str, file: &Path) -> Vec<(&'static str, Value)> {
        match self {
            Self::TypeScript=>["semanticDiagnosticsSync", "syntacticDiagnosticsSync"].iter().map(|command| ("workspace/executeCommand",json!({"command":"typescript.tsserverRequest","arguments":[command,{"file":file,"includeLinePosition":true},{"isAsync":false,"expectsResult":true}]}))).collect(),
            Self::RustPull=>vec![("textDocument/diagnostic",json!({"textDocument":{"uri":uri},"identifier":"rust-analyzer"}))],
            Self::RustPush|Self::StandardPush=>vec![],
            Self::StandardPull=>vec![("textDocument/diagnostic",json!({"textDocument":{"uri":uri}}))],
        }
    }
}

pub(super) fn rust_diagnostic_item(text: &str, value: &Value) -> Option<Value> {
    let point = |name| -> Option<TextPosition> {
        let point = value.get("range")?.get(name)?;
        Some(TextPosition {
            line: u32::try_from(point.get("line")?.as_u64()?).ok()?,
            character: u32::try_from(point.get("character")?.as_u64()?).ok()?,
        })
    };
    let start = point("start")?;
    let end = point("end")?;
    if utf16_offset(text, &start).ok()? > utf16_offset(text, &end).ok()? {
        return None;
    }
    let message = value
        .get("message")?
        .as_str()?
        .chars()
        .take(8192)
        .collect::<String>();
    if message.is_empty() {
        return None;
    }
    let severity = value
        .get("severity")
        .and_then(Value::as_u64)
        .filter(|v| (1..=4).contains(v))
        .unwrap_or(3);
    Some(
        json!({"range":{"start":{"line":start.line,"character":start.character},"end":{"line":end.line,"character":end.character}},"message":message,"severity":severity,"source":"rust-analyzer"}),
    )
}

fn diagnostic_item(text: &str, value: &Value) -> Option<Value> {
    let point = |value: &Value| -> Option<TextPosition> {
        Some(TextPosition {
            line: u32::try_from(value.get("line")?.as_u64()?.checked_sub(1)?).ok()?,
            character: u32::try_from(value.get("offset")?.as_u64()?.checked_sub(1)?).ok()?,
        })
    };
    let start = point(value.get("startLocation").or_else(|| value.get("start"))?)?;
    let end = point(value.get("endLocation").or_else(|| value.get("end"))?)?;
    let start_offset = utf16_offset(text, &start).ok()?;
    let end_offset = utf16_offset(text, &end).ok()?;
    if start_offset > end_offset {
        return None;
    }
    let message = value
        .get("text")
        .or_else(|| value.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("TypeScript diagnostic")
        .chars()
        .take(8192)
        .collect::<String>();
    let severity = match value.get("category").and_then(Value::as_str) {
        Some("error") => 1,
        Some("warning") => 2,
        Some("suggestion") => 4,
        _ => 3,
    };
    Some(
        json!({"range":{"start":{"line":start.line,"character":start.character},"end":{"line":end.line,"character":end.character}},"message":message,"severity":severity,"source":"typescript","code":value.get("code").and_then(Value::as_i64)}),
    )
}
