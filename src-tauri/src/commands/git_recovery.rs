use super::super::*;
use super::git_operations::{complete_repository_slices, mutation_outcome};
use crate::application::git_worktree_transactions::{
    self, GitWorktreeRecovery, RestoreChangesPlan,
};

#[tauri::command]
pub(crate) async fn prepare_restore_changes(
    repository_root: String,
    selected: Vec<FileChange>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RestoreChangesPlan, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("review restore", move || {
        git_worktree_transactions::prepare_restore(&GitRepository::open(root)?, &selected)
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_git_worktree_recoveries(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    app: tauri::AppHandle,
) -> Result<Vec<GitWorktreeRecovery>, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    let recovery_root = git_recovery_root(&app)?;
    run_blocking("list worktree recovery", move || {
        git_worktree_transactions::list_recoveries(&GitRepository::open(root)?, &recovery_root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn undo_git_worktree_recovery(
    repository_root: String,
    recovery_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    git_operations: State<'_, GitOperationCoordinator>,
    app: tauri::AppHandle,
) -> Result<RepositoryMutationOutcome, GitError> {
    let root = active_workspaces
        .require_git(window.label(), &repository_root)?
        .to_string_lossy()
        .into_owned();
    let recovery_root = git_recovery_root(&app)?;
    git_operations
        .run_local(root, "undo worktree change", move |repository| {
            git_worktree_transactions::undo_recovery(repository, &recovery_root, &recovery_id)?;
            repository
                .tracked_snapshot(COMMIT_LIMIT)
                .map(|snapshot| mutation_outcome(snapshot, &complete_repository_slices()))
        })
        .await
}

pub(crate) fn git_recovery_root(app: &tauri::AppHandle) -> Result<PathBuf, GitError> {
    app.path()
        .app_local_data_dir()
        .map(|root| root.join("git-worktree-recovery-v1"))
        .map_err(|error| GitError::Io {
            operation: "resolve Git recovery location".into(),
            message: error.to_string(),
        })
}
