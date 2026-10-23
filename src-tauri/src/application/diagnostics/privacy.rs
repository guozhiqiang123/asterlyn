use serde_json::{Map, Value};

pub(super) const MAX_STRING_BYTES: usize = 4 * 1024;
const FIELD_BUDGET: usize = 12 * 1024;
const MAX_NODES: usize = 256;
const MAX_DEPTH: usize = 8;

/// Copy only a bounded metadata tree; never walk an arbitrary error/payload in full.
pub(super) fn sanitize_fields(value: &Value, home: Option<&str>) -> (Value, bool) {
    let mut budget = Budget {
        bytes: FIELD_BUDGET,
        nodes: MAX_NODES,
        truncated: false,
    };
    let result = copy_value(value, home, 0, &mut budget);
    (result, budget.truncated)
}

struct Budget {
    bytes: usize,
    nodes: usize,
    truncated: bool,
}

fn copy_value(value: &Value, home: Option<&str>, depth: usize, budget: &mut Budget) -> Value {
    if depth >= MAX_DEPTH || budget.nodes == 0 || budget.bytes < 32 {
        budget.truncated = true;
        return Value::String("[TRUNCATED]".into());
    }
    budget.nodes -= 1;
    budget.bytes = budget.bytes.saturating_sub(16);
    match value {
        Value::String(text) => {
            let maximum = budget.bytes.min(MAX_STRING_BYTES);
            if text.len() > maximum {
                budget.truncated = true;
            }
            let text = sanitize_text(&bounded_text(text, maximum), home);
            budget.bytes = budget.bytes.saturating_sub(text.len());
            Value::String(text)
        }
        Value::Array(values) => {
            let mut copied = Vec::new();
            for value in values {
                if budget.nodes == 0 || budget.bytes < 32 {
                    budget.truncated = true;
                    break;
                }
                copied.push(copy_value(value, home, depth + 1, budget));
            }
            Value::Array(copied)
        }
        Value::Object(values) => {
            let mut copied = Map::new();
            for (key, value) in values {
                if budget.nodes == 0 || budget.bytes < 96 {
                    budget.truncated = true;
                    break;
                }
                budget.bytes = budget.bytes.saturating_sub(key.len().min(64));
                let safe_key = if key.len() <= 64
                    && key
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
                {
                    key.clone()
                } else {
                    budget.truncated = true;
                    "invalidField".into()
                };
                let safe_value = if key.len() > 64 || sensitive_key(key) {
                    budget.nodes -= 1;
                    Value::String("[REDACTED]".into())
                } else {
                    copy_value(value, home, depth + 1, budget)
                };
                copied.insert(safe_key, safe_value);
            }
            Value::Object(copied)
        }
        other => other.clone(),
    }
}

fn sensitive_key(key: &str) -> bool {
    let key: String = key
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    matches!(
        key.as_str(),
        "password"
            | "passwd"
            | "secret"
            | "clientsecret"
            | "token"
            | "accesstoken"
            | "refreshtoken"
            | "idtoken"
            | "authorization"
            | "proxyauthorization"
            | "cookie"
            | "setcookie"
            | "apikey"
            | "xapikey"
            | "privatekey"
            | "credentials"
    ) || key.ends_with("password")
        || key.ends_with("secret")
}

pub(super) fn sanitize_text(value: &str, home: Option<&str>) -> String {
    let mut text = bounded_text(value, MAX_STRING_BYTES);
    if let Some(home) = home {
        text = text.replace(home, "~");
    }
    // Headers can contain scheme + credentials (or multiple Digest fields). Drop the whole value.
    for name in [
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
    ] {
        redact_header(&mut text, name);
    }
    for marker in [
        "bearer ",
        "basic ",
        "access_token=",
        "refresh_token=",
        "id_token=",
        "token=",
        "password=",
        "passwd=",
        "client_secret=",
        "api_key=",
        "apikey=",
    ] {
        redact_marker(&mut text, marker);
    }
    // Remove URL user info for any URI scheme, including escaped passwords and SSH URLs.
    let mut search = 0;
    while let Some(relative) = text[search..].find("://") {
        let start = search + relative + 3;
        let end = text[start..]
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '/' | '?' | '#' | '"' | '\'' | '<' | '>')
            })
            .map_or(text.len(), |n| start + n);
        if let Some(at) = text[start..end].rfind('@') {
            text.replace_range(start..start + at, "[REDACTED]");
            search = start + "[REDACTED]@".len();
        } else if end == text.len()
            && text[start..end]
                .split_once(':')
                .is_some_and(|(_, suffix)| !suffix.bytes().all(|c| c.is_ascii_digit()))
        {
            // The input budget may have cut a long user:password authority before its '@'.
            text.replace_range(start..end, "[REDACTED]");
            search = text.len();
        } else {
            search = end;
        }
    }
    text
}

fn redact_header(text: &mut String, name: &str) {
    let mut search = 0;
    loop {
        let lower = text.to_ascii_lowercase();
        let Some(relative) = lower[search..].find(name) else {
            break;
        };
        let mut start = search + relative + name.len();
        while text
            .as_bytes()
            .get(start)
            .is_some_and(|c| matches!(c, b' ' | b'\t'))
        {
            start += 1;
        }
        if text.as_bytes().get(start) != Some(&b':') {
            search = start;
            continue;
        }
        start += 1;
        while text
            .as_bytes()
            .get(start)
            .is_some_and(|c| matches!(c, b' ' | b'\t'))
        {
            start += 1;
        }
        let end = text[start..]
            .find(['\r', '\n'])
            .map_or(text.len(), |n| start + n);
        text.replace_range(start..end, "[REDACTED]");
        search = start + "[REDACTED]".len();
    }
}

fn redact_marker(text: &mut String, marker: &str) {
    let mut search = 0;
    loop {
        let lower = text.to_ascii_lowercase();
        let Some(relative) = lower[search..].find(marker) else {
            break;
        };
        let mut start = search + relative + marker.len();
        while text
            .as_bytes()
            .get(start)
            .is_some_and(|c| matches!(c, b' ' | b'\t'))
        {
            start += 1;
        }
        let end = text[start..]
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '&' | ',' | ';' | '"' | '\'' | '<' | '>')
            })
            .map_or(text.len(), |n| start + n);
        text.replace_range(start..end, "[REDACTED]");
        search = start + "[REDACTED]".len();
    }
}

pub(super) fn bounded_text(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_owned();
    }
    if maximum_bytes < 3 {
        return String::new();
    }
    let mut end = maximum_bytes.saturating_sub(3);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn removes_realistic_credentials_and_preserves_unicode() {
        for input in [
            "Authorization: Basic ZmFrZTpzZWNyZXQ=",
            "authorization: bearer lower-secret",
            "AUTHORIZATION : Digest username=secret, response=secret",
            "https://user:pass%40word@example.test/path",
            "ssh://git:secret@example.test/repo",
            "?ACCESS_TOKEN=query-secret&ok=true",
            "Cookie: session=secret; other=secret",
            "中文 Bearer unicode-secret",
        ] {
            let safe = sanitize_text(input, None);
            for secret in [
                "ZmFrZTpzZWNyZXQ=",
                "lower-secret",
                "pass%40word",
                "query-secret",
                "unicode-secret",
                "username=secret",
                "session=secret",
                "git:secret",
            ] {
                assert!(!safe.contains(secret), "{safe}");
            }
        }
        assert!(sanitize_text("中文 Bearer value", None).starts_with("中文"));
        let long_url = format!("https://user:{}@example.test", "private".repeat(1000));
        assert!(!sanitize_text(&long_url, None).contains("private"));
    }

    #[test]
    fn bounds_deep_wide_metadata_and_redacts_sensitive_keys() {
        let (safe, _) = sanitize_fields(
            &json!({"nested": {"accessToken": "private-token", "password": "private-pass"}, "status": "ok"}),
            None,
        );
        let text = safe.to_string();
        assert!(!text.contains("private-"));
        assert_eq!(safe["status"], "ok");
        let (safe, truncated) = sanitize_fields(&json!(["界".repeat(100_000)]), None);
        assert!(truncated);
        assert!(safe.to_string().len() < FIELD_BUDGET * 2);
        let mut deep = Value::Null;
        for _ in 0..100 {
            deep = json!({"child": deep});
        }
        assert!(sanitize_fields(&deep, None).1);
        assert!(bounded_text("界界界", 4).len() <= 4);
    }
}
