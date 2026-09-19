use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use asterlyn_git::{CommitFileChange, CommitFileVersion};
use asterlyn_workspace::{PreparedFileRestore, WorkspaceError};

use super::WorkspaceWriteRegistry;

#[derive(Clone)]
pub(crate) struct StoredCommitFileRestorePlan {
    pub(crate) root: PathBuf,
    pub(crate) repository_id: String,
    pub(crate) commit_oid: String,
    pub(crate) selected: CommitFileChange,
    pub(crate) source: CommitFileVersion,
    pub(crate) plan: PreparedFileRestore,
}

#[derive(Default)]
struct CommitFileRestoreState {
    sequence: u64,
    planning: HashMap<(String, String), (String, u64)>,
    plans: HashMap<(String, String), StoredCommitFileRestorePlan>,
    executing: HashSet<(String, String)>,
}

pub(crate) struct CommitFileRestoreExecution {
    pub(crate) stored: StoredCommitFileRestorePlan,
    pub(crate) write_lock: Arc<Mutex<()>>,
}

pub(crate) struct CommitFileRestoreRegistry {
    state: Mutex<CommitFileRestoreState>,
    writes: WorkspaceWriteRegistry,
}

impl CommitFileRestoreRegistry {
    pub(crate) fn new(writes: WorkspaceWriteRegistry) -> Self {
        Self {
            state: Mutex::new(CommitFileRestoreState::default()),
            writes,
        }
    }

    pub(crate) fn begin_plan(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
    ) -> Result<u64, WorkspaceError> {
        validate_plan_id(plan_id)?;
        let mut state = self.lock("begin commit-file restore plan")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.executing.contains(&scope) {
            return Err(busy());
        }
        state.plans.retain(|(label, _), _| label != window_label);
        state.sequence = state.sequence.wrapping_add(1).max(1);
        let token = state.sequence;
        state.planning.insert(scope, (plan_id.to_string(), token));
        Ok(token)
    }

    pub(crate) fn finish_plan(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
        token: u64,
        stored: Option<StoredCommitFileRestorePlan>,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("finish commit-file restore plan")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.planning.get(&scope) != Some(&(plan_id.to_string(), token)) {
            return Err(stale());
        }
        state.planning.remove(&scope);
        if let Some(stored) = stored {
            state
                .plans
                .insert((window_label.to_string(), plan_id.to_string()), stored);
        }
        Ok(())
    }

    pub(crate) fn start_execution(
        &self,
        window_label: &str,
        repository_root: &str,
        root: &Path,
        plan_id: &str,
    ) -> Result<CommitFileRestoreExecution, WorkspaceError> {
        validate_plan_id(plan_id)?;
        let write_lock = self.writes.lock_for(root.to_string_lossy().into_owned())?;
        let mut state = self.lock("start commit-file restore")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.executing.contains(&scope) {
            return Err(busy());
        }
        let stored = state
            .plans
            .get(&(window_label.to_string(), plan_id.to_string()))
            .filter(|stored| stored.root == root)
            .cloned()
            .ok_or_else(stale)?;
        state.executing.insert(scope);
        Ok(CommitFileRestoreExecution { stored, write_lock })
    }

    pub(crate) fn finish_execution(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("finish commit-file restore")?;
        state
            .executing
            .remove(&(window_label.to_string(), repository_root.to_string()));
        state
            .plans
            .remove(&(window_label.to_string(), plan_id.to_string()));
        Ok(())
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.planning.retain(|(label, _), _| label != window_label);
        state.plans.retain(|(label, _), _| label != window_label);
        state.executing.retain(|(label, _)| label != window_label);
    }

    fn lock(
        &self,
        operation: &str,
    ) -> Result<std::sync::MutexGuard<'_, CommitFileRestoreState>, WorkspaceError> {
        self.state.lock().map_err(|_| WorkspaceError::Io {
            operation: operation.to_string(),
            message: "commit-file restore registry lock was poisoned".into(),
        })
    }
}

fn validate_plan_id(plan_id: &str) -> Result<(), WorkspaceError> {
    if plan_id.is_empty()
        || plan_id.len() > 96
        || plan_id
            .chars()
            .any(|character| character.is_whitespace() || matches!(character, '/' | '\\' | '\0'))
    {
        return Err(WorkspaceError::InvalidMutation {
            message: "commit-file restore plan IDs must be short opaque values".into(),
        });
    }
    Ok(())
}

fn busy() -> WorkspaceError {
    WorkspaceError::Busy {
        message: "another commit-file restore is already running".into(),
    }
}

fn stale() -> WorkspaceError {
    WorkspaceError::InvalidMutation {
        message: "commit-file restore plan is stale; review it again".into(),
    }
}
