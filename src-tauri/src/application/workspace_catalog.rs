use std::path::Path;

use asterlyn_git::{GitRepository, ProjectFile, ProjectFileList};
use asterlyn_workspace::{Workspace, WorkspaceError};

pub(crate) const PROJECT_FILE_LIMIT: usize = 100_000;

pub(crate) fn exact_git_repository(root: &Path) -> Result<Option<GitRepository>, WorkspaceError> {
    let canonical = std::fs::canonicalize(root).map_err(|error| WorkspaceError::Io {
        operation: "resolve selected workspace".to_string(),
        message: error.to_string(),
    })?;
    match GitRepository::open(root) {
        Ok(repository) => {
            let discovered =
                std::fs::canonicalize(repository.root()).map_err(|error| WorkspaceError::Io {
                    operation: "resolve discovered Git root".to_string(),
                    message: error.to_string(),
                })?;
            Ok((discovered == canonical).then_some(repository))
        }
        Err(error) if root.join(".git").exists() => Err(WorkspaceError::Io {
            operation: "open Git project".to_string(),
            message: error.to_string(),
        }),
        Err(_) => Ok(None),
    }
}

pub(crate) fn load_project_catalog(root: &Path) -> Result<ProjectFileList, WorkspaceError> {
    load_project_catalog_with_ignored(root, true)
}

pub(crate) fn load_authorized_project_catalog(
    root: &Path,
) -> Result<ProjectFileList, WorkspaceError> {
    load_project_catalog_with_ignored(root, false)
}

fn load_project_catalog_with_ignored(
    root: &Path,
    include_ignored: bool,
) -> Result<ProjectFileList, WorkspaceError> {
    if let Some(repository) = exact_git_repository(root)? {
        return (if include_ignored {
            repository.project_files(PROJECT_FILE_LIMIT)
        } else {
            repository.authorized_project_files(PROJECT_FILE_LIMIT)
        })
        .map_err(|error| WorkspaceError::Io {
            operation: "list Git project files".to_string(),
            message: error.to_string(),
        });
    }
    let catalog = Workspace::open(root)?.list_files(PROJECT_FILE_LIMIT)?;
    let root = root.to_string_lossy().into_owned();
    let files = catalog
        .paths
        .iter()
        .map(|path| ProjectFile {
            repository_id: "workspace".to_string(),
            path: path.clone(),
            workspace_path: path.clone(),
            read_only: false,
        })
        .collect();
    Ok(ProjectFileList {
        root,
        paths: catalog.paths,
        files,
        ignored_entries: Vec::new(),
        repository_roots: Vec::new(),
        truncated: catalog.truncated,
    })
}

pub(crate) fn reauthorize_session_file(
    root: &Path,
    catalogued: &ProjectFile,
) -> Result<ProjectFile, WorkspaceError> {
    if let Some(repository) = exact_git_repository(root)? {
        return repository
            .reauthorize_project_file(catalogued)
            .map_err(|_| WorkspaceError::NotAuthorized {
                message: "select a current tracked or non-ignored project file".to_string(),
            });
    }
    if catalogued.repository_id != "workspace" || catalogued.path != catalogued.workspace_path {
        return Err(WorkspaceError::NotAuthorized {
            message: "select a current file from the active ordinary folder".to_string(),
        });
    }
    Ok(catalogued.clone())
}

pub(crate) fn reauthorize_session_file_for_read(
    root: &Path,
    catalogued: &ProjectFile,
) -> Result<ProjectFile, WorkspaceError> {
    if let Some(repository) = exact_git_repository(root)? {
        return repository
            .reauthorize_project_file_for_read(catalogued)
            .map_err(|_| WorkspaceError::NotAuthorized {
                message: "select a current project file".to_string(),
            });
    }
    reauthorize_session_file(root, catalogued)
}

#[cfg(test)]
pub(crate) fn authorize_project_file(
    root: &Path,
    repository_id: &str,
    path: &str,
) -> Result<ProjectFile, WorkspaceError> {
    if let Some(repository) = exact_git_repository(root)? {
        return repository
            .authorize_project_file(repository_id, path, PROJECT_FILE_LIMIT)
            .map_err(|_| WorkspaceError::NotAuthorized {
                message: "select a current tracked or non-ignored project file".to_string(),
            });
    }
    if repository_id != "workspace" {
        return Err(WorkspaceError::NotAuthorized {
            message: "select a current file from the active ordinary folder".to_string(),
        });
    }
    let catalog = Workspace::open(root)?.list_files(PROJECT_FILE_LIMIT)?;
    if !catalog.paths.iter().any(|candidate| candidate == path) {
        return Err(WorkspaceError::NotAuthorized {
            message: "select a current file from the active ordinary folder catalog".to_string(),
        });
    }
    Ok(ProjectFile {
        repository_id: repository_id.to_string(),
        path: path.to_string(),
        workspace_path: path.to_string(),
        read_only: false,
    })
}
