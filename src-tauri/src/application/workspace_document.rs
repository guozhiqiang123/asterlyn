use std::path::Path;

use asterlyn_git::ProjectFile;
use asterlyn_workspace::{
    SaveTextFileRequest, SaveTextFileResult, TextFileSnapshot, Workspace, WorkspaceError,
};

#[cfg(test)]
use super::workspace_catalog::authorize_project_file;
use super::workspace_catalog::{reauthorize_session_file, reauthorize_session_file_for_read};
use super::workspace_session::WorkspaceWriteRegistry;

pub(crate) fn read_session_text_file(
    root: &Path,
    catalogued: &ProjectFile,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let authorized = reauthorize_session_file_for_read(root, catalogued)?;
    Workspace::open(root)?.read_text_file(&authorized.workspace_path)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn save_session_text_file(
    root: &Path,
    catalogued: &ProjectFile,
    expected_revision: String,
    content: String,
    utf8_bom: bool,
    request_id: String,
    writes: &WorkspaceWriteRegistry,
) -> Result<SaveTextFileResult, WorkspaceError> {
    let write_lock = writes.lock_for(root.to_string_lossy().into_owned())?;
    let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
        operation: "serialize workspace writes".to_string(),
        message: "workspace-write lock was poisoned".to_string(),
    })?;
    if catalogued.read_only {
        return Err(WorkspaceError::NotAuthorized {
            message: "the selected project file is read-only".to_string(),
        });
    }
    let authorized = reauthorize_session_file(root, catalogued)?;
    Workspace::open(root)?.save_text_file(&SaveTextFileRequest {
        workspace_path: authorized.workspace_path,
        expected_revision,
        content,
        utf8_bom,
        request_id,
    })
}

#[cfg(test)]
pub(crate) fn read_authorized_text_file(
    root: &Path,
    repository_id: &str,
    path: &str,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let authorized = authorize_project_file(root, repository_id, path)?;
    read_session_text_file(root, &authorized)
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn save_authorized_text_file(
    root: &Path,
    repository_id: &str,
    path: &str,
    expected_revision: String,
    content: String,
    utf8_bom: bool,
    request_id: String,
) -> Result<SaveTextFileResult, WorkspaceError> {
    let authorized = authorize_project_file(root, repository_id, path)?;
    save_session_text_file(
        root,
        &authorized,
        expected_revision,
        content,
        utf8_bom,
        request_id,
        &WorkspaceWriteRegistry::default(),
    )
}
