use crate::application::{ActiveWorkspaces, PluginProcessQueryManager, PluginProcessQueryResult};
use tauri::State;

#[tauri::command]
pub(crate) async fn execute_plugin_process_query(
    workspace_root: String,
    plugin_id: String,
    query_id: String,
    window: tauri::WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
    queries: State<'_, PluginProcessQueryManager>,
) -> Result<PluginProcessQueryResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    let owner = window.label().to_string();
    let manager = queries.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.execute(&owner, &root, &plugin_id, &query_id)
    })
    .await
    .map_err(|error| format!("process query worker could not complete: {error}"))
}
