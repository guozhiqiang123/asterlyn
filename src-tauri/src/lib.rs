use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use asterlyn_git::{
    CancellationToken, CommitDetails, CommitDiffResult, DiffResult, GitError, GitRepository,
    RepositorySnapshot, UntrackedScan,
};
use tauri::State;

const COMMIT_LIMIT: usize = 150;
const CANCELLED_SCAN_RETENTION: usize = 256;

#[derive(Default)]
struct ScanRegistry {
    inner: Mutex<ScanRegistryState>,
}

#[derive(Default)]
struct ScanRegistryState {
    active: HashMap<String, CancellationToken>,
    cancelled: HashSet<String>,
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

fn lock_scan_registry(scans: &ScanRegistry) -> Result<MutexGuard<'_, ScanRegistryState>, GitError> {
    scans.inner.lock().map_err(|_| GitError::Io {
        operation: "manage untracked scan".to_string(),
        message: "scan registry lock was poisoned".to_string(),
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
            commit_changes
        ])
        .run(tauri::generate_context!())
        .expect("Asterlyn desktop runtime failed");
}
