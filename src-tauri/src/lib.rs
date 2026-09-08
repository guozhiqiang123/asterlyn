use asterlyn_git::{DiffResult, GitError, GitRepository, RepositorySnapshot};

const COMMIT_LIMIT: usize = 150;

#[tauri::command]
async fn open_repository(path: String) -> Result<RepositorySnapshot, GitError> {
    run_blocking("open repository", move || {
        GitRepository::open(path)?.snapshot(COMMIT_LIMIT)
    })
    .await
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
async fn stage_paths(
    repository_root: String,
    paths: Vec<String>,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("stage paths", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.stage(&paths)?;
        repository.snapshot(COMMIT_LIMIT)
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
        repository.snapshot(COMMIT_LIMIT)
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
        repository.snapshot(COMMIT_LIMIT)
    })
    .await
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
        .invoke_handler(tauri::generate_handler![
            open_repository,
            read_diff,
            stage_paths,
            unstage_paths,
            commit_changes
        ])
        .run(tauri::generate_context!())
        .expect("Asterlyn desktop runtime failed");
}
