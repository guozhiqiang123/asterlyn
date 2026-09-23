use std::path::{Path, PathBuf};

use asterlyn_git::{GitRepository, ProjectFile, ProjectFileList};
use asterlyn_workspace::{Workspace, WorkspaceEntryKind, WorkspaceError};

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

pub(crate) fn load_ignored_project_directory(
    root: &Path,
    workspace_path: &str,
) -> Result<ProjectFileList, WorkspaceError> {
    let repository = exact_git_repository(root)?.ok_or_else(|| WorkspaceError::NotAuthorized {
        message: "ignored directory expansion requires a Git project".to_string(),
    })?;
    repository
        .project_ignored_directory(workspace_path, PROJECT_FILE_LIMIT)
        .map_err(|error| WorkspaceError::Io {
            operation: "list ignored project directory".to_string(),
            message: error.to_string(),
        })
}

pub(crate) fn resolve_workspace_entry(
    root: &Path,
    workspace_path: &str,
    kind: WorkspaceEntryKind,
) -> Result<PathBuf, WorkspaceError> {
    let workspace = Workspace::open(root)?;
    if workspace_path.is_empty() {
        // The Files navigator header addresses the workspace root itself, which has no relative
        // path of its own. Only a directory reveal of that exact authorized root is accepted.
        return match kind {
            WorkspaceEntryKind::Directory => Ok(workspace.root().to_path_buf()),
            WorkspaceEntryKind::File => Err(WorkspaceError::InvalidPath {
                message: "the workspace root is a directory".to_string(),
            }),
        };
    }
    workspace.resolve_existing_entry(workspace_path, kind)
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
            ignored: false,
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
        ignored: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_workspace_entry_path_addresses_only_the_authorized_root_directory() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("src")).unwrap();
        let canonical = std::fs::canonicalize(directory.path()).unwrap();
        assert_eq!(
            resolve_workspace_entry(directory.path(), "", WorkspaceEntryKind::Directory).unwrap(),
            canonical
        );
        assert!(matches!(
            resolve_workspace_entry(directory.path(), "", WorkspaceEntryKind::File),
            Err(WorkspaceError::InvalidPath { .. })
        ));
        assert!(matches!(
            resolve_workspace_entry(
                directory.path(),
                "../outside",
                WorkspaceEntryKind::Directory
            ),
            Err(WorkspaceError::InvalidPath { .. })
        ));
    }
}
