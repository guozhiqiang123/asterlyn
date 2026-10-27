//! Data-only source previews. Content-addressed LSP results never grant filesystem access.
use asterlyn_language_service::{TextPosition, utf16_offset};
use serde_json::Value;
use sha2::{Digest, Sha256};
const MAX_SOURCE: usize = 512 * 1024;
const MAX_TOTAL: usize = 2 * 1024 * 1024;
pub(super) fn validate_sources(value: &Value) -> Result<(), String> {
    let mut total = 0;
    fn visit(value: &Value, total: &mut usize, depth: usize) -> Result<(), String> {
        if depth > 32 {
            return Err("language result nesting exceeds its bound".into());
        }
        if let Some(items) = value.as_array() {
            for item in items {
                visit(item, total, depth + 1)?;
            }
        } else if let Some(object) = value.as_object() {
            if let Some(source) = object.get("readonlySource") {
                let source = source.as_object().ok_or("invalid read-only source")?;
                if source.len() != 3 {
                    return Err("invalid read-only source fields".into());
                }
                let text = source
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or("invalid source text")?;
                let path = source
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or("invalid source label")?;
                let language = source
                    .get("languageId")
                    .and_then(Value::as_str)
                    .ok_or("invalid source language")?;
                *total += text.len();
                if text.len() > MAX_SOURCE
                    || *total > MAX_TOTAL
                    || path.is_empty()
                    || path.len() > 256
                    || path.contains(['\\', ':', '\0'])
                    || path.starts_with('/')
                    || path
                        .split('/')
                        .any(|p| p.is_empty() || p == ".." || p == ".")
                    || path.chars().any(char::is_control)
                    || language.is_empty()
                    || language.len() > 64
                    || !language
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                {
                    return Err("read-only source exceeds its bound".into());
                }
                let uri = object
                    .get("targetUri")
                    .or_else(|| object.get("uri"))
                    .and_then(Value::as_str)
                    .ok_or("source URI missing")?;
                let uri = url::Url::parse(uri).map_err(|_| "invalid source URI")?;
                if uri.scheme() != "asterlyn-source"
                    || uri.host_str() != Some(&format!("{:x}", Sha256::digest(text.as_bytes())))
                    || uri.query().is_some()
                    || uri.fragment().is_some()
                    || !uri.username().is_empty()
                    || uri.password().is_some()
                    || uri.port().is_some()
                {
                    return Err("source content identity mismatch".into());
                }
                let range = object
                    .get("targetSelectionRange")
                    .or_else(|| object.get("range"))
                    .ok_or("source range missing")?;
                let point = |name: &str| -> Result<TextPosition, String> {
                    let value = &range[name];
                    Ok(TextPosition {
                        line: value["line"]
                            .as_u64()
                            .and_then(|v| u32::try_from(v).ok())
                            .ok_or("invalid source position")?,
                        character: value["character"]
                            .as_u64()
                            .and_then(|v| u32::try_from(v).ok())
                            .ok_or("invalid source position")?,
                    })
                };
                let from =
                    utf16_offset(text, &point("start")?).map_err(|_| "invalid source range")?;
                let to = utf16_offset(text, &point("end")?).map_err(|_| "invalid source range")?;
                if from > to {
                    return Err("reversed source range".into());
                }
            } else if object
                .get("uri")
                .or_else(|| object.get("targetUri"))
                .and_then(Value::as_str)
                .is_some_and(|uri| uri.starts_with("asterlyn-source:"))
            {
                return Err("source text missing".into());
            }
            for (key, item) in object {
                if key != "readonlySource" {
                    visit(item, total, depth + 1)?;
                }
            }
        }
        Ok(())
    }
    visit(value, &mut total, 0)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn source_is_data_with_verified_identity_and_utf16_range() {
        let text = "😀 class Api {}";
        let mut source = json!({"uri":format!("asterlyn-source://{:x}/Api.java",Sha256::digest(text.as_bytes())),"range":{"start":{"line":0,"character":3},"end":{"line":0,"character":8}},"readonlySource":{"text":text,"path":"Api.java","languageId":"java"}});
        assert!(validate_sources(&source).is_ok());
        source["range"]["start"]["character"] = json!(1);
        assert!(validate_sources(&source).is_err());
        source["range"]["start"]["character"] = json!(3);
        source["readonlySource"]["text"] = json!("other");
        assert!(validate_sources(&source).is_err());
    }
}
