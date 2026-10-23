use asterlyn_git::{CancellationToken, GitError, GitRepository, RepositorySnapshot};
use serde_json::json;
use std::sync::OnceLock;
use std::time::Instant;

use super::diagnostics::with_trace;
use super::{DiagnosticsLog, GitMutationRegistry, RemoteOperationRegistry, WorkspaceWriteRegistry};

pub(crate) struct GitOperationCoordinator {
    writes: WorkspaceWriteRegistry,
    mutations: GitMutationRegistry,
    remotes: RemoteOperationRegistry,
    diagnostics: OnceLock<DiagnosticsLog>,
}

impl GitOperationCoordinator {
    pub(crate) fn new(writes: WorkspaceWriteRegistry) -> Self {
        Self {
            writes,
            mutations: GitMutationRegistry::default(),
            remotes: RemoteOperationRegistry::default(),
            diagnostics: OnceLock::new(),
        }
    }

    pub(crate) fn install_diagnostics(&self, diagnostics: DiagnosticsLog) -> Result<(), String> {
        self.diagnostics
            .set(diagnostics)
            .map_err(|_| "Git operation diagnostics are already installed".to_string())
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
        let started = Instant::now();
        let diagnostic_context = self.diagnostics.get().map(|diagnostics| {
            let trace_id = diagnostics.next_trace_id("git-remote");
            let workspace_hash = diagnostics.hash_identifier(repository_root.as_bytes());
            let operation_id_hash = diagnostics.hash_identifier(operation_id.as_bytes());
            diagnostics.info(
                "git.remote",
                "operation.started",
                Some(&trace_id),
                json!({
                    "operation": operation,
                    "operationIdHash": operation_id_hash,
                    "workspaceHash": workspace_hash,
                }),
            );
            (
                diagnostics.clone(),
                trace_id,
                workspace_hash,
                operation_id_hash,
            )
        });
        let result = async {
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
            let worker_trace = diagnostic_context
                .as_ref()
                .map(|(_, trace, _, _)| trace.clone());
            let result = run_blocking(operation, move || {
                let work = || {
                    let _write = write_lock.lock().map_err(|_| poisoned_workspace_lock())?;
                    let _guard = mutation_lock.lock().map_err(|_| GitError::Io {
                        operation: "serialize Git mutations".to_string(),
                        message: "Git-mutation lock was poisoned".to_string(),
                    })?;
                    action(&repository, &task_cancellation)?;
                    repository.tracked_snapshot(snapshot_limit)
                };
                match worker_trace {
                    Some(trace) => with_trace(&trace, work),
                    None => work(),
                }
            })
            .await;

            self.remotes
                .finish(&resolved_root, &operation_id, &cancellation)?;
            result
        }
        .await;
        if let Some((diagnostics, trace_id, workspace_hash, operation_id_hash)) = diagnostic_context
        {
            match &result {
                Ok(_) => diagnostics.info(
                    "git.remote",
                    "operation.completed",
                    Some(&trace_id),
                    json!({
                        "durationMs": started.elapsed().as_millis(),
                        "operation": operation,
                        "operationIdHash": operation_id_hash,
                        "workspaceHash": workspace_hash,
                    }),
                ),
                Err(error) => diagnostics.error(
                    "git.remote",
                    "operation.failed",
                    Some(&trace_id),
                    json!({
                        "durationMs": started.elapsed().as_millis(),
                        "error": diagnostics.safe_message(error.to_string()),
                        "errorKind": git_error_kind(error),
                        "operation": operation,
                        "operationIdHash": operation_id_hash,
                        "remoteFailureReason": remote_failure_reason(error),
                        "workspaceHash": workspace_hash,
                    }),
                ),
            }
        }
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

fn git_error_kind(error: &GitError) -> &'static str {
    match error {
        GitError::InvalidRepository { .. } => "invalidRepository",
        GitError::CommandFailed { .. } => "commandFailed",
        GitError::Io { .. } => "io",
        GitError::Parse { .. } => "parse",
        GitError::InvalidInput { .. } => "invalidInput",
        GitError::UnsafeOperation { .. } => "unsafeOperation",
        GitError::RemoteFailed { .. } => "remoteFailed",
        GitError::RemoteCancelled { .. } => "remoteCancelled",
        GitError::Cancelled { .. } => "cancelled",
    }
}

fn remote_failure_reason(error: &GitError) -> Option<&'static str> {
    let GitError::RemoteFailed { reason, .. } = error else {
        return None;
    };
    Some(match reason {
        asterlyn_git::RemoteFailureKind::Authentication => "authentication",
        asterlyn_git::RemoteFailureKind::Network => "network",
        asterlyn_git::RemoteFailureKind::TagConflict => "tagConflict",
        asterlyn_git::RemoteFailureKind::Rejected => "rejected",
        asterlyn_git::RemoteFailureKind::Unknown => "unknown",
    })
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
    use serde_json::Value as JsonValue;
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

    #[test]
    fn remote_operations_emit_redacted_lifecycle_diagnostics() {
        let directory = tempfile::tempdir().unwrap();
        let repository = directory.path().join("repository");
        std::fs::create_dir(&repository).unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(&repository)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "-b", "main"]);
        git(&["config", "user.name", "Asterlyn Test"]);
        git(&["config", "user.email", "test@asterlyn.invalid"]);
        std::fs::write(repository.join("README.md"), "test\n").unwrap();
        git(&["add", "README.md"]);
        git(&["commit", "-m", "Initial"]);

        let diagnostics_directory = directory.path().join("diagnostics");
        let diagnostics = DiagnosticsLog::open(diagnostics_directory.clone());
        let coordinator = GitOperationCoordinator::new(WorkspaceWriteRegistry::default());
        coordinator
            .install_diagnostics(diagnostics.clone())
            .unwrap();
        let repository_root = repository.to_string_lossy().into_owned();
        tauri::async_runtime::block_on(coordinator.run_remote(
            repository_root.clone(),
            "private-operation-id".to_string(),
            "test remote read",
            10,
            |_repository, _cancellation| Ok(()),
        ))
        .unwrap();

        assert!(diagnostics.flush(Duration::from_secs(2)));
        let events = std::fs::read_to_string(
            diagnostics_directory
                .join(diagnostics.session_id())
                .join("asterlyn.jsonl"),
        )
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<JsonValue>(line).unwrap())
        .collect::<Vec<_>>();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["target"], "git.remote");
        assert_eq!(events[0]["event"], "operation.started");
        assert_eq!(events[1]["event"], "operation.completed");
        assert!(
            events
                .iter()
                .all(|event| event["fields"]["workspaceHash"].is_string())
        );
        let encoded = serde_json::to_string(&events).unwrap();
        assert!(!encoded.contains(&repository_root));
        assert!(!encoded.contains("private-operation-id"));
    }
}
