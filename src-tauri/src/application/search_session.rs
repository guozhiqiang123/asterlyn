use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use asterlyn_workspace::{PreparedWorkspaceReplacement, SearchCancellationToken, WorkspaceError};

const CANCELLED_SEARCH_RETENTION: usize = 128;
const REPLACEMENT_PLAN_RETENTION: usize = 16;

#[derive(Clone)]
pub(crate) struct StoredReplacementPlan {
    pub(crate) root: PathBuf,
    pub(crate) plan: PreparedWorkspaceReplacement,
    pub(crate) files: Vec<AuthorizedReplacementFile>,
}

#[derive(Clone)]
pub(crate) struct AuthorizedReplacementFile {
    pub(crate) repository_id: String,
    pub(crate) path: String,
    pub(crate) workspace_path: String,
}

struct ActiveWorkspaceSearch {
    id: String,
    cancellation: SearchCancellationToken,
}

#[derive(Default)]
pub(crate) struct WorkspaceSearchRegistry {
    state: Mutex<WorkspaceSearchRegistryState>,
}

#[derive(Default)]
struct WorkspaceSearchRegistryState {
    active: HashMap<(String, String), ActiveWorkspaceSearch>,
    cancelled: HashSet<(String, String, String)>,
}

impl WorkspaceSearchRegistry {
    pub(crate) fn register(
        &self,
        window_label: &str,
        repository_root: &str,
        request_id: &str,
    ) -> Result<SearchCancellationToken, WorkspaceError> {
        let mut state = self.lock("start workspace search")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if let Some(previous) = state.active.remove(&scope) {
            previous.cancellation.cancel();
        }
        let cancellation = SearchCancellationToken::new();
        if state.cancelled.remove(&(
            window_label.to_string(),
            repository_root.to_string(),
            request_id.to_string(),
        )) {
            cancellation.cancel();
        }
        state.active.insert(
            scope,
            ActiveWorkspaceSearch {
                id: request_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(cancellation)
    }

    pub(crate) fn cancel(
        &self,
        window_label: String,
        repository_root: String,
        request_id: String,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("cancel workspace search")?;
        let scope = (window_label.clone(), repository_root.clone());
        if state
            .active
            .get(&scope)
            .is_some_and(|active| active.id == request_id)
        {
            if let Some(active) = state.active.remove(&scope) {
                active.cancellation.cancel();
            }
            return Ok(());
        }
        if state.cancelled.len() >= CANCELLED_SEARCH_RETENTION {
            state.cancelled.clear();
        }
        state
            .cancelled
            .insert((window_label, repository_root, request_id));
        Ok(())
    }

    pub(crate) fn finish(
        &self,
        window_label: &str,
        repository_root: &str,
        request_id: &str,
        cancellation: &SearchCancellationToken,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("finish workspace search")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.active.get(&scope).is_some_and(|active| {
            active.id == request_id && active.cancellation.refers_to(cancellation)
        }) {
            state.active.remove(&scope);
        }
        Ok(())
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
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
    ) -> Result<std::sync::MutexGuard<'_, WorkspaceSearchRegistryState>, WorkspaceError> {
        self.state.lock().map_err(|_| WorkspaceError::Io {
            operation: operation.to_string(),
            message: "workspace-search registry lock was poisoned".to_string(),
        })
    }
}

#[derive(Default)]
pub(crate) struct WorkspaceReplacementRegistry {
    state: Mutex<WorkspaceReplacementRegistryState>,
}

#[derive(Default)]
struct WorkspaceReplacementRegistryState {
    plans: HashMap<(String, String), StoredReplacementPlan>,
    active: HashMap<(String, String), ActiveWorkspaceSearch>,
    cancelled: HashSet<(String, String, String)>,
}

impl WorkspaceReplacementRegistry {
    pub(crate) fn register(
        &self,
        window_label: &str,
        repository_root: &str,
        operation_id: &str,
    ) -> Result<SearchCancellationToken, WorkspaceError> {
        let mut state = self.lock("start workspace replacement")?;
        Ok(state.register(window_label, repository_root, operation_id))
    }

    pub(crate) fn finish_preview(
        &self,
        window_label: &str,
        repository_root: &str,
        operation_id: &str,
        cancellation: &SearchCancellationToken,
        stored: Option<StoredReplacementPlan>,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("finish replacement preview")?;
        state.finish(window_label, repository_root, operation_id, cancellation);
        if let Some(stored) = stored {
            if cancellation.is_cancelled() {
                return Err(WorkspaceError::Cancelled {
                    message: "workspace replacement preview was cancelled".to_string(),
                });
            }
            state.store(window_label, stored);
        }
        Ok(())
    }

    pub(crate) fn start_application(
        &self,
        window_label: &str,
        repository_root: &str,
        root: &Path,
        plan_id: &str,
    ) -> Result<(StoredReplacementPlan, SearchCancellationToken), WorkspaceError> {
        let mut state = self.lock("start workspace replacement")?;
        let stored = state.plan(window_label, root, plan_id)?;
        let cancellation = state.register(window_label, repository_root, plan_id);
        Ok((stored, cancellation))
    }

    pub(crate) fn finish_application(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
        cancellation: &SearchCancellationToken,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("finish workspace replacement")?;
        state.finish(window_label, repository_root, plan_id, cancellation);
        state.remove_plan(window_label, plan_id);
        Ok(())
    }

    pub(crate) fn cancel(
        &self,
        window_label: String,
        repository_root: String,
        operation_id: String,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("cancel workspace replacement")?;
        state.cancel(window_label, repository_root, operation_id);
        Ok(())
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.remove_window(window_label);
    }

    fn lock(
        &self,
        operation: &str,
    ) -> Result<std::sync::MutexGuard<'_, WorkspaceReplacementRegistryState>, WorkspaceError> {
        self.state.lock().map_err(|_| WorkspaceError::Io {
            operation: operation.to_string(),
            message: "workspace-replacement registry lock was poisoned".to_string(),
        })
    }

    #[cfg(test)]
    pub(crate) fn store(
        &self,
        window_label: &str,
        stored: StoredReplacementPlan,
    ) -> Result<(), WorkspaceError> {
        self.lock("store replacement plan")?
            .store(window_label, stored);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn plan(
        &self,
        window_label: &str,
        root: &Path,
        plan_id: &str,
    ) -> Result<StoredReplacementPlan, WorkspaceError> {
        self.lock("read replacement plan")?
            .plan(window_label, root, plan_id)
    }
}

impl WorkspaceReplacementRegistryState {
    fn register(
        &mut self,
        window_label: &str,
        repository_root: &str,
        operation_id: &str,
    ) -> SearchCancellationToken {
        let scope = (window_label.to_string(), repository_root.to_string());
        if let Some(previous) = self.active.remove(&scope) {
            previous.cancellation.cancel();
        }
        let cancellation = SearchCancellationToken::new();
        if self.cancelled.remove(&(
            window_label.to_string(),
            repository_root.to_string(),
            operation_id.to_string(),
        )) {
            cancellation.cancel();
        }
        self.active.insert(
            scope,
            ActiveWorkspaceSearch {
                id: operation_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        cancellation
    }

    fn finish(
        &mut self,
        window_label: &str,
        repository_root: &str,
        operation_id: &str,
        cancellation: &SearchCancellationToken,
    ) {
        let scope = (window_label.to_string(), repository_root.to_string());
        if self.active.get(&scope).is_some_and(|active| {
            active.id == operation_id && active.cancellation.refers_to(cancellation)
        }) {
            self.active.remove(&scope);
        }
    }

    fn cancel(&mut self, window_label: String, repository_root: String, operation_id: String) {
        let plan_key = (window_label.clone(), operation_id.clone());
        let removed_plan = self
            .plans
            .get(&plan_key)
            .is_some_and(|stored| stored.root == Path::new(&repository_root));
        if removed_plan {
            self.plans.remove(&plan_key);
        }
        let scope = (window_label.clone(), repository_root.clone());
        if self
            .active
            .get(&scope)
            .is_some_and(|active| active.id == operation_id)
        {
            if let Some(active) = self.active.remove(&scope) {
                active.cancellation.cancel();
            }
            return;
        }
        if removed_plan {
            return;
        }
        if self.cancelled.len() >= CANCELLED_SEARCH_RETENTION {
            self.cancelled.clear();
        }
        self.cancelled
            .insert((window_label, repository_root, operation_id));
    }

    fn store(&mut self, window_label: &str, stored: StoredReplacementPlan) {
        if self.plans.len() >= REPLACEMENT_PLAN_RETENTION {
            self.plans.clear();
        }
        self.plans
            .retain(|(label, _), existing| label != window_label || existing.root != stored.root);
        self.plans.insert(
            (window_label.to_string(), stored.plan.plan_id().to_string()),
            stored,
        );
    }

    fn plan(
        &self,
        window_label: &str,
        root: &Path,
        plan_id: &str,
    ) -> Result<StoredReplacementPlan, WorkspaceError> {
        self.plans
            .get(&(window_label.to_string(), plan_id.to_string()))
            .filter(|stored| stored.root == root)
            .cloned()
            .ok_or_else(|| WorkspaceError::InvalidReplacement {
                message: "replacement preview is stale; create a new preview".to_string(),
            })
    }

    fn remove_plan(&mut self, window_label: &str, plan_id: &str) {
        self.plans
            .remove(&(window_label.to_string(), plan_id.to_string()));
    }

    fn remove_window(&mut self, window_label: &str) {
        self.plans.retain(|(label, _), _| label != window_label);
        self.active.retain(|(label, _), active| {
            if label == window_label {
                active.cancellation.cancel();
                false
            } else {
                true
            }
        });
        self.cancelled.retain(|(label, _, _)| label != window_label);
    }
}
