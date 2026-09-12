use super::super::*;

#[tauri::command]
pub(crate) fn start_workspace_watch(
    workspace_root: String,
    generation: u64,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active_workspaces: State<'_, ActiveWorkspaces>,
    watches: State<'_, WorkspaceWatchService>,
) -> Result<WorkspaceWatchStatus, WorkspaceError> {
    let roots = active_workspaces.watch_roots(window.label(), &workspace_root)?;
    Ok(watches.activate(app, window.label(), roots, generation))
}

#[tauri::command]
pub(crate) fn stop_workspace_watch(
    window: tauri::WebviewWindow,
    watches: State<'_, WorkspaceWatchService>,
) {
    watches.remove_window(window.label());
}
