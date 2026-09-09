use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use asterlyn_git::{
    CancellationToken, CommitDetails, CommitDiffResult, DiffResult, GitError, GitRepository,
    HistoryPage, HistoryQuery, ProjectFileList, RepositorySnapshot, UntrackedScan,
};
use asterlyn_workspace::{
    SaveTextFileRequest, SaveTextFileResult, TextFileSnapshot, Workspace, WorkspaceError,
};
use tauri::State;

const COMMIT_LIMIT: usize = 150;
const PROJECT_FILE_LIMIT: usize = 5_000;
const CANCELLED_SCAN_RETENTION: usize = 256;
const CANCELLED_REMOTE_RETENTION: usize = 128;

#[derive(Default)]
struct ScanRegistry {
    inner: Mutex<ScanRegistryState>,
}

#[derive(Default)]
struct ScanRegistryState {
    active: HashMap<String, CancellationToken>,
    cancelled: HashSet<String>,
}

#[derive(Default)]
struct RemoteOperationRegistry {
    inner: Mutex<RemoteOperationRegistryState>,
}

#[derive(Default)]
struct RemoteOperationRegistryState {
    active: HashMap<String, ActiveRemoteOperation>,
    cancelled: HashSet<(String, String)>,
}

struct ActiveRemoteOperation {
    id: String,
    cancellation: CancellationToken,
}

#[derive(Default)]
struct ActiveWorkspace {
    root: Mutex<Option<PathBuf>>,
}

#[derive(Default)]
struct FileSaveRegistry {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl ActiveWorkspace {
    fn activate(&self, root: &str) -> Result<(), GitError> {
        let canonical = std::fs::canonicalize(root).map_err(|error| GitError::Io {
            operation: "activate workspace".to_string(),
            message: error.to_string(),
        })?;
        *self.root.lock().map_err(|_| GitError::Io {
            operation: "activate workspace".to_string(),
            message: "active workspace lock was poisoned".to_string(),
        })? = Some(canonical);
        Ok(())
    }

    fn resolve(&self, requested: &str) -> Result<PathBuf, WorkspaceError> {
        let requested =
            std::fs::canonicalize(requested).map_err(|error| WorkspaceError::NotAuthorized {
                message: format!("the requested workspace is unavailable: {error}"),
            })?;
        let active = self
            .root
            .lock()
            .map_err(|_| WorkspaceError::Io {
                operation: "authorize active workspace".to_string(),
                message: "active workspace lock was poisoned".to_string(),
            })?
            .clone()
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "open a repository before reading or saving files".to_string(),
            })?;
        if requested != active {
            return Err(WorkspaceError::NotAuthorized {
                message: "the file does not belong to the active repository".to_string(),
            });
        }
        Ok(active)
    }
}

impl FileSaveRegistry {
    fn lock_for(&self, identity: String) -> Result<Arc<Mutex<()>>, WorkspaceError> {
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

impl RemoteOperationRegistryState {
    fn register(
        &mut self,
        repository_root: &str,
        operation_id: &str,
        operation: &str,
    ) -> Result<CancellationToken, GitError> {
        if self.active.contains_key(repository_root) {
            return Err(GitError::UnsafeOperation {
                operation: operation.to_string(),
                message: "another remote operation is already running for this repository"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        let cancellation = CancellationToken::new();
        if self
            .cancelled
            .remove(&(repository_root.to_string(), operation_id.to_string()))
        {
            cancellation.cancel();
        }
        self.active.insert(
            repository_root.to_string(),
            ActiveRemoteOperation {
                id: operation_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(cancellation)
    }

    fn cancel(&mut self, repository_root: String, operation_id: String) {
        if let Some(active) = self.active.get(&repository_root)
            && active.id == operation_id
        {
            active.cancellation.cancel();
            return;
        }
        if self.cancelled.len() >= CANCELLED_REMOTE_RETENTION {
            self.cancelled.clear();
        }
        self.cancelled.insert((repository_root, operation_id));
    }

    fn finish(
        &mut self,
        repository_root: &str,
        operation_id: &str,
        cancellation: &CancellationToken,
    ) {
        if self.active.get(repository_root).is_some_and(|active| {
            active.id == operation_id && active.cancellation.refers_to(cancellation)
        }) {
            self.active.remove(repository_root);
        }
    }
}

#[tauri::command]
fn initial_repository() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .find(|argument| !argument.to_string_lossy().starts_with('-'))
        .map(|argument| argument.to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_repository(
    path: String,
    active_workspace: State<'_, ActiveWorkspace>,
) -> Result<RepositorySnapshot, GitError> {
    let snapshot = run_blocking("open repository", move || {
        GitRepository::open(path)?.tracked_snapshot(COMMIT_LIMIT)
    })
    .await?;
    active_workspace.activate(&snapshot.root)?;
    Ok(snapshot)
}

#[tauri::command]
async fn read_history_page(
    repository_root: String,
    query: HistoryQuery,
    offset: usize,
    limit: usize,
) -> Result<HistoryPage, GitError> {
    run_blocking("read history page", move || {
        GitRepository::open(repository_root)?.query_commit_history_page(&query, offset, limit)
    })
    .await
}

#[tauri::command]
async fn scan_untracked(
    repository_root: String,
    scan_id: String,
    scans: State<'_, ScanRegistry>,
) -> Result<UntrackedScan, GitError> {
    let cancellation = CancellationToken::new();
    {
        let mut registry = lock_scan_registry(scans.inner())?;
        if registry.cancelled.remove(&scan_id) {
            cancellation.cancel();
        }
        if let Some(previous) = registry
            .active
            .insert(scan_id.clone(), cancellation.clone())
        {
            previous.cancel();
        }
    }

    let task_cancellation = cancellation.clone();
    let result = run_blocking("scan untracked files", move || {
        GitRepository::open(repository_root)?.untracked_changes(&task_cancellation)
    })
    .await;

    let mut registry = lock_scan_registry(scans.inner())?;
    if registry
        .active
        .get(&scan_id)
        .is_some_and(|active| active.refers_to(&cancellation))
    {
        registry.active.remove(&scan_id);
    }
    result
}

#[tauri::command]
fn cancel_untracked_scan(scan_id: String, scans: State<'_, ScanRegistry>) -> Result<(), GitError> {
    let mut registry = lock_scan_registry(scans.inner())?;
    if let Some(cancellation) = registry.active.remove(&scan_id) {
        cancellation.cancel();
    } else {
        if registry.cancelled.len() >= CANCELLED_SCAN_RETENTION {
            registry.cancelled.clear();
        }
        registry.cancelled.insert(scan_id);
    }
    Ok(())
}

#[tauri::command]
async fn read_diff(
    repository_root: String,
    path: String,
    staged: bool,
) -> Result<DiffResult, GitError> {
    run_blocking("read diff", move || {
        GitRepository::open(repository_root)?.diff(&path, staged)
    })
    .await
}

#[tauri::command]
async fn list_project_files(repository_root: String) -> Result<ProjectFileList, GitError> {
    run_blocking("list project files", move || {
        GitRepository::open(repository_root)?.project_files(PROJECT_FILE_LIMIT)
    })
    .await
}

#[tauri::command]
async fn read_text_file(
    repository_root: String,
    repository_id: String,
    path: String,
    active_workspace: State<'_, ActiveWorkspace>,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let root = active_workspace.resolve(&repository_root)?;
    run_workspace_blocking("read text file", move || {
        read_authorized_text_file(&root, &repository_id, &path)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn save_text_file(
    repository_root: String,
    repository_id: String,
    path: String,
    expected_revision: String,
    content: String,
    utf8_bom: bool,
    request_id: String,
    active_workspace: State<'_, ActiveWorkspace>,
    save_registry: State<'_, FileSaveRegistry>,
) -> Result<SaveTextFileResult, WorkspaceError> {
    let root = active_workspace.resolve(&repository_root)?;
    let identity = format!("{}\0{}\0{}", root.display(), repository_id, path);
    let save_lock = save_registry.lock_for(identity)?;
    run_workspace_blocking("save text file", move || {
        let _guard = save_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize file save".to_string(),
            message: "file-save lock was poisoned".to_string(),
        })?;
        save_authorized_text_file(
            &root,
            &repository_id,
            &path,
            expected_revision,
            content,
            utf8_bom,
            request_id,
        )
    })
    .await
}

fn read_authorized_text_file(
    root: &Path,
    repository_id: &str,
    path: &str,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let authorized = authorize_project_file(root, repository_id, path)?;
    Workspace::open(root)?.read_text_file(&authorized.workspace_path)
}

#[allow(clippy::too_many_arguments)]
fn save_authorized_text_file(
    root: &Path,
    repository_id: &str,
    path: &str,
    expected_revision: String,
    content: String,
    utf8_bom: bool,
    request_id: String,
) -> Result<SaveTextFileResult, WorkspaceError> {
    let authorized = authorize_project_file(root, repository_id, path)?;
    Workspace::open(root)?.save_text_file(&SaveTextFileRequest {
        workspace_path: authorized.workspace_path,
        expected_revision,
        content,
        utf8_bom,
        request_id,
    })
}

fn authorize_project_file(
    root: &Path,
    repository_id: &str,
    path: &str,
) -> Result<asterlyn_git::ProjectFile, WorkspaceError> {
    GitRepository::open(root)
        .and_then(|repository| {
            repository.authorize_project_file(repository_id, path, PROJECT_FILE_LIMIT)
        })
        .map_err(|_| WorkspaceError::NotAuthorized {
            message: "select a current tracked or non-ignored project file".to_string(),
        })
}

#[tauri::command]
async fn read_commit_details(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
) -> Result<CommitDetails, GitError> {
    run_blocking("read commit details", move || {
        GitRepository::open(repository_root)?.repository_commit_details(&repository_id, &commit_oid)
    })
    .await
}

#[tauri::command]
async fn read_commit_diff(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    path: String,
    original_path: Option<String>,
) -> Result<CommitDiffResult, GitError> {
    run_blocking("read commit diff", move || {
        GitRepository::open(repository_root)?.repository_commit_diff(
            &repository_id,
            &commit_oid,
            &path,
            original_path.as_deref(),
        )
    })
    .await
}

#[tauri::command]
async fn stage_paths(
    repository_root: String,
    paths: Vec<String>,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("stage paths", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.stage(&paths)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn unstage_paths(
    repository_root: String,
    paths: Vec<String>,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("unstage paths", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.unstage(&paths)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn commit_changes(
    repository_root: String,
    message: String,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("create commit", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.commit(&message)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn switch_branch(
    repository_root: String,
    target_full_name: String,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("switch branch", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.switch_branch(&target_full_name)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn create_branch(
    repository_root: String,
    name: String,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("create branch", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.create_branch(&name)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn fetch_remote(
    repository_root: String,
    remote: String,
    operation_id: String,
    operations: State<'_, RemoteOperationRegistry>,
) -> Result<RepositorySnapshot, GitError> {
    run_remote_action(
        repository_root,
        operation_id,
        operations.inner(),
        "fetch",
        move |repository, cancellation| repository.fetch_remote(&remote, cancellation),
    )
    .await
}

#[tauri::command]
async fn pull_current(
    repository_root: String,
    operation_id: String,
    operations: State<'_, RemoteOperationRegistry>,
) -> Result<RepositorySnapshot, GitError> {
    run_remote_action(
        repository_root,
        operation_id,
        operations.inner(),
        "pull",
        move |repository, cancellation| repository.pull_ff_only(cancellation),
    )
    .await
}

#[tauri::command]
async fn push_current(
    repository_root: String,
    remote: String,
    operation_id: String,
    operations: State<'_, RemoteOperationRegistry>,
) -> Result<RepositorySnapshot, GitError> {
    run_remote_action(
        repository_root,
        operation_id,
        operations.inner(),
        "push",
        move |repository, cancellation| repository.push_current(&remote, cancellation),
    )
    .await
}

#[tauri::command]
fn cancel_remote_operation(
    repository_root: String,
    operation_id: String,
    operations: State<'_, RemoteOperationRegistry>,
) -> Result<(), GitError> {
    let mut registry = lock_remote_registry(operations.inner())?;
    registry.cancel(repository_root, operation_id);
    Ok(())
}

async fn run_remote_action<F>(
    repository_root: String,
    operation_id: String,
    operations: &RemoteOperationRegistry,
    operation: &str,
    action: F,
) -> Result<RepositorySnapshot, GitError>
where
    F: FnOnce(&GitRepository, &CancellationToken) -> Result<(), GitError> + Send + 'static,
{
    let repository = run_blocking("open repository for remote operation", move || {
        GitRepository::open(repository_root)
    })
    .await?;
    let resolved_root = repository.root().to_string_lossy().into_owned();
    let cancellation = {
        let mut registry = lock_remote_registry(operations)?;
        registry.register(&resolved_root, &operation_id, operation)?
    };

    let task_cancellation = cancellation.clone();
    let result = run_blocking(operation, move || {
        action(&repository, &task_cancellation)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await;

    let mut registry = lock_remote_registry(operations)?;
    registry.finish(&resolved_root, &operation_id, &cancellation);
    result
}

fn lock_scan_registry(scans: &ScanRegistry) -> Result<MutexGuard<'_, ScanRegistryState>, GitError> {
    scans.inner.lock().map_err(|_| GitError::Io {
        operation: "manage untracked scan".to_string(),
        message: "scan registry lock was poisoned".to_string(),
    })
}

fn lock_remote_registry(
    operations: &RemoteOperationRegistry,
) -> Result<MutexGuard<'_, RemoteOperationRegistryState>, GitError> {
    operations.inner.lock().map_err(|_| GitError::Io {
        operation: "manage remote operations".to_string(),
        message: "remote operation registry lock was poisoned".to_string(),
    })
}

async fn run_blocking<T, F>(operation: &str, task: F) -> Result<T, GitError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, GitError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: format!("background task could not complete: {error}"),
        })?
}

async fn run_workspace_blocking<T, F>(operation: &str, task: F) -> Result<T, WorkspaceError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, WorkspaceError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| WorkspaceError::Io {
            operation: operation.to_string(),
            message: format!("background task could not complete: {error}"),
        })?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ScanRegistry::default())
        .manage(RemoteOperationRegistry::default())
        .manage(ActiveWorkspace::default())
        .manage(FileSaveRegistry::default())
        .invoke_handler(tauri::generate_handler![
            initial_repository,
            open_repository,
            read_history_page,
            scan_untracked,
            cancel_untracked_scan,
            list_project_files,
            read_text_file,
            save_text_file,
            read_diff,
            read_commit_details,
            read_commit_diff,
            stage_paths,
            unstage_paths,
            commit_changes,
            switch_branch,
            create_branch,
            fetch_remote,
            pull_current,
            push_current,
            cancel_remote_operation
        ])
        .run(tauri::generate_context!())
        .expect("Asterlyn desktop runtime failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(path: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(arguments)
            .output()
            .expect("Git starts");
        assert!(
            output.status.success(),
            "Git {:?} failed: {}",
            arguments,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn desktop_file_boundary_saves_authorized_text_and_preserves_external_changes() {
        let directory = tempfile::tempdir().expect("temporary repository");
        git(directory.path(), &["init", "-b", "main"]);
        fs::write(directory.path().join("source.txt"), "original\r\n").expect("source file");
        fs::write(directory.path().join("ignored.txt"), "ignored\n").expect("ignored file");
        fs::write(directory.path().join(".gitignore"), "ignored.txt\n").expect("ignore file");
        git(directory.path(), &["add", ".gitignore", "source.txt"]);

        let initial = read_authorized_text_file(directory.path(), ".", "source.txt")
            .expect("authorized file reads");
        let saved = save_authorized_text_file(
            directory.path(),
            ".",
            "source.txt",
            initial.revision,
            "saved\r\n".to_string(),
            false,
            "native-save-1".to_string(),
        )
        .expect("authorized file saves");
        assert_eq!(
            fs::read(directory.path().join("source.txt")).expect("saved bytes"),
            b"saved\r\n"
        );

        fs::write(directory.path().join("source.txt"), "external\n").expect("external edit");
        let conflict = save_authorized_text_file(
            directory.path(),
            ".",
            "source.txt",
            saved.revision.clone(),
            "local\n".to_string(),
            false,
            "native-save-2".to_string(),
        )
        .expect_err("external edit conflicts");
        assert!(matches!(conflict, WorkspaceError::Conflict { .. }));
        assert_eq!(
            fs::read_to_string(directory.path().join("source.txt")).expect("external text"),
            "external\n"
        );
        assert!(matches!(
            read_authorized_text_file(directory.path(), ".", "ignored.txt"),
            Err(WorkspaceError::NotAuthorized { .. })
        ));

        git(
            directory.path(),
            &["rm", "--cached", "-f", "--", "source.txt"],
        );
        fs::write(
            directory.path().join(".gitignore"),
            "ignored.txt\nsource.txt\n",
        )
        .expect("updated ignore file");
        git(directory.path(), &["add", ".gitignore"]);
        let revoked = save_authorized_text_file(
            directory.path(),
            ".",
            "source.txt",
            saved.revision,
            "must not save\n".to_string(),
            false,
            "native-save-revoked".to_string(),
        )
        .expect_err("fresh catalog revokes ignored file authorization");
        assert!(matches!(revoked, WorkspaceError::NotAuthorized { .. }));
        assert_eq!(
            fs::read_to_string(directory.path().join("source.txt")).expect("revoked file"),
            "external\n"
        );
    }

    #[test]
    fn active_workspace_accepts_only_the_last_canonical_root() {
        let active = ActiveWorkspace::default();
        let first = tempfile::tempdir().expect("first workspace");
        let second = tempfile::tempdir().expect("second workspace");
        let first_path = first.path().to_string_lossy();
        let second_path = second.path().to_string_lossy();

        assert!(matches!(
            active.resolve(&first_path),
            Err(WorkspaceError::NotAuthorized { .. })
        ));
        active
            .activate(&first_path)
            .expect("first workspace activates");
        assert_eq!(
            active.resolve(&first_path).expect("active root resolves"),
            std::fs::canonicalize(first.path()).expect("canonical first root")
        );
        assert!(matches!(
            active.resolve(&second_path),
            Err(WorkspaceError::NotAuthorized { .. })
        ));
    }

    #[test]
    fn file_save_registry_reuses_only_matching_identity_locks() {
        let registry = FileSaveRegistry::default();
        let first = registry
            .lock_for("root\0.\0file".to_string())
            .expect("lock");
        let same = registry
            .lock_for("root\0.\0file".to_string())
            .expect("same lock");
        let other = registry
            .lock_for("root\0.\0other".to_string())
            .expect("other lock");

        assert!(Arc::ptr_eq(&first, &same));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[test]
    fn remote_registry_serializes_by_repository_and_cancels_exact_ids() {
        let mut registry = RemoteOperationRegistryState::default();
        let first = registry
            .register("/repo", "one", "fetch")
            .expect("first operation registers");
        let duplicate = registry
            .register("/repo", "two", "push")
            .expect_err("same repository is serialized");
        assert!(matches!(duplicate, GitError::UnsafeOperation { .. }));

        let other = registry
            .register("/other", "one", "fetch")
            .expect("different repository can run independently");
        registry.cancel("/repo".to_string(), "wrong".to_string());
        assert!(!first.is_cancelled());
        assert!(!other.is_cancelled());

        registry.cancel("/repo".to_string(), "one".to_string());
        assert!(first.is_cancelled());
        registry.finish("/repo", "one", &first);
        assert!(!registry.active.contains_key("/repo"));

        registry.cancel("/future".to_string(), "queued".to_string());
        let queued = registry
            .register("/future", "queued", "pull")
            .expect("pre-cancelled operation registers as cancelled");
        assert!(queued.is_cancelled());
    }
}
