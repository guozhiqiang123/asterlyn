use std::path::PathBuf;

use asterlyn_workspace::{FileRestoreApplyResult, FileRestorePreview, FileRestoreRecoverySummary};
use tauri::Manager;

use super::super::*;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitFileRestorePreview {
    #[serde(flatten)]
    pub(crate) restore: FileRestorePreview,
    pub(crate) repository_id: String,
    pub(crate) commit_oid: String,
    pub(crate) revision_oid: String,
    pub(crate) source_path: String,
    pub(crate) blob_oid: String,
    pub(crate) file_mode: String,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn prepare_commit_file_restore(
    repository_root: String,
    plan_id: String,
    repository_id: String,
    commit_oid: String,
    selected: CommitFileChange,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    restores: State<'_, CommitFileRestoreRegistry>,
) -> Result<CommitFileRestorePreview, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces
        .require_git(&window_label, &repository_root)
        .map_err(git_restore_error)?;
    let token = restores.begin_plan(&window_label, &repository_root, &plan_id)?;
    let task_root = root.clone();
    let task_plan_id = plan_id.clone();
    let task_repository_id = repository_id.clone();
    let task_commit_oid = commit_oid.clone();
    let task_selected = selected.clone();
    let result = run_workspace_blocking("prepare commit-file restore", move || {
        let repository = GitRepository::open(&task_root).map_err(git_restore_error)?;
        let target = repository
            .authorize_project_file_target(&task_repository_id, &task_selected.path)
            .map_err(git_restore_error)?;
        let source = repository
            .repository_commit_file_version(
                &task_repository_id,
                &task_commit_oid,
                &task_selected,
                IMAGE_PREVIEW_LIMIT_BYTES,
            )
            .map_err(git_restore_error)?;
        let restored_mode = restore_mode(&source.file_mode)?;
        let plan = Workspace::with_text_limit(&task_root, IMAGE_PREVIEW_LIMIT_BYTES)?
            .plan_file_restore(
                &task_plan_id,
                &target.workspace_path,
                source.bytes.clone(),
                restored_mode,
            )?;
        let preview = CommitFileRestorePreview {
            restore: plan.preview().clone(),
            repository_id: source.repository_id.clone(),
            commit_oid: source.commit_oid.clone(),
            revision_oid: source.revision_oid.clone(),
            source_path: source.source_path.clone(),
            blob_oid: source.blob_oid.clone(),
            file_mode: source.file_mode.clone(),
        };
        Ok((
            StoredCommitFileRestorePlan {
                root: task_root,
                repository_id: task_repository_id,
                commit_oid: task_commit_oid,
                selected: task_selected,
                source,
                plan,
            },
            preview,
        ))
    })
    .await;
    match result {
        Ok((stored, preview)) => {
            restores.finish_plan(
                &window_label,
                &repository_root,
                &plan_id,
                token,
                Some(stored),
            )?;
            Ok(preview)
        }
        Err(error) => {
            restores.finish_plan(&window_label, &repository_root, &plan_id, token, None)?;
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn execute_commit_file_restore(
    repository_root: String,
    plan_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    restores: State<'_, CommitFileRestoreRegistry>,
    app: tauri::AppHandle,
) -> Result<FileRestoreApplyResult, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces
        .require_git(&window_label, &repository_root)
        .map_err(git_restore_error)?;
    let execution = restores.start_execution(&window_label, &repository_root, &root, &plan_id)?;
    let recovery_root = commit_file_restore_recovery_root(&app)?;
    let stored = execution.stored;
    let write_lock = execution.write_lock;
    let result = run_workspace_blocking("execute commit-file restore", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".into(),
            message: "workspace-write lock was poisoned".into(),
        })?;
        let repository = GitRepository::open(&root).map_err(git_restore_error)?;
        let target = repository
            .authorize_project_file_target(&stored.repository_id, &stored.selected.path)
            .map_err(git_restore_error)?;
        if target.workspace_path != stored.plan.workspace_path() {
            return Err(WorkspaceError::NotAuthorized {
                message: "the reviewed historical-file target is no longer current".into(),
            });
        }
        let current_source = repository
            .repository_commit_file_version(
                &stored.repository_id,
                &stored.commit_oid,
                &stored.selected,
                IMAGE_PREVIEW_LIMIT_BYTES,
            )
            .map_err(git_restore_error)?;
        if current_source != stored.source {
            return Err(WorkspaceError::InvalidMutation {
                message: "the reviewed historical file identity changed; review it again".into(),
            });
        }
        Workspace::with_text_limit(&root, IMAGE_PREVIEW_LIMIT_BYTES)?
            .apply_file_restore(&recovery_root, &stored.plan)
    })
    .await;
    restores.finish_execution(&window_label, &repository_root, &plan_id)?;
    result
}

#[tauri::command]
pub(crate) async fn list_commit_file_restore_recoveries(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    app: tauri::AppHandle,
) -> Result<Vec<FileRestoreRecoverySummary>, WorkspaceError> {
    let root = active_workspaces
        .require_git(window.label(), &repository_root)
        .map_err(git_restore_error)?;
    let recovery_root = commit_file_restore_recovery_root(&app)?;
    run_workspace_blocking("list commit-file restore recoveries", move || {
        Workspace::with_text_limit(root, IMAGE_PREVIEW_LIMIT_BYTES)?
            .list_file_restore_recoveries(&recovery_root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rollback_commit_file_restore(
    repository_root: String,
    recovery_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
    app: tauri::AppHandle,
) -> Result<FileRestoreApplyResult, WorkspaceError> {
    let root = active_workspaces
        .require_git(window.label(), &repository_root)
        .map_err(git_restore_error)?;
    let write_lock = writes.lock_for(root.to_string_lossy().into_owned())?;
    let recovery_root = commit_file_restore_recovery_root(&app)?;
    run_workspace_blocking("rollback commit-file restore", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".into(),
            message: "workspace-write lock was poisoned".into(),
        })?;
        Workspace::with_text_limit(root, IMAGE_PREVIEW_LIMIT_BYTES)?
            .rollback_file_restore(&recovery_root, &recovery_id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn finalize_commit_file_restore(
    repository_root: String,
    recovery_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
    app: tauri::AppHandle,
) -> Result<(), WorkspaceError> {
    let root = active_workspaces
        .require_git(window.label(), &repository_root)
        .map_err(git_restore_error)?;
    let write_lock = writes.lock_for(root.to_string_lossy().into_owned())?;
    let recovery_root = commit_file_restore_recovery_root(&app)?;
    run_workspace_blocking("finalize commit-file restore", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".into(),
            message: "workspace-write lock was poisoned".into(),
        })?;
        Workspace::with_text_limit(root, IMAGE_PREVIEW_LIMIT_BYTES)?
            .finalize_file_restore(&recovery_root, &recovery_id)
    })
    .await
}

fn restore_mode(file_mode: &str) -> Result<u32, WorkspaceError> {
    match file_mode {
        "100644" => Ok(0o644),
        "100755" => Ok(0o755),
        _ => Err(WorkspaceError::UnsupportedFile {
            message: format!("historical Git mode {file_mode} is not a restorable regular file"),
        }),
    }
}

fn git_restore_error(error: GitError) -> WorkspaceError {
    WorkspaceError::InvalidMutation {
        message: error.to_string(),
    }
}

fn commit_file_restore_recovery_root(app: &tauri::AppHandle) -> Result<PathBuf, WorkspaceError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("commit-file-restore-recovery-v1"))
        .map_err(|error| WorkspaceError::Io {
            operation: "resolve commit-file restore recovery location".into(),
            message: error.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_regular_git_file_modes() {
        assert_eq!(restore_mode("100644").unwrap(), 0o644);
        assert_eq!(restore_mode("100755").unwrap(), 0o755);
        assert!(restore_mode("120000").is_err());
        assert!(restore_mode("160000").is_err());
    }
}
