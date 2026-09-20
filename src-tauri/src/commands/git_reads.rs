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

#[tauri::command]
pub(crate) async fn read_working_diff_base(
    repository_root: String,
    selected: FileChange,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<WorkingDiffBase, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read editable working Diff base", move || {
        let version = GitRepository::open(root)?
            .working_diff_base(&selected, asterlyn_workspace::DEFAULT_TEXT_LIMIT_BYTES)?;
        working_diff_base(version)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_commit_details(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitDetails, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read commit details", move || {
        GitRepository::open(root)?.repository_commit_details(&repository_id, &commit_oid)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_commit_comparison_details(
    repository_root: String,
    repository_id: String,
    before_oid: String,
    after_oid: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitComparisonDetails, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read commit comparison details", move || {
        GitRepository::open(root)?.repository_commit_comparison_details(
            &repository_id,
            &before_oid,
            &after_oid,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_git_blame(
    repository_root: String,
    repository_id: String,
    path: String,
    commit_oid: Option<String>,
    parent: bool,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<GitBlameResult, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read Git blame", move || {
        GitRepository::open(root)?.repository_blame(
            &repository_id,
            &path,
            commit_oid.as_deref(),
            parent,
        )
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn read_commit_diff(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    path: String,
    original_path: Option<String>,
    expanded_unchanged: bool,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitDiffResult, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read commit diff", move || {
        GitRepository::open(root)?.repository_commit_diff_with_unchanged(
            &repository_id,
            &commit_oid,
            &path,
            original_path.as_deref(),
            expanded_unchanged,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_commit_file(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    selected: CommitFileChange,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitFilePreview, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read historical commit file", move || {
        let version = GitRepository::open(root)?.repository_commit_file_version(
            &repository_id,
            &commit_oid,
            &selected,
            IMAGE_PREVIEW_LIMIT_BYTES,
        )?;
        commit_file_preview(version)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn compare_commit_file_to_current(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    selected: CommitFileChange,
    current_content: Option<String>,
    expected_current_revision: Option<String>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitFileComparison, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    let catalogued = active_workspaces
        .authorize_catalogued_file(window.label(), &root, &repository_id, &selected.path)
        .map_err(comparison_workspace_error)?;
    run_blocking("compare historical file to current", move || {
        let authorized = reauthorize_session_file_for_read(&root, &catalogued)
            .map_err(comparison_workspace_error)?;
        let current: BinaryFileSnapshot = Workspace::open(&root)
            .and_then(|workspace| {
                workspace.read_binary_file(&authorized.workspace_path, IMAGE_PREVIEW_LIMIT_BYTES)
            })
            .map_err(comparison_workspace_error)?;
        let version = GitRepository::open(&root)?.repository_commit_file_version(
            &repository_id,
            &commit_oid,
            &selected,
            IMAGE_PREVIEW_LIMIT_BYTES,
        )?;
        compare_commit_file(version, current, current_content, expected_current_revision)
    })
    .await
}

fn comparison_workspace_error(error: WorkspaceError) -> GitError {
    GitError::InvalidInput {
        field: "current file comparison".to_string(),
        message: error.to_string(),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn read_commit_comparison_diff(
    repository_root: String,
    repository_id: String,
    before_oid: String,
    after_oid: String,
    path: String,
    original_path: Option<String>,
    expanded_unchanged: bool,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitComparisonDiffResult, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read commit comparison diff", move || {
        GitRepository::open(root)?.repository_commit_comparison_diff_with_unchanged(
            &repository_id,
            &before_oid,
            &after_oid,
            &path,
            original_path.as_deref(),
            expanded_unchanged,
        )
    })
    .await
}
