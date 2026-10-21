use crate::application::{
    ActiveWorkspaces, PluginProcessQueryManager, PluginProcessQueryResult,
    PluginToolOperationExecution, PluginToolOperationResult, trust,
};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub(crate) async fn execute_plugin_process_query(
    workspace_root: String,
    plugin_id: String,
    query_id: String,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    queries: State<'_, PluginProcessQueryManager>,
) -> Result<PluginProcessQueryResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    let owner = window.label().to_string();
    let manager = queries.inner().clone();
    let trust_store = trust::app_store_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        manager.execute(&owner, &root, &trust_store, &plugin_id, &query_id)
    })
    .await
    .map_err(|error| format!("process query worker could not complete: {error}"))
}

#[tauri::command]
// Tauri maps these stable top-level parameters directly from the generated IPC contract.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_plugin_tool_operation(
    workspace_root: String,
    plugin_id: String,
    request_id: String,
    operation_id: String,
    parameters: HashMap<String, String>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    queries: State<'_, PluginProcessQueryManager>,
) -> Result<PluginToolOperationResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    let owner = window.label().to_string();
    let manager = queries.inner().clone();
    let trust_store = trust::app_store_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        manager.execute_tool_operation(PluginToolOperationExecution {
            owner: &owner,
            root: &root,
            trust_store: &trust_store,
            plugin_id: &plugin_id,
            request_id: &request_id,
            operation_id: &operation_id,
            parameters: &parameters,
        })
    })
    .await
    .map_err(|error| format!("plugin tool-operation worker could not complete: {error}"))
}

#[tauri::command]
pub(crate) fn cancel_plugin_tool_operation(
    request_id: String,
    window: tauri::WebviewWindow,
    queries: State<'_, PluginProcessQueryManager>,
) {
    queries.cancel_request(window.label(), &request_id);
}
