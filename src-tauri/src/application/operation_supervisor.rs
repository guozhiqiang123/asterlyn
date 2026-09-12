use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use asterlyn_git::{CancellationToken, GitError};

const CANCELLED_SCAN_RETENTION: usize = 256;
const CANCELLED_REMOTE_RETENTION: usize = 128;

#[derive(Default)]
pub(crate) struct ScanRegistry {
    inner: Mutex<ScanRegistryState>,
}

#[derive(Default)]
struct ScanRegistryState {
    active: HashMap<(String, String), CancellationToken>,
    cancelled: HashSet<(String, String)>,
}

#[derive(Default)]
pub(crate) struct RemoteOperationRegistry {
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

impl ScanRegistry {
    pub(crate) fn register(
        &self,
        window_label: &str,
        scan_id: String,
    ) -> Result<(String, String, CancellationToken), GitError> {
        let cancellation = CancellationToken::new();
        let scan_key = (window_label.to_string(), scan_id);
        let mut state = self.lock()?;
        if state.cancelled.remove(&scan_key) {
            cancellation.cancel();
        }
        if let Some(previous) = state.active.insert(scan_key.clone(), cancellation.clone()) {
            previous.cancel();
        }
        Ok((scan_key.0, scan_key.1, cancellation))
    }

    pub(crate) fn finish(
        &self,
        scan_key: &(String, String),
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        let mut state = self.lock()?;
        if state
            .active
            .get(scan_key)
            .is_some_and(|active| active.refers_to(cancellation))
        {
            state.active.remove(scan_key);
        }
        Ok(())
    }

    pub(crate) fn cancel(&self, window_label: &str, scan_id: String) -> Result<(), GitError> {
        let mut state = self.lock()?;
        let scan_key = (window_label.to_string(), scan_id);
        if let Some(cancellation) = state.active.remove(&scan_key) {
            cancellation.cancel();
        } else {
            if state.cancelled.len() >= CANCELLED_SCAN_RETENTION {
                state.cancelled.clear();
            }
            state.cancelled.insert(scan_key);
        }
        Ok(())
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        if let Ok(mut state) = self.inner.lock() {
            state.active.retain(|(label, _), cancellation| {
                if label == window_label {
                    cancellation.cancel();
                    false
                } else {
                    true
                }
            });
            state.cancelled.retain(|(label, _)| label != window_label);
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, ScanRegistryState>, GitError> {
        self.inner.lock().map_err(|_| GitError::Io {
            operation: "manage untracked scans".to_string(),
            message: "scan registry lock was poisoned".to_string(),
        })
    }
}

impl RemoteOperationRegistry {
    pub(crate) fn register(
        &self,
        repository_root: &str,
        operation_id: &str,
        operation: &str,
    ) -> Result<CancellationToken, GitError> {
        let mut state = self.lock()?;
        if state.active.contains_key(repository_root) {
            return Err(GitError::UnsafeOperation {
                operation: operation.to_string(),
                message: "another remote operation is already running for this repository"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        let cancellation = CancellationToken::new();
        if state
            .cancelled
            .remove(&(repository_root.to_string(), operation_id.to_string()))
        {
            cancellation.cancel();
        }
        state.active.insert(
            repository_root.to_string(),
            ActiveRemoteOperation {
                id: operation_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(cancellation)
    }

    pub(crate) fn cancel(
        &self,
        repository_root: String,
        operation_id: String,
    ) -> Result<(), GitError> {
        let mut state = self.lock()?;
        if let Some(active) = state.active.get(&repository_root)
            && active.id == operation_id
        {
            active.cancellation.cancel();
            return Ok(());
        }
        if state.cancelled.len() >= CANCELLED_REMOTE_RETENTION {
            state.cancelled.clear();
        }
        state.cancelled.insert((repository_root, operation_id));
        Ok(())
    }

    pub(crate) fn finish(
        &self,
        repository_root: &str,
        operation_id: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        let mut state = self.lock()?;
        if state.active.get(repository_root).is_some_and(|active| {
            active.id == operation_id && active.cancellation.refers_to(cancellation)
        }) {
            state.active.remove(repository_root);
        }
        Ok(())
    }

    fn lock(&self) -> Result<MutexGuard<'_, RemoteOperationRegistryState>, GitError> {
        self.inner.lock().map_err(|_| GitError::Io {
            operation: "manage remote operations".to_string(),
            message: "remote-operation registry lock was poisoned".to_string(),
        })
    }
}
