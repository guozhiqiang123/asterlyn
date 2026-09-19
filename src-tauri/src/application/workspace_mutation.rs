use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use asterlyn_workspace::{
    Workspace, WorkspaceCollisionPolicy, WorkspaceEntryIdentity, WorkspaceEntryInventory,
    WorkspaceError, WorkspaceMutationBlocker, WorkspaceMutationCancellationToken,
    WorkspaceMutationLimits, WorkspaceMutationOperation, WorkspaceMutationOutcome,
    WorkspaceMutationPlan,
};

use super::WorkspaceWriteRegistry;

const WORKSPACE_MUTATION_LIMITS: WorkspaceMutationLimits = WorkspaceMutationLimits {
    max_entries: 20_000,
    max_total_bytes: 512 * 1024 * 1024,
    max_depth: 64,
    max_path_bytes: 4_096,
};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceMutationPreview {
    plan_id: String,
    operation: WorkspaceMutationOperation,
    collision_policy: WorkspaceCollisionPolicy,
    source: Option<WorkspaceEntryIdentity>,
    entry_count: usize,
    total_bytes: u64,
    hidden_entry_count: usize,
    fingerprint: Option<String>,
    blockers: Vec<WorkspaceMutationBlocker>,
}

impl From<&WorkspaceMutationPlan> for WorkspaceMutationPreview {
    fn from(plan: &WorkspaceMutationPlan) -> Self {
        Self {
            plan_id: plan.plan_id.clone(),
            operation: plan.operation.clone(),
            collision_policy: plan.collision_policy,
            source: plan
                .inventory
                .as_ref()
                .map(|inventory| inventory.source.clone()),
            entry_count: plan
                .inventory
                .as_ref()
                .map_or(0, |inventory| inventory.entries.len()),
            total_bytes: plan
                .inventory
                .as_ref()
                .map_or(0, |inventory| inventory.total_bytes),
            hidden_entry_count: plan.inventory.as_ref().map_or(0, |inventory| {
                inventory
                    .entries
                    .iter()
                    .filter(|entry| entry.hidden)
                    .count()
            }),
            fingerprint: plan
                .inventory
                .as_ref()
                .map(|inventory| inventory.fingerprint.clone()),
            blockers: plan.blockers.clone(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceEntryInspection {
    source: WorkspaceEntryIdentity,
    entry_count: usize,
    total_bytes: u64,
    hidden_entry_count: usize,
    symlink_paths: Vec<String>,
    nested_repository_paths: Vec<String>,
    multiple_link_paths: Vec<String>,
    truncated: bool,
    fingerprint: String,
}

impl From<WorkspaceEntryInventory> for WorkspaceEntryInspection {
    fn from(inventory: WorkspaceEntryInventory) -> Self {
        Self {
            source: inventory.source,
            entry_count: inventory.entries.len(),
            total_bytes: inventory.total_bytes,
            hidden_entry_count: inventory
                .entries
                .iter()
                .filter(|entry| entry.hidden)
                .count(),
            symlink_paths: inventory.symlink_paths,
            nested_repository_paths: inventory.nested_repository_paths,
            multiple_link_paths: inventory.multiple_link_paths,
            truncated: inventory.truncated,
            fingerprint: inventory.fingerprint,
        }
    }
}

pub(crate) fn inspect_workspace_entry_inventory(
    root: &Path,
    workspace_path: &str,
) -> Result<WorkspaceEntryInspection, WorkspaceError> {
    Workspace::open(root)?
        .inspect_entry(workspace_path, WORKSPACE_MUTATION_LIMITS)
        .map(WorkspaceEntryInspection::from)
}

pub(crate) fn prepare_workspace_mutation_plan(
    root: &Path,
    plan_id: &str,
    operation: WorkspaceMutationOperation,
    collision_policy: WorkspaceCollisionPolicy,
) -> Result<
    (
        WorkspaceMutationPreview,
        Option<StoredWorkspaceMutationPlan>,
    ),
    WorkspaceError,
> {
    let workspace = Workspace::open(root)?;
    let plan = match operation {
        WorkspaceMutationOperation::CreateFile { destination } => {
            workspace.plan_create_file(plan_id, &destination, collision_policy)
        }
        WorkspaceMutationOperation::Copy {
            source,
            destination,
        } => workspace.plan_copy(
            plan_id,
            &source,
            &destination,
            collision_policy,
            WORKSPACE_MUTATION_LIMITS,
        ),
        WorkspaceMutationOperation::Move {
            source,
            destination,
        } => workspace.plan_move(
            plan_id,
            &source,
            &destination,
            collision_policy,
            WORKSPACE_MUTATION_LIMITS,
        ),
        WorkspaceMutationOperation::Trash { source } => {
            workspace.plan_trash(plan_id, &source, WORKSPACE_MUTATION_LIMITS)
        }
    }?;
    let preview = WorkspaceMutationPreview::from(&plan);
    let stored = plan.executable().then_some(StoredWorkspaceMutationPlan {
        root: workspace.root().to_path_buf(),
        plan,
    });
    Ok((preview, stored))
}

pub(crate) fn execute_workspace_mutation_plan<F>(
    root: &Path,
    recovery_root: &Path,
    execution: WorkspaceMutationExecution,
    trash: F,
) -> Result<WorkspaceMutationOutcome, WorkspaceError>
where
    F: FnOnce(&Path) -> Result<(), WorkspaceError>,
{
    let _guard = execution
        .write_lock
        .lock()
        .map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
    let workspace = Workspace::open(root)?;
    match &execution.plan.operation {
        WorkspaceMutationOperation::Trash { .. } => workspace.execute_trash_plan_with(
            recovery_root,
            &execution.plan,
            &execution.cancellation,
            trash,
        ),
        _ => {
            workspace.execute_mutation_plan(recovery_root, &execution.plan, &execution.cancellation)
        }
    }
}

#[derive(Clone)]
pub(crate) struct StoredWorkspaceMutationPlan {
    root: PathBuf,
    plan: WorkspaceMutationPlan,
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
    plan: WorkspaceMutationPlan,
    cancellation: WorkspaceMutationCancellationToken,
    write_lock: Arc<Mutex<()>>,
}

impl WorkspaceMutationExecution {
    pub(crate) fn cancellation(&self) -> WorkspaceMutationCancellationToken {
        self.cancellation.clone()
    }
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

    #[test]
    fn application_service_plans_and_executes_without_tauri() {
        let root = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        let (preview, stored) = prepare_workspace_mutation_plan(
            root.path(),
            "create-file",
            WorkspaceMutationOperation::CreateFile {
                destination: "created.txt".to_string(),
            },
            WorkspaceCollisionPolicy::Cancel,
        )
        .unwrap();
        assert_eq!(preview.plan_id, "create-file");
        assert!(preview.blockers.is_empty());

        let stored = stored.expect("executable plan");
        let outcome = execute_workspace_mutation_plan(
            root.path(),
            recovery.path(),
            WorkspaceMutationExecution {
                plan: stored.plan,
                cancellation: WorkspaceMutationCancellationToken::new(),
                write_lock: Arc::new(Mutex::new(())),
            },
            |_| {
                Err(WorkspaceError::InvalidMutation {
                    message: "create must not use the trash adapter".to_string(),
                })
            },
        )
        .unwrap();

        assert_eq!(
            outcome.status,
            asterlyn_workspace::WorkspaceMutationStatus::Completed
        );
        assert!(root.path().join("created.txt").is_file());
    }

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
