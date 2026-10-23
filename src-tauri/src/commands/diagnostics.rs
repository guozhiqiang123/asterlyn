use serde_json::json;
use tauri::{State, WebviewWindow};

use crate::application::DiagnosticsLog;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn write_frontend_diagnostic(
    level: String,
    event: String,
    message: String,
    stack: Option<String>,
    trace_id: Option<String>,
    command: Option<String>,
    duration_ms: Option<u64>,
    suppressed: Option<u64>,
    bridge_failures: Option<u64>,
    window: WebviewWindow,
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<(), String> {
    if message.len() > 16 * 1024
        || stack.as_ref().is_some_and(|value| value.len() > 16 * 1024)
        || command.as_ref().is_some_and(|value| value.len() > 128)
    {
        return Err("diagnostic message exceeds ingress limit".to_owned());
    }
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
        "command": command.filter(|value| value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')),
        "durationMs": duration_ms,
        "suppressed": suppressed,
        "bridgeFailures": bridge_failures,
    });
    let trace_id = diagnostics.command_trace(trace_id.as_deref(), "frontend");
    diagnostics.record(&level, "frontend", &event, Some(&trace_id), fields);
    Ok(())
}

#[tauri::command]
pub(crate) fn diagnostic_log_health(
    diagnostics: State<'_, DiagnosticsLog>,
) -> crate::application::diagnostics::DiagnosticHealth {
    diagnostics.health()
}

#[tauri::command]
pub(crate) fn diagnostic_log_directory(
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<String, String> {
    diagnostics
        .directory()
        .ok_or_else(|| "diagnostic log directory is unavailable".to_owned())?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "diagnostic log directory is not valid UTF-8".to_owned())
}
