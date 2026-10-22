use serde_json::json;
use tauri::{State, WebviewWindow};

use crate::application::DiagnosticsLog;

#[tauri::command]
pub(crate) fn write_frontend_diagnostic(
    level: String,
    event: String,
    message: String,
    stack: Option<String>,
    window: WebviewWindow,
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<(), String> {
    if !matches!(level.as_str(), "info" | "warning" | "error") {
        return Err("diagnostic level is invalid".to_owned());
    }
    if event.is_empty()
        || event.len() > 128
        || !event
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("diagnostic event name is invalid".to_owned());
    }
    let fields = json!({
        "window": window.label(),
        "message": diagnostics.safe_message(message),
        "stack": stack.map(|value| diagnostics.safe_message(value)),
    });
    diagnostics.record(&level, "frontend", &event, None, fields);
    Ok(())
}

#[tauri::command]
pub(crate) fn diagnostic_log_directory(
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<String, String> {
    diagnostics
        .directory()
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "diagnostic log directory is not valid UTF-8".to_owned())
}
