//! Native adapter for admitted analysis programs. The model kernel remains I/O-free.
pub mod components;
mod worker;
use asterlyn_plugin_dependencies::DependencyNode;
use asterlyn_plugin_models::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, Weak},
    time::{Duration, Instant},
};
pub use worker::{AdmittedProgram, Progress};

#[derive(Clone)]
pub struct AuthoritySnapshot {
    pub nodes: Vec<DependencyNode>,
    pub packages: Vec<PackageIdentity>,
    pub scope: Scope,
    pub services: Vec<ProvidedService>,
}
impl AuthoritySnapshot {
    pub fn view(&self) -> ModelAuthority<'_> {
        ModelAuthority {
            nodes: &self.nodes,
            packages: &self.packages,
            scope: &self.scope,
            services: &self.services,
        }
    }
}
pub type AuthorityReader = Arc<dyn Fn() -> Result<AuthoritySnapshot, String> + Send + Sync>;
pub type Allowed = Arc<dyn Fn() -> bool + Send + Sync>;
pub type ProgressSink = Arc<dyn Fn(Progress) + Send + Sync>;

pub struct SealedArtifact {
    file: tempfile::NamedTempFile,
    digest: String,
    bytes: u64,
    _reservation: worker::Reservation,
}
impl SealedArtifact {
    pub fn path(&self) -> &Path {
        self.file.path()
    }
    pub fn digest(&self) -> &str {
        &self.digest
    }
    pub fn bytes(&self) -> u64 {
        self.bytes
    }
    /// Rehash immediately before handing an artifact to a consumer, not merely its claimed name.
    pub fn verify(&self) -> Result<(), String> {
        worker::verify_artifact(self)
    }
}
type Outcome = Result<Arc<SealedArtifact>, String>;
struct Job {
    result: Mutex<Option<Outcome>>,
    changed: Condvar,
}
struct State {
    broker: ModelBroker,
    jobs: BTreeMap<u64, Arc<Job>>,
}
struct Inner {
    state: Mutex<State>,
    directory: tempfile::TempDir,
    budget: Arc<std::sync::atomic::AtomicU64>,
    processes: Arc<Mutex<BTreeSet<u32>>>,
}

pub struct AnalysisRuntime {
    inner: Arc<Inner>,
}
pub struct ModelHandle {
    pub reference: ArtifactRef,
    pub artifact: Arc<SealedArtifact>,
    _lease: LeaseGuard,
    authority: AuthorityReader,
    grant: ModelGrant,
}
struct LeaseGuard {
    lease: ModelLease,
    inner: Weak<Inner>,
}
impl ModelHandle {
    pub fn is_current(&self) -> bool {
        let Ok(snapshot) = (self.authority)() else {
            return false;
        };
        self._lease.inner.upgrade().is_some_and(|inner| {
            inner.state.lock().is_ok_and(|state| {
                state
                    .broker
                    .resolve(
                        &self.grant,
                        &snapshot.view(),
                        &self._lease.lease,
                        &self.reference,
                        Instant::now(),
                    )
                    .is_ok()
            })
        })
    }
}
impl Drop for LeaseGuard {
    fn drop(&mut self) {
        release(&self.inner, &self.lease);
    }
}
fn release(inner: &Weak<Inner>, lease: &ModelLease) {
    if let Some(inner) = inner.upgrade()
        && let Ok(mut state) = inner.state.lock()
        && let Ok(Some(id)) = state.broker.release(lease)
    {
        state.jobs.remove(&id);
    }
}

impl AnalysisRuntime {
    pub fn new(cache_parent: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(cache_parent).map_err(|_| "analysis cache is unavailable")?;
        let directory = tempfile::Builder::new()
            .prefix("analysis-")
            .tempdir_in(cache_parent)
            .map_err(|_| "cannot create private analysis cache")?;
        Ok(Self {
            inner: Arc::new(Inner {
                state: Mutex::new(State {
                    broker: ModelBroker::default(),
                    jobs: BTreeMap::new(),
                }),
                directory,
                budget: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                processes: Arc::new(Mutex::new(BTreeSet::new())),
            }),
        })
    }
    /// Blocks only the native caller, never a JS callback. Matching requests share one worker.
    pub fn acquire(
        &self,
        grant: ModelGrant,
        program: AdmittedProgram,
        authority: AuthorityReader,
        allowed: Allowed,
        progress: ProgressSink,
    ) -> Result<ModelHandle, String> {
        if !allowed() {
            return Err("analysis authority was revoked".into());
        }
        let snapshot = authority()?;
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| "analysis state lock unavailable")?;
        let mut request = state
            .broker
            .request(&grant, &snapshot.view(), Instant::now())
            .map_err(model_error)?;
        for id in &request.retired {
            state.jobs.remove(id);
        }
        // The lease belongs to its job; a joined running request resolves it through the private map.
        let job = if let Some(ticket) = request.work.take() {
            let job = Arc::new(Job {
                result: Mutex::new(None),
                changed: Condvar::new(),
            });
            state.jobs.insert(ticket.generation(), job.clone());
            let weak = Arc::downgrade(&self.inner);
            let result_job = job.clone();
            let cache = self.inner.directory.path().to_path_buf();
            let budget = self.inner.budget.clone();
            let processes = self.inner.processes.clone();
            let current = authority.clone();
            let permitted_authority = authority.clone();
            let permitted_inner = weak.clone();
            let permitted_ticket = ticket.clone();
            let permitted: Allowed = Arc::new(move || {
                let Ok(snapshot) = permitted_authority() else {
                    return false;
                };
                let Some(inner) = permitted_inner.upgrade() else {
                    return false;
                };
                inner.state.lock().is_ok_and(|state| {
                    state
                        .broker
                        .has_authorized_leases(&snapshot.view(), &permitted_ticket)
                })
            });
            let spawned = std::thread::Builder::new()
                .name("plugin-model-worker".into())
                .spawn(move || {
                    let outcome = worker::run(
                        program,
                        &cache,
                        &ticket,
                        permitted.clone(),
                        progress,
                        budget,
                        processes,
                    )
                    .and_then(|artifact| {
                        if !permitted() {
                            return Err("analysis authority was revoked".into());
                        }
                        let snapshot = current()?;
                        let inner = weak.upgrade().ok_or("analysis runtime ended")?;
                        let mut state = inner
                            .state
                            .lock()
                            .map_err(|_| "analysis state lock unavailable")?;
                        state
                            .broker
                            .publish_for_leases(
                                &snapshot.view(),
                                &ticket,
                                artifact.digest.clone(),
                                artifact.bytes,
                                Instant::now(),
                            )
                            .map_err(model_error)?;
                        Ok(Arc::new(artifact))
                    });
                    if outcome.is_err()
                        && let Some(inner) = weak.upgrade()
                        && let Ok(mut state) = inner.state.lock()
                    {
                        let _ = state.broker.fail(&ticket);
                    }
                    if let Ok(mut result) = result_job.result.lock() {
                        *result = Some(outcome);
                        result_job.changed.notify_all();
                    }
                });
            if spawned.is_err() {
                let _ = state.broker.release(&request.lease);
                state.jobs.remove(&request.lease.generation());
                return Err("cannot start model worker".into());
            }
            job
        } else {
            state
                .jobs
                .get(&request.lease.generation())
                .cloned()
                .ok_or("model job is stale")?
        };
        drop(state);
        let lease = LeaseGuard {
            lease: request.lease,
            inner: Arc::downgrade(&self.inner),
        };
        let deadline = Instant::now() + MAX_JOB_DURATION + Duration::from_secs(15);
        let outcome = (|| {
            let mut result = job
                .result
                .lock()
                .map_err(|_| "analysis result lock unavailable")?;
            loop {
                if !allowed() {
                    return Err("analysis authority was revoked".into());
                }
                if let Some(value) = result.as_ref() {
                    return value.clone();
                }
                if Instant::now() >= deadline {
                    return Err("analysis wait timed out".into());
                }
                result = job
                    .changed
                    .wait_timeout(result, Duration::from_millis(100))
                    .map_err(|_| "analysis result lock unavailable")?
                    .0;
            }
        })();
        let artifact = outcome?;
        artifact.verify()?;
        let snapshot = authority()?;
        let state = self
            .inner
            .state
            .lock()
            .map_err(|_| "analysis state lock unavailable")?;
        let reference = match state
            .broker
            .status(&grant, &snapshot.view(), &lease.lease, Instant::now())
            .map_err(model_error)?
        {
            JobStatus::Ready(value) => value,
            _ => return Err("model is not ready".into()),
        };
        state
            .broker
            .resolve(
                &grant,
                &snapshot.view(),
                &lease.lease,
                &reference,
                Instant::now(),
            )
            .map_err(model_error)?;
        Ok(ModelHandle {
            reference,
            artifact,
            _lease: lease,
            authority,
            grant,
        })
    }
    pub fn invalidate(&self, predicate: impl Fn(&ModelKey) -> bool) {
        if let Ok(mut state) = self.inner.state.lock() {
            for id in state.broker.invalidate(predicate) {
                state.jobs.remove(&id);
            }
        }
    }
    pub fn cancel_all(&self) {
        self.invalidate(|_| true);
        // Exit must signal children synchronously; a detached Rust worker may not run another tick
        // after the application exits. The reviewed program then owns its bounded cleanup grace.
        let processes = self
            .inner
            .processes
            .lock()
            .map(|pids| pids.iter().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        for &pid in &processes {
            // Shutdown must not rely on a detached worker getting another scheduler
            // tick after the host begins exiting.  Give cooperative children the
            // termination signal, then synchronously force the owned process group;
            // this is deliberately bounded and never invokes a global daemon stop.
            asterlyn_process::signal_process_tree(pid, false);
        }
        std::thread::sleep(Duration::from_millis(100));
        let remaining = self
            .inner
            .processes
            .lock()
            .map(|pids| {
                processes
                    .iter()
                    .copied()
                    .filter(|pid| pids.contains(pid))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for pid in remaining {
            asterlyn_process::terminate_process_tree(pid);
        }
    }
    pub fn cache_directory(&self) -> PathBuf {
        self.inner.directory.path().to_path_buf()
    }
}
impl Drop for AnalysisRuntime {
    fn drop(&mut self) {
        self.cancel_all();
    }
}
fn model_error(error: ModelError) -> String {
    format!("model reference rejected: {error:?}")
}
