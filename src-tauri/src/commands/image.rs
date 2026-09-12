use super::super::*;

#[tauri::command]
pub(crate) async fn read_image_file(
    repository_root: String,
    repository_id: String,
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ImagePreview, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let catalogued = active_workspaces.authorize_catalogued_file(
        window.label(),
        &root,
        &repository_id,
        &path,
    )?;
    run_workspace_blocking("read image file", move || {
        let authorized = reauthorize_session_file(&root, &catalogued)?;
        let snapshot = Workspace::open(&root)?
            .read_binary_file(&authorized.workspace_path, IMAGE_PREVIEW_LIMIT_BYTES)?;
        encode_image_preview(&snapshot.workspace_path, snapshot.bytes)
            .map_err(|message| WorkspaceError::UnsupportedFile { message })
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_local_image_diff(
    repository_root: String,
    selected: FileChange,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ImageDiffPreview, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read local image diff", move || {
        let diff = GitRepository::open(root)?.local_binary_diff(&selected)?;
        encode_image_diff(diff.path, diff.before, diff.after)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn read_commit_image_diff(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    path: String,
    original_path: Option<String>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ImageDiffPreview, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read commit image diff", move || {
        let diff = GitRepository::open(root)?.repository_commit_binary_diff(
            &repository_id,
            &commit_oid,
            &path,
            original_path.as_deref(),
        )?;
        encode_image_diff(diff.path, diff.before, diff.after)
    })
    .await
}
