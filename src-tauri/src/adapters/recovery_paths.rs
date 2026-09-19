use std::path::PathBuf;

use asterlyn_workspace::WorkspaceError;
use tauri::Manager;

pub(crate) fn commit_file_restore_recovery_root(
    app: &tauri::AppHandle,
) -> Result<PathBuf, WorkspaceError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("commit-file-restore-recovery-v1"))
        .map_err(|error| WorkspaceError::Io {
            operation: "resolve commit-file restore recovery location".into(),
            message: error.to_string(),
        })
}

pub(crate) fn replacement_recovery_root(app: &tauri::AppHandle) -> Result<PathBuf, WorkspaceError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("replacement-recovery-v1"))
        .map_err(|error| WorkspaceError::Io {
            operation: "resolve replacement recovery location".to_string(),
            message: error.to_string(),
        })
}

pub(crate) fn workspace_mutation_recovery_root(
    app: &tauri::AppHandle,
) -> Result<PathBuf, WorkspaceError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("workspace-mutation-recovery-v1"))
        .map_err(|error| WorkspaceError::Io {
            operation: "resolve workspace mutation recovery location".to_string(),
            message: error.to_string(),
        })
}
