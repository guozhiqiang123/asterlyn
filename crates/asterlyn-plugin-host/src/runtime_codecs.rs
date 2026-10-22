use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use boa_engine::object::builtins::{JsArray, JsUint8Array};
use boa_engine::{
    Context, JsNativeError, JsResult, JsString, JsValue, NativeFunction, Source, js_string,
};
use serde_json::{Map as JsonMap, Value as JsonValue, json};
use std::collections::BTreeMap;

use super::{PluginEngineError, js_error};

const MAX_BASE64_DECODED_BYTES: usize = 16 * 1024 * 1024;
const MAX_BASE64_ENCODED_BYTES: usize = MAX_BASE64_DECODED_BYTES.div_ceil(3) * 4;
const MAX_GRADLE_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_GRADLE_LINE_BYTES: usize = 16 * 1024;
const MAX_GRADLE_TASKS: usize = 32_768;

const SAFE_TEXT_CODEC_BOOTSTRAP: &str = r#"
(() => {
  const utf8Encode = globalThis.__asterlynUtf8Encode;
  const utf8Decode = globalThis.__asterlynUtf8Decode;
  const utf8DecodeLines = globalThis.__asterlynUtf8DecodeLines;
  const decodeGradleTasks = globalThis.__asterlynDecodeGradleTasks;
  delete globalThis.__asterlynUtf8Encode;
  delete globalThis.__asterlynUtf8Decode;
  delete globalThis.__asterlynUtf8DecodeLines;
  delete globalThis.__asterlynDecodeGradleTasks;

  class SafeTextEncoder {
    get encoding() { return "utf-8"; }
    encode(input = "") { return utf8Encode(String(input)); }
  }
  class SafeTextDecoder {
    constructor(label = "utf-8", options = {}) {
      const normalized = String(label).trim().toLowerCase();
      if (normalized !== "utf-8" && normalized !== "utf8" && normalized !== "unicode-1-1-utf-8") {
        throw new RangeError("Only UTF-8 TextDecoder is supported by the plugin host.");
      }
      this.fatal = Boolean(options.fatal);
      this.ignoreBOM = Boolean(options.ignoreBOM);
    }
    get encoding() { return "utf-8"; }
    decode(input = new Uint8Array(), options = {}) {
      if (options.stream) throw new TypeError("Streaming TextDecoder is not supported by the plugin host.");
      return utf8Decode(input, this.fatal, this.ignoreBOM);
    }
    decodeLines(input = new Uint8Array(), options = {}) {
      if (options.stream) throw new TypeError("Streaming TextDecoder is not supported by the plugin host.");
      return utf8DecodeLines(input, this.fatal, this.ignoreBOM, Boolean(options.trim), Boolean(options.stripAnsi));
    }
    decodeGradleTasks(input = new Uint8Array()) { return decodeGradleTasks(input); }
  }
  Object.freeze(SafeTextEncoder.prototype);
  Object.freeze(SafeTextDecoder.prototype);
  Object.defineProperties(globalThis, {
    TextEncoder: { value: SafeTextEncoder, writable: false, enumerable: false, configurable: false },
    TextDecoder: { value: SafeTextDecoder, writable: false, enumerable: false, configurable: false },
  });
})();
"#;

const SAFE_BASE64_CODEC_BOOTSTRAP: &str = r#"
(() => {
  const decodeBytes = globalThis.__asterlynBase64DecodeBytes;
  const encodeBytes = globalThis.__asterlynBase64EncodeBytes;
  delete globalThis.__asterlynBase64DecodeBytes;
  delete globalThis.__asterlynBase64EncodeBytes;
  Object.defineProperty(Uint8Array, "fromBase64", {
    value(input = "") { return decodeBytes(String(input)); },
    writable: false,
    enumerable: false,
    configurable: false,
  });
  Object.defineProperty(Uint8Array.prototype, "toBase64", {
    value() { return encodeBytes(this); },
    writable: false,
    enumerable: false,
    configurable: false,
  });
})();
"#;

pub(super) fn install(context: &mut Context) -> Result<(), PluginEngineError> {
    install_safe_text_codecs(context)?;
    install_safe_base64_codecs(context)
}

fn install_safe_text_codecs(context: &mut Context) -> Result<(), PluginEngineError> {
    context
        .register_global_builtin_callable(
            js_string!("__asterlynUtf8Encode"),
            1,
            NativeFunction::from_fn_ptr(utf8_encode),
        )
        .map_err(|error| js_error("register UTF-8 encoder", error, context))?;
    context
        .register_global_builtin_callable(
            js_string!("__asterlynUtf8Decode"),
            3,
            NativeFunction::from_fn_ptr(utf8_decode),
        )
        .map_err(|error| js_error("register UTF-8 decoder", error, context))?;
    context
        .register_global_builtin_callable(
            js_string!("__asterlynUtf8DecodeLines"),
            5,
            NativeFunction::from_fn_ptr(utf8_decode_lines),
        )
        .map_err(|error| js_error("register UTF-8 line decoder", error, context))?;
    context
        .register_global_builtin_callable(
            js_string!("__asterlynDecodeGradleTasks"),
            1,
            NativeFunction::from_fn_ptr(decode_gradle_tasks),
        )
        .map_err(|error| js_error("register Gradle task decoder", error, context))?;
    context
        .eval(Source::from_bytes(SAFE_TEXT_CODEC_BOOTSTRAP))
        .map_err(|error| js_error("install safe text codecs", error, context))?;
    Ok(())
}

fn install_safe_base64_codecs(context: &mut Context) -> Result<(), PluginEngineError> {
    context
        .register_global_builtin_callable(
            js_string!("__asterlynBase64DecodeBytes"),
            1,
            NativeFunction::from_fn_ptr(base64_decode_bytes),
        )
        .map_err(|error| js_error("register base64 byte decoder", error, context))?;
    context
        .register_global_builtin_callable(
            js_string!("__asterlynBase64EncodeBytes"),
            1,
            NativeFunction::from_fn_ptr(base64_encode_bytes),
        )
        .map_err(|error| js_error("register base64 byte encoder", error, context))?;
    context
        .register_global_builtin_callable(
            js_string!("atob"),
            1,
            NativeFunction::from_fn_ptr(base64_decode),
        )
        .map_err(|error| js_error("register base64 decoder", error, context))?;
    context
        .register_global_builtin_callable(
            js_string!("btoa"),
            1,
            NativeFunction::from_fn_ptr(base64_encode),
        )
        .map_err(|error| js_error("register base64 encoder", error, context))?;
    context
        .eval(Source::from_bytes(SAFE_BASE64_CODEC_BOOTSTRAP))
        .map_err(|error| js_error("install safe base64 codecs", error, context))?;
    Ok(())
}

fn utf8_encode(_this: &JsValue, arguments: &[JsValue], context: &mut Context) -> JsResult<JsValue> {
    let text = arguments
        .first()
        .cloned()
        .unwrap_or_default()
        .to_string(context)?
        .to_std_string_escaped();
    JsUint8Array::from_iter(text.into_bytes(), context).map(Into::into)
}

fn utf8_decode(_this: &JsValue, arguments: &[JsValue], context: &mut Context) -> JsResult<JsValue> {
    let mut bytes = text_decoder_bytes(arguments, context)?;
    let fatal = arguments.get(1).is_some_and(JsValue::to_boolean);
    let ignore_bom = arguments.get(2).is_some_and(JsValue::to_boolean);
    if !ignore_bom && bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        bytes.drain(..3);
    }
    let decoded = if fatal {
        std::str::from_utf8(&bytes)
            .map(str::to_owned)
            .map_err(|_| {
                JsNativeError::typ().with_message("TextDecoder input is not valid UTF-8")
            })?
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(JsString::from(decoded).into())
}

fn utf8_decode_lines(
    _this: &JsValue,
    arguments: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let mut bytes = text_decoder_bytes(arguments, context)?;
    let fatal = arguments.get(1).is_some_and(JsValue::to_boolean);
    let ignore_bom = arguments.get(2).is_some_and(JsValue::to_boolean);
    let trim = arguments.get(3).is_some_and(JsValue::to_boolean);
    let strip_ansi = arguments.get(4).is_some_and(JsValue::to_boolean);
    if !ignore_bom && bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        bytes.drain(..3);
    }
    let mut lines = Vec::new();
    for line in bytes.split(|byte| *byte == b'\n') {
        let mut line = line.strip_suffix(b"\r").unwrap_or(line).to_vec();
        if strip_ansi {
            line = strip_ansi_sequences(&line);
        }
        let line = if trim {
            trim_ascii(&line)
        } else {
            line.as_slice()
        };
        let decoded = if fatal {
            std::str::from_utf8(line).map(str::to_owned).map_err(|_| {
                JsNativeError::typ().with_message("TextDecoder input is not valid UTF-8")
            })?
        } else {
            String::from_utf8_lossy(line).into_owned()
        };
        lines.push(JsString::from(decoded).into());
    }
    Ok(JsArray::from_iter(lines, context).into())
}

fn strip_ansi_sequences(bytes: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if (bytes[index] == 0x1B || bytes[index] == 0x9B) && bytes.get(index + 1) == Some(&b'[') {
            index += 2;
            while index < bytes.len() {
                let byte = bytes[index];
                index += 1;
                if (0x40..=0x7E).contains(&byte) {
                    break;
                }
            }
        } else {
            result.push(bytes[index]);
            index += 1;
        }
    }
    result
}

fn trim_ascii(mut bytes: &[u8]) -> &[u8] {
    while bytes.first().is_some_and(u8::is_ascii_whitespace) {
        bytes = &bytes[1..];
    }
    while bytes.last().is_some_and(u8::is_ascii_whitespace) {
        bytes = &bytes[..bytes.len() - 1];
    }
    bytes
}

fn text_decoder_bytes(arguments: &[JsValue], context: &mut Context) -> JsResult<Vec<u8>> {
    let value = arguments.first().cloned().unwrap_or_default();
    let object = value.as_object().ok_or_else(|| {
        JsNativeError::typ().with_message("TextDecoder input must be a Uint8Array")
    })?;
    let array = JsUint8Array::from_object(object)?;
    Ok(array.iter(context).collect())
}

fn decode_gradle_tasks(
    _this: &JsValue,
    arguments: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let bytes = text_decoder_bytes(arguments, context)?;
    let snapshot = parse_gradle_tasks(&bytes);
    JsValue::from_json(&snapshot, context)
}

fn parse_gradle_tasks(bytes: &[u8]) -> JsonValue {
    if bytes.len() > MAX_GRADLE_OUTPUT_BYTES {
        return gradle_error("Gradle output exceeded the discovery limit.");
    }
    let decoded = String::from_utf8_lossy(bytes);
    let mut lines = Vec::new();
    for raw in decoded.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if raw.len() > MAX_GRADLE_LINE_BYTES {
            return gradle_error("Gradle task output contained an overlong line.");
        }
        lines.push(
            String::from_utf8_lossy(&strip_ansi_sequences(raw.as_bytes()))
                .trim()
                .to_owned(),
        );
    }
    let mut records = BTreeMap::<String, JsonValue>::new();
    let mut recognized = 0usize;
    let mut group = "Other".to_owned();
    let mut project_path = ":".to_owned();
    let mut in_task_group = false;
    for (index, line) in lines.iter().enumerate() {
        if line.is_empty() || is_gradle_divider(line) {
            continue;
        }
        if in_task_group {
            if let Some((task_name, description)) = parse_gradle_task_line(line) {
                let id = if task_name.starts_with(':') {
                    task_name.to_owned()
                } else if task_name.contains(':') {
                    format!(":{task_name}")
                } else if project_path == ":" {
                    format!(":{task_name}")
                } else {
                    format!("{project_path}:{task_name}")
                };
                recognized += 1;
                if recognized > MAX_GRADLE_TASKS * 4 {
                    return gradle_error("Gradle task list exceeded the discovery limit.");
                }
                if let Some(existing) = records.get_mut(&id) {
                    if existing.get("description").is_none() {
                        if let Some(description) = description {
                            existing["description"] = JsonValue::String(description.to_owned());
                        }
                    }
                } else {
                    if records.len() >= MAX_GRADLE_TASKS {
                        return gradle_error("Gradle task list exceeded the discovery limit.");
                    }
                    let separator = id.rfind(':').unwrap_or(0);
                    let task_project_path = if separator > 0 { &id[..separator] } else { ":" };
                    let mut task = JsonMap::new();
                    task.insert("id".to_owned(), JsonValue::String(id.clone()));
                    task.insert("label".to_owned(), JsonValue::String(id.clone()));
                    task.insert("group".to_owned(), JsonValue::String(group.clone()));
                    if let Some(description) = description {
                        task.insert(
                            "description".to_owned(),
                            JsonValue::String(description.to_owned()),
                        );
                    }
                    task.insert(
                        "projectPath".to_owned(),
                        JsonValue::String(task_project_path.to_owned()),
                    );
                    task.insert("runnable".to_owned(), JsonValue::Bool(false));
                    task.insert(
                        "disabledReason".to_owned(),
                        JsonValue::String("Task execution is not enabled yet.".to_owned()),
                    );
                    records.insert(id, JsonValue::Object(task));
                }
                continue;
            }
        }
        if is_gradle_failure(line) {
            return gradle_error("Gradle task discovery failed.");
        }
        if line.starts_with("Tasks runnable from root project ") {
            project_path = ":".to_owned();
            in_task_group = false;
            continue;
        }
        if let Some(path) = gradle_project_path(line) {
            project_path = path;
            in_task_group = false;
            continue;
        }
        if is_gradle_group_heading(line)
            && lines
                .get(index + 1)
                .is_some_and(|next| is_gradle_divider(next))
        {
            group.clone_from(line);
            in_task_group = true;
        }
    }
    if records.is_empty() {
        return gradle_error("Gradle output contained no recognizable tasks.");
    }
    json!({ "status": "ready", "tasks": records.into_values().collect::<Vec<_>>() })
}

fn gradle_error(message: &str) -> JsonValue {
    json!({ "status": "error", "tasks": [], "error": message })
}

fn is_gradle_failure(value: &str) -> bool {
    value.starts_with("FAILURE:")
        || value.starts_with("BUILD FAILED")
        || value.starts_with("Could not determine")
}

fn is_gradle_divider(value: &str) -> bool {
    value.len() >= 3 && value.bytes().all(|byte| byte == b'-')
}

fn is_gradle_group_heading(value: &str) -> bool {
    value.ends_with(" tasks")
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic()
                || (index > 0 && (byte.is_ascii_digit() || matches!(byte, b'_' | b' ' | b'-')))
        })
}

fn gradle_project_path(value: &str) -> Option<String> {
    let quoted = value.strip_prefix("Tasks runnable from project ")?;
    let quote = quoted.as_bytes().first().copied()?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    let end = quoted[1..].find(char::from(quote))? + 1;
    if end <= 1 {
        return None;
    }
    let project = &quoted[1..end];
    Some(if project.starts_with(':') {
        project.to_owned()
    } else {
        format!(":{project}")
    })
}

fn parse_gradle_task_line(value: &str) -> Option<(&str, Option<&str>)> {
    let task_end = value.find(char::is_whitespace).unwrap_or(value.len());
    let task_name = &value[..task_end];
    if !valid_gradle_task_name(task_name) {
        return None;
    }
    let remainder = value[task_end..].trim_start();
    if remainder.is_empty() {
        return Some((task_name, None));
    }
    let description = remainder.strip_prefix('-')?.trim();
    Some((task_name, (!description.is_empty()).then_some(description)))
}

fn valid_gradle_task_name(value: &str) -> bool {
    if value.is_empty() || !value.is_ascii() {
        return false;
    }
    let bytes = value.as_bytes();
    let mut index = 0;
    if bytes[0] == b':' {
        index = 1;
        if index == bytes.len() {
            return false;
        }
    } else if !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    let mut segment_length = 0;
    for byte in &bytes[index..] {
        if *byte == b':' {
            if segment_length == 0 {
                return false;
            }
            segment_length = 0;
        } else if byte.is_ascii_alphanumeric() || matches!(*byte, b'_' | b'.' | b'-') {
            segment_length += 1;
        } else {
            return false;
        }
    }
    segment_length > 0
}

fn base64_decode(
    _this: &JsValue,
    arguments: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let decoded = decode_base64(arguments, context)?;
    let code_units = decoded.into_iter().map(u16::from).collect::<Vec<_>>();
    Ok(JsString::from(code_units.as_slice()).into())
}

fn base64_decode_bytes(
    _this: &JsValue,
    arguments: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    JsUint8Array::from_iter(decode_base64(arguments, context)?, context).map(Into::into)
}

fn base64_encode_bytes(
    _this: &JsValue,
    arguments: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let value = arguments.first().cloned().unwrap_or_default();
    let object = value.as_object().ok_or_else(|| {
        JsNativeError::typ().with_message("base64 byte input must be a Uint8Array")
    })?;
    let array = JsUint8Array::from_object(object)?;
    let bytes = array.iter(context).collect::<Vec<_>>();
    if bytes.len() > MAX_BASE64_DECODED_BYTES {
        return Err(JsNativeError::range()
            .with_message("base64 byte input exceeds the plugin host limit")
            .into());
    }
    Ok(JsString::from(BASE64.encode(bytes)).into())
}

fn decode_base64(arguments: &[JsValue], context: &mut Context) -> JsResult<Vec<u8>> {
    let input = arguments
        .first()
        .cloned()
        .unwrap_or_default()
        .to_string(context)?;
    if input.len() > MAX_BASE64_ENCODED_BYTES {
        return Err(JsNativeError::range()
            .with_message("atob input exceeds the plugin host limit")
            .into());
    }
    let mut encoded = Vec::with_capacity(input.len());
    for code_unit in input.iter() {
        let byte = u8::try_from(code_unit).map_err(|_| {
            JsNativeError::typ().with_message("atob input must contain only base64 text")
        })?;
        if !byte.is_ascii_whitespace() {
            encoded.push(byte);
        }
    }
    let decoded = BASE64
        .decode(encoded)
        .map_err(|_| JsNativeError::typ().with_message("atob input is not valid base64 text"))?;
    if decoded.len() > MAX_BASE64_DECODED_BYTES {
        return Err(JsNativeError::range()
            .with_message("atob output exceeds the plugin host limit")
            .into());
    }
    Ok(decoded)
}

fn base64_encode(
    _this: &JsValue,
    arguments: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let input = arguments
        .first()
        .cloned()
        .unwrap_or_default()
        .to_string(context)?;
    if input.len() > MAX_BASE64_DECODED_BYTES {
        return Err(JsNativeError::range()
            .with_message("btoa input exceeds the plugin host limit")
            .into());
    }
    let mut bytes = Vec::with_capacity(input.len());
    for code_unit in input.iter() {
        bytes.push(u8::try_from(code_unit).map_err(|_| {
            JsNativeError::typ().with_message("btoa input must contain only Latin-1 code units")
        })?);
    }
    Ok(JsString::from(BASE64.encode(bytes)).into())
}
