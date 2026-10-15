use crate::application::trust;
use crate::application::{
    ActiveWorkspaces, TaskArtifactDiscovery, TaskManager, scan_task_artifacts,
};
use asterlyn_task::{PROTOCOL_VERSION, PreparedTask, TaskRequest, TaskSessionEvent, TaskStarted};
use tauri::{Emitter, Manager, State};

const EVENT: &str = "task-session-event";

#[tauri::command]
pub(crate) fn discover_task_artifacts(
    repository_root: String,
    hints: Vec<String>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<TaskArtifactDiscovery, String> {
    let root = active_workspaces
        .resolve(window.label(), &repository_root)
        .map_err(|error| error.to_string())?;
    scan_task_artifacts(&root, &hints)
}
#[tauri::command]
pub(crate) fn prepare_task_execution(
    workspace_root: String,
    request: TaskRequest,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    tasks: State<'_, TaskManager>,
) -> Result<PreparedTask, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|e| e.to_string())?;
    let token = active
        .activation_token(window.label())
        .map_err(|e| e.to_string())?;
    let trust_path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("resolve local task trust store: {e}"))?
        .join("task-trust-v1.json");
    let state = trust::read(&trust_path, &root)?;
    tasks.prepare(window.label(), &root, token, request, state)
}

#[tauri::command]
pub(crate) fn start_task_execution(
    workspace_root: String,
    review_id: String,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    tasks: State<'_, TaskManager>,
) -> Result<TaskStarted, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|e| e.to_string())?;
    let token = active
        .activation_token(window.label())
        .map_err(|e| e.to_string())?;
    let state = trust::read(
        &app.path()
            .app_local_data_dir()
            .map_err(|e| format!("resolve local task trust store: {e}"))?
            .join("task-trust-v1.json"),
        &root,
    )?;
    let event_window = window.clone();
    let sink = std::sync::Arc::new(move |event: TaskSessionEvent| {
        let _ = event_window.emit(EVENT, event);
    });
    let run_id = tasks.start(window.label(), &root, token, &review_id, state, sink)?;
    Ok(TaskStarted {
        protocol_version: PROTOCOL_VERSION,
        run_id,
        review_id,
        workspace_root: root.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub(crate) fn cancel_task_execution(
    run_id: String,
    window: tauri::WebviewWindow,
    tasks: State<'_, TaskManager>,
) -> Result<(), String> {
    tasks.cancel(window.label(), &run_id)
}
