use std::collections::{BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};
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

type Owners = Arc<Mutex<HashMap<String, u64>>>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWatchStatus {
    pub(crate) available: bool,
    pub(crate) message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceWatchInvalidation {
    root: String,
    generation: u64,
    slices: Vec<RepositoryStateSlice>,
    paths: Vec<String>,
    causes: Vec<&'static str>,
    overflowed: bool,
}

#[derive(Default)]
pub(crate) struct WorkspaceWatchService {
    registry: Mutex<WatchRegistry>,
}

#[derive(Default)]
struct WatchRegistry {
    roots: HashMap<PathBuf, SharedWorkspaceWatch>,
    owner_roots: HashMap<String, PathBuf>,
}

struct SharedWorkspaceWatch {
    watcher: RecommendedWatcher,
    workspace_directories: BTreeSet<PathBuf>,
    metadata_roots: Vec<PathBuf>,
    owners: Owners,
}

#[derive(Default)]
struct PendingHint {
    slices: BTreeSet<RepositoryStateSlice>,
    paths: BTreeSet<String>,
    overflowed: bool,
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
        if let Some(watch) = registry.roots.get_mut(&root) {
            if watch.metadata_roots == metadata_roots {
                if let Err(message) = add_workspace_watches(watch, &root, &directories) {
                    return unavailable(message);
                }
                let owners = Arc::clone(&watch.owners);
                if let Ok(mut owners) = owners.lock() {
                    owners.insert(window_label.to_string(), generation);
                    drop(owners);
                    registry.owner_roots.insert(window_label.to_string(), root);
                    return available();
                }
                return unavailable("workspace-watch owner lock was poisoned");
            }
        }

        let (owners, watch_directories) = registry
            .roots
            .get(&root)
            .map(|watch| {
                let mut combined = watch.workspace_directories.clone();
                combined.extend(normalized_watch_directories(&root, &directories));
                (Arc::clone(&watch.owners), combined.into_iter().collect())
            })
            .unwrap_or_else(|| {
                (
                    Arc::new(Mutex::new(HashMap::new())),
                    normalized_watch_directories(&root, &directories)
                        .into_iter()
                        .collect(),
                )
            });
        let shared = match create_watch(
            app,
            root.clone(),
            metadata_roots,
            watch_directories,
            Arc::clone(&owners),
        ) {
            Ok(shared) => shared,
            Err(message) => return unavailable(message),
        };
        if let Ok(mut owners) = owners.lock() {
            owners.insert(window_label.to_string(), generation);
        } else {
            return unavailable("workspace-watch owner lock was poisoned");
        }
        registry.roots.insert(root.clone(), shared);
        registry.owner_roots.insert(window_label.to_string(), root);
        available()
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
    let worker_owners = Arc::clone(&owners);
    let worker_metadata_roots = metadata_roots.clone();
    thread::Builder::new()
        .name("asterlyn-workspace-watch".to_string())
        .spawn(move || watch_loop(app, root, worker_metadata_roots, worker_owners, receiver))
        .map_err(|error| format!("workspace-watch worker could not start: {error}"))?;
    Ok(SharedWorkspaceWatch {
        watcher,
        workspace_directories,
        metadata_roots,
        owners,
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

#[cfg(target_os = "linux")]
fn add_workspace_watches(
    watch: &mut SharedWorkspaceWatch,
    root: &Path,
    directories: &[PathBuf],
) -> Result<(), String> {
    let additions = normalized_watch_directories(root, directories);
    for directory in additions.difference(&watch.workspace_directories) {
        watch
            .watcher
            .watch(directory, RecursiveMode::NonRecursive)
            .map_err(|error| {
                format!(
                    "a project directory could not be watched ({}): {error}",
                    directory.display()
                )
            })?;
    }
    watch.workspace_directories.extend(additions);
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn add_workspace_watches(
    _watch: &mut SharedWorkspaceWatch,
    _root: &Path,
    _directories: &[PathBuf],
) -> Result<(), String> {
    Ok(())
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
    owners: Owners,
    receiver: mpsc::Receiver<notify::Result<Event>>,
) {
    let mut pending = PendingHint::default();
    loop {
        match receiver.recv_timeout(pending.next_timeout()) {
            Ok(event) => {
                pending.merge_event(event, &root, &metadata_roots);
                if pending.ready() {
                    emit_pending(&app, &root, &owners, &mut pending);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if pending.ready() {
                    emit_pending(&app, &root, &owners, &mut pending);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                emit_pending(&app, &root, &owners, &mut pending);
                break;
            }
        }
    }
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
                self.mark_overflow();
                return;
            }
        };
        if event.need_rescan() {
            self.mark_overflow();
            return;
        }
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        if event.paths.is_empty() {
            self.mark_overflow();
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
                self.mark_overflow();
            }
        }
    }

    fn merge_git_path(&mut self, components: &[String]) {
        let Some(first) = components.first().map(String::as_str) else {
            self.mark_overflow();
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
            self.mark_overflow();
        } else if !self.overflowed {
            self.paths.insert(path);
        }
    }

    fn mark_overflow(&mut self) {
        self.overflowed = true;
        self.paths.clear();
        self.slices.extend([
            RepositoryStateSlice::WorkspaceCatalog,
            RepositoryStateSlice::OpenDocuments,
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

    fn take(&mut self) -> Option<(Vec<RepositoryStateSlice>, Vec<String>, bool)> {
        if self.slices.is_empty() {
            *self = Self::default();
            return None;
        }
        let slices = std::mem::take(&mut self.slices).into_iter().collect();
        let paths = std::mem::take(&mut self.paths).into_iter().collect();
        let overflowed = self.overflowed;
        *self = Self::default();
        Some((slices, paths, overflowed))
    }
}

fn emit_pending(app: &tauri::AppHandle, root: &Path, owners: &Owners, pending: &mut PendingHint) {
    let Some((slices, paths, overflowed)) = pending.take() else {
        return;
    };
    let owner_snapshot = owners
        .lock()
        .map(|owners| {
            owners
                .iter()
                .map(|(label, generation)| (label.clone(), *generation))
                .collect()
        })
        .unwrap_or_else(|_| Vec::<(String, u64)>::new());
    for (label, generation) in owner_snapshot {
        let payload = WorkspaceWatchInvalidation {
            root: root.to_string_lossy().into_owned(),
            generation,
            slices: slices.clone(),
            paths: paths.clone(),
            causes: vec![if overflowed {
                "overflowRecovery"
            } else {
                "watcher"
            }],
            overflowed,
        };
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.emit(WATCH_EVENT, payload);
        }
    }
}

fn detach_owner(registry: &mut WatchRegistry, window_label: &str) {
    let Some(root) = registry.owner_roots.remove(window_label) else {
        return;
    };
    let remove_root = registry
        .roots
        .get(&root)
        .and_then(|watch| watch.owners.lock().ok())
        .map(|mut owners| {
            owners.remove(window_label);
            owners.is_empty()
        })
        .unwrap_or(true);
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

fn available() -> WorkspaceWatchStatus {
    WorkspaceWatchStatus {
        available: true,
        message: None,
    }
}

fn unavailable(message: impl Into<String>) -> WorkspaceWatchStatus {
    WorkspaceWatchStatus {
        available: false,
        message: Some(message.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, DataChange, ModifyKind};
    use std::fs;

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

        assert!(hint.overflowed);
        assert!(hint.paths.is_empty());
        assert_eq!(hint.slices.len(), 7);
    }

    #[test]
    #[ignore = "requires a real operating-system watcher backend; run during native acceptance"]
    fn native_backend_reports_a_workspace_change() {
        let directory = tempfile::tempdir().expect("native watch workspace");
        let root = directory.path();
        let changed = root.join("external.txt");
        let (sender, receiver) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(sender).expect("native watcher starts");
        install_workspace_watches(&mut watcher, root, &[root.to_path_buf()])
            .expect("workspace watch starts");

        fs::write(&changed, "external change\n").expect("external write succeeds");
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut hint = PendingHint::default();
        while Instant::now() < deadline && hint.paths.is_empty() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let event = receiver
                .recv_timeout(remaining)
                .expect("native watcher reports the external write");
            hint.merge_event(event, root, &[]);
        }

        assert_eq!(hint.paths, BTreeSet::from(["external.txt".to_string()]));
        assert!(hint.slices.contains(&RepositoryStateSlice::OpenDocuments));
        assert!(hint.slices.contains(&RepositoryStateSlice::WorkingTree));
    }
}
