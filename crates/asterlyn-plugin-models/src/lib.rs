//! Generic, bounded model-job state. No Gradle, server, filesystem, process or UI authority.
//! A native adapter must derive identities from verified packages and the active workspace.
//! Payloads stay outside plugin callbacks; only exact references are exposed by this kernel.
use asterlyn_plugin_dependencies::{DependencyNode, enable_closure, valid_plugin_id};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

pub const MAX_JOBS: usize = 16;
pub const MAX_LEASES: usize = 64;
pub const MAX_ARTIFACT_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_RETAINED_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_JOB_DURATION: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct PackageIdentity {
    pub id: String,
    pub version: String,
    pub archive_digest: String,
    pub content_digest: String,
}
impl PackageIdentity {
    fn validate(&self) -> Result<(), ModelError> {
        if !valid_plugin_id(&self.id)
            || self.version.is_empty()
            || self.version.len() > 64
            || !digest(&self.archive_digest)
            || !digest(&self.content_digest)
        {
            return Err(ModelError::InvalidIdentity);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Scope {
    pub owner: String,
    pub workspace_digest: String,
    pub activation: u64,
}
impl Scope {
    fn validate(&self) -> Result<(), ModelError> {
        if self.owner.is_empty()
            || self.owner.len() > 160
            || self.owner.chars().any(char::is_control)
            || self.activation == 0
            || !digest(&self.workspace_digest)
        {
            return Err(ModelError::InvalidIdentity);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ModelKey {
    pub scope: Scope,
    pub producer: PackageIdentity,
    pub service: String,
    pub schema: u32,
    pub build_root_digest: String,
    pub input_digest: String,
    pub selection_digest: String,
    pub tool_digest: String,
}
impl ModelKey {
    fn validate(&self) -> Result<(), ModelError> {
        self.scope.validate()?;
        self.producer.validate()?;
        if !valid_plugin_id(&self.service)
            || self.schema == 0
            || [
                &self.build_root_digest,
                &self.input_digest,
                &self.selection_digest,
                &self.tool_digest,
            ]
            .iter()
            .any(|value| !digest(value))
        {
            return Err(ModelError::InvalidIdentity);
        }
        Ok(())
    }
    // A new fingerprint or selected variant supersedes this window's previous analysis intent.
    fn same_slot(&self, other: &Self) -> bool {
        self.scope == other.scope
            && self.producer.id == other.producer.id
            && self.service == other.service
            && self.build_root_digest == other.build_root_digest
    }
}

/// A verified, current native snapshot. No field may be sourced from plugin request claims.
pub struct ModelAuthority<'a> {
    pub nodes: &'a [DependencyNode],
    pub packages: &'a [PackageIdentity],
    pub scope: &'a Scope,
    pub services: &'a [ProvidedService],
}
#[derive(Clone, Debug)]
pub struct ProvidedService {
    pub producer: PackageIdentity,
    pub id: String,
    pub schema: u32,
}

/// Native-only grant: never deserialize a grant from a plugin or frontend request.
#[derive(Clone, Debug)]
pub struct ModelGrant {
    consumer: PackageIdentity,
    key: ModelKey,
}
impl ModelGrant {
    /// Call after verifying exact package contents and the provider's declared service/schema.
    /// The authoritative dependency graph is checked again for every lease/read/publish operation.
    pub fn admit(
        authority: &ModelAuthority<'_>,
        consumer: PackageIdentity,
        key: ModelKey,
    ) -> Result<Self, ModelError> {
        consumer.validate()?;
        key.validate()?;
        let grant = Self { consumer, key };
        grant.check(authority)?;
        Ok(grant)
    }
    fn check(&self, authority: &ModelAuthority<'_>) -> Result<(), ModelError> {
        let nodes = authority.nodes;
        if authority.scope != &self.key.scope
            || authority.packages.len() > 64
            || authority.services.len() > 64
            || ![&self.consumer, &self.key.producer]
                .iter()
                .all(|package| authority.packages.contains(package))
            || !authority.services.iter().any(|service| {
                service.producer == self.key.producer
                    && service.id == self.key.service
                    && service.schema == self.key.schema
            })
        {
            return Err(ModelError::Unavailable);
        }
        let closure =
            enable_closure(nodes, &self.consumer.id).map_err(|_| ModelError::Unavailable)?;
        if self.consumer.id == self.key.producer.id
            || !closure.contains(&self.key.producer.id)
            || closure
                .iter()
                .any(|id| !nodes.iter().any(|node| node.id == *id && node.enabled))
            || [&self.consumer, &self.key.producer].iter().any(|package| {
                !nodes.iter().any(|node| {
                    node.id == package.id
                        && node
                            .versions
                            .iter()
                            .any(|version| version == &package.version)
                })
            })
        {
            return Err(ModelError::Unavailable);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ModelError {
    InvalidIdentity,
    Unavailable,
    Limit,
    Stale,
    NotReady,
    Failed,
    Expired,
    ArtifactMismatch,
}

/// A ticket is created only for a new job. Joining clients receive a lease, never a writer ticket.
#[derive(Clone, Debug)]
pub struct WorkTicket {
    id: u64,
    key: ModelKey,
    cancelled: Arc<AtomicBool>,
}
impl WorkTicket {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
    pub fn generation(&self) -> u64 {
        self.id
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelLease {
    id: u64,
    job: u64,
    consumer: PackageIdentity,
}
impl ModelLease {
    pub fn generation(&self) -> u64 {
        self.job
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArtifactRef {
    generation: u64,
    digest: String,
    bytes: u64,
    schema: u32,
}
impl ArtifactRef {
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn digest(&self) -> &str {
        &self.digest
    }
    pub fn bytes(&self) -> u64 {
        self.bytes
    }
    pub fn schema(&self) -> u32 {
        self.schema
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Running,
    Ready(ArtifactRef),
    Failed,
}
pub struct ModelRequest {
    pub lease: ModelLease,
    pub work: Option<WorkTicket>,
    pub status: JobStatus,
    pub retired: Vec<u64>,
}
struct Job {
    key: ModelKey,
    cancelled: Arc<AtomicBool>,
    status: JobStatus,
    deadline: Instant,
}

/// Caller serializes access. This object owns metadata only, not payload buffers or worker threads.
#[derive(Default)]
pub struct ModelBroker {
    sequence: u64,
    jobs: BTreeMap<u64, Job>,
    leases: BTreeMap<u64, ModelLease>,
}
impl ModelBroker {
    fn next(&mut self) -> Result<u64, ModelError> {
        self.sequence = self.sequence.checked_add(1).ok_or(ModelError::Limit)?;
        Ok(self.sequence)
    }
    pub fn request(
        &mut self,
        grant: &ModelGrant,
        authority: &ModelAuthority<'_>,
        now: Instant,
    ) -> Result<ModelRequest, ModelError> {
        grant.check(authority)?;
        if self.sequence > u64::MAX - 2 {
            return Err(ModelError::Limit);
        }
        let mut retired = self.expire(now);
        // Superseding a slot revokes every old lease/reference before accepting a new result.
        retired.extend(self.invalidate(|key| key.same_slot(&grant.key) && key != &grant.key));
        if self.leases.len() >= MAX_LEASES {
            return Err(ModelError::Limit);
        }
        let found = self
            .jobs
            .iter()
            .find(|(_, job)| job.key == grant.key)
            .map(|(id, _)| *id);
        let (job_id, work) = match found {
            Some(id) => (id, None),
            None => {
                if self.jobs.len() >= MAX_JOBS {
                    return Err(ModelError::Limit);
                }
                let id = self.next()?;
                let cancelled = Arc::new(AtomicBool::new(false));
                self.jobs.insert(
                    id,
                    Job {
                        key: grant.key.clone(),
                        cancelled: cancelled.clone(),
                        status: JobStatus::Running,
                        deadline: now + MAX_JOB_DURATION,
                    },
                );
                (
                    id,
                    Some(WorkTicket {
                        id,
                        key: grant.key.clone(),
                        cancelled,
                    }),
                )
            }
        };
        let lease = ModelLease {
            id: self.next()?,
            job: job_id,
            consumer: grant.consumer.clone(),
        };
        self.leases.insert(lease.id, lease.clone());
        Ok(ModelRequest {
            lease,
            work,
            status: self.jobs[&job_id].status.clone(),
            retired,
        })
    }
    fn checked_job(
        &self,
        grant: &ModelGrant,
        authority: &ModelAuthority<'_>,
        lease: &ModelLease,
        now: Instant,
    ) -> Result<&Job, ModelError> {
        grant.check(authority)?;
        if self.leases.get(&lease.id) != Some(lease) || lease.consumer != grant.consumer {
            return Err(ModelError::Stale);
        }
        let job = self.jobs.get(&lease.job).ok_or(ModelError::Stale)?;
        if job.key != grant.key {
            return Err(ModelError::Stale);
        }
        if job.status == JobStatus::Running && job.deadline <= now {
            return Err(ModelError::Expired);
        }
        Ok(job)
    }
    pub fn status(
        &self,
        grant: &ModelGrant,
        authority: &ModelAuthority<'_>,
        lease: &ModelLease,
        now: Instant,
    ) -> Result<JobStatus, ModelError> {
        Ok(self
            .checked_job(grant, authority, lease, now)?
            .status
            .clone())
    }
    /// Adapter streams a bounded file, computes its digest, seals it, then commits this metadata.
    /// Never accept a digest or file path merely asserted by an isolated plugin.
    pub fn publish(
        &mut self,
        grant: &ModelGrant,
        authority: &ModelAuthority<'_>,
        ticket: &WorkTicket,
        artifact_digest: String,
        bytes: u64,
        now: Instant,
    ) -> Result<ArtifactRef, ModelError> {
        grant.check(authority)?;
        if bytes == 0 || bytes > MAX_ARTIFACT_BYTES || !digest(&artifact_digest) {
            return Err(ModelError::Limit);
        }
        let retained: u64 = self
            .jobs
            .values()
            .filter_map(|job| match &job.status {
                JobStatus::Ready(value) => Some(value.bytes),
                _ => None,
            })
            .sum();
        if retained + bytes > MAX_RETAINED_BYTES {
            return Err(ModelError::Limit);
        }
        let job = self.jobs.get_mut(&ticket.id).ok_or(ModelError::Stale)?;
        if job.key != grant.key
            || job.key != ticket.key
            || ticket.is_cancelled()
            || !Arc::ptr_eq(&ticket.cancelled, &job.cancelled)
        {
            return Err(ModelError::Stale);
        }
        if now >= job.deadline {
            return Err(ModelError::Expired);
        }
        if job.status != JobStatus::Running {
            return Err(ModelError::Stale);
        }
        let reference = ArtifactRef {
            generation: ticket.id,
            digest: artifact_digest,
            bytes,
            schema: job.key.schema,
        };
        job.status = JobStatus::Ready(reference.clone());
        Ok(reference)
    }
    /// Resolves identity only. The adapter verifies the sealed file's size/digest before use.
    pub fn resolve(
        &self,
        grant: &ModelGrant,
        authority: &ModelAuthority<'_>,
        lease: &ModelLease,
        reference: &ArtifactRef,
        now: Instant,
    ) -> Result<(), ModelError> {
        match &self.checked_job(grant, authority, lease, now)?.status {
            JobStatus::Ready(current) if current == reference => Ok(()),
            JobStatus::Ready(_) => Err(ModelError::ArtifactMismatch),
            JobStatus::Running => Err(ModelError::NotReady),
            JobStatus::Failed => Err(ModelError::Failed),
        }
    }
    pub fn fail(&mut self, ticket: &WorkTicket) -> Result<(), ModelError> {
        let job = self.jobs.get_mut(&ticket.id).ok_or(ModelError::Stale)?;
        if job.key != ticket.key
            || !Arc::ptr_eq(&ticket.cancelled, &job.cancelled)
            || job.status != JobStatus::Running
        {
            return Err(ModelError::Stale);
        }
        job.cancelled.store(true, Ordering::SeqCst);
        job.status = JobStatus::Failed;
        Ok(())
    }
    /// Cancelling one consumer cannot interrupt another consumer's shared work.
    pub fn release(&mut self, lease: &ModelLease) -> Result<Option<u64>, ModelError> {
        if self.leases.get(&lease.id) != Some(lease) {
            return Err(ModelError::Stale);
        }
        self.leases.remove(&lease.id);
        if !self.leases.values().any(|other| other.job == lease.job) {
            self.remove(lease.job);
            return Ok(Some(lease.job));
        }
        Ok(None)
    }
    fn remove(&mut self, id: u64) {
        if let Some(job) = self.jobs.remove(&id) {
            job.cancelled.store(true, Ordering::SeqCst);
        }
        self.leases.retain(|_, lease| lease.job != id);
    }
    /// Native lifecycle uses this on workspace/input/selection/package replacement or disable.
    /// Returns artifact generations for adapter-owned file cleanup; running workers see cancellation.
    pub fn invalidate(&mut self, predicate: impl Fn(&ModelKey) -> bool) -> Vec<u64> {
        let ids: Vec<_> = self
            .jobs
            .iter()
            .filter(|(_, job)| predicate(&job.key))
            .map(|(id, _)| *id)
            .collect();
        for id in &ids {
            self.remove(*id);
        }
        ids
    }
    pub fn expire(&mut self, now: Instant) -> Vec<u64> {
        let ids: Vec<_> = self
            .jobs
            .iter()
            .filter(|(_, job)| !matches!(job.status, JobStatus::Ready(_)) && job.deadline <= now)
            .map(|(id, _)| *id)
            .collect();
        for id in &ids {
            self.remove(*id);
        }
        ids
    }
    /// Background work belongs to all current leases, not the first waiting consumer.
    pub fn has_authorized_leases(
        &self,
        authority: &ModelAuthority<'_>,
        ticket: &WorkTicket,
    ) -> bool {
        !ticket.is_cancelled()
            && self.leases.values().any(|lease| {
                lease.job == ticket.id
                    && ModelGrant {
                        consumer: lease.consumer.clone(),
                        key: ticket.key.clone(),
                    }
                    .check(authority)
                    .is_ok()
            })
    }
    pub fn publish_for_leases(
        &mut self,
        authority: &ModelAuthority<'_>,
        ticket: &WorkTicket,
        digest: String,
        bytes: u64,
        now: Instant,
    ) -> Result<ArtifactRef, ModelError> {
        let grant = self
            .leases
            .values()
            .filter(|lease| lease.job == ticket.id)
            .map(|lease| ModelGrant {
                consumer: lease.consumer.clone(),
                key: ticket.key.clone(),
            })
            .find(|grant| grant.check(authority).is_ok())
            .ok_or(ModelError::Unavailable)?;
        self.publish(&grant, authority, ticket, digest, bytes, now)
    }
    pub fn lease_is_current(&self, lease: &ModelLease) -> bool {
        self.leases.get(&lease.id) == Some(lease) && self.jobs.contains_key(&lease.job)
    }
    pub fn retained_jobs(&self) -> usize {
        self.jobs.len()
    }
}
impl Drop for ModelBroker {
    fn drop(&mut self) {
        self.invalidate(|_| true);
    }
}

pub fn content_digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}
fn digest(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value.as_bytes()[7..]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

#[cfg(test)]
mod tests;
