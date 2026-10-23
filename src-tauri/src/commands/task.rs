use crate::application::trust;
use crate::application::{
    ActiveWorkspaces, DiagnosticsLog, TaskArtifactDiscovery, TaskManager, scan_task_artifacts,
};
use asterlyn_task::{
    OutputStream, PROTOCOL_VERSION, PreparedTask, TaskRequest, TaskSessionEvent, TaskStarted,
    TaskStatus,
};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager, State};

const EVENT: &str = "task-session-event";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskConfirmationResult {
    protocol_version: u8,
    review_id: String,
    remembered: bool,
}

fn authorization_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("task-trust-v1.json"))
        .map_err(|error| format!("resolve local task trust store: {error}"))
}

#[tauri::command]
pub(crate) fn discover_task_artifacts(
    repository_root: String,
    hints: Vec<String>,
    sidecar_names: Vec<String>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<TaskArtifactDiscovery, String> {
    let root = active_workspaces
        .resolve(window.label(), &repository_root)
        .map_err(|error| error.to_string())?;
    scan_task_artifacts(&root, &hints, &sidecar_names)
}
#[tauri::command]
// Tauri injects window/application state alongside the stable command arguments.
#[allow(clippy::too_many_arguments)]
pub(crate) fn prepare_task_execution(
    workspace_root: String,
    request: TaskRequest,
    diagnostic_trace_id: Option<String>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    tasks: State<'_, TaskManager>,
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<PreparedTask, String> {
    let trace_id = diagnostics.command_trace(diagnostic_trace_id.as_deref(), "task-prepare");
    let started = Instant::now();
    diagnostics.info(
        "task.execution",
        "prepare.started",
        Some(&trace_id),
        json!({
            "window": window.label(),
            "workspaceHash": diagnostics.hash_identifier(workspace_root.as_bytes()),
            "pluginId": &request.plugin_id,
            "providerId": &request.provider_id,
            "taskId": &request.task_id,
            "executablePath": &request.executable_path,
            "argumentCount": request.args.len(),
        }),
    );
    let result = (|| {
        let root = active
            .resolve(window.label(), &workspace_root)
            .map_err(|e| e.to_string())?;
        let token = active
            .activation_token(window.label())
            .map_err(|e| e.to_string())?;
        let state = trust::read(&authorization_path(&app)?, &root, &request.plugin_id)?;
        tasks.prepare(window.label(), &root, token, request, state)
    })();
    match &result {
        Ok(review) => diagnostics.info(
            "task.execution",
            "prepare.completed",
            Some(&trace_id),
            json!({
                "durationMs": elapsed_millis(started),
                "reviewId": &review.review_id,
                "trust": format!("{:?}", review.trust).to_lowercase(),
            }),
        ),
        Err(error) => diagnostics.error(
            "task.execution",
            "prepare.failed",
            Some(&trace_id),
            json!({
                "durationMs": elapsed_millis(started),
                "error": diagnostics.safe_message(error),
            }),
        ),
    }
    result
}

#[tauri::command]
pub(crate) fn read_task_confirmation(
    workspace_root: String,
    review_id: String,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    tasks: State<'_, TaskManager>,
) -> Result<TaskConfirmationResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    let token = active
        .activation_token(window.label())
        .map_err(|error| error.to_string())?;
    let scope = tasks.authorization_scope(window.label(), &root, token, &review_id)?;
    Ok(TaskConfirmationResult {
        protocol_version: PROTOCOL_VERSION,
        review_id,
        remembered: trust::task_confirmation_matches(&authorization_path(&app)?, &scope)?,
    })
}

#[tauri::command]
// Tauri injects window/application state alongside the stable command arguments.
#[allow(clippy::too_many_arguments)]
pub(crate) fn start_task_execution(
    workspace_root: String,
    review_id: String,
    remember_confirmation: bool,
    diagnostic_trace_id: Option<String>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    tasks: State<'_, TaskManager>,
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<TaskStarted, String> {
    let trace_id = diagnostics.command_trace(diagnostic_trace_id.as_deref(), "task-run");
    let started = Instant::now();
    diagnostics.info(
        "task.execution",
        "start.requested",
        Some(&trace_id),
        json!({
            "window": window.label(),
            "workspaceHash": diagnostics.hash_identifier(workspace_root.as_bytes()),
            "reviewId": &review_id,
            "rememberConfirmation": remember_confirmation,
        }),
    );
    let result = (|| {
        let root = active
            .resolve(window.label(), &workspace_root)
            .map_err(|e| e.to_string())?;
        let token = active
            .activation_token(window.label())
            .map_err(|e| e.to_string())?;
        let scope = tasks.authorization_scope(window.label(), &root, token, &review_id)?;
        let authorization_path = authorization_path(&app)?;
        let state = trust::read(&authorization_path, &root, &scope.plugin_id)?;
        if remember_confirmation {
            trust::remember_task_confirmation(&authorization_path, &scope)?;
        }
        let event_window = window.clone();
        let event_diagnostics = diagnostics.inner().clone();
        let event_trace_id = trace_id.clone();
        let event_state = Arc::new(Mutex::new(TaskRunDiagnosticState::new()));
        let sink = Arc::new(move |event: TaskSessionEvent| {
            record_task_event(&event_diagnostics, &event_trace_id, &event_state, &event);
            let _ = event_window.emit(EVENT, event);
        });
        let run_id = tasks.start(window.label(), &root, token, &review_id, state, sink)?;
        Ok(TaskStarted {
            protocol_version: PROTOCOL_VERSION,
            run_id,
            review_id: review_id.clone(),
            workspace_root: root.to_string_lossy().into_owned(),
        })
    })();
    match &result {
        Ok(run) => diagnostics.info(
            "task.execution",
            "start.accepted",
            Some(&trace_id),
            json!({
                "durationMs": elapsed_millis(started),
                "reviewId": &run.review_id,
                "runId": &run.run_id,
            }),
        ),
        Err(error) => diagnostics.error(
            "task.execution",
            "start.failed",
            Some(&trace_id),
            json!({
                "durationMs": elapsed_millis(started),
                "reviewId": &review_id,
                "error": diagnostics.safe_message(error),
            }),
        ),
    }
    result
}

#[tauri::command]
pub(crate) fn cancel_task_execution(
    run_id: String,
    window: tauri::WebviewWindow,
    tasks: State<'_, TaskManager>,
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<(), String> {
    let trace_id = diagnostics.next_trace_id("task-cancel");
    let result = tasks.cancel(window.label(), &run_id);
    let (level, event) = if result.is_ok() {
        ("info", "cancel.completed")
    } else {
        ("error", "cancel.failed")
    };
    diagnostics.record(
        level,
        "task.execution",
        event,
        Some(&trace_id),
        json!({
            "window": window.label(),
            "runId": &run_id,
            "error": result.as_ref().err().map(|error| diagnostics.safe_message(error)),
        }),
    );
    result
}

struct TaskRunDiagnosticState {
    started: Instant,
    output_events: u64,
    stdout_bytes: u64,
    stderr_bytes: u64,
    omitted_bytes: u64,
}

impl TaskRunDiagnosticState {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            output_events: 0,
            stdout_bytes: 0,
            stderr_bytes: 0,
            omitted_bytes: 0,
        }
    }
}

fn record_task_event(
    diagnostics: &DiagnosticsLog,
    trace_id: &str,
    state: &Arc<Mutex<TaskRunDiagnosticState>>,
    event: &TaskSessionEvent,
) {
    let Ok(mut state) = state.lock() else {
        diagnostics.error(
            "task.execution",
            "telemetry_state_failed",
            Some(trace_id),
            json!({"error": "task diagnostic state lock was poisoned"}),
        );
        return;
    };
    match event {
        TaskSessionEvent::Output {
            stream,
            data_base64,
            ..
        } => {
            state.output_events = state.output_events.saturating_add(1);
            let bytes = decoded_base64_bytes(data_base64);
            match stream {
                OutputStream::Stdout => {
                    state.stdout_bytes = state.stdout_bytes.saturating_add(bytes)
                }
                OutputStream::Stderr => {
                    state.stderr_bytes = state.stderr_bytes.saturating_add(bytes)
                }
            }
        }
        TaskSessionEvent::Truncated {
            run_id,
            stream,
            omitted_bytes,
            ..
        } => {
            state.omitted_bytes = state.omitted_bytes.saturating_add(*omitted_bytes);
            diagnostics.record(
                "warning",
                "task.execution",
                "output.truncated",
                Some(trace_id),
                json!({
                    "runId": run_id,
                    "stream": output_stream_name(stream),
                    "omittedBytes": omitted_bytes,
                }),
            );
        }
        TaskSessionEvent::Status {
            run_id,
            status,
            message,
            exit_code,
            ..
        } => {
            let terminal = matches!(
                status,
                TaskStatus::Succeeded
                    | TaskStatus::Failed
                    | TaskStatus::Cancelled
                    | TaskStatus::Crashed
            );
            let event_name = if terminal {
                "run.completed"
            } else {
                "run.status"
            };
            let level = if matches!(status, TaskStatus::Failed | TaskStatus::Crashed) {
                "error"
            } else {
                "info"
            };
            diagnostics.record(
                level,
                "task.execution",
                event_name,
                Some(trace_id),
                json!({
                    "runId": run_id,
                    "status": task_status_name(status),
                    "durationMs": elapsed_millis(state.started),
                    "exitCode": exit_code,
                    "message": message.as_ref().map(|value| diagnostics.safe_message(value)),
                    "outputEvents": state.output_events,
                    "stdoutBytes": state.stdout_bytes,
                    "stderrBytes": state.stderr_bytes,
                    "omittedBytes": state.omitted_bytes,
                }),
            );
        }
    }
}

fn decoded_base64_bytes(value: &str) -> u64 {
    let padding = value
        .as_bytes()
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count();
    value
        .len()
        .saturating_div(4)
        .saturating_mul(3)
        .saturating_sub(padding) as u64
}

fn output_stream_name(stream: &OutputStream) -> &'static str {
    match stream {
        OutputStream::Stdout => "stdout",
        OutputStream::Stderr => "stderr",
    }
}

fn task_status_name(status: &TaskStatus) -> &'static str {
    match status {
        TaskStatus::Queued => "queued",
        TaskStatus::Running => "running",
        TaskStatus::Succeeded => "succeeded",
        TaskStatus::Failed => "failed",
        TaskStatus::Cancelled => "cancelled",
        TaskStatus::Crashed => "crashed",
    }
}

fn elapsed_millis(started: Instant) -> u128 {
    started.elapsed().as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_byte_count_handles_padding() {
        assert_eq!(decoded_base64_bytes(""), 0);
        assert_eq!(decoded_base64_bytes("YQ=="), 1);
        assert_eq!(decoded_base64_bytes("YWI="), 2);
        assert_eq!(decoded_base64_bytes("YWJj"), 3);
    }

    #[test]
    fn task_events_log_aggregates_without_output_contents() {
        let directory = tempfile::tempdir().unwrap();
        let diagnostics = DiagnosticsLog::open(directory.path().to_path_buf());
        let state = Arc::new(Mutex::new(TaskRunDiagnosticState::new()));
        record_task_event(
            &diagnostics,
            "trace-1",
            &state,
            &TaskSessionEvent::Output {
                protocol_version: PROTOCOL_VERSION,
                run_id: "run-1".into(),
                workspace_root: "/private/workspace".into(),
                stream: OutputStream::Stdout,
                data_base64: "c2VjcmV0LW91dHB1dA==".into(),
                sequence: 1,
            },
        );
        record_task_event(
            &diagnostics,
            "trace-1",
            &state,
            &TaskSessionEvent::Status {
                protocol_version: PROTOCOL_VERSION,
                run_id: "run-1".into(),
                workspace_root: "/private/workspace".into(),
                sequence: 2,
                status: TaskStatus::Succeeded,
                message: None,
                exit_code: Some(0),
            },
        );
        assert!(diagnostics.flush(std::time::Duration::from_secs(2)));
        let log = std::fs::read_to_string(
            directory
                .path()
                .join(diagnostics.session_id())
                .join("asterlyn.jsonl"),
        )
        .unwrap();
        assert!(log.contains("\"event\":\"run.completed\""));
        assert!(log.contains("\"stdoutBytes\":13"));
        assert!(!log.contains("c2VjcmV0LW91dHB1dA=="));
        assert!(!log.contains("secret-output"));
    }
}
