use std::collections::{BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, Manager};

use super::WorkspaceWatchRoots;
use crate::RepositoryStateSlice;

const WATCH_EVENT: &str = "workspace-watch-invalidation";
const QUIET_PERIOD: Duration = Duration::from_millis(120);
const MAX_LATENCY: Duration = Duration::from_millis(500);
const MAX_PATHS: usize = 512;
const MAX_REVIVABLE_DIRECTORIES: usize = 512;

type Owners = Arc<Mutex<HashMap<String, WatchOwner>>>;

#[derive(Clone)]
struct WatchOwner {
    generation: u64,
    directories: BTreeSet<PathBuf>,
    revivable_directories: BTreeSet<PathBuf>,
    revived_directories: BTreeSet<PathBuf>,
}

impl WatchOwner {
    fn effective_directories(&self) -> impl Iterator<Item = &PathBuf> {
        self.directories
            .iter()
            .chain(self.revived_directories.iter())
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWatchStatus {
    pub(crate) available: bool,
    pub(crate) message: Option<String>,
    pub(crate) watch_instance: Option<u64>,
    pub(crate) verification_required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceWatchInvalidation {
    root: String,
    generation: u64,
    watch_instance: u64,
    slices: Vec<RepositoryStateSlice>,
    paths: Vec<String>,
    causes: Vec<&'static str>,
    recovery: WorkspaceWatchRecovery,
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
enum WorkspaceWatchRecovery {
    #[default]
    None,
    PathsTruncated,
    RootAmbiguous,
    BackendOverflow,
}

#[derive(Default)]
pub(crate) struct WorkspaceWatchService {
    registry: Mutex<WatchRegistry>,
    sequence: AtomicU64,
}

#[derive(Default)]
struct WatchRegistry {
    roots: HashMap<PathBuf, SharedWorkspaceWatch>,
    owner_roots: HashMap<String, PathBuf>,
}

struct SharedWorkspaceWatch {
    // Owns the backend lifetime; only Linux adds registrations after construction.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    watcher: RecommendedWatcher,
    workspace_directories: Arc<Mutex<BTreeSet<PathBuf>>>,
    metadata_roots: Vec<PathBuf>,
    owners: Owners,
    watch_instance: u64,
}

#[derive(Default)]
struct PendingHint {
    slices: BTreeSet<RepositoryStateSlice>,
    paths: BTreeSet<String>,
    recovery: WorkspaceWatchRecovery,
    first_event: Option<Instant>,
    last_event: Option<Instant>,
}

impl WorkspaceWatchService {
    pub(crate) fn activate(
        &self,
        app: tauri::AppHandle,
        window_label: &str,
        roots: WorkspaceWatchRoots,
        generation: u64,
    ) -> WorkspaceWatchStatus {
        let WorkspaceWatchRoots {
            root,
            git_dir,
            directories,
        } = roots;
        let requested_directories = normalized_watch_directories(&root, &directories);
        let metadata_roots = git_metadata_roots(git_dir.as_deref());
        let mut registry = match self.registry.lock() {
            Ok(registry) => registry,
            Err(_) => return unavailable("workspace-watch registry lock was poisoned"),
        };
        if registry
            .owner_roots
            .get(window_label)
            .is_some_and(|owned_root| owned_root != &root)
        {
            detach_owner(&mut registry, window_label);
        }
        if let Some(watch) = registry.roots.get_mut(&root)
            && watch.metadata_roots == metadata_roots
        {
            let owners = Arc::clone(&watch.owners);
            if let Ok(mut owners) = owners.lock() {
                let previous_owner = owners.remove(window_label);
                owners.insert(
                    window_label.to_string(),
                    updated_watch_owner(generation, requested_directories, previous_owner.as_ref()),
                );
                drop(owners);
                let verification_required = match reconcile_workspace_watches(watch, &root) {
                    Ok(expanded) => expanded,
                    Err(message) => {
                        if let Ok(mut owners) = watch.owners.lock() {
                            if let Some(previous_owner) = previous_owner {
                                owners.insert(window_label.to_string(), previous_owner);
                            } else {
                                owners.remove(window_label);
                            }
                        }
                        let _ = reconcile_workspace_watches(watch, &root);
                        return unavailable(message);
                    }
                };
                let watch_instance = watch.watch_instance;
                registry.owner_roots.insert(window_label.to_string(), root);
                return available(watch_instance, verification_required);
            }
            return unavailable("workspace-watch owner lock was poisoned");
        }

        let mut previous = registry.roots.remove(&root);
        let replacing = previous.is_some();
        let previous_owners = previous.as_ref().map(|watch| Arc::clone(&watch.owners));
        let owners = if let Some(previous_owners) = previous_owners {
            let owner_snapshot = match previous_owners.lock() {
                Ok(mut owners) => {
                    let snapshot = owners.clone();
                    owners.clear();
                    snapshot
                }
                Err(_) => {
                    if let Some(previous) = previous.take() {
                        registry.roots.insert(root.clone(), previous);
                    }
                    return unavailable("workspace-watch directory plan lock was poisoned");
                }
            };
            Arc::new(Mutex::new(owner_snapshot))
        } else {
            Arc::new(Mutex::new(HashMap::new()))
        };
        if let Ok(mut registered) = owners.lock() {
            let previous_owner = registered.remove(window_label);
            registered.insert(
                window_label.to_string(),
                updated_watch_owner(generation, requested_directories, previous_owner.as_ref()),
            );
        } else {
            return unavailable("workspace-watch owner lock was poisoned");
        }
        let watch_directories = desired_workspace_directories(&root, &owners);
        let watch_instance = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let shared = match create_watch(
            app,
            root.clone(),
            metadata_roots,
            watch_directories,
            Arc::clone(&owners),
            watch_instance,
        ) {
            Ok(shared) => shared,
            Err(message) => {
                if let Some(mut previous) = previous.take() {
                    if let (Ok(current), Ok(mut restored)) = (owners.lock(), previous.owners.lock())
                    {
                        *restored = current.clone();
                    }
                    let _ = reconcile_workspace_watches(&mut previous, &root);
                    registry.roots.insert(root.clone(), previous);
                    registry.owner_roots.insert(window_label.to_string(), root);
                }
                return unavailable(message);
            }
        };
        registry.roots.insert(root.clone(), shared);
        registry.owner_roots.insert(window_label.to_string(), root);
        available(watch_instance, replacing)
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            detach_owner(&mut registry, window_label);
        }
    }
}

fn create_watch(
    app: tauri::AppHandle,
    root: PathBuf,
    metadata_roots: Vec<PathBuf>,
    directories: Vec<PathBuf>,
    owners: Owners,
    watch_instance: u64,
) -> Result<SharedWorkspaceWatch, String> {
    let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(sender)
        .map_err(|error| format!("native file watching is unavailable: {error}"))?;
    let workspace_directories = normalized_watch_directories(&root, &directories);
    install_workspace_watches(
        &mut watcher,
        &root,
        &workspace_directories.iter().cloned().collect::<Vec<_>>(),
    )?;
    install_git_watches(&mut watcher, &root, &metadata_roots)?;
    let workspace_directories = Arc::new(Mutex::new(workspace_directories));
    let worker_owners = Arc::clone(&owners);
    let worker_metadata_roots = metadata_roots.clone();
    let worker_workspace_directories = Arc::clone(&workspace_directories);
    thread::Builder::new()
        .name("asterlyn-workspace-watch".to_string())
        .spawn(move || {
            watch_loop(
                app,
                root,
                worker_metadata_roots,
                worker_workspace_directories,
                worker_owners,
                watch_instance,
                receiver,
            )
        })
        .map_err(|error| format!("workspace-watch worker could not start: {error}"))?;
    Ok(SharedWorkspaceWatch {
        watcher,
        workspace_directories,
        metadata_roots,
        owners,
        watch_instance,
    })
}

fn normalized_watch_directories(root: &Path, directories: &[PathBuf]) -> BTreeSet<PathBuf> {
    directories
        .iter()
        .filter(|directory| directory.starts_with(root) && directory.is_dir())
        .cloned()
        .chain(std::iter::once(root.to_path_buf()))
        .collect()
}

fn desired_workspace_directories(root: &Path, owners: &Owners) -> Vec<PathBuf> {
    let mut desired = BTreeSet::from([root.to_path_buf()]);
    if let Ok(owners) = owners.lock() {
        for owner in owners.values() {
            desired.extend(owner.effective_directories().cloned());
        }
    }
    desired.into_iter().collect()
}

fn updated_watch_owner(
    generation: u64,
    directories: BTreeSet<PathBuf>,
    previous: Option<&WatchOwner>,
) -> WatchOwner {
    let mut revivable_directories = previous
        .map(|owner| owner.revivable_directories.clone())
        .unwrap_or_default();
    let mut revived_directories = BTreeSet::new();
    if let Some(previous) = previous {
        for directory in previous.effective_directories() {
            if directories.contains(directory) {
                continue;
            }
            if directory.is_dir() && previous.revived_directories.contains(directory) {
                revived_directories.insert(directory.clone());
            } else if !directory.exists() {
                revivable_directories.insert(directory.clone());
            }
        }
    }
    let recreated: Vec<_> = revivable_directories
        .iter()
        .filter(|directory| directory.is_dir())
        .cloned()
        .collect();
    for directory in recreated {
        revivable_directories.remove(&directory);
        if !directories.contains(&directory) {
            revived_directories.insert(directory);
        }
    }
    for directory in &directories {
        revivable_directories.remove(directory);
        revived_directories.remove(directory);
    }
    while revivable_directories.len() > MAX_REVIVABLE_DIRECTORIES {
        let Some(path) = revivable_directories.iter().next_back().cloned() else {
            break;
        };
        revivable_directories.remove(&path);
    }
    WatchOwner {
        generation,
        directories,
        revivable_directories,
        revived_directories,
    }
}

#[cfg(target_os = "linux")]
fn reconcile_workspace_watches(
    watch: &mut SharedWorkspaceWatch,
    root: &Path,
) -> Result<bool, String> {
    let desired =
        normalized_watch_directories(root, &desired_workspace_directories(root, &watch.owners));
    let mut watched = watch
        .workspace_directories
        .lock()
        .map_err(|_| "workspace-watch directory plan lock was poisoned".to_string())?;
    let additions: Vec<_> = desired.difference(&watched).cloned().collect();
    let removals: Vec<_> = watched.difference(&desired).cloned().collect();
    let mut actual = watched.clone();
    for directory in &additions {
        if let Err(error) = watch.watcher.watch(directory, RecursiveMode::NonRecursive) {
            *watched = actual;
            return Err(format!(
                "a project directory could not be watched ({}): {error}",
                directory.display()
            ));
        }
        actual.insert(directory.clone());
    }
    for directory in &removals {
        match watch.watcher.unwatch(directory) {
            Ok(()) => {
                actual.remove(directory);
            }
            Err(_) if !directory.exists() => {
                actual.remove(directory);
            }
            Err(error) => {
                *watched = actual;
                return Err(format!(
                    "a stale project directory watch could not be removed ({}): {error}",
                    directory.display()
                ));
            }
        }
    }
    *watched = actual;
    Ok(!additions.is_empty())
}

#[cfg(not(target_os = "linux"))]
fn reconcile_workspace_watches(
    watch: &mut SharedWorkspaceWatch,
    root: &Path,
) -> Result<bool, String> {
    let desired =
        normalized_watch_directories(root, &desired_workspace_directories(root, &watch.owners));
    let mut watched = watch
        .workspace_directories
        .lock()
        .map_err(|_| "workspace-watch directory plan lock was poisoned".to_string())?;
    let expanded = desired.difference(&watched).next().is_some();
    *watched = desired;
    Ok(expanded)
}

fn git_metadata_roots(git_dir: Option<&Path>) -> Vec<PathBuf> {
    let Some(git_dir) = git_dir else {
        return Vec::new();
    };
    let mut roots = vec![git_dir.to_path_buf()];
    let common = std::fs::read_to_string(git_dir.join("commondir"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .and_then(|value| {
            let path = Path::new(&value);
            let candidate = if path.is_absolute() {
                path.to_path_buf()
            } else {
                git_dir.join(path)
            };
            std::fs::canonicalize(candidate).ok()
        });
    if let Some(common) = common.filter(|common| common != git_dir) {
        roots.push(common);
    }
    roots
}

#[cfg(target_os = "linux")]
fn install_workspace_watches(
    watcher: &mut RecommendedWatcher,
    root: &Path,
    directories: &[PathBuf],
) -> Result<(), String> {
    watcher
        .watch(root, RecursiveMode::NonRecursive)
        .map_err(|error| format!("the project folder could not be watched: {error}"))?;
    for directory in directories {
        if directory == root || !directory.starts_with(root) {
            continue;
        }
        if let Err(error) = watcher.watch(directory, RecursiveMode::NonRecursive)
            && directory.exists()
        {
            return Err(format!(
                "a project directory could not be watched ({}): {error}",
                directory.display()
            ));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn install_workspace_watches(
    watcher: &mut RecommendedWatcher,
    root: &Path,
    _directories: &[PathBuf],
) -> Result<(), String> {
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|error| format!("the project folder could not be watched: {error}"))
}

fn install_git_watches(
    watcher: &mut RecommendedWatcher,
    workspace_root: &Path,
    metadata_roots: &[PathBuf],
) -> Result<(), String> {
    for metadata_root in metadata_roots {
        #[cfg(not(target_os = "linux"))]
        if metadata_root.starts_with(workspace_root) {
            continue;
        }
        #[cfg(target_os = "linux")]
        watcher
            .watch(metadata_root, RecursiveMode::NonRecursive)
            .map_err(|error| format!("Git metadata could not be watched: {error}"))?;
        #[cfg(not(target_os = "linux"))]
        watcher
            .watch(metadata_root, RecursiveMode::Recursive)
            .map_err(|error| format!("Git metadata could not be watched: {error}"))?;

        #[cfg(target_os = "linux")]
        for relative in ["refs", "sequencer", "rebase-merge", "rebase-apply"] {
            let directory = metadata_root.join(relative);
            if directory.is_dir() {
                watcher
                    .watch(&directory, RecursiveMode::Recursive)
                    .map_err(|error| format!("Git metadata could not be watched: {error}"))?;
            }
        }
    }
    #[cfg(target_os = "linux")]
    let _ = workspace_root;
    Ok(())
}

fn watch_loop(
    app: tauri::AppHandle,
    root: PathBuf,
    metadata_roots: Vec<PathBuf>,
    workspace_directories: Arc<Mutex<BTreeSet<PathBuf>>>,
    owners: Owners,
    watch_instance: u64,
    receiver: mpsc::Receiver<notify::Result<Event>>,
) {
    let mut pending = PendingHint::default();
    loop {
        match receiver.recv_timeout(pending.next_timeout()) {
            Ok(event) => {
                if let Some(event) = filter_workspace_event_by_directory_plan(
                    event,
                    &root,
                    &metadata_roots,
                    &workspace_directories,
                ) {
                    pending.merge_event(event, &root, &metadata_roots);
                }
                if pending.ready() {
                    emit_pending(&app, &root, &owners, watch_instance, &mut pending);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if pending.ready() {
                    emit_pending(&app, &root, &owners, watch_instance, &mut pending);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                emit_pending(&app, &root, &owners, watch_instance, &mut pending);
                break;
            }
        }
    }
}

fn filter_workspace_event_by_directory_plan(
    event: notify::Result<Event>,
    root: &Path,
    metadata_roots: &[PathBuf],
    workspace_directories: &Mutex<BTreeSet<PathBuf>>,
) -> Option<notify::Result<Event>> {
    let mut event = match event {
        Ok(event) => event,
        Err(error) => return Some(Err(error)),
    };
    if event.paths.is_empty() || event.need_rescan() {
        return Some(Ok(event));
    }
    let Ok(directories) = workspace_directories.lock() else {
        return Some(Ok(event));
    };
    event.paths.retain(|path| {
        metadata_roots
            .iter()
            .any(|metadata_root| path.starts_with(metadata_root))
            || path == root
            || path
                .strip_prefix(root)
                .ok()
                .filter(|relative| !relative.as_os_str().is_empty())
                .and_then(|_| path.parent())
                .is_some_and(|parent| directories.contains(parent))
    });
    (!event.paths.is_empty()).then_some(Ok(event))
}

impl PendingHint {
    fn merge_event(
        &mut self,
        event: notify::Result<Event>,
        root: &Path,
        metadata_roots: &[PathBuf],
    ) {
        let now = Instant::now();
        self.first_event.get_or_insert(now);
        self.last_event = Some(now);
        let event = match event {
            Ok(event) => event,
            Err(_) => {
                self.mark_backend_overflow();
                return;
            }
        };
        if event.need_rescan() {
            self.mark_backend_overflow();
            return;
        }
        if matches!(
            event.kind,
            EventKind::Access(_)
                | EventKind::Modify(notify::event::ModifyKind::Metadata(
                    notify::event::MetadataKind::AccessTime
                ))
        ) {
            return;
        }
        if event.paths.is_empty() {
            self.mark_backend_overflow();
            return;
        }
        let catalog_changed = changes_catalog(event.kind);
        for path in &event.paths {
            self.merge_path(path, root, metadata_roots, catalog_changed);
        }
    }

    fn merge_path(
        &mut self,
        path: &Path,
        root: &Path,
        metadata_roots: &[PathBuf],
        catalog_changed: bool,
    ) {
        if let Some(relative) = metadata_roots
            .iter()
            .find_map(|directory| path.strip_prefix(directory).ok())
        {
            self.merge_git_path(&normalized_components(relative));
            return;
        }
        if let Ok(relative) = path.strip_prefix(root) {
            let components = normalized_components(relative);
            if let Some(git_index) = components.iter().position(|part| part == ".git") {
                self.merge_git_path(&components[git_index + 1..]);
            } else if !components.is_empty() {
                self.slices.insert(RepositoryStateSlice::OpenDocuments);
                self.slices.insert(RepositoryStateSlice::WorkingTree);
                if catalog_changed || affects_catalog_membership(&components) {
                    self.slices.insert(RepositoryStateSlice::WorkspaceCatalog);
                }
                self.insert_path(components.join("/"));
            } else {
                self.mark_root_ambiguous();
            }
        }
    }

    fn merge_git_path(&mut self, components: &[String]) {
        let Some(first) = components.first().map(String::as_str) else {
            self.mark_root_ambiguous();
            return;
        };
        if matches!(first, "objects" | "logs" | "COMMIT_EDITMSG") {
            return;
        }
        if first == "HEAD" || first == "ORIG_HEAD" {
            self.slices.extend([
                RepositoryStateSlice::Head,
                RepositoryStateSlice::Refs,
                RepositoryStateSlice::History,
                RepositoryStateSlice::WorkingTree,
                RepositoryStateSlice::Operation,
            ]);
        } else if first == "index" || first == "index.lock" {
            self.slices.extend([
                RepositoryStateSlice::WorkingTree,
                RepositoryStateSlice::Operation,
            ]);
        } else if first == "refs" || matches!(first, "packed-refs" | "FETCH_HEAD" | "config") {
            self.slices.extend([
                RepositoryStateSlice::Head,
                RepositoryStateSlice::Refs,
                RepositoryStateSlice::History,
                RepositoryStateSlice::WorkingTree,
            ]);
        } else if is_operation_marker(first) {
            self.slices.extend([
                RepositoryStateSlice::OpenDocuments,
                RepositoryStateSlice::WorkingTree,
                RepositoryStateSlice::Head,
                RepositoryStateSlice::Operation,
            ]);
        }
    }

    fn insert_path(&mut self, path: String) {
        if self.paths.len() >= MAX_PATHS {
            self.mark_paths_truncated();
        } else if self.recovery == WorkspaceWatchRecovery::None {
            self.paths.insert(path);
        }
    }

    fn mark_paths_truncated(&mut self) {
        self.recovery = self.recovery.max(WorkspaceWatchRecovery::PathsTruncated);
        self.paths.clear();
    }

    fn mark_root_ambiguous(&mut self) {
        self.recovery = self.recovery.max(WorkspaceWatchRecovery::RootAmbiguous);
        self.paths.clear();
        self.slices.extend([
            RepositoryStateSlice::WorkspaceCatalog,
            RepositoryStateSlice::OpenDocuments,
            RepositoryStateSlice::RepositoryCapability,
            RepositoryStateSlice::WorkingTree,
        ]);
    }

    fn mark_backend_overflow(&mut self) {
        self.recovery = WorkspaceWatchRecovery::BackendOverflow;
        self.paths.clear();
        self.slices.extend([
            RepositoryStateSlice::WorkspaceCatalog,
            RepositoryStateSlice::OpenDocuments,
            RepositoryStateSlice::RepositoryCapability,
            RepositoryStateSlice::WorkingTree,
            RepositoryStateSlice::Head,
            RepositoryStateSlice::Refs,
            RepositoryStateSlice::History,
            RepositoryStateSlice::Operation,
        ]);
    }

    fn next_timeout(&self) -> Duration {
        let Some(first) = self.first_event else {
            return Duration::from_secs(60);
        };
        let now = Instant::now();
        let quiet_deadline = self.last_event.unwrap_or(first) + QUIET_PERIOD;
        let maximum_deadline = first + MAX_LATENCY;
        quiet_deadline
            .min(maximum_deadline)
            .saturating_duration_since(now)
    }

    fn ready(&self) -> bool {
        let Some(first) = self.first_event else {
            return false;
        };
        let now = Instant::now();
        now.duration_since(self.last_event.unwrap_or(first)) >= QUIET_PERIOD
            || now.duration_since(first) >= MAX_LATENCY
    }

    fn take(
        &mut self,
    ) -> Option<(
        Vec<RepositoryStateSlice>,
        Vec<String>,
        WorkspaceWatchRecovery,
    )> {
        if self.slices.is_empty() {
            *self = Self::default();
            return None;
        }
        let slices = std::mem::take(&mut self.slices).into_iter().collect();
        let paths = std::mem::take(&mut self.paths).into_iter().collect();
        let recovery = self.recovery;
        *self = Self::default();
        Some((slices, paths, recovery))
    }
}

fn emit_pending(
    app: &tauri::AppHandle,
    root: &Path,
    owners: &Owners,
    watch_instance: u64,
    pending: &mut PendingHint,
) {
    let Some((slices, paths, recovery)) = pending.take() else {
        return;
    };
    let owner_snapshot = owners
        .lock()
        .map(|owners| {
            owners
                .iter()
                .map(|(label, owner)| (label.clone(), owner.clone()))
                .collect()
        })
        .unwrap_or_else(|_| Vec::<(String, WatchOwner)>::new());
    let includes_shared_repository_state = slices.iter().any(|slice| {
        matches!(
            slice,
            RepositoryStateSlice::RepositoryCapability
                | RepositoryStateSlice::Head
                | RepositoryStateSlice::Refs
                | RepositoryStateSlice::History
                | RepositoryStateSlice::Operation
        )
    });
    for (label, owner) in owner_snapshot {
        let owner_directories = owner.effective_directories().cloned().collect();
        let owner_paths: Vec<_> = paths
            .iter()
            .filter(|path| owner_accepts_workspace_path(root, &owner_directories, path))
            .cloned()
            .collect();
        if !paths.is_empty() && owner_paths.is_empty() && !includes_shared_repository_state {
            continue;
        }
        let payload = WorkspaceWatchInvalidation {
            root: root.to_string_lossy().into_owned(),
            generation: owner.generation,
            watch_instance,
            slices: slices.clone(),
            paths: owner_paths,
            causes: vec![if recovery == WorkspaceWatchRecovery::BackendOverflow {
                "overflowRecovery"
            } else {
                "watcher"
            }],
            recovery,
        };
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit(WATCH_EVENT, payload);
        }
    }
}

fn owner_accepts_workspace_path(
    root: &Path,
    directories: &BTreeSet<PathBuf>,
    workspace_path: &str,
) -> bool {
    let path = root.join(workspace_path);
    path.parent()
        .is_some_and(|parent| directories.contains(parent))
}

fn detach_owner(registry: &mut WatchRegistry, window_label: &str) {
    let Some(root) = registry.owner_roots.remove(window_label) else {
        return;
    };
    let remove_root = if let Some(watch) = registry.roots.get_mut(&root) {
        let empty = watch
            .owners
            .lock()
            .map(|mut owners| {
                owners.remove(window_label);
                owners.is_empty()
            })
            .unwrap_or(true);
        if !empty {
            let _ = reconcile_workspace_watches(watch, &root);
        }
        empty
    } else {
        true
    };
    if remove_root {
        registry.roots.remove(&root);
    }
}

fn normalized_components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

fn changes_catalog(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Any | EventKind::Create(_) | EventKind::Remove(_)
    ) || matches!(kind, EventKind::Modify(notify::event::ModifyKind::Name(_)))
}

fn affects_catalog_membership(components: &[String]) -> bool {
    matches!(
        components.last().map(String::as_str),
        Some(".gitignore" | ".gitmodules")
    )
}

fn is_operation_marker(name: &str) -> bool {
    matches!(
        name,
        "MERGE_HEAD"
            | "REBASE_HEAD"
            | "CHERRY_PICK_HEAD"
            | "REVERT_HEAD"
            | "BISECT_LOG"
            | "sequencer"
            | "rebase-merge"
            | "rebase-apply"
    )
}

fn available(watch_instance: u64, verification_required: bool) -> WorkspaceWatchStatus {
    WorkspaceWatchStatus {
        available: true,
        message: None,
        watch_instance: Some(watch_instance),
        verification_required,
    }
}

fn unavailable(message: impl Into<String>) -> WorkspaceWatchStatus {
    WorkspaceWatchStatus {
        available: false,
        message: Some(message.into()),
        watch_instance: None,
        verification_required: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, ModifyKind};
    use std::fs;

    #[test]
    fn shared_directory_plan_is_the_exact_union_of_current_owner_plans() {
        let root = Path::new("/workspace");
        let owners = Arc::new(Mutex::new(HashMap::from([
            (
                "first".to_string(),
                WatchOwner {
                    generation: 1,
                    directories: BTreeSet::from([
                        root.to_path_buf(),
                        root.join("src"),
                        root.join("docs"),
                    ]),
                    revivable_directories: BTreeSet::new(),
                    revived_directories: BTreeSet::new(),
                },
            ),
            (
                "second".to_string(),
                WatchOwner {
                    generation: 2,
                    directories: BTreeSet::from([root.to_path_buf(), root.join("tests")]),
                    revivable_directories: BTreeSet::new(),
                    revived_directories: BTreeSet::new(),
                },
            ),
        ])));

        assert_eq!(
            desired_workspace_directories(root, &owners),
            vec![
                root.to_path_buf(),
                root.join("docs"),
                root.join("src"),
                root.join("tests"),
            ]
        );

        owners.lock().unwrap().remove("first");
        assert_eq!(
            desired_workspace_directories(root, &owners),
            vec![root.to_path_buf(), root.join("tests")]
        );
    }

    #[test]
    fn owner_path_admission_does_not_leak_another_windows_hot_directories() {
        let root = Path::new("/workspace");
        let first = BTreeSet::from([root.to_path_buf(), root.join("ignored/first")]);
        let second = BTreeSet::from([root.to_path_buf(), root.join("ignored/second")]);

        assert!(owner_accepts_workspace_path(
            root,
            &first,
            "ignored/first/open.txt"
        ));
        assert!(!owner_accepts_workspace_path(
            root,
            &second,
            "ignored/first/open.txt"
        ));
    }

    #[test]
    fn deleted_known_directories_are_rewatched_when_the_same_path_reappears() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let source = root.join("src");
        fs::create_dir(&source).unwrap();

        let initial = updated_watch_owner(1, BTreeSet::from([root.clone(), source.clone()]), None);
        fs::remove_dir(&source).unwrap();
        let removed = updated_watch_owner(2, BTreeSet::from([root.clone()]), Some(&initial));
        assert!(removed.revivable_directories.contains(&source));
        assert!(!removed.effective_directories().any(|path| path == &source));

        fs::create_dir(&source).unwrap();
        let recreated = updated_watch_owner(3, BTreeSet::from([root.clone()]), Some(&removed));
        assert!(recreated.revived_directories.contains(&source));
        assert!(
            recreated
                .effective_directories()
                .any(|path| path == &source)
        );

        let retained = updated_watch_owner(4, BTreeSet::from([root]), Some(&recreated));
        assert!(retained.effective_directories().any(|path| path == &source));
    }

    #[test]
    fn read_access_and_access_time_metadata_do_not_invalidate_the_workspace() {
        let root = Path::new("/workspace");
        let mut hint = PendingHint::default();
        for kind in [
            EventKind::Access(notify::event::AccessKind::Read),
            EventKind::Modify(ModifyKind::Metadata(
                notify::event::MetadataKind::AccessTime,
            )),
        ] {
            hint.merge_event(
                Ok(Event::new(kind).add_path(root.join("file.md"))),
                root,
                &[],
            );
        }
        assert!(hint.take().is_none());
    }

    #[test]
    #[ignore = "requires a real operating-system watcher backend; run during native acceptance"]
    fn native_backend_git_refresh_reaches_idle_and_still_reports_external_edits() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        for args in [
            &["init", "-b", "main"][..],
            &["config", "user.name", "Test"],
            &["config", "user.email", "test@example.invalid"],
        ] {
            assert!(
                std::process::Command::new("git")
                    .arg("-C")
                    .arg(&root)
                    .args(args)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        }
        fs::write(root.join("file.md"), "content").unwrap();
        for args in [&["add", "."][..], &["commit", "-m", "base"]] {
            assert!(
                std::process::Command::new("git")
                    .arg("-C")
                    .arg(&root)
                    .args(args)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        }
        let (sender, receiver) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(sender).unwrap();
        watcher.watch(&root, RecursiveMode::Recursive).unwrap();
        let repository = asterlyn_git::GitRepository::open(&root).unwrap();
        for _ in 0..3 {
            repository.tracked_snapshot(10).unwrap();
        }
        let mut hint = PendingHint::default();
        let deadline = Instant::now() + Duration::from_millis(1_500);
        while Instant::now() < deadline {
            if let Ok(event) = receiver.recv_timeout(Duration::from_millis(50)) {
                hint.merge_event(event, &root, &[root.join(".git")]);
            }
        }
        assert!(
            hint.take().is_none(),
            "read-only refresh generated another invalidation"
        );
        fs::write(root.join("file.md"), "external edit").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline && hint.slices.is_empty() {
            if let Ok(event) = receiver.recv_timeout(Duration::from_millis(50)) {
                hint.merge_event(event, &root, &[root.join(".git")]);
            }
        }
        assert!(hint.slices.contains(&RepositoryStateSlice::OpenDocuments));
    }

    #[test]
    fn content_edits_invalidate_documents_and_working_tree_without_catalog() {
        let root = Path::new("/workspace");
        let mut hint = PendingHint::default();
        hint.merge_event(
            Ok(
                Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
                    .add_path(root.join("src/main.rs")),
            ),
            root,
            &[],
        );

        assert_eq!(
            hint.slices,
            BTreeSet::from([
                RepositoryStateSlice::OpenDocuments,
                RepositoryStateSlice::WorkingTree,
            ])
        );
        assert_eq!(hint.paths, BTreeSet::from(["src/main.rs".to_string()]));
    }

    #[test]
    fn recursive_watch_filters_events_outside_the_catalog_directory_plan() {
        let root = Path::new("/workspace");
        let directories = Mutex::new(BTreeSet::from([root.to_path_buf(), root.join("src")]));

        let ignored = filter_workspace_event_by_directory_plan(
            Ok(Event::new(EventKind::Create(CreateKind::File))
                .add_path(root.join("build/generated/output.bin"))),
            root,
            &[],
            &directories,
        );
        assert!(ignored.is_none());

        let source = filter_workspace_event_by_directory_plan(
            Ok(Event::new(EventKind::Create(CreateKind::File)).add_path(root.join("src/new.rs"))),
            root,
            &[],
            &directories,
        );
        assert!(source.is_some());

        let top_level = filter_workspace_event_by_directory_plan(
            Ok(Event::new(EventKind::Create(CreateKind::File)).add_path(root.join("README.md"))),
            root,
            &[],
            &directories,
        );
        assert!(top_level.is_some());
    }

    #[test]
    fn created_paths_and_ignore_rules_invalidate_the_catalog() {
        let root = Path::new("/workspace");
        let mut hint = PendingHint::default();
        hint.merge_event(
            Ok(Event::new(EventKind::Create(CreateKind::File)).add_path(root.join("src/new.rs"))),
            root,
            &[],
        );
        hint.merge_event(
            Ok(Event::new(EventKind::Modify(ModifyKind::Any)).add_path(root.join(".gitignore"))),
            root,
            &[],
        );

        assert!(
            hint.slices
                .contains(&RepositoryStateSlice::WorkspaceCatalog)
        );
    }

    #[test]
    fn git_object_churn_is_ignored_but_refs_are_typed() {
        let root = Path::new("/workspace");
        let mut hint = PendingHint::default();
        hint.merge_event(
            Ok(Event::new(EventKind::Create(CreateKind::File))
                .add_path(root.join(".git/objects/aa/object"))),
            root,
            &[],
        );
        assert!(hint.slices.is_empty());

        hint.merge_event(
            Ok(Event::new(EventKind::Modify(ModifyKind::Any))
                .add_path(root.join(".git/refs/heads/main"))),
            root,
            &[],
        );
        assert_eq!(
            hint.slices,
            BTreeSet::from([
                RepositoryStateSlice::Head,
                RepositoryStateSlice::Refs,
                RepositoryStateSlice::History,
                RepositoryStateSlice::WorkingTree,
            ])
        );
        assert!(hint.paths.is_empty());
    }

    #[test]
    fn rescan_events_broaden_reconciliation_and_drop_untrusted_paths() {
        let root = Path::new("/workspace");
        let mut hint = PendingHint::default();
        hint.merge_event(
            Ok(Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan)),
            root,
            &[],
        );

        assert_eq!(hint.recovery, WorkspaceWatchRecovery::BackendOverflow);
        assert!(hint.paths.is_empty());
        assert_eq!(hint.slices.len(), 8);
    }

    #[test]
    fn path_truncation_keeps_the_typed_slices_and_only_drops_path_targeting() {
        let root = Path::new("/workspace");
        let mut hint = PendingHint::default();
        for index in 0..=MAX_PATHS {
            hint.merge_event(
                Ok(
                    Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
                        .add_path(root.join(format!("src/file-{index}.rs"))),
                ),
                root,
                &[],
            );
        }

        assert_eq!(hint.recovery, WorkspaceWatchRecovery::PathsTruncated);
        assert!(hint.paths.is_empty());
        assert_eq!(
            hint.slices,
            BTreeSet::from([
                RepositoryStateSlice::OpenDocuments,
                RepositoryStateSlice::WorkingTree,
            ])
        );
    }

    #[test]
    #[ignore = "requires a real operating-system watcher backend; run during native acceptance"]
    fn native_backend_reports_a_workspace_change() {
        let directory = tempfile::tempdir().expect("native watch workspace");
        let canonical = fs::canonicalize(directory.path()).unwrap();
        let root = canonical.as_path();
        let changed = root.join("external.txt");
        let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(sender).expect("native watcher starts");
        install_workspace_watches(&mut watcher, root, &[root.to_path_buf()])
            .expect("workspace watch starts");

        fs::write(&changed, "external change\n").expect("external write succeeds");
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut hint = PendingHint::default();
        while Instant::now() < deadline && hint.slices.is_empty() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let event = receiver
                .recv_timeout(remaining)
                .expect("native watcher reports the external write");
            hint.merge_event(event, root, &[]);
        }

        // FSEvents may coalesce creation of the temporary root with the file event.
        // A root-level hint legitimately requests complete reconciliation without exact paths.
        assert!(
            hint.recovery == WorkspaceWatchRecovery::RootAmbiguous
                || hint.paths.contains("external.txt")
        );
        assert!(hint.slices.contains(&RepositoryStateSlice::OpenDocuments));
        assert!(hint.slices.contains(&RepositoryStateSlice::WorkingTree));
    }
}
