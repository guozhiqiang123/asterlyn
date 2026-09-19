use asterlyn_workspace::{FileRestoreApplyResult, FileRestoreRecoverySummary};

use super::super::*;
use crate::adapters::recovery_paths::commit_file_restore_recovery_root;
use crate::application::{
    CommitFileRestorePreview, execute_commit_file_restore_plan,
    finalize_commit_file_restore as finalize_file_restore,
    list_commit_file_restore_recoveries as load_commit_file_restore_recoveries,
    prepare_commit_file_restore_plan, rollback_commit_file_restore as rollback_file_restore,
};

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
        prepare_commit_file_restore_plan(
            &task_root,
            &task_plan_id,
            &task_repository_id,
            &task_commit_oid,
            task_selected,
        )
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
    let result = run_workspace_blocking("execute commit-file restore", move || {
        execute_commit_file_restore_plan(&root, &recovery_root, execution)
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
        load_commit_file_restore_recoveries(&root, &recovery_root)
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
    let writes = writes.inner().clone();
    let recovery_root = commit_file_restore_recovery_root(&app)?;
    run_workspace_blocking("rollback commit-file restore", move || {
        rollback_file_restore(&root, &recovery_root, &recovery_id, &writes)
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
    let writes = writes.inner().clone();
    let recovery_root = commit_file_restore_recovery_root(&app)?;
    run_workspace_blocking("finalize commit-file restore", move || {
        finalize_file_restore(&root, &recovery_root, &recovery_id, &writes)
    })
    .await
}

fn git_restore_error(error: GitError) -> WorkspaceError {
    WorkspaceError::InvalidMutation {
        message: error.to_string(),
    }
}
