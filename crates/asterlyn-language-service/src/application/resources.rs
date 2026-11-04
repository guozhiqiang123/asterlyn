//! Generic admission for supervised analysis work. A soft budget, not an OS memory sandbox.
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, VecDeque},
    path::Path,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourcePolicy {
    pub schema: u8,
    #[serde(rename = "physicalMiB")]
    pub physical_mib: u32,
    #[serde(rename = "budgetMiB")]
    pub budget_mib: u32,
    #[serde(rename = "maxHeapMiB")]
    pub max_heap_mib: u32,
    #[serde(rename = "compilerMaxMiB")]
    pub compiler_max_mib: Option<u32>,
    #[serde(rename = "choicesMiB")]
    pub choices_mib: Vec<u32>,
}
impl ResourcePolicy {
    fn new(physical_mib: u32, selected: Option<u32>) -> Result<Self, String> {
        let budget_mib = (physical_mib / 2).clamp(1536, 24576);
        let choices_mib = [1024, 2048, 4096, 6144, 8192]
            .into_iter()
            .filter(|n| n + 512 <= budget_mib)
            .collect::<Vec<_>>();
        if selected.is_some_and(|n| !choices_mib.contains(&n)) {
            return Err("analysis-resource-setting-invalid".into());
        }
        Ok(Self {
            schema: 1,
            physical_mib,
            budget_mib,
            max_heap_mib: selected.unwrap_or((budget_mib - 512).min(4096)),
            compiler_max_mib: selected,
            choices_mib,
        })
    }
}
struct Ticket {
    owner: String,
    key: String,
    amount: u32,
    deadline: Instant,
}
#[derive(Default)]
struct Accounting {
    queue: VecDeque<Ticket>,
    leases: BTreeMap<(String, String), u32>,
    owners: BTreeMap<String, u32>,
    observed: u32,
    sampling: bool,
}
pub(super) struct Pool {
    policy: ResourcePolicy,
    state: Mutex<Accounting>,
}
impl Default for Pool {
    fn default() -> Self {
        Self {
            policy: ResourcePolicy::new(
                asterlyn_process::memory::physical_mib().unwrap_or(8192),
                None,
            )
            .unwrap(),
            state: Mutex::default(),
        }
    }
}
impl Pool {
    pub fn register(self: &Arc<Self>, owner: &str, pid: u32) {
        let mut state = self.state.lock().unwrap();
        state.owners.insert(owner.into(), pid);
        if state.sampling {
            return;
        }
        state.sampling = true;
        drop(state);
        let weak = Arc::downgrade(self);
        // Sampling is outside actors and never blocks language protocol traffic.
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let Some(pool) = weak.upgrade() else { break };
                let mut state = pool.state.lock().unwrap();
                let pids = state.owners.values().copied().collect::<Vec<_>>();
                if pids.is_empty() {
                    state.sampling = false;
                    break;
                }
                drop(state);
                if let Some(usage) = asterlyn_process::memory::group_rss_mib(&pids) {
                    pool.state.lock().unwrap().observed = usage;
                }
            }
        });
    }
    pub fn policy(&self, selected: Option<u32>) -> Result<ResourcePolicy, String> {
        ResourcePolicy::new(self.policy.physical_mib, selected)
    }
    pub fn poll(&self, owner: &str, key: &str, amount: u32, now: Instant) -> Result<bool, String> {
        if amount == 0 || amount > self.policy.budget_mib {
            return Err("analysis-resource-budget-exceeded".into());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "analysis-resource-unavailable")?;
        let id = (owner.to_owned(), key.to_owned());
        if state.leases.contains_key(&id) {
            return Ok(true);
        }
        if let Some(ticket) = state
            .queue
            .iter()
            .find(|t| t.owner == owner && t.key == key)
        {
            if ticket.amount != amount {
                return Err("analysis-resource-request-invalid".into());
            }
            if now >= ticket.deadline {
                state.queue.retain(|t| !(t.owner == owner && t.key == key));
                return Err("analysis-resource-wait-timeout".into());
            }
        } else {
            if state.queue.len() >= 64 {
                return Err("analysis-resource-queue-full".into());
            }
            state.queue.push_back(Ticket {
                owner: owner.into(),
                key: key.into(),
                amount,
                deadline: now + Duration::from_secs(120),
            });
        }
        let used = state.leases.values().sum::<u32>().max(state.observed);
        if state
            .queue
            .front()
            .is_some_and(|t| t.owner == owner && t.key == key)
            && used.saturating_add(amount) <= self.policy.budget_mib
        {
            state.queue.pop_front();
            state.leases.insert(id, amount);
            return Ok(true);
        }
        Ok(false)
    }
    pub fn release(&self, owner: &str, key: &str) {
        if let Ok(mut s) = self.state.lock() {
            s.leases.remove(&(owner.into(), key.into()));
            s.queue.retain(|t| !(t.owner == owner && t.key == key));
        }
    }
    pub fn close(&self, owner: &str) {
        if let Ok(mut s) = self.state.lock() {
            s.owners.remove(owner);
            s.leases.retain(|(o, _), _| o != owner);
            s.queue.retain(|t| t.owner != owner);
            if s.owners.is_empty() {
                s.observed = 0;
            }
        }
    }
}
pub(super) struct Scope {
    pub pool: Arc<Pool>,
    pub owner: String,
}
impl Drop for Scope {
    fn drop(&mut self) {
        self.pool.close(&self.owner);
    }
}

static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Store {
    projects: BTreeMap<String, u32>,
}
fn load(path: &Path) -> Result<Store, String> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Store::default()),
        Err(_) => return Err("analysis-resource-settings-unavailable".into()),
    };
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 65536 {
        return Err("analysis-resource-settings-invalid".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "analysis-resource-settings-unavailable")?;
    if bytes.len() > 65536 {
        return Err("analysis-resource-settings-invalid".into());
    }
    let store: Store =
        serde_json::from_slice(&bytes).map_err(|_| "analysis-resource-settings-invalid")?;
    if store.projects.len() > 512
        || store.projects.iter().any(|(key, n)| {
            key.len() != 64
                || !key.bytes().all(|c| c.is_ascii_hexdigit())
                || ![1024, 2048, 4096, 6144, 8192].contains(n)
        })
    {
        return Err("analysis-resource-settings-invalid".into());
    }
    Ok(store)
}
pub fn preference(path: &Path, root: &Path) -> Result<Option<u32>, String> {
    let _guard = STORE_LOCK
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| "analysis-resource-settings-unavailable")?;
    Ok(load(path)?
        .projects
        .get(&super::consent::workspace(root)?)
        .copied())
}
pub fn remember(path: &Path, root: &Path, value: Option<u32>) -> Result<(), String> {
    use std::io::Write;
    let _guard = STORE_LOCK
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| "analysis-resource-settings-unavailable")?;
    ResourcePolicy::new(
        asterlyn_process::memory::physical_mib().unwrap_or(8192),
        value,
    )?;
    let mut store = load(path)?;
    let key = super::consent::workspace(root)?;
    if let Some(n) = value {
        store.projects.insert(key, n);
    } else {
        store.projects.remove(&key);
    }
    if store.projects.len() > 512 {
        return Err("analysis-resource-settings-full".into());
    }
    let parent = path
        .parent()
        .ok_or("analysis-resource-settings-unavailable")?;
    std::fs::create_dir_all(parent).map_err(|_| "analysis-resource-settings-unavailable")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "analysis-resource-settings-unavailable")?;
    file.write_all(&serde_json::to_vec(&store).unwrap())
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "analysis-resource-settings-unavailable")?;
    file.persist(path)
        .map_err(|_| "analysis-resource-settings-unavailable")?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pool() -> Pool {
        Pool {
            policy: ResourcePolicy::new(8192, None).unwrap(),
            state: Mutex::default(),
        }
    }
    #[test]
    fn fifo_cancel_oversize_timeout_and_owner_cleanup() {
        let p = pool();
        let now = Instant::now();
        assert!(p.poll("a", "1", 3000, now).unwrap());
        assert!(!p.poll("b", "2", 3000, now).unwrap());
        assert!(!p.poll("c", "3", 100, now).unwrap());
        p.close("a");
        assert!(p.poll("b", "2", 3000, now).unwrap());
        p.release("b", "2");
        assert!(p.poll("c", "3", 100, now).unwrap());
        assert!(p.poll("d", "4", 9000, now).is_err());
        assert!(!p.poll("e", "5", 4096, now).unwrap());
        assert_eq!(
            p.poll("e", "5", 4096, now + Duration::from_secs(121))
                .unwrap_err(),
            "analysis-resource-wait-timeout"
        );
        p.close("c");
        assert!(p.state.lock().unwrap().leases.is_empty());
    }
    #[test]
    fn machine_and_project_choices() {
        assert_eq!(ResourcePolicy::new(16384, None).unwrap().max_heap_mib, 4096);
        assert_eq!(
            ResourcePolicy::new(16384, Some(6144)).unwrap().max_heap_mib,
            6144
        );
        assert!(ResourcePolicy::new(4096, Some(4096)).is_err());
    }
    #[test]
    fn persistent_identity_and_auto() {
        let dir = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let path = dir.path().join("resources.json");
        remember(&path, project.path(), Some(1024)).unwrap();
        assert_eq!(preference(&path, project.path()).unwrap(), Some(1024));
        assert_eq!(preference(&path, dir.path()).unwrap(), None);
        remember(&path, project.path(), None).unwrap();
        assert_eq!(preference(&path, project.path()).unwrap(), None);
        std::fs::write(&path, "bad").unwrap();
        assert!(preference(&path, project.path()).is_err());
    }
}
