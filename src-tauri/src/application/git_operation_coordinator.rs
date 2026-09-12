use asterlyn_git::{CancellationToken, GitError, GitRepository, RepositorySnapshot};

use super::{GitMutationRegistry, RemoteOperationRegistry};

#[derive(Default)]
pub(crate) struct GitOperationCoordinator {
    mutations: GitMutationRegistry,
    remotes: RemoteOperationRegistry,
}

impl GitOperationCoordinator {
    pub(crate) async fn run_local<T, F>(
        &self,
        repository_root: String,
        operation: &str,
        action: F,
    ) -> Result<T, GitError>
    where
        T: Send + 'static,
        F: FnOnce(&GitRepository) -> Result<T, GitError> + Send + 'static,
    {
        let repository = run_blocking("open repository for Git mutation", move || {
            GitRepository::open(repository_root)
        })
        .await?;
        let identity = repository.root().to_string_lossy().into_owned();
        let mutation_lock = self.mutations.lock_for(identity)?;
        run_blocking(operation, move || {
            let _guard = mutation_lock.lock().map_err(|_| GitError::Io {
                operation: "serialize Git mutations".to_string(),
                message: "Git-mutation lock was poisoned".to_string(),
            })?;
            action(&repository)
        })
        .await
    }

    pub(crate) async fn run_remote<F>(
        &self,
        repository_root: String,
        operation_id: String,
        operation: &str,
        snapshot_limit: usize,
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
        let mutation_lock = self.mutations.lock_for(resolved_root.clone())?;
        let cancellation = self
            .remotes
            .register(&resolved_root, &operation_id, operation)?;

        let task_cancellation = cancellation.clone();
        let result = run_blocking(operation, move || {
            let _guard = mutation_lock.lock().map_err(|_| GitError::Io {
                operation: "serialize Git mutations".to_string(),
                message: "Git-mutation lock was poisoned".to_string(),
            })?;
            action(&repository, &task_cancellation)?;
            repository.tracked_snapshot(snapshot_limit)
        })
        .await;

        self.remotes
            .finish(&resolved_root, &operation_id, &cancellation)?;
        result
    }

    pub(crate) fn cancel_remote(
        &self,
        repository_root: String,
        operation_id: String,
    ) -> Result<(), GitError> {
        self.remotes.cancel(repository_root, operation_id)
    }
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
