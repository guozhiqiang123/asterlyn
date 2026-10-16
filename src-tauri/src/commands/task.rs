use crate::application::trust;
use crate::application::{
    ActiveWorkspaces, TaskArtifactDiscovery, TaskManager, scan_task_artifacts,
};
use asterlyn_task::{PROTOCOL_VERSION, PreparedTask, TaskRequest, TaskSessionEvent, TaskStarted};
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
    let state = trust::read(&authorization_path(&app)?, &root, &request.plugin_id)?;
    tasks.prepare(window.label(), &root, token, request, state)
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
pub(crate) fn start_task_execution(
    workspace_root: String,
    review_id: String,
    remember_confirmation: bool,
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
    let scope = tasks.authorization_scope(window.label(), &root, token, &review_id)?;
    let authorization_path = authorization_path(&app)?;
    let state = trust::read(&authorization_path, &root, &scope.plugin_id)?;
    if remember_confirmation {
        trust::remember_task_confirmation(&authorization_path, &scope)?;
    }
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
