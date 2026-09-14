use asterlyn_git::{CancellationToken, GitError, GitRepository, RepositorySnapshot};

use super::{GitMutationRegistry, RemoteOperationRegistry, WorkspaceWriteRegistry};

pub(crate) struct GitOperationCoordinator {
    writes: WorkspaceWriteRegistry,
    mutations: GitMutationRegistry,
    remotes: RemoteOperationRegistry,
}

impl GitOperationCoordinator {
    pub(crate) fn new(writes: WorkspaceWriteRegistry) -> Self {
        Self {
            writes,
            mutations: GitMutationRegistry::default(),
            remotes: RemoteOperationRegistry::default(),
        }
    }

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
        let write_lock = self
            .writes
            .lock_for(identity.clone())
            .map_err(workspace_lock_error)?;
        let mutation_lock = self.mutations.lock_for(identity)?;
        run_blocking(operation, move || {
            let _write = write_lock.lock().map_err(|_| poisoned_workspace_lock())?;
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
        let write_lock = self
            .writes
            .lock_for(resolved_root.clone())
            .map_err(workspace_lock_error)?;
        let mutation_lock = self.mutations.lock_for(resolved_root.clone())?;
        let cancellation = self
            .remotes
            .register(&resolved_root, &operation_id, operation)?;

        let task_cancellation = cancellation.clone();
        let result = run_blocking(operation, move || {
            let _write = write_lock.lock().map_err(|_| poisoned_workspace_lock())?;
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

fn workspace_lock_error(error: asterlyn_workspace::WorkspaceError) -> GitError {
    GitError::Io {
        operation: "serialize workspace writes".to_string(),
        message: error.to_string(),
    }
}

fn poisoned_workspace_lock() -> GitError {
    GitError::Io {
        operation: "serialize workspace writes".to_string(),
        message: "workspace-write lock was poisoned".to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, mpsc};
    use std::time::Duration;

    #[test]
    fn a_git_mutation_waits_for_the_same_lock_as_an_ordinary_file_save() {
        let directory = tempfile::tempdir().unwrap();
        assert!(
            std::process::Command::new("git")
                .arg("-C")
                .arg(directory.path())
                .args(["init", "-b", "main"])
                .output()
                .unwrap()
                .status
                .success()
        );
        let root = std::fs::canonicalize(directory.path())
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let writes = WorkspaceWriteRegistry::default();
        let lock = writes.lock_for(root.clone()).unwrap();
        let coordinator = GitOperationCoordinator::new(writes.clone());
        assert!(Arc::ptr_eq(
            &lock,
            &coordinator.writes.lock_for(root.clone()).unwrap()
        ));
        let guard = lock.lock().unwrap();
        let (sent, received) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            tauri::async_runtime::block_on(coordinator.run_local(
                root,
                "test shared write",
                move |_| {
                    sent.send(()).unwrap();
                    Ok(())
                },
            ))
        });
        assert!(received.recv_timeout(Duration::from_millis(100)).is_err());
        drop(guard);
        received.recv_timeout(Duration::from_secs(5)).unwrap();
        worker.join().unwrap().unwrap();
    }
}
