use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use boa_engine::object::builtins::JsUint8Array;
use boa_engine::{
    Context, JsNativeError, JsResult, JsString, JsValue, NativeFunction, Source, js_string,
};

use super::{PluginEngineError, js_error};

const MAX_BASE64_DECODED_BYTES: usize = 16 * 1024 * 1024;
const MAX_BASE64_ENCODED_BYTES: usize = MAX_BASE64_DECODED_BYTES.div_ceil(3) * 4;

const SAFE_TEXT_CODEC_BOOTSTRAP: &str = r#"
(() => {
  const utf8Encode = globalThis.__asterlynUtf8Encode;
  const utf8Decode = globalThis.__asterlynUtf8Decode;
  delete globalThis.__asterlynUtf8Encode;
  delete globalThis.__asterlynUtf8Decode;

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
  }
  Object.freeze(SafeTextEncoder.prototype);
  Object.freeze(SafeTextDecoder.prototype);
  Object.defineProperties(globalThis, {
    TextEncoder: { value: SafeTextEncoder, writable: false, enumerable: false, configurable: false },
    TextDecoder: { value: SafeTextDecoder, writable: false, enumerable: false, configurable: false },
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
        .eval(Source::from_bytes(SAFE_TEXT_CODEC_BOOTSTRAP))
        .map_err(|error| js_error("install safe text codecs", error, context))?;
    Ok(())
}

fn install_safe_base64_codecs(context: &mut Context) -> Result<(), PluginEngineError> {
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
    let value = arguments.first().cloned().unwrap_or_default();
    let object = value.as_object().ok_or_else(|| {
        JsNativeError::typ().with_message("TextDecoder input must be a Uint8Array")
    })?;
    let array = JsUint8Array::from_object(object)?;
    let mut bytes = array.iter(context).collect::<Vec<_>>();
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

fn base64_decode(
    _this: &JsValue,
    arguments: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
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
    let code_units = decoded.into_iter().map(u16::from).collect::<Vec<_>>();
    Ok(JsString::from(code_units.as_slice()).into())
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
