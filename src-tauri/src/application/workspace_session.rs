use std::collections::{BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use asterlyn_git::{GitError, ProjectFile, ProjectFileList};
use asterlyn_workspace::WorkspaceError;

const MAX_OPEN_DOCUMENT_WATCH_PATHS: usize = 128;

#[derive(Default)]
pub(crate) struct ActiveWorkspaces {
    roots: Mutex<HashMap<String, ActiveWorkspace>>,
    activations: Mutex<HashMap<String, u64>>,
    sequence: AtomicU64,
}

struct ActiveWorkspace {
    root: PathBuf,
    git_enabled: bool,
    git_dir: Option<PathBuf>,
    repository_observation: u64,
    watch_directories: Vec<PathBuf>,
    catalog: HashMap<String, HashMap<String, ProjectFile>>,
}

pub(crate) struct WorkspaceWatchRoots {
    pub(crate) root: PathBuf,
    pub(crate) git_dir: Option<PathBuf>,
    pub(crate) directories: Vec<PathBuf>,
}

#[derive(Default)]
pub(crate) struct PendingRepositoryWindows {
    paths: Mutex<HashMap<String, PendingRepositoryWindow>>,
    sequence: AtomicU64,
}

struct PendingRepositoryWindow {
    path: PathBuf,
    consumed: bool,
}

pub(crate) enum PendingRepositoryWindowReservation {
    Existing(String),
    Reserved(String),
}

#[derive(Default, Clone)]
pub(crate) struct WorkspaceWriteRegistry {
    locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

#[derive(Default)]
pub(crate) struct GitMutationRegistry {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl ActiveWorkspaces {
    pub(crate) fn begin_activation(&self, window_label: &str) -> Result<u64, WorkspaceError> {
        let mut activations = self
            .activations
            .lock()
            .map_err(|_| activation_lock_error())?;
        let token = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        activations.insert(window_label.to_string(), token);
        Ok(token)
    }

    pub(crate) fn activation_token(&self, window_label: &str) -> Result<u64, WorkspaceError> {
        self.activations
            .lock()
            .map_err(|_| activation_lock_error())?
            .get(window_label)
            .copied()
            .ok_or_else(stale_activation)
    }

    pub(crate) fn activate_current(
        &self,
        window_label: &str,
        token: u64,
        root: &Path,
        git_dir: Option<&Path>,
    ) -> Result<(), WorkspaceError> {
        let activations = self
            .activations
            .lock()
            .map_err(|_| activation_lock_error())?;
        if activations.get(window_label) != Some(&token) {
            return Err(stale_activation());
        }
        self.install_workspace(window_label, root, git_dir)
    }

    #[cfg(test)]
    pub(crate) fn activate(
        &self,
        window_label: &str,
        root: &Path,
        git_dir: Option<&Path>,
    ) -> Result<(), WorkspaceError> {
        let token = self.begin_activation(window_label)?;
        self.activate_current(window_label, token, root, git_dir)
    }

    fn install_workspace(
        &self,
        window_label: &str,
        root: &Path,
        git_dir: Option<&Path>,
    ) -> Result<(), WorkspaceError> {
        let canonical = std::fs::canonicalize(root).map_err(|error| WorkspaceError::Io {
            operation: "activate workspace".to_string(),
            message: error.to_string(),
        })?;
        let git_dir = git_dir
            .map(std::fs::canonicalize)
            .transpose()
            .map_err(|error| WorkspaceError::Io {
                operation: "activate Git workspace".to_string(),
                message: error.to_string(),
            })?;
        let mut roots = self.roots.lock().map_err(|_| WorkspaceError::Io {
            operation: "activate workspace".to_string(),
            message: "active workspace lock was poisoned".to_string(),
        })?;
        let repository_observation = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(active) = roots
            .get_mut(window_label)
            .filter(|active| active.root == canonical)
        {
            active.git_enabled = git_dir.is_some();
            active.git_dir = git_dir;
            active.repository_observation = repository_observation;
            return Ok(());
        }
        roots.insert(
            window_label.to_string(),
            ActiveWorkspace {
                watch_directories: vec![canonical.clone()],
                root: canonical,
                git_enabled: git_dir.is_some(),
                git_dir,
                repository_observation,
                catalog: HashMap::new(),
            },
        );
        Ok(())
    }

    pub(crate) fn begin_repository_observation(
        &self,
        window_label: &str,
        root: &Path,
    ) -> Result<u64, WorkspaceError> {
        let observation = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let mut roots = self.roots.lock().map_err(|_| WorkspaceError::Io {
            operation: "begin repository observation".to_string(),
            message: "active workspace lock was poisoned".to_string(),
        })?;
        let active = roots
            .get_mut(window_label)
            .filter(|active| active.root == root)
            .ok_or_else(stale_activation)?;
        active.repository_observation = observation;
        Ok(observation)
    }

    pub(crate) fn activate_repository_observation(
        &self,
        window_label: &str,
        activation_token: u64,
        observation: u64,
        root: &Path,
        git_dir: Option<&Path>,
    ) -> Result<(), WorkspaceError> {
        let git_dir = git_dir
            .map(std::fs::canonicalize)
            .transpose()
            .map_err(|error| WorkspaceError::Io {
                operation: "activate repository observation".to_string(),
                message: error.to_string(),
            })?;
        let activations = self
            .activations
            .lock()
            .map_err(|_| activation_lock_error())?;
        if activations.get(window_label) != Some(&activation_token) {
            return Err(stale_activation());
        }
        let mut roots = self.roots.lock().map_err(|_| WorkspaceError::Io {
            operation: "activate repository observation".to_string(),
            message: "active workspace lock was poisoned".to_string(),
        })?;
        let active = roots
            .get_mut(window_label)
            .filter(|active| active.root == root && active.repository_observation == observation)
            .ok_or_else(stale_activation)?;
        active.git_enabled = git_dir.is_some();
        active.git_dir = git_dir;
        Ok(())
    }

    pub(crate) fn watch_roots(
        &self,
        window_label: &str,
        requested: &str,
        open_document_paths: &[String],
    ) -> Result<WorkspaceWatchRoots, WorkspaceError> {
        if open_document_paths.len() > MAX_OPEN_DOCUMENT_WATCH_PATHS {
            return Err(WorkspaceError::InvalidPath {
                message: format!(
                    "workspace watch accepts at most {MAX_OPEN_DOCUMENT_WATCH_PATHS} open documents"
                ),
            });
        }
        let root = self.resolve(window_label, requested)?;
        let roots = self.roots.lock().map_err(|_| WorkspaceError::Io {
            operation: "authorize workspace watch".to_string(),
            message: "active workspace lock was poisoned".to_string(),
        })?;
        let active = roots
            .get(window_label)
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "open a project folder before watching files".to_string(),
            })?;
        let mut directories: BTreeSet<_> = active.watch_directories.iter().cloned().collect();
        for workspace_path in open_document_paths {
            let catalogued = active.catalog.values().any(|files| {
                files
                    .values()
                    .any(|file| file.workspace_path == *workspace_path)
            });
            if !catalogued || !valid_workspace_relative_path(workspace_path) {
                return Err(WorkspaceError::NotAuthorized {
                    message: "an open document is absent from the current project catalog"
                        .to_string(),
                });
            }
            insert_workspace_path_directories(&mut directories, &root, workspace_path);
        }
        Ok(WorkspaceWatchRoots {
            root: if active.root == root {
                root
            } else {
                return Err(stale_activation());
            },
            git_dir: active.git_dir.clone(),
            directories: directories.into_iter().collect(),
        })
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
            .map(|active| active.root.clone())
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "open a project folder before reading or saving files".to_string(),
            })?;
        if requested != active {
            return Err(WorkspaceError::NotAuthorized {
                message: "the file does not belong to the active project".to_string(),
            });
        }
        Ok(active)
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
            .map(|active| (active.root.clone(), active.git_enabled))
            .ok_or_else(|| GitError::InvalidInput {
                field: "repository root".to_string(),
                message: "open a Git project before using Git features".to_string(),
            })?;
        if requested != active.0 || !active.1 {
            return Err(GitError::InvalidInput {
                field: "repository root".to_string(),
                message: "Git features are unavailable for this ordinary folder".to_string(),
            });
        }
        Ok(active.0)
    }

    pub(crate) fn install_catalog(
        &self,
        window_label: &str,
        token: u64,
        root: &Path,
        catalog: &ProjectFileList,
    ) -> Result<(), WorkspaceError> {
        let activations = self
            .activations
            .lock()
            .map_err(|_| activation_lock_error())?;
        if activations.get(window_label) != Some(&token) {
            return Err(stale_activation());
        }
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
        active.watch_directories = catalog_watch_directories(&active.root, catalog);
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

    pub(crate) fn window_for_root(&self, root: &Path) -> Result<Option<String>, WorkspaceError> {
        Ok(self
            .roots
            .lock()
            .map_err(|_| WorkspaceError::Io {
                operation: "locate open workspace".to_string(),
                message: "active workspace lock was poisoned".to_string(),
            })?
            .iter()
            .filter(|(_, active)| active.root == root)
            .map(|(label, _)| label.clone())
            .min())
    }

    pub(crate) fn remove(&self, window_label: &str) {
        let Ok(mut activations) = self.activations.lock() else {
            return;
        };
        activations.remove(window_label);
        if let Ok(mut roots) = self.roots.lock() {
            roots.remove(window_label);
        }
    }
}

fn activation_lock_error() -> WorkspaceError {
    WorkspaceError::Io {
        operation: "workspace activation".to_string(),
        message: "workspace activation lock was poisoned".to_string(),
    }
}

fn stale_activation() -> WorkspaceError {
    WorkspaceError::NotAuthorized {
        message: "the workspace request was superseded or its window was closed".to_string(),
    }
}

fn catalog_watch_directories(root: &Path, catalog: &ProjectFileList) -> Vec<PathBuf> {
    let mut directories = BTreeSet::from([root.to_path_buf()]);
    for file in &catalog.files {
        if file.read_only {
            continue;
        }
        insert_workspace_path_directories(&mut directories, root, &file.workspace_path);
    }
    directories
        .into_iter()
        .filter(|directory| {
            std::fs::symlink_metadata(directory)
                .map(|metadata| metadata.file_type().is_dir())
                .unwrap_or(false)
        })
        .collect()
}

fn insert_workspace_path_directories(
    directories: &mut BTreeSet<PathBuf>,
    root: &Path,
    workspace_path: &str,
) {
    let Some(parent) = Path::new(workspace_path).parent() else {
        return;
    };
    let mut candidate = root.to_path_buf();
    for component in parent.components() {
        let Component::Normal(name) = component else {
            return;
        };
        candidate.push(name);
        if candidate.is_dir() {
            directories.insert(candidate.clone());
        }
    }
}

fn valid_workspace_relative_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4_096
        && !path.contains('\\')
        && !Path::new(path).is_absolute()
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

impl PendingRepositoryWindows {
    pub(crate) fn reserve(
        &self,
        path: PathBuf,
    ) -> Result<PendingRepositoryWindowReservation, GitError> {
        let mut paths = self.paths.lock().map_err(|_| GitError::Io {
            operation: "open project window".to_string(),
            message: "pending project window lock was poisoned".to_string(),
        })?;
        if let Some((label, _)) = paths.iter().find(|(_, pending)| pending.path == path) {
            return Ok(PendingRepositoryWindowReservation::Existing(label.clone()));
        }
        let label = format!(
            "project-{}",
            self.sequence.fetch_add(1, Ordering::Relaxed) + 1
        );
        paths.insert(
            label.clone(),
            PendingRepositoryWindow {
                path,
                consumed: false,
            },
        );
        Ok(PendingRepositoryWindowReservation::Reserved(label))
    }

    pub(crate) fn take(&self, window_label: &str) -> Result<Option<String>, GitError> {
        let mut paths = self.paths.lock().map_err(|_| GitError::Io {
            operation: "initialize project window".to_string(),
            message: "pending project window lock was poisoned".to_string(),
        })?;
        let Some(pending) = paths.get_mut(window_label) else {
            return Ok(None);
        };
        if pending.consumed {
            return Ok(None);
        }
        pending.consumed = true;
        Ok(Some(pending.path.to_string_lossy().into_owned()))
    }

    pub(crate) fn window_for_root(&self, root: &Path) -> Result<Option<String>, GitError> {
        Ok(self
            .paths
            .lock()
            .map_err(|_| GitError::Io {
                operation: "locate pending project window".to_string(),
                message: "pending project window lock was poisoned".to_string(),
            })?
            .iter()
            .filter(|(_, pending)| pending.path == root)
            .map(|(label, _)| label.clone())
            .min())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obsolete_activation_cannot_replace_newer_authorization_or_reopen_a_closed_window() {
        let active = ActiveWorkspaces::default();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let old = active.begin_activation("main").unwrap();
        let current = active.begin_activation("main").unwrap();
        active
            .activate_current("main", current, second.path(), None)
            .unwrap();
        assert!(
            active
                .activate_current("main", old, first.path(), None)
                .is_err()
        );
        assert_eq!(
            active
                .resolve("main", &second.path().to_string_lossy())
                .unwrap(),
            std::fs::canonicalize(second.path()).unwrap()
        );
        active.remove("main");
        assert!(
            active
                .activate_current("main", current, second.path(), None)
                .is_err()
        );
    }

    #[test]
    fn catalog_completion_is_bound_to_the_activation_even_when_the_same_root_returns() {
        let active = ActiveWorkspaces::default();
        let directory = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        let old = active.begin_activation("main").unwrap();
        active.activate_current("main", old, &root, None).unwrap();
        let current = active.begin_activation("main").unwrap();
        active
            .activate_current("main", current, &root, None)
            .unwrap();
        let catalog = crate::load_project_catalog(&root).unwrap();
        assert!(
            active
                .install_catalog("main", old, &root, &catalog)
                .is_err()
        );
        active
            .install_catalog("main", current, &root, &catalog)
            .unwrap();
    }

    #[test]
    fn workspace_root_ownership_follows_window_activation_and_removal() {
        let active = ActiveWorkspaces::default();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let first_root = std::fs::canonicalize(first.path()).unwrap();
        let second_root = std::fs::canonicalize(second.path()).unwrap();

        active.activate("project-1", &first_root, None).unwrap();
        assert_eq!(
            active.window_for_root(&first_root).unwrap(),
            Some("project-1".to_string())
        );

        active.activate("project-1", &second_root, None).unwrap();
        assert_eq!(active.window_for_root(&first_root).unwrap(), None);
        assert_eq!(
            active.window_for_root(&second_root).unwrap(),
            Some("project-1".to_string())
        );

        active.remove("project-1");
        assert_eq!(active.window_for_root(&second_root).unwrap(), None);
    }

    #[test]
    fn ignored_open_document_adds_and_removes_its_parent_from_the_watch_plan() {
        let active = ActiveWorkspaces::default();
        let directory = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        let ignored_parent = root.join("generated/deep");
        std::fs::create_dir_all(&ignored_parent).unwrap();
        std::fs::write(ignored_parent.join("open.txt"), "preview").unwrap();
        let token = active.begin_activation("main").unwrap();
        active.activate_current("main", token, &root, None).unwrap();
        let catalog = ProjectFileList {
            root: root.to_string_lossy().into_owned(),
            paths: vec!["generated/deep/open.txt".to_string()],
            files: vec![ProjectFile {
                repository_id: ".".to_string(),
                path: "generated/deep/open.txt".to_string(),
                workspace_path: "generated/deep/open.txt".to_string(),
                read_only: true,
            }],
            ignored_entries: Vec::new(),
            repository_roots: Vec::new(),
            truncated: false,
        };
        active
            .install_catalog("main", token, &root, &catalog)
            .unwrap();

        let cold = active
            .watch_roots("main", root.to_string_lossy().as_ref(), &[])
            .unwrap();
        assert!(!cold.directories.contains(&ignored_parent));
        let hot = active
            .watch_roots(
                "main",
                root.to_string_lossy().as_ref(),
                &["generated/deep/open.txt".to_string()],
            )
            .unwrap();
        assert!(hot.directories.contains(&root.join("generated")));
        assert!(hot.directories.contains(&ignored_parent));
    }

    #[test]
    fn same_root_capability_transition_updates_git_authorization() {
        let active = ActiveWorkspaces::default();
        let directory = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        let git_dir = root.join(".git");
        std::fs::create_dir(&git_dir).unwrap();
        let token = active.begin_activation("main").unwrap();
        active.activate_current("main", token, &root, None).unwrap();
        assert!(
            active
                .require_git("main", root.to_string_lossy().as_ref())
                .is_err()
        );

        active
            .activate_current("main", token, &root, Some(&git_dir))
            .unwrap();
        assert!(
            active
                .require_git("main", root.to_string_lossy().as_ref())
                .is_ok()
        );
        active.activate_current("main", token, &root, None).unwrap();
        assert!(
            active
                .require_git("main", root.to_string_lossy().as_ref())
                .is_err()
        );
    }

    #[test]
    fn obsolete_repository_observation_cannot_roll_back_git_authorization() {
        let active = ActiveWorkspaces::default();
        let directory = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        let git_dir = root.join(".git");
        std::fs::create_dir(&git_dir).unwrap();
        let activation = active.begin_activation("main").unwrap();
        active
            .activate_current("main", activation, &root, None)
            .unwrap();
        let obsolete = active.begin_repository_observation("main", &root).unwrap();
        let current = active.begin_repository_observation("main", &root).unwrap();

        active
            .activate_repository_observation("main", activation, current, &root, Some(&git_dir))
            .unwrap();
        assert!(
            active
                .activate_repository_observation("main", activation, obsolete, &root, None)
                .is_err()
        );
        assert!(
            active
                .require_git("main", root.to_string_lossy().as_ref())
                .is_ok()
        );
    }
}
