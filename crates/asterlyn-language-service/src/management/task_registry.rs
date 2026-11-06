use super::*;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
    time::Instant,
};

#[derive(Debug, Clone)]
pub struct ManagedInstallReviewDetails {
    pub review: ManagedInstallReview,
    pub recipe: ManagedRecipeSummary,
    pub notice_text: Arc<str>,
}

/// Single-use native handle returned only after host confirmation. Its fields
/// are private so a renderer/plugin operation ID cannot forge execution work.
pub struct ManagedConfirmedInstall {
    operation_id: String,
    owner: Arc<TaskRegistryInner>,
    identity: Arc<()>,
}

impl ManagedConfirmedInstall {
    pub fn operation_id(&self) -> &str {
        &self.operation_id
    }
}

impl Drop for ManagedConfirmedInstall {
    fn drop(&mut self) {
        let active = self.owner.state.lock().ok().and_then(|state| {
            state.active.get(&self.operation_id).and_then(|active| {
                Arc::ptr_eq(&active.identity, &self.identity)
                    .then(|| (active.authority.clone(), active.ticket.clone()))
            })
        });
        if let Some((authority, ticket)) = active {
            let _ = self.owner.executor.cancel(&authority, &ticket);
            if let Ok(mut state) = self.owner.state.lock()
                && state
                    .active
                    .get(&self.operation_id)
                    .is_some_and(|active| Arc::ptr_eq(&active.identity, &self.identity))
            {
                state.active.remove(&self.operation_id);
            }
        }
    }
}

#[derive(Clone)]
pub struct ManagedInstallationTaskRegistry {
    inner: Arc<TaskRegistryInner>,
}

struct TaskRegistryInner {
    executor: ManagedInstallationExecutor,
    recipes: ManagedRecipeRegistry,
    state: Mutex<TaskRegistryState>,
}

impl Drop for TaskRegistryInner {
    fn drop(&mut self) {
        let state = self
            .state
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut authorities = BTreeMap::new();
        for authority in state
            .pending
            .values()
            .map(|pending| &pending.authority)
            .chain(state.active.values().map(|active| &active.authority))
        {
            authorities
                .entry((authority.plugin_id.clone(), authority.window_id.clone()))
                .or_insert_with(|| authority.clone());
        }
        for mut authority in authorities.into_values() {
            authority.enabled = false;
            authority.may_manage = false;
            let _ = self.executor.reconcile_authority(&authority);
        }
    }
}

#[derive(Default)]
struct TaskRegistryState {
    pending: BTreeMap<String, PendingInstall>,
    active: BTreeMap<String, ActiveInstall>,
}

struct PendingInstall {
    authority: ManagementAuthority,
    registered: ManagedRegisteredRecipe,
    deadline: Instant,
}

struct ActiveInstall {
    authority: ManagementAuthority,
    registered: ManagedRegisteredRecipe,
    ticket: ManagedOperationTicket,
    identity: Arc<()>,
    running: bool,
}

impl ManagedInstallationTaskRegistry {
    pub fn new(executor: ManagedInstallationExecutor, recipes: ManagedRecipeRegistry) -> Self {
        Self {
            inner: Arc::new(TaskRegistryInner {
                executor,
                recipes,
                state: Mutex::new(TaskRegistryState::default()),
            }),
        }
    }

    pub fn snapshot(&self) -> Result<ManagedInstallationSnapshot, ManagedInstallError> {
        self.inner.executor.snapshot()
    }

    pub fn recipe_summaries(
        &self,
        authority: &ManagementAuthority,
        current_target: &str,
    ) -> Result<Vec<ManagedRecipeSummary>, ManagedInstallError> {
        self.inner.recipes.summaries(authority, current_target)
    }

    pub fn prepare_install(
        &self,
        authority: &ManagementAuthority,
        reference: &ManagedRecipeReference,
        now: Instant,
    ) -> Result<ManagedInstallReviewDetails, ManagedInstallError> {
        let registered = self.inner.recipes.resolve(authority, reference)?;
        let mut state = self.lock()?;
        state.pending.retain(|_, pending| pending.deadline > now);
        if state.pending.len() >= MAX_REVIEWS {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let review = self
            .inner
            .executor
            .prepare_install(authority, &registered, now)?;
        let details = ManagedInstallReviewDetails {
            review: review.clone(),
            recipe: registered.summary(),
            notice_text: registered.notice_text_arc(),
        };
        if state
            .pending
            .insert(
                review.id.clone(),
                PendingInstall {
                    authority: authority.clone(),
                    registered,
                    deadline: now + MANAGEMENT_REVIEW_TTL,
                },
            )
            .is_some()
        {
            return Err(ManagedInstallError::StateChanged);
        }
        Ok(details)
    }

    pub fn confirm_install(
        &self,
        authority: &ManagementAuthority,
        review_id: &str,
        now: Instant,
    ) -> Result<ManagedConfirmedInstall, ManagedInstallError> {
        let mut state = self.lock()?;
        let pending = state
            .pending
            .get(review_id)
            .ok_or(ManagedInstallError::StaleReview)?;
        if &pending.authority != authority {
            return Err(ManagedInstallError::StaleReview);
        }
        if state.active.len() >= MAX_OPERATIONS {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let ticket = match self.inner.executor.confirm(authority, review_id, now) {
            Ok(ticket) => ticket,
            Err(error) => {
                if matches!(
                    error,
                    ManagedInstallError::ExpiredReview
                        | ManagedInstallError::StaleReview
                        | ManagedInstallError::NotFound
                ) {
                    state.pending.remove(review_id);
                }
                return Err(error);
            }
        };
        let pending = state
            .pending
            .remove(review_id)
            .expect("pending review checked");
        let operation_id = ticket.id().to_owned();
        let identity = Arc::new(());
        if state.active.contains_key(&operation_id) {
            let _ = self.inner.executor.cancel(&pending.authority, &ticket);
            return Err(ManagedInstallError::StateChanged);
        }
        state.active.insert(
            operation_id.clone(),
            ActiveInstall {
                authority: pending.authority,
                registered: pending.registered,
                ticket,
                identity: identity.clone(),
                running: false,
            },
        );
        Ok(ManagedConfirmedInstall {
            operation_id,
            owner: self.inner.clone(),
            identity,
        })
    }

    pub fn cancel_install(
        &self,
        authority: &ManagementAuthority,
        operation_id: &str,
    ) -> Result<(), ManagedInstallError> {
        let ticket = {
            let state = self.lock()?;
            let active = state
                .active
                .get(operation_id)
                .ok_or(ManagedInstallError::NotFound)?;
            if &active.authority != authority {
                return Err(ManagedInstallError::PermissionDenied);
            }
            active.ticket.clone()
        };
        self.inner.executor.cancel(authority, &ticket)
    }

    /// Revoke reviews and jobs when a host window loses this plugin authority.
    /// Published content and use leases remain owned by the durable coordinator.
    pub fn revoke_plugin_window(
        &self,
        plugin_id: &str,
        window_id: &str,
    ) -> Result<(), ManagedInstallError> {
        self.revoke_matching(|authority| {
            authority.plugin_id == plugin_id && authority.window_id == window_id
        })
    }

    /// Revoke the plugin across all windows after disable or package replacement.
    pub fn revoke_plugin(&self, plugin_id: &str) -> Result<(), ManagedInstallError> {
        self.revoke_matching(|authority| authority.plugin_id == plugin_id)
    }

    /// Revoke every plugin authority owned by a destroyed window.
    pub fn revoke_window(&self, window_id: &str) -> Result<(), ManagedInstallError> {
        self.revoke_matching(|authority| authority.window_id == window_id)
    }

    /// Consumes the work exactly once. Hosts run this inside their bounded
    /// blocking pool and then publish a fresh snapshot; no callback occurs here.
    pub fn execute_install_blocking(
        &self,
        work: ManagedConfirmedInstall,
    ) -> Result<ManagedContentInventory, ManagedInstallError> {
        if !Arc::ptr_eq(&self.inner, &work.owner) {
            return Err(ManagedInstallError::PermissionDenied);
        }
        let (authority, ticket, registered) = {
            let mut state = self.lock()?;
            let active = state
                .active
                .get_mut(&work.operation_id)
                .ok_or(ManagedInstallError::NotFound)?;
            if !Arc::ptr_eq(&active.identity, &work.identity) {
                return Err(ManagedInstallError::PermissionDenied);
            }
            if active.running {
                return Err(ManagedInstallError::Busy);
            }
            active.running = true;
            (
                active.authority.clone(),
                active.ticket.clone(),
                active.registered.clone(),
            )
        };
        let result = self.inner.executor.execute_confirmed_install_blocking(
            &authority,
            &ticket,
            &registered,
        );
        self.finish(&work);
        result
    }

    /// Used when the host cannot enqueue a confirmed worker. Cancellation is
    /// recorded before the native handle is discarded.
    pub fn abandon_install(
        &self,
        work: ManagedConfirmedInstall,
    ) -> Result<(), ManagedInstallError> {
        if !Arc::ptr_eq(&self.inner, &work.owner) {
            return Err(ManagedInstallError::PermissionDenied);
        }
        let (authority, ticket) = {
            let state = self.lock()?;
            let active = state
                .active
                .get(&work.operation_id)
                .ok_or(ManagedInstallError::NotFound)?;
            if !Arc::ptr_eq(&active.identity, &work.identity) || active.running {
                return Err(ManagedInstallError::InvalidTransition);
            }
            (active.authority.clone(), active.ticket.clone())
        };
        let result = self.inner.executor.cancel(&authority, &ticket);
        self.finish(&work);
        result
    }

    fn finish(&self, work: &ManagedConfirmedInstall) {
        if let Ok(mut state) = self.inner.state.lock()
            && state
                .active
                .get(&work.operation_id)
                .is_some_and(|active| Arc::ptr_eq(&active.identity, &work.identity))
        {
            state.active.remove(&work.operation_id);
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, TaskRegistryState>, ManagedInstallError> {
        self.inner
            .state
            .lock()
            .map_err(|_| ManagedInstallError::StorageFailed)
    }

    fn revoke_matching(
        &self,
        matches: impl Fn(&ManagementAuthority) -> bool,
    ) -> Result<(), ManagedInstallError> {
        let mut state = self.lock()?;
        let mut authorities = BTreeMap::new();
        for authority in state
            .pending
            .values()
            .map(|pending| &pending.authority)
            .chain(state.active.values().map(|active| &active.authority))
            .filter(|authority| matches(authority))
        {
            authorities
                .entry((authority.plugin_id.clone(), authority.window_id.clone()))
                .or_insert_with(|| authority.clone());
        }
        for mut authority in authorities.into_values() {
            authority.enabled = false;
            authority.may_manage = false;
            self.inner.executor.reconcile_authority(&authority)?;
        }
        state
            .pending
            .retain(|_, pending| !matches(&pending.authority));
        state.active.retain(|_, active| !matches(&active.authority));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    const NOTICE: &str = "fixture notice\n";

    fn hash(value: &[u8]) -> String {
        format!("sha256:{:x}", Sha256::digest(value))
    }

    fn authority(window: &str) -> ManagementAuthority {
        ManagementAuthority {
            window_id: window.into(),
            activation: 1,
            plugin_id: "dev.example.lsp".into(),
            plugin_version: "1.0.0".into(),
            package_digest: hash(b"plugin"),
            enabled: true,
            may_manage: true,
        }
    }

    fn registry() -> ManagedRecipeRegistry {
        let mut spec = ManagedInstallRecipeSpec {
            schema_version: MANAGED_INSTALL_RECIPE_SCHEMA_VERSION,
            server: ManagedServerId {
                plugin_id: "dev.example.lsp".into(),
                server_id: "rust".into(),
            },
            version: "1.0.0".into(),
            target: "aarch64-apple-darwin".into(),
            recipe_digest: hash(b"placeholder"),
            archive_digest: hash(b"archive"),
            content_digest: hash(b"content"),
            source: "https://downloads.example.com/server.gz".into(),
            allowed_redirect_origins: vec![],
            format: ManagedArchiveFormat::Gzip {
                output_path: "bin/server".into(),
                executable: true,
            },
            download_bytes: 100,
            expanded_bytes: 200,
            license: ManagedRecipeLicense {
                expression: "MIT".into(),
                notice_url: "https://github.com/example/server/blob/v1/LICENSE".into(),
                notice_digest: hash(NOTICE.as_bytes()),
            },
        };
        spec.recipe_digest = spec.calculated_digest().unwrap();
        ManagedRecipeRegistry::admit([ManagedRecipeCatalogEntry {
            plugin_version: "1.0.0".into(),
            package_digest: hash(b"plugin"),
            spec,
            notice_text: NOTICE.into(),
        }])
        .unwrap()
    }

    fn tasks() -> (
        tempfile::TempDir,
        ManagedInstallationExecutor,
        ManagedInstallationTaskRegistry,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let executor = ManagedInstallationExecutor::open(
            directory.path().join("managed-language"),
            "task-epoch".into(),
        )
        .unwrap();
        let tasks = ManagedInstallationTaskRegistry::new(executor.clone(), registry());
        (directory, executor, tasks)
    }

    #[test]
    fn review_confirmation_and_cancel_are_bound_to_exact_authority() {
        let (_directory, _executor, tasks) = tasks();
        let owner = authority("one");
        let reference = tasks
            .recipe_summaries(&owner, "aarch64-apple-darwin")
            .unwrap()
            .pop()
            .unwrap()
            .reference;
        let now = Instant::now();
        let details = tasks.prepare_install(&owner, &reference, now).unwrap();
        assert_eq!(details.notice_text.as_ref(), NOTICE);
        assert_eq!(details.recipe.reference, reference);
        assert!(matches!(
            tasks.confirm_install(&authority("two"), &details.review.id, now),
            Err(ManagedInstallError::StaleReview)
        ));
        let work = tasks
            .confirm_install(&owner, &details.review.id, now)
            .unwrap();
        assert_eq!(
            tasks.cancel_install(&authority("two"), work.operation_id()),
            Err(ManagedInstallError::PermissionDenied)
        );
        tasks.cancel_install(&owner, work.operation_id()).unwrap();
        assert_eq!(
            tasks.execute_install_blocking(work),
            Err(ManagedInstallError::Cancelled)
        );
        assert_eq!(
            tasks.snapshot().unwrap().operations[0].phase,
            ManagedOperationPhase::Cancelled
        );
    }

    #[test]
    fn expired_review_is_removed_and_a_confirmed_worker_can_be_abandoned() {
        let (_directory, _executor, tasks) = tasks();
        let owner = authority("one");
        let reference = tasks
            .recipe_summaries(&owner, "aarch64-apple-darwin")
            .unwrap()
            .pop()
            .unwrap()
            .reference;
        let now = Instant::now();
        let expired = tasks.prepare_install(&owner, &reference, now).unwrap();
        assert!(matches!(
            tasks.confirm_install(&owner, &expired.review.id, now + MANAGEMENT_REVIEW_TTL),
            Err(ManagedInstallError::ExpiredReview)
        ));
        assert!(matches!(
            tasks.confirm_install(&owner, &expired.review.id, now),
            Err(ManagedInstallError::StaleReview)
        ));

        let review = tasks
            .prepare_install(&owner, &reference, now + MANAGEMENT_REVIEW_TTL)
            .unwrap();
        let work = tasks
            .confirm_install(&owner, &review.review.id, now + MANAGEMENT_REVIEW_TTL)
            .unwrap();
        let operation_id = work.operation_id().to_owned();
        tasks.abandon_install(work).unwrap();
        assert_eq!(
            tasks.cancel_install(&owner, &operation_id),
            Err(ManagedInstallError::NotFound)
        );
    }

    #[test]
    fn dropping_a_registry_revokes_its_unconfirmed_reviews() {
        let (_directory, executor, tasks) = tasks();
        let owner = authority("one");
        let reference = tasks
            .recipe_summaries(&owner, "aarch64-apple-darwin")
            .unwrap()
            .pop()
            .unwrap()
            .reference;
        let now = Instant::now();
        let review = tasks.prepare_install(&owner, &reference, now).unwrap();
        drop(tasks);
        assert!(matches!(
            executor.confirm(&owner, &review.review.id, now),
            Err(ManagedInstallError::StaleReview)
        ));
    }

    #[test]
    fn host_lifecycle_revocation_removes_matching_review_and_work_handles() {
        let (_directory, executor, tasks) = tasks();
        let owner = authority("one");
        let reference = tasks
            .recipe_summaries(&owner, "aarch64-apple-darwin")
            .unwrap()
            .pop()
            .unwrap()
            .reference;
        let now = Instant::now();
        let pending = tasks.prepare_install(&owner, &reference, now).unwrap();
        tasks.revoke_plugin_window(&owner.plugin_id, "one").unwrap();
        assert!(matches!(
            executor.confirm(&owner, &pending.review.id, now),
            Err(ManagedInstallError::StaleReview)
        ));

        let review = tasks.prepare_install(&owner, &reference, now).unwrap();
        let work = tasks
            .confirm_install(&owner, &review.review.id, now)
            .unwrap();
        let operation_id = work.operation_id().to_owned();
        tasks.revoke_window("one").unwrap();
        assert_eq!(
            tasks.cancel_install(&owner, &operation_id),
            Err(ManagedInstallError::NotFound)
        );
        assert_eq!(
            tasks.execute_install_blocking(work),
            Err(ManagedInstallError::NotFound)
        );
        assert_eq!(
            executor.snapshot().unwrap().operations[0].phase,
            ManagedOperationPhase::Cancelled
        );
    }
}
