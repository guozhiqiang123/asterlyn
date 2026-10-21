use crate::application::{ActiveWorkspaces, PluginProcessQueryManager, TaskManager, trust};
use asterlyn_task::TrustState;
use tauri::State;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceTrustResult {
    protocol_version: u8,
    workspace_root: String,
    plugin_id: String,
    state: TrustState,
}

#[tauri::command]
pub(crate) fn read_workspace_trust(
    workspace_root: String,
    plugin_id: String,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
) -> Result<WorkspaceTrustResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|e| e.to_string())?;
    Ok(WorkspaceTrustResult {
        protocol_version: 1,
        workspace_root: root.to_string_lossy().into_owned(),
        state: trust::read(&trust::app_store_path(&app)?, &root, &plugin_id)?,
        plugin_id,
    })
}

#[tauri::command]
// Tauri injects the window, app handle, and managed states beside the three stable IPC fields.
#[allow(clippy::too_many_arguments)]
pub(crate) fn set_workspace_trust(
    workspace_root: String,
    plugin_id: String,
    state: TrustState,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    tasks: State<'_, TaskManager>,
    process_queries: State<'_, PluginProcessQueryManager>,
) -> Result<WorkspaceTrustResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|e| e.to_string())?;
    let result = trust::set(&trust::app_store_path(&app)?, &root, &plugin_id, state)?;
    if result != TrustState::Trusted {
        tasks.cancel_workspace(&root);
        process_queries.cancel_session_operations(window.label(), &plugin_id);
    }
    Ok(WorkspaceTrustResult {
        protocol_version: 1,
        workspace_root: root.to_string_lossy().into_owned(),
        plugin_id,
        state: result,
    })
}
