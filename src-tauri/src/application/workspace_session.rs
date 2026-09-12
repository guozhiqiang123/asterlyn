use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use asterlyn_git::{GitError, ProjectFile, ProjectFileList};
use asterlyn_workspace::WorkspaceError;

#[derive(Default)]
pub(crate) struct ActiveWorkspaces {
    roots: Mutex<HashMap<String, ActiveWorkspace>>,
}

#[derive(Clone)]
struct ActiveWorkspace {
    root: PathBuf,
    git_enabled: bool,
    catalog: HashMap<String, HashMap<String, ProjectFile>>,
}

#[derive(Default)]
pub(crate) struct PendingRepositoryWindows {
    paths: Mutex<HashMap<String, PathBuf>>,
    sequence: AtomicU64,
}

#[derive(Default)]
pub(crate) struct WorkspaceWriteRegistry {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

#[derive(Default)]
pub(crate) struct GitMutationRegistry {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl ActiveWorkspaces {
    pub(crate) fn activate(
        &self,
        window_label: &str,
        root: &Path,
        git_enabled: bool,
    ) -> Result<(), WorkspaceError> {
        let canonical = std::fs::canonicalize(root).map_err(|error| WorkspaceError::Io {
            operation: "activate workspace".to_string(),
            message: error.to_string(),
        })?;
        self.roots
            .lock()
            .map_err(|_| WorkspaceError::Io {
                operation: "activate workspace".to_string(),
                message: "active workspace lock was poisoned".to_string(),
            })?
            .insert(
                window_label.to_string(),
                ActiveWorkspace {
                    root: canonical,
                    git_enabled,
                    catalog: HashMap::new(),
                },
            );
        Ok(())
    }

    pub(crate) fn resolve(
        &self,
        window_label: &str,
        requested: &str,
    ) -> Result<PathBuf, WorkspaceError> {
        let requested =
            std::fs::canonicalize(requested).map_err(|error| WorkspaceError::NotAuthorized {
                message: format!("the requested workspace is unavailable: {error}"),
            })?;
        let active = self
            .roots
            .lock()
            .map_err(|_| WorkspaceError::Io {
                operation: "authorize active workspace".to_string(),
                message: "active workspace lock was poisoned".to_string(),
            })?
            .get(window_label)
            .cloned()
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "open a project folder before reading or saving files".to_string(),
            })?;
        if requested != active.root {
            return Err(WorkspaceError::NotAuthorized {
                message: "the file does not belong to the active project".to_string(),
            });
        }
        Ok(active.root)
    }

    pub(crate) fn require_git(
        &self,
        window_label: &str,
        requested: &str,
    ) -> Result<PathBuf, GitError> {
        let requested =
            std::fs::canonicalize(requested).map_err(|error| GitError::InvalidInput {
                field: "repository root".to_string(),
                message: format!("the requested project is unavailable: {error}"),
            })?;
        let active = self
            .roots
            .lock()
            .map_err(|_| GitError::Io {
                operation: "authorize Git workspace".to_string(),
                message: "active workspace lock was poisoned".to_string(),
            })?
            .get(window_label)
            .cloned()
            .ok_or_else(|| GitError::InvalidInput {
                field: "repository root".to_string(),
                message: "open a Git project before using Git features".to_string(),
            })?;
        if requested != active.root || !active.git_enabled {
            return Err(GitError::InvalidInput {
                field: "repository root".to_string(),
                message: "Git features are unavailable for this ordinary folder".to_string(),
            });
        }
        Ok(active.root)
    }

    pub(crate) fn install_catalog(
        &self,
        window_label: &str,
        root: &Path,
        catalog: &ProjectFileList,
    ) -> Result<(), WorkspaceError> {
        let mut roots = self.roots.lock().map_err(|_| WorkspaceError::Io {
            operation: "install project catalog".to_string(),
            message: "active workspace lock was poisoned".to_string(),
        })?;
        let active = roots
            .get_mut(window_label)
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "open a project folder before installing its file catalog".to_string(),
            })?;
        if active.root != root || catalog.root != root.to_string_lossy() {
            return Err(WorkspaceError::NotAuthorized {
                message: "the project catalog belongs to a stale workspace session".to_string(),
            });
        }
        let mut files = HashMap::<String, HashMap<String, ProjectFile>>::new();
        for file in &catalog.files {
            files
                .entry(file.repository_id.clone())
                .or_default()
                .insert(file.path.clone(), file.clone());
        }
        active.catalog = files;
        Ok(())
    }

    pub(crate) fn authorize_catalogued_file(
        &self,
        window_label: &str,
        root: &Path,
        repository_id: &str,
        path: &str,
    ) -> Result<ProjectFile, WorkspaceError> {
        let roots = self.roots.lock().map_err(|_| WorkspaceError::Io {
            operation: "authorize project file".to_string(),
            message: "active workspace lock was poisoned".to_string(),
        })?;
        let active = roots
            .get(window_label)
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "open a project folder before reading or saving files".to_string(),
            })?;
        if active.root != root {
            return Err(WorkspaceError::NotAuthorized {
                message: "the file belongs to a stale workspace session".to_string(),
            });
        }
        active
            .catalog
            .get(repository_id)
            .and_then(|files| files.get(path))
            .cloned()
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "select a file from the current project catalog".to_string(),
            })
    }

    pub(crate) fn remove(&self, window_label: &str) {
        if let Ok(mut roots) = self.roots.lock() {
            roots.remove(window_label);
        }
    }
}

impl PendingRepositoryWindows {
    pub(crate) fn reserve(&self, path: PathBuf) -> Result<String, GitError> {
        let label = format!(
            "project-{}",
            self.sequence.fetch_add(1, Ordering::Relaxed) + 1
        );
        self.paths
            .lock()
            .map_err(|_| GitError::Io {
                operation: "open repository window".to_string(),
                message: "pending repository window lock was poisoned".to_string(),
            })?
            .insert(label.clone(), path);
        Ok(label)
    }

    pub(crate) fn take(&self, window_label: &str) -> Result<Option<String>, GitError> {
        Ok(self
            .paths
            .lock()
            .map_err(|_| GitError::Io {
                operation: "initialize repository window".to_string(),
                message: "pending repository window lock was poisoned".to_string(),
            })?
            .remove(window_label)
            .map(|path| path.to_string_lossy().into_owned()))
    }

    pub(crate) fn remove(&self, window_label: &str) {
        if let Ok(mut paths) = self.paths.lock() {
            paths.remove(window_label);
        }
    }
}

impl WorkspaceWriteRegistry {
    pub(crate) fn lock_for(&self, identity: String) -> Result<Arc<Mutex<()>>, WorkspaceError> {
        let mut locks = self.locks.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize file saves".to_string(),
            message: "file-save registry lock was poisoned".to_string(),
        })?;
        Ok(locks
            .entry(identity)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }
}

impl GitMutationRegistry {
    pub(crate) fn lock_for(&self, identity: String) -> Result<Arc<Mutex<()>>, GitError> {
        let mut locks = self.locks.lock().map_err(|_| GitError::Io {
            operation: "serialize Git mutations".to_string(),
            message: "Git-mutation registry lock was poisoned".to_string(),
        })?;
        Ok(locks
            .entry(identity)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }
}
