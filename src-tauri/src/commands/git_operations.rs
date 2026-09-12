use super::super::*;

#[tauri::command]
pub(crate) async fn stage_paths(
    repository_root: String,
    paths: Vec<String>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "stage paths", move |repository| {
            repository.stage(&paths)?;
            repository.tracked_snapshot(COMMIT_LIMIT)
        })
        .await
}

#[tauri::command]
pub(crate) async fn unstage_paths(
    repository_root: String,
    paths: Vec<String>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "unstage paths", move |repository| {
            repository.unstage(&paths)?;
            repository.tracked_snapshot(COMMIT_LIMIT)
        })
        .await
}

#[tauri::command]
pub(crate) async fn commit_changes(
    repository_root: String,
    message: String,
    selected: Vec<FileChange>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitSelectedResult, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "create selected commit",
            move |repository| {
                let committed = repository.commit_selected(&message, &selected)?;
                match repository.tracked_snapshot(COMMIT_LIMIT) {
                    Ok(snapshot) => Ok(CommitSelectedResult {
                        oid: committed.oid,
                        snapshot: Some(snapshot),
                        refresh_error: None,
                        verification_warning: committed.verification_warning,
                    }),
                    Err(error) => Ok(CommitSelectedResult {
                        oid: committed.oid,
                        snapshot: None,
                        refresh_error: Some(error.to_string()),
                        verification_warning: committed.verification_warning,
                    }),
                }
            },
        )
        .await
}

#[tauri::command]
pub(crate) async fn revert_changes(
    repository_root: String,
    selected: Vec<FileChange>,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(
            repository_root,
            "revert selected changes",
            move |repository| {
                repository.revert_selected(&selected)?;
                repository.tracked_snapshot(COMMIT_LIMIT)
            },
        )
        .await
}

#[tauri::command]
pub(crate) async fn switch_branch(
    repository_root: String,
    target_full_name: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "switch branch", move |repository| {
            repository.switch_branch(&target_full_name)?;
            repository.tracked_snapshot(COMMIT_LIMIT)
        })
        .await
}

#[tauri::command]
pub(crate) async fn create_branch(
    repository_root: String,
    name: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_local(repository_root, "create branch", move |repository| {
            repository.create_branch(&name)?;
            repository.tracked_snapshot(COMMIT_LIMIT)
        })
        .await
}

#[tauri::command]
pub(crate) async fn fetch_remote(
    repository_root: String,
    remote: String,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_remote(
            repository_root,
            operation_id,
            "fetch",
            COMMIT_LIMIT,
            move |repository, cancellation| repository.fetch_remote(&remote, cancellation),
        )
        .await
}

#[tauri::command]
pub(crate) async fn read_push_preview(
    repository_root: String,
    remote: String,
    tag_mode: PushTagMode,
    offset: usize,
    page_size: usize,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<PushPreview, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read push preview", move || {
        GitRepository::open(root)?.push_preview_with_tags(&remote, tag_mode, offset, page_size)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_push_file_commit(
    repository_root: String,
    remote: String,
    tag_mode: PushTagMode,
    preview_token: String,
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<Option<CommitDetails>, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read pushed file commit", move || {
        GitRepository::open(root)?.push_file_commit(&remote, tag_mode, &preview_token, &path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn pull_current(
    repository_root: String,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_remote(
            repository_root,
            operation_id,
            "pull",
            COMMIT_LIMIT,
            move |repository, cancellation| repository.pull_ff_only(cancellation),
        )
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn push_current(
    repository_root: String,
    remote: String,
    mode: PushMode,
    tag_mode: PushTagMode,
    preview_token: String,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let repository_root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    git_operations
        .run_remote(
            repository_root,
            operation_id,
            "push",
            COMMIT_LIMIT,
            move |repository, cancellation| {
                repository.push_current_with_options(
                    &remote,
                    mode,
                    tag_mode,
                    &preview_token,
                    cancellation,
                )
            },
        )
        .await
}

#[tauri::command]
pub(crate) fn cancel_remote_operation(
    repository_root: String,
    operation_id: String,
    git_operations: State<'_, GitOperationCoordinator>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<(), GitError> {
    active_workspaces.require_git(window.label(), &repository_root)?;
    git_operations.cancel_remote(repository_root, operation_id)
}
