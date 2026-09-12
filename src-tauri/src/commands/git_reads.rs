use super::super::*;

#[tauri::command]
pub(crate) async fn read_tracked_changes(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<TrackedChangeScan, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read tracked changes", move || {
        GitRepository::open(root)?.tracked_changes()
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_history_page(
    repository_root: String,
    query: HistoryQuery,
    offset: usize,
    limit: usize,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<HistoryPage, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read history page", move || {
        GitRepository::open(root)?.query_commit_history_page(&query, offset, limit)
    })
    .await
}

#[tauri::command]
pub(crate) async fn scan_untracked(
    repository_root: String,
    scan_id: String,
    window: tauri::WebviewWindow,
    scans: State<'_, ScanRegistry>,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<UntrackedScan, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    let (window_label, scan_id, cancellation) = scans.register(window.label(), scan_id)?;
    let scan_key = (window_label, scan_id);

    let task_cancellation = cancellation.clone();
    let result = run_blocking("scan untracked files", move || {
        GitRepository::open(root)?.untracked_changes(&task_cancellation)
    })
    .await;

    scans.finish(&scan_key, &cancellation)?;
    result
}

#[tauri::command]
pub(crate) fn cancel_untracked_scan(
    scan_id: String,
    window: tauri::WebviewWindow,
    scans: State<'_, ScanRegistry>,
) -> Result<(), GitError> {
    scans.cancel(window.label(), scan_id)
}

#[tauri::command]
pub(crate) async fn read_diff(
    repository_root: String,
    path: String,
    staged: bool,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<DiffResult, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read diff", move || {
        GitRepository::open(root)?.diff(&path, staged)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_local_diff(
    repository_root: String,
    selected: FileChange,
    expanded_unchanged: bool,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<DiffResult, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read complete local diff", move || {
        GitRepository::open(root)?.local_diff_with_unchanged(&selected, expanded_unchanged)
    })
    .await
}
