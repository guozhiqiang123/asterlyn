use super::{
    model::{digest, opaque, version},
    *,
};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

pub const MANAGEMENT_REVIEW_TTL: Duration = Duration::from_secs(5 * 60);

/// Constructed by the native admission boundary, never deserialized from plugin/renderer input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagementAuthority {
    pub window_id: String,
    pub activation: u64,
    pub plugin_id: String,
    pub plugin_version: String,
    pub package_digest: String,
    pub enabled: bool,
    pub may_manage: bool,
}

impl ManagementAuthority {
    fn validate(&self, server: &ManagedServerId) -> Result<(), ManagedInstallError> {
        server.validate()?;
        if !self.enabled || !self.may_manage || self.plugin_id != server.plugin_id {
            return Err(ManagedInstallError::PermissionDenied);
        }
        if !opaque(&self.window_id, 128)
            || self.activation == 0
            || self.activation > MAX_SAFE_INTEGER
            || !version(&self.plugin_version)
            || !digest(&self.package_digest)
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        Ok(())
    }
}

/// Resolved by a native recipe adapter. There is intentionally no client-provided URL or path.
#[derive(Debug, Clone)]
pub struct ManagedInstallPlan {
    pub artifact: ManagedArtifact,
    pub download_bytes: u64,
    pub expanded_bytes: u64,
}

impl ManagedInstallPlan {
    fn validate(&self) -> Result<(), ManagedInstallError> {
        self.artifact.validate()?;
        if self.download_bytes == 0
            || self.download_bytes > MAX_DOWNLOAD_BYTES
            || self.expanded_bytes == 0
            || self.expanded_bytes > MAX_EXPANDED_BYTES
        {
            return Err(ManagedInstallError::ResourceLimit);
        }
        Ok(())
    }
}

/// Verifies the exact admitted recipe, inventory and bytes; implementations own safe path access.
pub trait ManagedArtifactVerifier {
    fn verify(&mut self, artifact: &ManagedArtifact) -> Result<(), ManagedInstallError>;
}

/// Sealed native proof; verification may run off the state-owner lock. Never serializable.
pub struct VerifiedManagedArtifact {
    identity: ManagedArtifact,
}
pub fn verify_managed_artifact(
    artifact: &ManagedArtifact,
    verifier: &mut impl ManagedArtifactVerifier,
) -> Result<VerifiedManagedArtifact, ManagedInstallError> {
    artifact.validate()?;
    verifier.verify(artifact)?;
    Ok(VerifiedManagedArtifact {
        identity: artifact.clone(),
    })
}

/// Native storage must implement durable compare-and-swap, not merely write a JSON file.
/// Install publishes verified immutable content before the index. Removal isolates old content
/// in a unique tombstone so deferred cleanup cannot delete a subsequent installation of that ID.
/// Errors leave the prior index authoritative; uncertain commits MUST return StateChanged.
pub trait ManagedInstallationStorage {
    fn commit_install(
        &mut self,
        expected_revision: u64,
        next: &ManagedInstallationIndex,
        artifact: &ManagedArtifact,
    ) -> Result<(), ManagedInstallError>;
    fn commit_removal(
        &mut self,
        expected_revision: u64,
        next: &ManagedInstallationIndex,
        artifact: &ManagedInstalledArtifact,
    ) -> Result<(), ManagedInstallError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedUseScope {
    pub window_id: String,
    pub workspace_digest: String,
    pub session_id: String,
}

/// Native-only resource lease. Acquiring it is NOT permission to start a language server.
#[derive(Debug)]
pub struct ManagedUseLease {
    id: String,
    identity: Arc<()>,
}

#[derive(Debug, Clone)]
pub struct ManagedOperationTicket {
    id: String,
    cancelled: Arc<AtomicBool>,
}
impl ManagedOperationTicket {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone)]
pub struct ManagedInstallReview {
    pub id: String,
    pub kind: ManagedOperationKind,
    pub artifact: ManagedArtifact,
    pub index_revision: u64,
    pub download_bytes: u64,
    pub expanded_bytes: u64,
    pub uses: Vec<ManagedUseScope>,
}

struct Review {
    public: ManagedInstallReview,
    authority: ManagementAuthority,
    deadline: Instant,
}
struct Job {
    authority: ManagementAuthority,
    artifact: ManagedArtifact,
    state: ManagedInstallOperation,
    cancelled: Arc<AtomicBool>,
}
struct Use {
    artifact_id: String,
    scope: ManagedUseScope,
    identity: Arc<()>,
}

/// One instance per native host, shared by windows. Adapters serialize fresh authority with calls.
pub struct ManagedInstallationCoordinator {
    epoch: String,
    revision: u64,
    sequence: u64,
    index: ManagedInstallationIndex,
    storage_current: bool,
    verified: BTreeSet<String>,
    reviews: BTreeMap<String, Review>,
    jobs: BTreeMap<String, Job>,
    finished: VecDeque<String>,
    uses: BTreeMap<String, Use>,
}

impl ManagedInstallationCoordinator {
    pub fn restore(
        epoch: String,
        index: ManagedInstallationIndex,
    ) -> Result<Self, ManagedInstallError> {
        if !opaque(&epoch, 64) {
            return Err(ManagedInstallError::InvalidRequest);
        }
        index.validate()?;
        Ok(Self {
            epoch,
            revision: 0,
            sequence: 0,
            index,
            storage_current: true,
            verified: BTreeSet::new(),
            reviews: BTreeMap::new(),
            jobs: BTreeMap::new(),
            finished: VecDeque::new(),
            uses: BTreeMap::new(),
        })
    }

    pub fn snapshot(&self) -> Result<ManagedInstallationSnapshot, ManagedInstallError> {
        self.current()?;
        Ok(ManagedInstallationSnapshot {
            protocol_version: 1,
            epoch: self.epoch.clone(),
            revision: self.revision,
            index_revision: self.index.revision,
            artifacts: self
                .index
                .artifacts
                .iter()
                .map(|artifact| ManagedArtifactStatus {
                    verification: if self.verified.contains(&artifact.id) {
                        ManagedArtifactVerification::Verified
                    } else {
                        ManagedArtifactVerification::Required
                    },
                    use_count: self.use_count(&artifact.id) as u32,
                    artifact: artifact.clone(),
                })
                .collect(),
            selections: self.index.selections.clone(),
            operations: self.jobs.values().map(|job| job.state.clone()).collect(),
        })
    }

    pub fn prepare_install(
        &mut self,
        authority: &ManagementAuthority,
        plan: ManagedInstallPlan,
        now: Instant,
    ) -> Result<ManagedInstallReview, ManagedInstallError> {
        self.current()?;
        plan.validate()?;
        authority.validate(&plan.artifact.server)?;
        self.available(&plan.artifact.server)?;
        if self
            .index
            .artifacts
            .iter()
            .any(|artifact| artifact.id == plan.artifact.id())
        {
            return Err(ManagedInstallError::StateChanged);
        }
        if self.index.artifacts.len() >= MAX_ARTIFACTS {
            return Err(ManagedInstallError::ResourceLimit);
        }
        self.prepare(authority, plan, ManagedOperationKind::Install, now)
    }

    pub fn prepare_remove(
        &mut self,
        authority: &ManagementAuthority,
        artifact_id: &str,
        now: Instant,
    ) -> Result<ManagedInstallReview, ManagedInstallError> {
        self.current()?;
        let artifact = self.removable(artifact_id)?.identity.clone();
        authority.validate(&artifact.server)?;
        self.available(&artifact.server)?;
        self.prepare(
            authority,
            ManagedInstallPlan {
                artifact,
                download_bytes: 0,
                expanded_bytes: 0,
            },
            ManagedOperationKind::Remove,
            now,
        )
    }

    fn prepare(
        &mut self,
        authority: &ManagementAuthority,
        plan: ManagedInstallPlan,
        kind: ManagedOperationKind,
        now: Instant,
    ) -> Result<ManagedInstallReview, ManagedInstallError> {
        let ManagedInstallPlan {
            artifact,
            download_bytes,
            expanded_bytes,
        } = plan;
        self.reviews.retain(|_, review| review.deadline > now);
        if self.reviews.len() >= MAX_REVIEWS {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let id = self.fresh_id()?;
        let artifact_id = artifact.id();
        let public = ManagedInstallReview {
            id: id.clone(),
            kind,
            artifact,
            index_revision: self.index.revision,
            download_bytes,
            expanded_bytes,
            uses: self
                .uses
                .values()
                .filter(|usage| usage.artifact_id == artifact_id)
                .map(|usage| usage.scope.clone())
                .collect(),
        };
        self.reviews.insert(
            id,
            Review {
                public: public.clone(),
                authority: authority.clone(),
                deadline: now + MANAGEMENT_REVIEW_TTL,
            },
        );
        Ok(public)
    }

    /// Called only by the host-reviewed confirmation path, never by a plugin self-approval callback.
    pub fn confirm(
        &mut self,
        authority: &ManagementAuthority,
        review_id: &str,
        now: Instant,
    ) -> Result<ManagedOperationTicket, ManagedInstallError> {
        self.current()?;
        let review = self
            .reviews
            .get(review_id)
            .ok_or(ManagedInstallError::StaleReview)?;
        authority.validate(&review.public.artifact.server)?;
        if &review.authority != authority {
            return Err(ManagedInstallError::StaleReview);
        }
        if now >= review.deadline {
            self.reviews.remove(review_id);
            return Err(ManagedInstallError::ExpiredReview);
        }
        if review.public.index_revision != self.index.revision {
            self.reviews.remove(review_id);
            return Err(ManagedInstallError::StaleReview);
        }
        self.available(&review.public.artifact.server)?;
        if self
            .jobs
            .values()
            .filter(|job| !job.state.phase.terminal())
            .count()
            >= MAX_OPERATIONS
        {
            return Err(ManagedInstallError::ResourceLimit);
        }
        if review.public.kind == ManagedOperationKind::Remove {
            let id = review.public.artifact.id();
            self.removable(&id)?;
            let uses = self
                .uses
                .values()
                .filter(|usage| usage.artifact_id == id)
                .map(|usage| usage.scope.clone())
                .collect::<Vec<_>>();
            if uses != review.public.uses {
                return Err(ManagedInstallError::StaleReview);
            }
        }
        if review.public.kind == ManagedOperationKind::Install
            && self.index.artifacts.len() >= MAX_ARTIFACTS
        {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let revision = self.next_revision()?;
        let id = self.fresh_id()?;
        let review = self.reviews.remove(review_id).expect("review checked");
        let cancelled = Arc::new(AtomicBool::new(false));
        let state = ManagedInstallOperation {
            id: id.clone(),
            server: review.public.artifact.server.clone(),
            artifact_id: review.public.artifact.id(),
            kind: review.public.kind,
            phase: if review.public.kind == ManagedOperationKind::Install {
                ManagedOperationPhase::Acquiring
            } else {
                ManagedOperationPhase::WaitingForUses
            },
            completed_bytes: 0,
            total_bytes: review.public.download_bytes,
            failure: None,
        };
        self.jobs.insert(
            id.clone(),
            Job {
                authority: authority.clone(),
                artifact: review.public.artifact,
                state,
                cancelled: cancelled.clone(),
            },
        );
        self.revision = revision;
        Ok(ManagedOperationTicket { id, cancelled })
    }

    pub fn progress(
        &mut self,
        ticket: &ManagedOperationTicket,
        completed_bytes: u64,
    ) -> Result<(), ManagedInstallError> {
        self.current()?;
        let job = self.job(ticket)?;
        if job.state.phase != ManagedOperationPhase::Acquiring
            || completed_bytes < job.state.completed_bytes
            || completed_bytes > job.state.total_bytes
        {
            return Err(ManagedInstallError::InvalidTransition);
        }
        let revision = self.next_revision()?;
        self.jobs
            .get_mut(&ticket.id)
            .expect("job checked")
            .state
            .completed_bytes = completed_bytes;
        self.revision = revision;
        Ok(())
    }

    pub fn begin_verification(
        &mut self,
        ticket: &ManagedOperationTicket,
    ) -> Result<(), ManagedInstallError> {
        self.current()?;
        let job = self.job(ticket)?;
        if job.state.phase != ManagedOperationPhase::Acquiring
            || job.state.completed_bytes != job.state.total_bytes
        {
            return Err(ManagedInstallError::InvalidTransition);
        }
        let revision = self.next_revision()?;
        self.jobs
            .get_mut(&ticket.id)
            .expect("job checked")
            .state
            .phase = ManagedOperationPhase::Verifying;
        self.revision = revision;
        Ok(())
    }

    pub fn complete_install(
        &mut self,
        authority: &ManagementAuthority,
        ticket: &ManagedOperationTicket,
        verified: &VerifiedManagedArtifact,
        storage: &mut impl ManagedInstallationStorage,
    ) -> Result<(), ManagedInstallError> {
        self.current()?;
        self.check_job_authority(authority, ticket)?;
        let job = self.job(ticket)?;
        if job.state.kind != ManagedOperationKind::Install
            || job.state.phase != ManagedOperationPhase::Verifying
        {
            return Err(ManagedInstallError::InvalidTransition);
        }
        let artifact = job.artifact.clone();
        let revision = self.next_revision()?;
        if verified.identity != artifact {
            self.fail_internal(ticket, ManagedInstallError::IntegrityMismatch, revision);
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        let mut next = self.index.clone();
        next.revision = next
            .revision
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE_INTEGER)
            .ok_or_else(|| {
                self.fail_internal(ticket, ManagedInstallError::ResourceLimit, revision);
                ManagedInstallError::ResourceLimit
            })?;
        next.artifacts.push(ManagedInstalledArtifact {
            id: artifact.id(),
            identity: artifact.clone(),
            ownership: ManagedArtifactOwnership::Managed,
        });
        if let Some(selection) = next
            .selections
            .iter_mut()
            .find(|selection| selection.server == artifact.server)
        {
            if let Some(current) = selection.current.take() {
                selection.rollback = Some(current);
            }
            selection.current = Some(artifact.id());
        } else {
            next.selections.push(ManagedServerSelection {
                server: artifact.server.clone(),
                current: Some(artifact.id()),
                rollback: None,
            });
        }
        if let Err(error) = next.validate() {
            self.fail_internal(ticket, error, revision);
            return Err(error);
        }
        self.jobs
            .get_mut(&ticket.id)
            .expect("job checked")
            .state
            .phase = ManagedOperationPhase::Committing;
        if let Err(error) = storage.commit_install(self.index.revision, &next, &artifact) {
            self.fail_internal(ticket, error, revision);
            return Err(error);
        }
        self.index = next;
        self.verified.insert(artifact.id());
        self.finish(ticket, ManagedOperationPhase::Completed, None, revision);
        Ok(())
    }

    /// Storage isolates content before success; no deferred cleanup may address its old path.
    pub fn complete_remove(
        &mut self,
        authority: &ManagementAuthority,
        ticket: &ManagedOperationTicket,
        storage: &mut impl ManagedInstallationStorage,
    ) -> Result<(), ManagedInstallError> {
        self.current()?;
        self.check_job_authority(authority, ticket)?;
        let job = self.job(ticket)?;
        if job.state.kind != ManagedOperationKind::Remove
            || job.state.phase != ManagedOperationPhase::WaitingForUses
        {
            return Err(ManagedInstallError::InvalidTransition);
        }
        let id = job.state.artifact_id.clone();
        let artifact = self.removable(&id)?.clone();
        if self.use_count(&id) != 0 {
            return Err(ManagedInstallError::InUse);
        }
        let revision = self.next_revision()?;
        let mut next = self.index.clone();
        next.revision = next
            .revision
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE_INTEGER)
            .ok_or_else(|| {
                self.fail_internal(ticket, ManagedInstallError::ResourceLimit, revision);
                ManagedInstallError::ResourceLimit
            })?;
        next.artifacts.retain(|artifact| artifact.id != id);
        for selection in &mut next.selections {
            if selection.current.as_deref() == Some(&id) {
                selection.current = None;
            }
        }
        next.selections
            .retain(|selection| selection.current.is_some() || selection.rollback.is_some());
        next.validate()?;
        self.jobs
            .get_mut(&ticket.id)
            .expect("job checked")
            .state
            .phase = ManagedOperationPhase::Committing;
        if let Err(error) = storage.commit_removal(self.index.revision, &next, &artifact) {
            self.fail_internal(ticket, error, revision);
            return Err(error);
        }
        self.index = next;
        self.verified.remove(&id);
        self.finish(ticket, ManagedOperationPhase::Completed, None, revision);
        Ok(())
    }

    pub fn cancel(
        &mut self,
        authority: &ManagementAuthority,
        ticket: &ManagedOperationTicket,
    ) -> Result<(), ManagedInstallError> {
        self.check_job_authority(authority, ticket)?;
        let revision = self.next_revision()?;
        self.finish(ticket, ManagedOperationPhase::Cancelled, None, revision);
        Ok(())
    }

    pub fn fail(
        &mut self,
        ticket: &ManagedOperationTicket,
        error: ManagedInstallError,
    ) -> Result<(), ManagedInstallError> {
        self.job(ticket)?;
        let revision = self.next_revision()?;
        self.fail_internal(ticket, error, revision);
        Ok(())
    }

    /// Disable/update closes old work. Resource uses survive until the actual process owner releases.
    pub fn reconcile_authority(
        &mut self,
        authority: &ManagementAuthority,
    ) -> Result<(), ManagedInstallError> {
        let revision = self.next_revision()?;
        let applies = |old: &ManagementAuthority| {
            old.plugin_id == authority.plugin_id && old.window_id == authority.window_id
        };
        self.reviews.retain(|_, review| {
            !applies(&review.authority)
                || &review.authority == authority && authority.enabled && authority.may_manage
        });
        let tickets = self
            .jobs
            .iter()
            .filter(|(_, job)| {
                !job.state.phase.terminal()
                    && applies(&job.authority)
                    && (&job.authority != authority || !authority.enabled || !authority.may_manage)
            })
            .map(|(id, job)| ManagedOperationTicket {
                id: id.clone(),
                cancelled: job.cancelled.clone(),
            })
            .collect::<Vec<_>>();
        for ticket in tickets {
            self.finish(&ticket, ManagedOperationPhase::Cancelled, None, revision);
        }
        self.revision = revision;
        Ok(())
    }

    pub fn verify_existing(
        &mut self,
        id: &str,
        verified: &VerifiedManagedArtifact,
    ) -> Result<(), ManagedInstallError> {
        self.current()?;
        let artifact = self
            .index
            .artifacts
            .iter()
            .find(|artifact| artifact.id == id)
            .ok_or(ManagedInstallError::NotFound)?;
        self.available(&artifact.identity.server)?;
        let revision = self.next_revision()?;
        let result = if artifact.identity == verified.identity {
            Ok(())
        } else {
            Err(ManagedInstallError::IntegrityMismatch)
        };
        if result.is_ok() {
            self.verified.insert(id.into());
        } else {
            self.verified.remove(id);
        }
        self.revision = revision;
        result
    }

    pub fn invalidate_artifact(&mut self, id: &str) -> Result<(), ManagedInstallError> {
        if !self
            .index
            .artifacts
            .iter()
            .any(|artifact| artifact.id == id)
        {
            return Err(ManagedInstallError::NotFound);
        }
        let revision = self.next_revision()?;
        self.verified.remove(id);
        self.revision = revision;
        Ok(())
    }

    pub fn acquire_use(
        &mut self,
        id: &str,
        scope: ManagedUseScope,
    ) -> Result<ManagedUseLease, ManagedInstallError> {
        self.current()?;
        if !opaque(&scope.window_id, 128)
            || !digest(&scope.workspace_digest)
            || !opaque(&scope.session_id, 128)
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        let artifact = self
            .index
            .artifacts
            .iter()
            .find(|artifact| artifact.id == id)
            .ok_or(ManagedInstallError::NotFound)?;
        if !self.verified.contains(id) {
            return Err(ManagedInstallError::Unverified);
        }
        if self.jobs.values().any(|job| {
            !job.state.phase.terminal()
                && job.state.kind == ManagedOperationKind::Remove
                && job.artifact.server == artifact.identity.server
        }) {
            return Err(ManagedInstallError::Busy);
        }
        if self.uses.len() >= MAX_USES {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let revision = self.next_revision()?;
        let lease_id = self.fresh_id()?;
        let identity = Arc::new(());
        self.uses.insert(
            lease_id.clone(),
            Use {
                artifact_id: id.into(),
                scope,
                identity: identity.clone(),
            },
        );
        self.revision = revision;
        Ok(ManagedUseLease {
            id: lease_id,
            identity,
        })
    }

    pub fn release_use(&mut self, lease: &ManagedUseLease) -> Result<(), ManagedInstallError> {
        let usage = self
            .uses
            .get(&lease.id)
            .ok_or(ManagedInstallError::NotFound)?;
        if !Arc::ptr_eq(&usage.identity, &lease.identity) {
            return Err(ManagedInstallError::PermissionDenied);
        }
        let revision = self.next_revision()?;
        self.uses.remove(&lease.id);
        self.revision = revision;
        Ok(())
    }

    fn current(&self) -> Result<(), ManagedInstallError> {
        if self.storage_current {
            Ok(())
        } else {
            Err(ManagedInstallError::StateChanged)
        }
    }
    fn next_revision(&self) -> Result<u64, ManagedInstallError> {
        self.revision
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(ManagedInstallError::ResourceLimit)
    }
    fn fresh_id(&mut self) -> Result<String, ManagedInstallError> {
        self.sequence = self
            .sequence
            .checked_add(1)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or(ManagedInstallError::ResourceLimit)?;
        Ok(format!("{}-{}", self.epoch, self.sequence))
    }
    fn available(&self, server: &ManagedServerId) -> Result<(), ManagedInstallError> {
        if self
            .jobs
            .values()
            .any(|job| !job.state.phase.terminal() && &job.artifact.server == server)
        {
            Err(ManagedInstallError::Busy)
        } else {
            Ok(())
        }
    }
    fn use_count(&self, id: &str) -> usize {
        self.uses
            .values()
            .filter(|usage| usage.artifact_id == id)
            .count()
    }
    fn removable(&self, id: &str) -> Result<&ManagedInstalledArtifact, ManagedInstallError> {
        let artifact = self
            .index
            .artifacts
            .iter()
            .find(|artifact| artifact.id == id)
            .ok_or(ManagedInstallError::NotFound)?;
        if artifact.ownership == ManagedArtifactOwnership::External {
            return Err(ManagedInstallError::ExternalArtifact);
        }
        if self
            .index
            .selections
            .iter()
            .any(|selection| selection.rollback.as_deref() == Some(id))
        {
            return Err(ManagedInstallError::ProtectedArtifact);
        }
        Ok(artifact)
    }
    fn job(&self, ticket: &ManagedOperationTicket) -> Result<&Job, ManagedInstallError> {
        let job = self
            .jobs
            .get(&ticket.id)
            .ok_or(ManagedInstallError::NotFound)?;
        if !Arc::ptr_eq(&ticket.cancelled, &job.cancelled) {
            return Err(ManagedInstallError::PermissionDenied);
        }
        if ticket.is_cancelled() {
            return Err(ManagedInstallError::Cancelled);
        }
        if job.state.phase.terminal() {
            return Err(ManagedInstallError::InvalidTransition);
        }
        Ok(job)
    }
    fn check_job_authority(
        &mut self,
        authority: &ManagementAuthority,
        ticket: &ManagedOperationTicket,
    ) -> Result<(), ManagedInstallError> {
        let job = self.job(ticket)?;
        authority.validate(&job.artifact.server)?;
        if &job.authority != authority {
            return Err(ManagedInstallError::StaleReview);
        }
        Ok(())
    }
    fn fail_internal(
        &mut self,
        ticket: &ManagedOperationTicket,
        error: ManagedInstallError,
        revision: u64,
    ) {
        self.finish(ticket, ManagedOperationPhase::Failed, Some(error), revision);
        if error == ManagedInstallError::StateChanged {
            self.storage_current = false;
            self.reviews.clear();
            for job in self.jobs.values() {
                if !job.state.phase.terminal() {
                    job.cancelled.store(true, Ordering::Release);
                }
            }
        }
    }
    fn finish(
        &mut self,
        ticket: &ManagedOperationTicket,
        phase: ManagedOperationPhase,
        failure: Option<ManagedInstallError>,
        revision: u64,
    ) {
        let job = self.jobs.get_mut(&ticket.id).expect("job checked");
        job.state.phase = phase;
        job.state.failure = failure;
        if phase != ManagedOperationPhase::Completed {
            job.cancelled.store(true, Ordering::Release);
        }
        self.finished.push_back(ticket.id.clone());
        while self.finished.len() > MAX_FINISHED_OPERATIONS {
            if let Some(old) = self.finished.pop_front() {
                self.jobs.remove(&old);
            }
        }
        self.revision = revision;
    }
}
