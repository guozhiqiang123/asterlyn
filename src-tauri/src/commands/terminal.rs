use asterlyn_terminal::{
    TERMINAL_PROTOCOL_VERSION, TerminalEvent, TerminalSessions, TerminalStarted,
};
use base64::Engine;
use tauri::{Emitter, State};

use crate::application::ActiveWorkspaces;

const TERMINAL_EVENT_NAME: &str = "terminal-session-event";
const MAX_ENCODED_INPUT_BYTES: usize = 90_000;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalStartedPayload {
    protocol_version: u8,
    session_id: String,
    shell: String,
    cwd: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
enum TerminalEventPayload {
    #[serde(rename = "output")]
    Output {
        protocol_version: u8,
        session_id: String,
        sequence: u64,
        data_base64: String,
    },
    #[serde(rename = "exited")]
    Exited {
        protocol_version: u8,
        session_id: String,
        exit_code: u32,
        signal: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        protocol_version: u8,
        session_id: String,
        message: String,
    },
}

#[tauri::command]
pub(crate) fn start_terminal(
    workspace_root: String,
    cols: u16,
    rows: u16,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    sessions: State<'_, TerminalSessions>,
) -> Result<TerminalStartedPayload, String> {
    let root = active_workspaces
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    let event_window = window.clone();
    let sink = std::sync::Arc::new(move |event| {
        let payload = map_terminal_event(event);
        let _ = event_window.emit(TERMINAL_EVENT_NAME, payload);
    });
    let started = sessions
        .start(window.label(), &root, cols, rows, sink)
        .map_err(|error| error.to_string())?;
    Ok(map_started(started))
}

#[tauri::command]
pub(crate) fn write_terminal(
    session_id: String,
    data_base64: String,
    window: tauri::WebviewWindow,
    sessions: State<'_, TerminalSessions>,
) -> Result<(), String> {
    if data_base64.len() > MAX_ENCODED_INPUT_BYTES {
        return Err("terminal input exceeds the encoded transport limit".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|_| "terminal input is not valid base64".to_string())?;
    sessions
        .write(window.label(), &session_id, &bytes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    window: tauri::WebviewWindow,
    sessions: State<'_, TerminalSessions>,
) -> Result<(), String> {
    sessions
        .resize(window.label(), &session_id, cols, rows)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn close_terminal(
    session_id: String,
    window: tauri::WebviewWindow,
    sessions: State<'_, TerminalSessions>,
) -> Result<bool, String> {
    sessions
        .close(window.label(), &session_id)
        .map_err(|error| error.to_string())
}

fn map_started(started: TerminalStarted) -> TerminalStartedPayload {
    TerminalStartedPayload {
        protocol_version: TERMINAL_PROTOCOL_VERSION,
        session_id: started.session_id,
        shell: started.shell,
        cwd: started.cwd.to_string_lossy().into_owned(),
    }
}

fn map_terminal_event(event: TerminalEvent) -> TerminalEventPayload {
    match event {
        TerminalEvent::Output {
            session_id,
            sequence,
            bytes,
        } => TerminalEventPayload::Output {
            protocol_version: TERMINAL_PROTOCOL_VERSION,
            session_id,
            sequence,
            data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        },
        TerminalEvent::Exited {
            session_id,
            exit_code,
            signal,
        } => TerminalEventPayload::Exited {
            protocol_version: TERMINAL_PROTOCOL_VERSION,
            session_id,
            exit_code,
            signal,
        },
        TerminalEvent::ReaderFailed {
            session_id,
            message,
        } => TerminalEventPayload::Error {
            protocol_version: TERMINAL_PROTOCOL_VERSION,
            session_id,
            message,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_payload_is_versioned_and_base64_encoded() {
        let payload = map_terminal_event(TerminalEvent::Output {
            session_id: "terminal-7".to_string(),
            sequence: 3,
            bytes: vec![0, 255, b'A'],
        });
        let value = serde_json::to_value(payload).expect("serialize event");
        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["kind"], "output");
        assert_eq!(value["sessionId"], "terminal-7");
        assert_eq!(value["sequence"], 3);
        assert_eq!(value["dataBase64"], "AP9B");
    }
}
