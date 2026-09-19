use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use asterlyn_workspace::{
    WorkspaceError, WorkspaceMutationCancellationToken, WorkspaceMutationPlan,
};

use super::WorkspaceWriteRegistry;

#[derive(Clone)]
pub(crate) struct StoredWorkspaceMutationPlan {
    pub(crate) root: PathBuf,
    pub(crate) plan: WorkspaceMutationPlan,
}

struct ActiveWorkspaceMutationPlan {
    plan_id: String,
    token: u64,
}

#[derive(Clone)]
struct ActiveWorkspaceMutation {
    plan_id: String,
    cancellation: WorkspaceMutationCancellationToken,
}

#[derive(Default)]
struct WorkspaceMutationCoordinatorState {
    plans: HashMap<(String, String), StoredWorkspaceMutationPlan>,
    planning: HashMap<(String, String), ActiveWorkspaceMutationPlan>,
    active: HashMap<(String, String), ActiveWorkspaceMutation>,
    cancelled: HashSet<(String, String, String)>,
    sequence: u64,
}

pub(crate) struct WorkspaceMutationExecution {
    pub(crate) plan: WorkspaceMutationPlan,
    pub(crate) cancellation: WorkspaceMutationCancellationToken,
    pub(crate) write_lock: Arc<Mutex<()>>,
}

pub(crate) struct WorkspaceMutationCoordinator {
    state: Mutex<WorkspaceMutationCoordinatorState>,
    writes: WorkspaceWriteRegistry,
}

impl WorkspaceMutationCoordinator {
    pub(crate) fn new(writes: WorkspaceWriteRegistry) -> Self {
        Self {
            state: Mutex::new(WorkspaceMutationCoordinatorState::default()),
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
        let mut state = self.lock("begin workspace mutation plan")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.active.contains_key(&scope) {
            return Err(busy_mutation());
        }
        state.plans.retain(|(label, _), _| label != window_label);
        if state.cancelled.remove(&(
            window_label.to_string(),
            repository_root.to_string(),
            plan_id.to_string(),
        )) {
            return Err(WorkspaceError::Cancelled {
                message: "workspace mutation planning was cancelled".to_string(),
            });
        }
        state.sequence = state.sequence.wrapping_add(1).max(1);
        let token = state.sequence;
        state.planning.insert(
            scope,
            ActiveWorkspaceMutationPlan {
                plan_id: plan_id.to_string(),
                token,
            },
        );
        Ok(token)
    }

    pub(crate) fn finish_plan(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
        token: u64,
        stored: Option<StoredWorkspaceMutationPlan>,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("finish workspace mutation plan")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        let current = state
            .planning
            .get(&scope)
            .is_some_and(|planning| planning.plan_id == plan_id && planning.token == token);
        if !current {
            return Err(WorkspaceError::Cancelled {
                message: "workspace mutation planning was superseded or cancelled".to_string(),
            });
        }
        state.planning.remove(&scope);
        if let Some(stored) = stored {
            state.plans.insert(
                (window_label.to_string(), stored.plan.plan_id.clone()),
                stored,
            );
        }
        Ok(())
    }

    pub(crate) fn start_execution(
        &self,
        window_label: &str,
        repository_root: &str,
        root: &Path,
        plan_id: &str,
    ) -> Result<WorkspaceMutationExecution, WorkspaceError> {
        validate_plan_id(plan_id)?;
        let write_lock = self.writes.lock_for(root.to_string_lossy().into_owned())?;
        let mut state = self.lock("start workspace mutation")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.active.contains_key(&scope) {
            return Err(busy_mutation());
        }
        let stored = state
            .plans
            .get(&(window_label.to_string(), plan_id.to_string()))
            .filter(|stored| stored.root == root)
            .cloned()
            .ok_or_else(stale_plan)?;
        let cancellation = WorkspaceMutationCancellationToken::new();
        if state.cancelled.remove(&(
            window_label.to_string(),
            repository_root.to_string(),
            plan_id.to_string(),
        )) {
            cancellation.cancel();
        }
        state.active.insert(
            scope,
            ActiveWorkspaceMutation {
                plan_id: plan_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(WorkspaceMutationExecution {
            plan: stored.plan,
            cancellation,
            write_lock,
        })
    }

    pub(crate) fn finish_execution(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
        cancellation: &WorkspaceMutationCancellationToken,
    ) -> Result<(), WorkspaceError> {
        validate_plan_id(plan_id)?;
        let mut state = self.lock("finish workspace mutation")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.active.get(&scope).is_some_and(|active| {
            active.plan_id == plan_id && active.cancellation.refers_to(cancellation)
        }) {
            state.active.remove(&scope);
            state
                .plans
                .remove(&(window_label.to_string(), plan_id.to_string()));
        }
        Ok(())
    }

    pub(crate) fn cancel(
        &self,
        window_label: String,
        repository_root: String,
        plan_id: String,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("cancel workspace mutation")?;
        let scope = (window_label.clone(), repository_root.clone());
        if state
            .planning
            .get(&scope)
            .is_some_and(|planning| planning.plan_id == plan_id)
        {
            state.planning.remove(&scope);
            return Ok(());
        }
        if let Some(active) = state.active.get(&scope)
            && active.plan_id == plan_id
        {
            active.cancellation.cancel();
            return Ok(());
        }
        if state
            .plans
            .remove(&(window_label.clone(), plan_id.clone()))
            .is_some()
        {
            return Ok(());
        }
        if state.cancelled.len() >= 32 {
            state.cancelled.clear();
        }
        state
            .cancelled
            .insert((window_label, repository_root, plan_id));
        Ok(())
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.plans.retain(|(label, _), _| label != window_label);
        state.planning.retain(|(label, _), _| label != window_label);
        state.active.retain(|(label, _), active| {
            if label == window_label {
                active.cancellation.cancel();
                false
            } else {
                true
            }
        });
        state
            .cancelled
            .retain(|(label, _, _)| label != window_label);
    }

    fn lock(
        &self,
        operation: &str,
    ) -> Result<std::sync::MutexGuard<'_, WorkspaceMutationCoordinatorState>, WorkspaceError> {
        self.state.lock().map_err(|_| WorkspaceError::Io {
            operation: operation.to_string(),
            message: "workspace-mutation coordinator lock was poisoned".to_string(),
        })
    }
}

fn busy_mutation() -> WorkspaceError {
    WorkspaceError::Busy {
        message: "another workspace mutation is already running".to_string(),
    }
}

fn stale_plan() -> WorkspaceError {
    WorkspaceError::InvalidMutation {
        message: "workspace mutation plan is stale; create a new plan".to_string(),
    }
}

fn validate_plan_id(plan_id: &str) -> Result<(), WorkspaceError> {
    if plan_id.is_empty() || plan_id.len() > 128 || plan_id.contains(['/', '\\', '\0', '\n', '\r'])
    {
        return Err(WorkspaceError::InvalidMutation {
            message: "workspace mutation plan IDs must be short opaque values".to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use asterlyn_workspace::{Workspace, WorkspaceCollisionPolicy};

    fn stored(root: &Path, id: &str, destination: &str) -> StoredWorkspaceMutationPlan {
        let workspace = Workspace::open(root).unwrap();
        StoredWorkspaceMutationPlan {
            root: workspace.root().to_path_buf(),
            plan: workspace
                .plan_create_file(id, destination, WorkspaceCollisionPolicy::Cancel)
                .unwrap(),
        }
    }

    fn install_plan(coordinator: &WorkspaceMutationCoordinator, root: &Path, id: &str) {
        let token = coordinator.begin_plan("main", "/repo", id).unwrap();
        coordinator
            .finish_plan("main", "/repo", id, token, Some(stored(root, id, id)))
            .unwrap();
    }

    #[test]
    fn latest_plan_replaces_older_plans_for_the_same_window() {
        let root = tempfile::tempdir().unwrap();
        let coordinator = WorkspaceMutationCoordinator::new(WorkspaceWriteRegistry::default());
        install_plan(&coordinator, root.path(), "first");
        install_plan(&coordinator, root.path(), "second");

        assert!(matches!(
            coordinator.start_execution("main", "/repo", root.path(), "first"),
            Err(WorkspaceError::InvalidMutation { .. })
        ));
        assert!(
            coordinator
                .start_execution("main", "/repo", root.path(), "second")
                .is_ok()
        );
    }

    #[test]
    fn active_mutation_is_never_replaced_and_window_cleanup_cancels_it() {
        let root = tempfile::tempdir().unwrap();
        let coordinator = WorkspaceMutationCoordinator::new(WorkspaceWriteRegistry::default());
        install_plan(&coordinator, root.path(), "first");
        let execution = coordinator
            .start_execution("main", "/repo", root.path(), "first")
            .unwrap();

        assert!(matches!(
            coordinator.begin_plan("main", "/repo", "second"),
            Err(WorkspaceError::Busy { .. })
        ));
        assert!(matches!(
            coordinator.start_execution("main", "/repo", root.path(), "first"),
            Err(WorkspaceError::Busy { .. })
        ));
        coordinator.remove_window("main");
        assert!(execution.cancellation.is_cancelled());
    }

    #[test]
    fn a_finished_token_cannot_remove_a_newer_execution() {
        let root = tempfile::tempdir().unwrap();
        let coordinator = WorkspaceMutationCoordinator::new(WorkspaceWriteRegistry::default());
        install_plan(&coordinator, root.path(), "first");
        let first = coordinator
            .start_execution("main", "/repo", root.path(), "first")
            .unwrap();
        coordinator
            .finish_execution("main", "/repo", "first", &first.cancellation)
            .unwrap();
        install_plan(&coordinator, root.path(), "second");
        let second = coordinator
            .start_execution("main", "/repo", root.path(), "second")
            .unwrap();

        coordinator
            .finish_execution("main", "/repo", "second", &first.cancellation)
            .unwrap();
        assert!(!second.cancellation.is_cancelled());
        assert!(matches!(
            coordinator.start_execution("main", "/repo", root.path(), "second"),
            Err(WorkspaceError::Busy { .. })
        ));
    }

    #[test]
    fn an_older_plan_completion_cannot_replace_the_latest_plan() {
        let root = tempfile::tempdir().unwrap();
        let coordinator = WorkspaceMutationCoordinator::new(WorkspaceWriteRegistry::default());
        let old = coordinator.begin_plan("main", "/repo", "old").unwrap();
        let current = coordinator.begin_plan("main", "/repo", "current").unwrap();

        assert!(matches!(
            coordinator.finish_plan(
                "main",
                "/repo",
                "old",
                old,
                Some(stored(root.path(), "old", "old")),
            ),
            Err(WorkspaceError::Cancelled { .. })
        ));
        coordinator
            .finish_plan(
                "main",
                "/repo",
                "current",
                current,
                Some(stored(root.path(), "current", "current")),
            )
            .unwrap();
        assert!(
            coordinator
                .start_execution("main", "/repo", root.path(), "current")
                .is_ok()
        );
    }
}
