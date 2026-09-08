use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use asterlyn_git::{
    CancellationToken, CommitDetails, CommitDiffResult, DiffResult, GitError, GitRepository,
    RepositorySnapshot, UntrackedScan,
};
use tauri::State;

const COMMIT_LIMIT: usize = 150;
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
async fn open_repository(path: String) -> Result<RepositorySnapshot, GitError> {
    run_blocking("open repository", move || {
        GitRepository::open(path)?.tracked_snapshot(COMMIT_LIMIT)
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
async fn read_commit_details(
    repository_root: String,
    commit_oid: String,
) -> Result<CommitDetails, GitError> {
    run_blocking("read commit details", move || {
        GitRepository::open(repository_root)?.commit_details(&commit_oid)
    })
    .await
}

#[tauri::command]
async fn read_commit_diff(
    repository_root: String,
    commit_oid: String,
    path: String,
    original_path: Option<String>,
) -> Result<CommitDiffResult, GitError> {
    run_blocking("read commit diff", move || {
        GitRepository::open(repository_root)?.commit_diff(
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ScanRegistry::default())
        .manage(RemoteOperationRegistry::default())
        .invoke_handler(tauri::generate_handler![
            initial_repository,
            open_repository,
            scan_untracked,
            cancel_untracked_scan,
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
