use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use asterlyn_git::{
    CancellationToken, CommitDetails, CommitDiffResult, DiffResult, GitError, GitRepository,
    HistoryPage, HistoryQuery, ProjectFileList, RepositorySnapshot, UntrackedScan,
};
#[cfg(test)]
use asterlyn_workspace::SearchMode;
use asterlyn_workspace::{
    PreparedWorkspaceReplacement, ReplacementApplyResult, ReplacementFilePreview,
    ReplacementLimits, ReplacementRecoverySummary, SaveTextFileRequest, SaveTextFileResult,
    SearchCancellationToken, SearchCandidate, SearchCoverageReason, SearchLimits, SearchOptions,
    SearchSkipReason, TextFileSnapshot, Workspace, WorkspaceError,
};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const COMMIT_LIMIT: usize = 150;
const PROJECT_FILE_LIMIT: usize = 5_000;
const PROJECT_WINDOW_WIDTH: f64 = 1320.0;
const PROJECT_WINDOW_HEIGHT: f64 = 820.0;
const PROJECT_WINDOW_MIN_WIDTH: f64 = 920.0;
const PROJECT_WINDOW_MIN_HEIGHT: f64 = 600.0;
const CANCELLED_SCAN_RETENTION: usize = 256;
const CANCELLED_REMOTE_RETENTION: usize = 128;
const CANCELLED_SEARCH_RETENTION: usize = 128;
const REPLACEMENT_PLAN_RETENTION: usize = 16;

pub const WORKSPACE_SEARCH_LIMITS: SearchLimits = SearchLimits {
    max_candidates: PROJECT_FILE_LIMIT,
    max_total_bytes: 64 * 1024 * 1024,
    max_matches: 500,
    max_preview_utf16: 320,
    max_reported_skips: 100,
    max_query_bytes: 4_096,
    max_path_patterns_per_kind: 32,
    max_path_pattern_bytes: 256,
    max_context_lines: 3,
    max_regex_size_bytes: 2 * 1024 * 1024,
    max_regex_dfa_size_bytes: 2 * 1024 * 1024,
};

pub const WORKSPACE_REPLACEMENT_LIMITS: ReplacementLimits = ReplacementLimits {
    max_files: 200,
    max_plan_bytes: 64 * 1024 * 1024,
    max_replacement_bytes: 16 * 1024,
    max_preview_utf16: 320,
};

#[derive(Default)]
struct ScanRegistry {
    inner: Mutex<ScanRegistryState>,
}

#[derive(Default)]
struct ScanRegistryState {
    active: HashMap<(String, String), CancellationToken>,
    cancelled: HashSet<(String, String)>,
}

#[derive(Default)]
struct RemoteOperationRegistry {
    inner: Mutex<RemoteOperationRegistryState>,
}

#[derive(Default)]
struct RemoteOperationRegistryState {
    active: HashMap<String, ActiveRemoteOperation>,
    cancelled: HashSet<(String, String)>,
}

struct ActiveRemoteOperation {
    id: String,
    cancellation: CancellationToken,
}

impl ScanRegistry {
    fn remove_window(&self, window_label: &str) {
        if let Ok(mut state) = self.inner.lock() {
            state.active.retain(|(label, _), cancellation| {
                if label == window_label {
                    cancellation.cancel();
                    false
                } else {
                    true
                }
            });
            state.cancelled.retain(|(label, _)| label != window_label);
        }
    }
}

#[derive(Default)]
struct ActiveWorkspaces {
    roots: Mutex<HashMap<String, PathBuf>>,
}

#[derive(Default)]
struct PendingRepositoryWindows {
    paths: Mutex<HashMap<String, PathBuf>>,
    sequence: AtomicU64,
}

#[derive(Default)]
struct WorkspaceWriteRegistry {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

#[derive(Default)]
struct WorkspaceReplacementRegistry {
    inner: Mutex<WorkspaceReplacementRegistryState>,
}

#[derive(Default)]
struct WorkspaceReplacementRegistryState {
    plans: HashMap<(String, String), StoredReplacementPlan>,
    active: HashMap<(String, String), ActiveWorkspaceSearch>,
    cancelled: HashSet<(String, String, String)>,
}

#[derive(Clone)]
struct StoredReplacementPlan {
    root: PathBuf,
    plan: PreparedWorkspaceReplacement,
    files: Vec<AuthorizedReplacementFile>,
}

#[derive(Clone)]
struct AuthorizedReplacementFile {
    repository_id: String,
    path: String,
    workspace_path: String,
}

#[derive(Default)]
struct WorkspaceSearchRegistry {
    inner: Mutex<WorkspaceSearchRegistryState>,
}

#[derive(Default)]
struct WorkspaceSearchRegistryState {
    active: HashMap<(String, String), ActiveWorkspaceSearch>,
    cancelled: HashSet<(String, String, String)>,
}

struct ActiveWorkspaceSearch {
    id: String,
    cancellation: SearchCancellationToken,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTextSearchReport {
    request_id: String,
    matches: Vec<WorkspaceTextSearchMatch>,
    catalog_candidates: usize,
    eligible_candidates: usize,
    files_searched: usize,
    bytes_read: usize,
    skipped_count: usize,
    skipped_files: Vec<WorkspaceTextSearchSkippedFile>,
    coverage_reasons: Vec<SearchCoverageReason>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTextSearchMatch {
    repository_id: String,
    path: String,
    workspace_path: String,
    revision: String,
    from_utf16: usize,
    to_utf16: usize,
    line: usize,
    column_utf16: usize,
    preview: String,
    preview_from_utf16: usize,
    preview_to_utf16: usize,
    leading_clipped: bool,
    trailing_clipped: bool,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTextSearchSkippedFile {
    repository_id: String,
    path: String,
    workspace_path: String,
    reason: SearchSkipReason,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceReplacementPreview {
    plan_id: String,
    files: Vec<WorkspaceReplacementFilePreview>,
    total_matches: usize,
    skipped_count: usize,
    coverage_reasons: Vec<SearchCoverageReason>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WorkspaceReplacementFilePreview {
    repository_id: String,
    path: String,
    workspace_path: String,
    match_count: usize,
    byte_delta: i64,
    before_preview: String,
    after_preview: String,
}

impl ActiveWorkspaces {
    fn activate(&self, window_label: &str, root: &str) -> Result<(), GitError> {
        let canonical = std::fs::canonicalize(root).map_err(|error| GitError::Io {
            operation: "activate workspace".to_string(),
            message: error.to_string(),
        })?;
        self.roots
            .lock()
            .map_err(|_| GitError::Io {
                operation: "activate workspace".to_string(),
                message: "active workspace lock was poisoned".to_string(),
            })?
            .insert(window_label.to_string(), canonical);
        Ok(())
    }

    fn resolve(&self, window_label: &str, requested: &str) -> Result<PathBuf, WorkspaceError> {
        let requested =
            std::fs::canonicalize(requested).map_err(|error| WorkspaceError::NotAuthorized {
                message: format!("the requested workspace is unavailable: {error}"),
            })?;
        let active = self
            .roots
            .lock()
            .map_err(|_| WorkspaceError::Io {
                operation: "authorize active workspace".to_string(),
                message: "active workspace lock was poisoned".to_string(),
            })?
            .get(window_label)
            .cloned()
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "open a repository before reading or saving files".to_string(),
            })?;
        if requested != active {
            return Err(WorkspaceError::NotAuthorized {
                message: "the file does not belong to the active repository".to_string(),
            });
        }
        Ok(active)
    }

    fn remove(&self, window_label: &str) {
        if let Ok(mut roots) = self.roots.lock() {
            roots.remove(window_label);
        }
    }
}

impl PendingRepositoryWindows {
    fn reserve(&self, path: PathBuf) -> Result<String, GitError> {
        let label = format!(
            "project-{}",
            self.sequence.fetch_add(1, Ordering::Relaxed) + 1
        );
        self.paths
            .lock()
            .map_err(|_| GitError::Io {
                operation: "open repository window".to_string(),
                message: "pending repository window lock was poisoned".to_string(),
            })?
            .insert(label.clone(), path);
        Ok(label)
    }

    fn take(&self, window_label: &str) -> Result<Option<String>, GitError> {
        Ok(self
            .paths
            .lock()
            .map_err(|_| GitError::Io {
                operation: "initialize repository window".to_string(),
                message: "pending repository window lock was poisoned".to_string(),
            })?
            .remove(window_label)
            .map(|path| path.to_string_lossy().into_owned()))
    }

    fn remove(&self, window_label: &str) {
        if let Ok(mut paths) = self.paths.lock() {
            paths.remove(window_label);
        }
    }
}

impl WorkspaceWriteRegistry {
    fn lock_for(&self, identity: String) -> Result<Arc<Mutex<()>>, WorkspaceError> {
        let mut locks = self.locks.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize file saves".to_string(),
            message: "file-save registry lock was poisoned".to_string(),
        })?;
        Ok(locks
            .entry(identity)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
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

impl WorkspaceSearchRegistryState {
    fn register(
        &mut self,
        window_label: &str,
        repository_root: &str,
        request_id: &str,
    ) -> SearchCancellationToken {
        let scope = (window_label.to_string(), repository_root.to_string());
        if let Some(previous) = self.active.remove(&scope) {
            previous.cancellation.cancel();
        }
        let cancellation = SearchCancellationToken::new();
        if self.cancelled.remove(&(
            window_label.to_string(),
            repository_root.to_string(),
            request_id.to_string(),
        )) {
            cancellation.cancel();
        }
        self.active.insert(
            scope,
            ActiveWorkspaceSearch {
                id: request_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        cancellation
    }

    fn cancel(&mut self, window_label: String, repository_root: String, request_id: String) {
        let scope = (window_label.clone(), repository_root.clone());
        if self
            .active
            .get(&scope)
            .is_some_and(|active| active.id == request_id)
        {
            if let Some(active) = self.active.remove(&scope) {
                active.cancellation.cancel();
            }
            return;
        }
        if self.cancelled.len() >= CANCELLED_SEARCH_RETENTION {
            self.cancelled.clear();
        }
        self.cancelled
            .insert((window_label, repository_root, request_id));
    }

    fn finish(
        &mut self,
        window_label: &str,
        repository_root: &str,
        request_id: &str,
        cancellation: &SearchCancellationToken,
    ) {
        let scope = (window_label.to_string(), repository_root.to_string());
        if self.active.get(&scope).is_some_and(|active| {
            active.id == request_id && active.cancellation.refers_to(cancellation)
        }) {
            self.active.remove(&scope);
        }
    }

    fn remove_window(&mut self, window_label: &str) {
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

impl RemoteOperationRegistryState {
    fn register(
        &mut self,
        repository_root: &str,
        operation_id: &str,
        operation: &str,
    ) -> Result<CancellationToken, GitError> {
        if self.active.contains_key(repository_root) {
            return Err(GitError::UnsafeOperation {
                operation: operation.to_string(),
                message: "another remote operation is already running for this repository"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        let cancellation = CancellationToken::new();
        if self
            .cancelled
            .remove(&(repository_root.to_string(), operation_id.to_string()))
        {
            cancellation.cancel();
        }
        self.active.insert(
            repository_root.to_string(),
            ActiveRemoteOperation {
                id: operation_id.to_string(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(cancellation)
    }

    fn cancel(&mut self, repository_root: String, operation_id: String) {
        if let Some(active) = self.active.get(&repository_root)
            && active.id == operation_id
        {
            active.cancellation.cancel();
            return;
        }
        if self.cancelled.len() >= CANCELLED_REMOTE_RETENTION {
            self.cancelled.clear();
        }
        self.cancelled.insert((repository_root, operation_id));
    }

    fn finish(
        &mut self,
        repository_root: &str,
        operation_id: &str,
        cancellation: &CancellationToken,
    ) {
        if self.active.get(repository_root).is_some_and(|active| {
            active.id == operation_id && active.cancellation.refers_to(cancellation)
        }) {
            self.active.remove(repository_root);
        }
    }
}

#[tauri::command]
fn initial_repository(
    window: tauri::WebviewWindow,
    pending: State<'_, PendingRepositoryWindows>,
) -> Result<Option<String>, GitError> {
    if let Some(path) = pending.take(window.label())? {
        return Ok(Some(path));
    }
    Ok(std::env::args_os()
        .skip(1)
        .find(|argument| !argument.to_string_lossy().starts_with('-'))
        .map(|argument| argument.to_string_lossy().into_owned()))
}

fn window_chrome_mode_for(is_macos: bool) -> &'static str {
    if is_macos {
        "macos-native"
    } else {
        "custom-right"
    }
}

#[tauri::command]
fn window_chrome_mode() -> &'static str {
    window_chrome_mode_for(cfg!(target_os = "macos"))
}

fn build_project_window(
    app: &tauri::AppHandle,
    label: impl Into<String>,
    title: impl Into<String>,
) -> tauri::Result<tauri::WebviewWindow> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(PROJECT_WINDOW_WIDTH, PROJECT_WINDOW_HEIGHT)
        .min_inner_size(PROJECT_WINDOW_MIN_WIDTH, PROJECT_WINDOW_MIN_HEIGHT)
        .center();

    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    builder.build()
}

#[tauri::command]
async fn open_repository(
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<RepositorySnapshot, GitError> {
    let snapshot = run_blocking("open repository", move || {
        GitRepository::open(path)?.tracked_snapshot(COMMIT_LIMIT)
    })
    .await?;
    active_workspaces.activate(window.label(), &snapshot.root)?;
    Ok(snapshot)
}

#[tauri::command]
fn open_repository_window(
    path: String,
    app: tauri::AppHandle,
    pending: State<'_, PendingRepositoryWindows>,
) -> Result<String, GitError> {
    let canonical = std::fs::canonicalize(&path).map_err(|error| GitError::Io {
        operation: "open repository window".to_string(),
        message: error.to_string(),
    })?;
    GitRepository::open(&canonical)?;
    let label = pending.reserve(canonical.clone())?;
    let title = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("Asterlyn — {name}"))
        .unwrap_or_else(|| "Asterlyn".to_string());
    let result = build_project_window(&app, label.clone(), title);
    if let Err(error) = result {
        pending.remove(&label);
        return Err(GitError::Io {
            operation: "open repository window".to_string(),
            message: error.to_string(),
        });
    }
    Ok(label)
}

#[tauri::command]
async fn read_history_page(
    repository_root: String,
    query: HistoryQuery,
    offset: usize,
    limit: usize,
) -> Result<HistoryPage, GitError> {
    run_blocking("read history page", move || {
        GitRepository::open(repository_root)?.query_commit_history_page(&query, offset, limit)
    })
    .await
}

#[tauri::command]
async fn scan_untracked(
    repository_root: String,
    scan_id: String,
    window: tauri::WebviewWindow,
    scans: State<'_, ScanRegistry>,
) -> Result<UntrackedScan, GitError> {
    let cancellation = CancellationToken::new();
    let scan_key = (window.label().to_string(), scan_id);
    {
        let mut registry = lock_scan_registry(scans.inner())?;
        if registry.cancelled.remove(&scan_key) {
            cancellation.cancel();
        }
        if let Some(previous) = registry
            .active
            .insert(scan_key.clone(), cancellation.clone())
        {
            previous.cancel();
        }
    }

    let task_cancellation = cancellation.clone();
    let result = run_blocking("scan untracked files", move || {
        GitRepository::open(repository_root)?.untracked_changes(&task_cancellation)
    })
    .await;

    let mut registry = lock_scan_registry(scans.inner())?;
    if registry
        .active
        .get(&scan_key)
        .is_some_and(|active| active.refers_to(&cancellation))
    {
        registry.active.remove(&scan_key);
    }
    result
}

#[tauri::command]
fn cancel_untracked_scan(
    scan_id: String,
    window: tauri::WebviewWindow,
    scans: State<'_, ScanRegistry>,
) -> Result<(), GitError> {
    let mut registry = lock_scan_registry(scans.inner())?;
    let scan_key = (window.label().to_string(), scan_id);
    if let Some(cancellation) = registry.active.remove(&scan_key) {
        cancellation.cancel();
    } else {
        if registry.cancelled.len() >= CANCELLED_SCAN_RETENTION {
            registry.cancelled.clear();
        }
        registry.cancelled.insert(scan_key);
    }
    Ok(())
}

#[tauri::command]
async fn read_diff(
    repository_root: String,
    path: String,
    staged: bool,
) -> Result<DiffResult, GitError> {
    run_blocking("read diff", move || {
        GitRepository::open(repository_root)?.diff(&path, staged)
    })
    .await
}

#[tauri::command]
async fn list_project_files(repository_root: String) -> Result<ProjectFileList, GitError> {
    run_blocking("list project files", move || {
        GitRepository::open(repository_root)?.project_files(PROJECT_FILE_LIMIT)
    })
    .await
}

#[tauri::command]
async fn search_workspace_text(
    repository_root: String,
    request_id: String,
    query: String,
    options: Option<SearchOptions>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    searches: State<'_, WorkspaceSearchRegistry>,
) -> Result<WorkspaceTextSearchReport, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces.resolve(&window_label, &repository_root)?;
    let cancellation = searches
        .inner
        .lock()
        .map_err(|_| WorkspaceError::Io {
            operation: "start workspace search".to_string(),
            message: "workspace-search registry lock was poisoned".to_string(),
        })?
        .register(&window_label, &repository_root, &request_id);

    let task_root = root.clone();
    let task_request_id = request_id.clone();
    let task_cancellation = cancellation.clone();
    let task_options = options.unwrap_or_default();
    let result = run_workspace_blocking("search workspace text", move || {
        search_authorized_workspace(
            &task_root,
            &task_request_id,
            &query,
            &task_options,
            &task_cancellation,
        )
    })
    .await;

    searches
        .inner
        .lock()
        .map_err(|_| WorkspaceError::Io {
            operation: "finish workspace search".to_string(),
            message: "workspace-search registry lock was poisoned".to_string(),
        })?
        .finish(&window_label, &repository_root, &request_id, &cancellation);
    result
}

#[tauri::command]
fn cancel_workspace_text_search(
    repository_root: String,
    request_id: String,
    window: tauri::WebviewWindow,
    searches: State<'_, WorkspaceSearchRegistry>,
) -> Result<(), WorkspaceError> {
    searches
        .inner
        .lock()
        .map_err(|_| WorkspaceError::Io {
            operation: "cancel workspace search".to_string(),
            message: "workspace-search registry lock was poisoned".to_string(),
        })?
        .cancel(window.label().to_string(), repository_root, request_id);
    Ok(())
}

fn search_authorized_workspace(
    root: &Path,
    request_id: &str,
    query: &str,
    options: &SearchOptions,
    cancellation: &SearchCancellationToken,
) -> Result<WorkspaceTextSearchReport, WorkspaceError> {
    let catalog = GitRepository::open(root)
        .and_then(|repository| repository.authorized_project_files(PROJECT_FILE_LIMIT))
        .map_err(|error| WorkspaceError::Io {
            operation: "load current project catalog for search".to_string(),
            message: error.to_string(),
        })?;
    if cancellation.is_cancelled() {
        return Err(WorkspaceError::Cancelled {
            message: "workspace search was cancelled".to_string(),
        });
    }
    let candidates: Vec<_> = catalog
        .files
        .iter()
        .map(|file| SearchCandidate {
            workspace_path: file.workspace_path.clone(),
        })
        .collect();
    let report = Workspace::open(root)?.search_text(
        request_id,
        &candidates,
        catalog.truncated,
        query,
        options,
        cancellation,
        WORKSPACE_SEARCH_LIMITS,
    )?;

    let matches = report
        .matches
        .into_iter()
        .map(|found| {
            let file =
                catalog
                    .files
                    .get(found.candidate_index)
                    .ok_or_else(|| WorkspaceError::Io {
                        operation: "map workspace search result".to_string(),
                        message: "search returned an unknown catalog candidate".to_string(),
                    })?;
            Ok(WorkspaceTextSearchMatch {
                repository_id: file.repository_id.clone(),
                path: file.path.clone(),
                workspace_path: found.workspace_path,
                revision: found.revision,
                from_utf16: found.from_utf16,
                to_utf16: found.to_utf16,
                line: found.line,
                column_utf16: found.column_utf16,
                preview: found.preview,
                preview_from_utf16: found.preview_from_utf16,
                preview_to_utf16: found.preview_to_utf16,
                leading_clipped: found.leading_clipped,
                trailing_clipped: found.trailing_clipped,
            })
        })
        .collect::<Result<Vec<_>, WorkspaceError>>()?;
    let skipped_files =
        report
            .skipped_files
            .into_iter()
            .map(|skipped| {
                let file = catalog.files.get(skipped.candidate_index).ok_or_else(|| {
                    WorkspaceError::Io {
                        operation: "map skipped workspace search file".to_string(),
                        message: "search returned an unknown skipped candidate".to_string(),
                    }
                })?;
                Ok(WorkspaceTextSearchSkippedFile {
                    repository_id: file.repository_id.clone(),
                    path: file.path.clone(),
                    workspace_path: skipped.workspace_path,
                    reason: skipped.reason,
                })
            })
            .collect::<Result<Vec<_>, WorkspaceError>>()?;

    Ok(WorkspaceTextSearchReport {
        request_id: report.request_id,
        matches,
        catalog_candidates: report.catalog_candidates,
        eligible_candidates: report.eligible_candidates,
        files_searched: report.files_searched,
        bytes_read: report.bytes_read,
        skipped_count: report.skipped_count,
        skipped_files,
        coverage_reasons: report.coverage_reasons,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn preview_workspace_replacement(
    repository_root: String,
    plan_id: String,
    query: String,
    replacement: String,
    options: SearchOptions,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    replacements: State<'_, WorkspaceReplacementRegistry>,
) -> Result<WorkspaceReplacementPreview, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces.resolve(&window_label, &repository_root)?;
    let cancellation = replacements
        .inner
        .lock()
        .map_err(|_| replacement_registry_error("start replacement preview"))?
        .register(&window_label, &repository_root, &plan_id);
    let task_root = root.clone();
    let task_plan_id = plan_id.clone();
    let task_cancellation = cancellation.clone();
    let result = run_workspace_blocking("preview workspace replacement", move || {
        prepare_authorized_replacement(
            &task_root,
            &task_plan_id,
            &query,
            &replacement,
            &options,
            &task_cancellation,
        )
    })
    .await;

    let mut registry = replacements
        .inner
        .lock()
        .map_err(|_| replacement_registry_error("finish replacement preview"))?;
    registry.finish(&window_label, &repository_root, &plan_id, &cancellation);
    match result {
        Ok((stored, preview)) => {
            if cancellation.is_cancelled() {
                return Err(WorkspaceError::Cancelled {
                    message: "workspace replacement preview was cancelled".to_string(),
                });
            }
            registry.store(&window_label, stored);
            Ok(preview)
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn apply_workspace_replacement(
    repository_root: String,
    plan_id: String,
    selected_paths: Vec<String>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
    replacements: State<'_, WorkspaceReplacementRegistry>,
    app: tauri::AppHandle,
) -> Result<ReplacementApplyResult, WorkspaceError> {
    let window_label = window.label().to_string();
    let root = active_workspaces.resolve(&window_label, &repository_root)?;
    let (stored, cancellation) = {
        let mut registry = replacements
            .inner
            .lock()
            .map_err(|_| replacement_registry_error("start workspace replacement"))?;
        let stored = registry.plan(&window_label, &root, &plan_id)?;
        let cancellation = registry.register(&window_label, &repository_root, &plan_id);
        (stored, cancellation)
    };
    let write_lock = writes.lock_for(root.to_string_lossy().to_string())?;
    let recovery_root = replacement_recovery_root(&app)?;
    let task_plan = stored.plan.clone();
    let task_stored = stored.clone();
    let task_cancellation = cancellation.clone();
    let result = run_workspace_blocking("apply workspace replacement", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
        authorize_replacement_selection(&root, &task_stored, &selected_paths)?;
        Workspace::open(&root)?.apply_replacement_plan(
            &recovery_root,
            &task_plan,
            &selected_paths,
            &task_cancellation,
        )
    })
    .await;

    let mut registry = replacements
        .inner
        .lock()
        .map_err(|_| replacement_registry_error("finish workspace replacement"))?;
    registry.finish(&window_label, &repository_root, &plan_id, &cancellation);
    registry.remove_plan(&window_label, &plan_id);
    result
}

#[tauri::command]
fn cancel_workspace_replacement(
    repository_root: String,
    operation_id: String,
    window: tauri::WebviewWindow,
    replacements: State<'_, WorkspaceReplacementRegistry>,
) -> Result<(), WorkspaceError> {
    replacements
        .inner
        .lock()
        .map_err(|_| replacement_registry_error("cancel workspace replacement"))?
        .cancel(window.label().to_string(), repository_root, operation_id);
    Ok(())
}

#[tauri::command]
async fn list_workspace_replacement_recoveries(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    app: tauri::AppHandle,
) -> Result<Vec<ReplacementRecoverySummary>, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let recovery_root = replacement_recovery_root(&app)?;
    run_workspace_blocking("list replacement recoveries", move || {
        Workspace::open(root)?.list_replacement_recoveries(&recovery_root)
    })
    .await
}

#[tauri::command]
async fn rollback_workspace_replacement(
    repository_root: String,
    recovery_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
    app: tauri::AppHandle,
) -> Result<ReplacementApplyResult, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let write_lock = writes.lock_for(root.to_string_lossy().to_string())?;
    let recovery_root = replacement_recovery_root(&app)?;
    run_workspace_blocking("rollback workspace replacement", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
        Workspace::open(root)?.rollback_replacement(&recovery_root, &recovery_id)
    })
    .await
}

#[tauri::command]
async fn finalize_workspace_replacement(
    repository_root: String,
    recovery_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
    app: tauri::AppHandle,
) -> Result<(), WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let write_lock = writes.lock_for(root.to_string_lossy().to_string())?;
    let recovery_root = replacement_recovery_root(&app)?;
    run_workspace_blocking("finalize workspace replacement", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
        Workspace::open(root)?.finalize_replacement(&recovery_root, &recovery_id)
    })
    .await
}

fn prepare_authorized_replacement(
    root: &Path,
    plan_id: &str,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
    cancellation: &SearchCancellationToken,
) -> Result<(StoredReplacementPlan, WorkspaceReplacementPreview), WorkspaceError> {
    let catalog = GitRepository::open(root)
        .and_then(|repository| repository.authorized_project_files(PROJECT_FILE_LIMIT))
        .map_err(|error| WorkspaceError::Io {
            operation: "load current project catalog for replacement".to_string(),
            message: error.to_string(),
        })?;
    if cancellation.is_cancelled() {
        return Err(WorkspaceError::Cancelled {
            message: "workspace replacement preview was cancelled".to_string(),
        });
    }
    let candidates: Vec<_> = catalog
        .files
        .iter()
        .map(|file| SearchCandidate {
            workspace_path: file.workspace_path.clone(),
        })
        .collect();
    let plan = Workspace::open(root)?.plan_text_replacement(
        plan_id,
        &candidates,
        catalog.truncated,
        query,
        replacement,
        options,
        cancellation,
        WORKSPACE_SEARCH_LIMITS,
        WORKSPACE_REPLACEMENT_LIMITS,
    )?;
    let mut authorized_files = Vec::new();
    let mut preview_files = Vec::new();
    for preview in &plan.preview().files {
        let file = catalog
            .files
            .iter()
            .find(|file| file.workspace_path == preview.workspace_path)
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "replacement preview returned an unauthorized file".to_string(),
            })?;
        authorized_files.push(AuthorizedReplacementFile {
            repository_id: file.repository_id.clone(),
            path: file.path.clone(),
            workspace_path: file.workspace_path.clone(),
        });
        preview_files.push(map_replacement_preview(file, preview));
    }
    let preview = WorkspaceReplacementPreview {
        plan_id: plan.plan_id().to_string(),
        files: preview_files,
        total_matches: plan.preview().total_matches,
        skipped_count: plan.preview().skipped_count,
        coverage_reasons: plan.preview().coverage_reasons.clone(),
    };
    Ok((
        StoredReplacementPlan {
            root: root.to_path_buf(),
            plan,
            files: authorized_files,
        },
        preview,
    ))
}

fn map_replacement_preview(
    file: &asterlyn_git::ProjectFile,
    preview: &ReplacementFilePreview,
) -> WorkspaceReplacementFilePreview {
    WorkspaceReplacementFilePreview {
        repository_id: file.repository_id.clone(),
        path: file.path.clone(),
        workspace_path: file.workspace_path.clone(),
        match_count: preview.match_count,
        byte_delta: preview.byte_delta,
        before_preview: preview.before_preview.clone(),
        after_preview: preview.after_preview.clone(),
    }
}

fn authorize_replacement_selection(
    root: &Path,
    stored: &StoredReplacementPlan,
    selected_paths: &[String],
) -> Result<(), WorkspaceError> {
    let selected: HashSet<_> = selected_paths.iter().map(String::as_str).collect();
    if selected.is_empty() || selected.len() != selected_paths.len() {
        return Err(WorkspaceError::InvalidReplacement {
            message: "select one or more unique previewed files".to_string(),
        });
    }
    let current = GitRepository::open(root)
        .and_then(|repository| repository.authorized_project_files(PROJECT_FILE_LIMIT))
        .map_err(|error| WorkspaceError::Io {
            operation: "reauthorize replacement files".to_string(),
            message: error.to_string(),
        })?;
    for selected_path in selected {
        let planned = stored
            .files
            .iter()
            .find(|file| file.workspace_path == selected_path)
            .ok_or_else(|| WorkspaceError::InvalidReplacement {
                message: "replacement selection is outside the reviewed plan".to_string(),
            })?;
        if !current.files.iter().any(|file| {
            file.repository_id == planned.repository_id
                && file.path == planned.path
                && file.workspace_path == planned.workspace_path
        }) {
            return Err(WorkspaceError::NotAuthorized {
                message: format!(
                    "{} is no longer an authorized project file",
                    planned.workspace_path
                ),
            });
        }
    }
    Ok(())
}

fn replacement_recovery_root(app: &tauri::AppHandle) -> Result<PathBuf, WorkspaceError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("replacement-recovery-v1"))
        .map_err(|error| WorkspaceError::Io {
            operation: "resolve replacement recovery location".to_string(),
            message: error.to_string(),
        })
}

fn replacement_registry_error(operation: &str) -> WorkspaceError {
    WorkspaceError::Io {
        operation: operation.to_string(),
        message: "workspace-replacement registry lock was poisoned".to_string(),
    }
}

#[tauri::command]
async fn read_text_file(
    repository_root: String,
    repository_id: String,
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    run_workspace_blocking("read text file", move || {
        read_authorized_text_file(&root, &repository_id, &path)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn save_text_file(
    repository_root: String,
    repository_id: String,
    path: String,
    expected_revision: String,
    content: String,
    utf8_bom: bool,
    request_id: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
    writes: State<'_, WorkspaceWriteRegistry>,
) -> Result<SaveTextFileResult, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    let write_lock = writes.lock_for(root.to_string_lossy().to_string())?;
    run_workspace_blocking("save text file", move || {
        let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".to_string(),
            message: "workspace-write lock was poisoned".to_string(),
        })?;
        save_authorized_text_file(
            &root,
            &repository_id,
            &path,
            expected_revision,
            content,
            utf8_bom,
            request_id,
        )
    })
    .await
}

fn read_authorized_text_file(
    root: &Path,
    repository_id: &str,
    path: &str,
) -> Result<TextFileSnapshot, WorkspaceError> {
    let authorized = authorize_project_file(root, repository_id, path)?;
    Workspace::open(root)?.read_text_file(&authorized.workspace_path)
}

#[allow(clippy::too_many_arguments)]
fn save_authorized_text_file(
    root: &Path,
    repository_id: &str,
    path: &str,
    expected_revision: String,
    content: String,
    utf8_bom: bool,
    request_id: String,
) -> Result<SaveTextFileResult, WorkspaceError> {
    let authorized = authorize_project_file(root, repository_id, path)?;
    Workspace::open(root)?.save_text_file(&SaveTextFileRequest {
        workspace_path: authorized.workspace_path,
        expected_revision,
        content,
        utf8_bom,
        request_id,
    })
}

fn authorize_project_file(
    root: &Path,
    repository_id: &str,
    path: &str,
) -> Result<asterlyn_git::ProjectFile, WorkspaceError> {
    GitRepository::open(root)
        .and_then(|repository| {
            repository.authorize_project_file(repository_id, path, PROJECT_FILE_LIMIT)
        })
        .map_err(|_| WorkspaceError::NotAuthorized {
            message: "select a current tracked or non-ignored project file".to_string(),
        })
}

#[tauri::command]
async fn read_commit_details(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
) -> Result<CommitDetails, GitError> {
    run_blocking("read commit details", move || {
        GitRepository::open(repository_root)?.repository_commit_details(&repository_id, &commit_oid)
    })
    .await
}

#[tauri::command]
async fn read_commit_diff(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    path: String,
    original_path: Option<String>,
) -> Result<CommitDiffResult, GitError> {
    run_blocking("read commit diff", move || {
        GitRepository::open(repository_root)?.repository_commit_diff(
            &repository_id,
            &commit_oid,
            &path,
            original_path.as_deref(),
        )
    })
    .await
}

#[tauri::command]
async fn stage_paths(
    repository_root: String,
    paths: Vec<String>,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("stage paths", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.stage(&paths)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn unstage_paths(
    repository_root: String,
    paths: Vec<String>,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("unstage paths", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.unstage(&paths)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn commit_changes(
    repository_root: String,
    message: String,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("create commit", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.commit(&message)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn switch_branch(
    repository_root: String,
    target_full_name: String,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("switch branch", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.switch_branch(&target_full_name)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn create_branch(
    repository_root: String,
    name: String,
) -> Result<RepositorySnapshot, GitError> {
    run_blocking("create branch", move || {
        let repository = GitRepository::open(repository_root)?;
        repository.create_branch(&name)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await
}

#[tauri::command]
async fn fetch_remote(
    repository_root: String,
    remote: String,
    operation_id: String,
    operations: State<'_, RemoteOperationRegistry>,
) -> Result<RepositorySnapshot, GitError> {
    run_remote_action(
        repository_root,
        operation_id,
        operations.inner(),
        "fetch",
        move |repository, cancellation| repository.fetch_remote(&remote, cancellation),
    )
    .await
}

#[tauri::command]
async fn pull_current(
    repository_root: String,
    operation_id: String,
    operations: State<'_, RemoteOperationRegistry>,
) -> Result<RepositorySnapshot, GitError> {
    run_remote_action(
        repository_root,
        operation_id,
        operations.inner(),
        "pull",
        move |repository, cancellation| repository.pull_ff_only(cancellation),
    )
    .await
}

#[tauri::command]
async fn push_current(
    repository_root: String,
    remote: String,
    operation_id: String,
    operations: State<'_, RemoteOperationRegistry>,
) -> Result<RepositorySnapshot, GitError> {
    run_remote_action(
        repository_root,
        operation_id,
        operations.inner(),
        "push",
        move |repository, cancellation| repository.push_current(&remote, cancellation),
    )
    .await
}

#[tauri::command]
fn cancel_remote_operation(
    repository_root: String,
    operation_id: String,
    operations: State<'_, RemoteOperationRegistry>,
) -> Result<(), GitError> {
    let mut registry = lock_remote_registry(operations.inner())?;
    registry.cancel(repository_root, operation_id);
    Ok(())
}

async fn run_remote_action<F>(
    repository_root: String,
    operation_id: String,
    operations: &RemoteOperationRegistry,
    operation: &str,
    action: F,
) -> Result<RepositorySnapshot, GitError>
where
    F: FnOnce(&GitRepository, &CancellationToken) -> Result<(), GitError> + Send + 'static,
{
    let repository = run_blocking("open repository for remote operation", move || {
        GitRepository::open(repository_root)
    })
    .await?;
    let resolved_root = repository.root().to_string_lossy().into_owned();
    let cancellation = {
        let mut registry = lock_remote_registry(operations)?;
        registry.register(&resolved_root, &operation_id, operation)?
    };

    let task_cancellation = cancellation.clone();
    let result = run_blocking(operation, move || {
        action(&repository, &task_cancellation)?;
        repository.tracked_snapshot(COMMIT_LIMIT)
    })
    .await;

    let mut registry = lock_remote_registry(operations)?;
    registry.finish(&resolved_root, &operation_id, &cancellation);
    result
}

fn lock_scan_registry(scans: &ScanRegistry) -> Result<MutexGuard<'_, ScanRegistryState>, GitError> {
    scans.inner.lock().map_err(|_| GitError::Io {
        operation: "manage untracked scan".to_string(),
        message: "scan registry lock was poisoned".to_string(),
    })
}

fn lock_remote_registry(
    operations: &RemoteOperationRegistry,
) -> Result<MutexGuard<'_, RemoteOperationRegistryState>, GitError> {
    operations.inner.lock().map_err(|_| GitError::Io {
        operation: "manage remote operations".to_string(),
        message: "remote operation registry lock was poisoned".to_string(),
    })
}

async fn run_blocking<T, F>(operation: &str, task: F) -> Result<T, GitError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, GitError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: format!("background task could not complete: {error}"),
        })?
}

async fn run_workspace_blocking<T, F>(operation: &str, task: F) -> Result<T, WorkspaceError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, WorkspaceError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| WorkspaceError::Io {
            operation: operation.to_string(),
            message: format!("background task could not complete: {error}"),
        })?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ScanRegistry::default())
        .manage(RemoteOperationRegistry::default())
        .manage(ActiveWorkspaces::default())
        .manage(PendingRepositoryWindows::default())
        .manage(WorkspaceWriteRegistry::default())
        .manage(WorkspaceSearchRegistry::default())
        .manage(WorkspaceReplacementRegistry::default())
        .setup(|app| {
            build_project_window(app.handle(), "main", "Asterlyn")?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                window.state::<ScanRegistry>().remove_window(window.label());
                window.state::<ActiveWorkspaces>().remove(window.label());
                window
                    .state::<PendingRepositoryWindows>()
                    .remove(window.label());
                if let Ok(mut searches) = window.state::<WorkspaceSearchRegistry>().inner.lock() {
                    searches.remove_window(window.label());
                }
                if let Ok(mut replacements) =
                    window.state::<WorkspaceReplacementRegistry>().inner.lock()
                {
                    replacements.remove_window(window.label());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            initial_repository,
            window_chrome_mode,
            open_repository,
            open_repository_window,
            read_history_page,
            scan_untracked,
            cancel_untracked_scan,
            list_project_files,
            search_workspace_text,
            cancel_workspace_text_search,
            preview_workspace_replacement,
            apply_workspace_replacement,
            cancel_workspace_replacement,
            list_workspace_replacement_recoveries,
            rollback_workspace_replacement,
            finalize_workspace_replacement,
            read_text_file,
            save_text_file,
            read_diff,
            read_commit_details,
            read_commit_diff,
            stage_paths,
            unstage_paths,
            commit_changes,
            switch_branch,
            create_branch,
            fetch_remote,
            pull_current,
            push_current,
            cancel_remote_operation
        ])
        .run(tauri::generate_context!())
        .expect("Asterlyn desktop runtime failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(path: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(arguments)
            .output()
            .expect("Git starts");
        assert!(
            output.status.success(),
            "Git {:?} failed: {}",
            arguments,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn desktop_file_boundary_saves_authorized_text_and_preserves_external_changes() {
        let directory = tempfile::tempdir().expect("temporary repository");
        git(directory.path(), &["init", "-b", "main"]);
        fs::write(directory.path().join("source.txt"), "original\r\n").expect("source file");
        fs::write(directory.path().join("ignored.txt"), "ignored\n").expect("ignored file");
        fs::write(directory.path().join(".gitignore"), "ignored.txt\n").expect("ignore file");
        git(directory.path(), &["add", ".gitignore", "source.txt"]);

        let initial = read_authorized_text_file(directory.path(), ".", "source.txt")
            .expect("authorized file reads");
        let saved = save_authorized_text_file(
            directory.path(),
            ".",
            "source.txt",
            initial.revision,
            "saved\r\n".to_string(),
            false,
            "native-save-1".to_string(),
        )
        .expect("authorized file saves");
        assert_eq!(
            fs::read(directory.path().join("source.txt")).expect("saved bytes"),
            b"saved\r\n"
        );

        fs::write(directory.path().join("source.txt"), "external\n").expect("external edit");
        let conflict = save_authorized_text_file(
            directory.path(),
            ".",
            "source.txt",
            saved.revision.clone(),
            "local\n".to_string(),
            false,
            "native-save-2".to_string(),
        )
        .expect_err("external edit conflicts");
        assert!(matches!(conflict, WorkspaceError::Conflict { .. }));
        assert_eq!(
            fs::read_to_string(directory.path().join("source.txt")).expect("external text"),
            "external\n"
        );
        assert!(matches!(
            read_authorized_text_file(directory.path(), ".", "ignored.txt"),
            Err(WorkspaceError::NotAuthorized { .. })
        ));

        git(
            directory.path(),
            &["rm", "--cached", "-f", "--", "source.txt"],
        );
        fs::write(
            directory.path().join(".gitignore"),
            "ignored.txt\nsource.txt\n",
        )
        .expect("updated ignore file");
        git(directory.path(), &["add", ".gitignore"]);
        let revoked = save_authorized_text_file(
            directory.path(),
            ".",
            "source.txt",
            saved.revision,
            "must not save\n".to_string(),
            false,
            "native-save-revoked".to_string(),
        )
        .expect_err("fresh catalog revokes ignored file authorization");
        assert!(matches!(revoked, WorkspaceError::NotAuthorized { .. }));
        assert_eq!(
            fs::read_to_string(directory.path().join("source.txt")).expect("revoked file"),
            "external\n"
        );
    }

    #[test]
    fn workspace_search_uses_a_fresh_git_authorized_catalog() {
        let directory = tempfile::tempdir().expect("temporary repository");
        git(directory.path(), &["init", "-b", "main"]);
        fs::write(directory.path().join("source.txt"), "authorized needle\n").expect("source file");
        fs::write(directory.path().join("ignored.txt"), "ignored needle\n").expect("ignored file");
        fs::write(directory.path().join(".gitignore"), "ignored.txt\n").expect("ignore file");
        git(directory.path(), &["add", ".gitignore", "source.txt"]);

        let first = search_authorized_workspace(
            directory.path(),
            "native-search-1",
            "needle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
        )
        .expect("authorized search");
        assert_eq!(first.matches.len(), 1);
        assert_eq!(first.matches[0].path, "source.txt");
        let old_result = first.matches[0].clone();

        git(
            directory.path(),
            &["rm", "--cached", "-f", "--", "source.txt"],
        );
        fs::write(
            directory.path().join(".gitignore"),
            "ignored.txt\nsource.txt\n",
        )
        .expect("updated ignore file");
        git(directory.path(), &["add", ".gitignore"]);

        let old_result_open = read_authorized_text_file(
            directory.path(),
            &old_result.repository_id,
            &old_result.path,
        )
        .expect_err("an old result must pass fresh E1 authorization");
        assert!(matches!(
            old_result_open,
            WorkspaceError::NotAuthorized { .. }
        ));

        let revoked = search_authorized_workspace(
            directory.path(),
            "native-search-2",
            "needle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
        )
        .expect("revoked search remains valid");
        assert!(revoked.matches.is_empty());
    }

    #[test]
    fn workspace_search_maps_regex_path_filters_and_context_through_the_desktop_boundary() {
        let directory = tempfile::tempdir().expect("temporary repository");
        git(directory.path(), &["init", "-b", "main"]);
        fs::create_dir_all(directory.path().join("src/generated")).expect("source directories");
        fs::write(
            directory.path().join("src/code.rs"),
            "before\nNeedle 42\nafter\n",
        )
        .expect("source file");
        fs::write(
            directory.path().join("src/generated/code.rs"),
            "Needle 99\n",
        )
        .expect("generated file");
        fs::write(directory.path().join("README.md"), "Needle 11\n").expect("readme");
        git(directory.path(), &["add", "."]);

        let options = SearchOptions {
            mode: SearchMode::Regex,
            include_globs: vec!["src/**".to_string()],
            exclude_globs: vec!["src/generated/**".to_string()],
            context_lines: 1,
        };
        let report = search_authorized_workspace(
            directory.path(),
            "native-search-options",
            "(?i)needle [0-9]+",
            &options,
            &SearchCancellationToken::new(),
        )
        .expect("refined search");

        assert_eq!(report.catalog_candidates, 3);
        assert_eq!(report.eligible_candidates, 1);
        assert_eq!(report.files_searched, 1);
        assert_eq!(report.matches.len(), 1);
        assert_eq!(report.matches[0].path, "src/code.rs");
        assert_eq!(report.matches[0].preview, "before\nNeedle 42\nafter");
    }

    #[test]
    fn workspace_replacement_preview_maps_git_identities_and_reauthorizes_apply() {
        let directory = tempfile::tempdir().expect("temporary repository");
        let recovery = tempfile::tempdir().expect("recovery directory");
        git(directory.path(), &["init", "-b", "main"]);
        fs::write(directory.path().join("tracked.txt"), "needle tracked\n").expect("tracked file");
        fs::write(directory.path().join("untracked.txt"), "needle untracked\n")
            .expect("untracked file");
        fs::write(directory.path().join(".gitignore"), "").expect("ignore file");
        git(directory.path(), &["add", ".gitignore", "tracked.txt"]);

        let (stored, preview) = prepare_authorized_replacement(
            directory.path(),
            "native-replace-preview",
            "needle",
            "found",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
        )
        .expect("replacement preview");
        assert_eq!(preview.total_matches, 2);
        assert_eq!(preview.files.len(), 2);
        assert!(preview.files.iter().all(|file| file.repository_id == "."));

        authorize_replacement_selection(directory.path(), &stored, &["tracked.txt".to_string()])
            .expect("tracked selection remains authorized");
        let applied = Workspace::open(directory.path())
            .unwrap()
            .apply_replacement_plan(
                recovery.path(),
                &stored.plan,
                &["tracked.txt".to_string()],
                &SearchCancellationToken::new(),
            )
            .expect("selected replacement applies");
        assert_eq!(
            applied.status,
            asterlyn_workspace::ReplacementRecoveryStatus::Applied
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("tracked.txt")).unwrap(),
            "found tracked\n"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("untracked.txt")).unwrap(),
            "needle untracked\n"
        );

        fs::write(directory.path().join(".gitignore"), "untracked.txt\n")
            .expect("ignore untracked file");
        let revoked = authorize_replacement_selection(
            directory.path(),
            &stored,
            &["untracked.txt".to_string()],
        )
        .expect_err("fresh catalog revokes replacement authorization");
        assert!(matches!(revoked, WorkspaceError::NotAuthorized { .. }));
    }

    #[test]
    fn replacement_registry_supersedes_plans_by_workspace_and_cancels_exact_operations() {
        let directory = tempfile::tempdir().expect("temporary repository");
        git(directory.path(), &["init", "-b", "main"]);
        fs::write(directory.path().join("source.txt"), "needle\n").expect("source file");
        git(directory.path(), &["add", "source.txt"]);
        let (first, _) = prepare_authorized_replacement(
            directory.path(),
            "plan-one",
            "needle",
            "one",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
        )
        .expect("first plan");
        let (second, _) = prepare_authorized_replacement(
            directory.path(),
            "plan-two",
            "needle",
            "two",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
        )
        .expect("second plan");
        let canonical = std::fs::canonicalize(directory.path()).unwrap();
        let mut registry = WorkspaceReplacementRegistryState::default();
        registry.store("main", first);
        registry.store("main", second.clone());
        registry.store("project-1", second);
        assert!(registry.plan("main", &canonical, "plan-one").is_err());
        assert!(registry.plan("main", &canonical, "plan-two").is_ok());
        assert!(registry.plan("project-1", &canonical, "plan-two").is_ok());
        registry.cancel(
            "main".to_string(),
            canonical.to_string_lossy().to_string(),
            "plan-two".to_string(),
        );
        assert!(registry.plan("main", &canonical, "plan-two").is_err());
        assert!(registry.plan("project-1", &canonical, "plan-two").is_ok());
        assert!(registry.cancelled.is_empty());

        registry.cancel(
            "main".to_string(),
            "/repo".to_string(),
            "cancelled".to_string(),
        );
        assert!(
            registry
                .register("main", "/repo", "cancelled")
                .is_cancelled()
        );
        let active = registry.register("main", "/repo", "active");
        registry.cancel(
            "main".to_string(),
            "/repo".to_string(),
            "active".to_string(),
        );
        assert!(active.is_cancelled());
        registry.remove_window("project-1");
        assert!(registry.plan("project-1", &canonical, "plan-two").is_err());
    }

    #[test]
    fn active_workspaces_isolate_authorization_by_window() {
        let active = ActiveWorkspaces::default();
        let first = tempfile::tempdir().expect("first workspace");
        let second = tempfile::tempdir().expect("second workspace");
        let first_path = first.path().to_string_lossy();
        let second_path = second.path().to_string_lossy();

        assert!(matches!(
            active.resolve("main", &first_path),
            Err(WorkspaceError::NotAuthorized { .. })
        ));
        active
            .activate("main", &first_path)
            .expect("first workspace activates");
        active
            .activate("project-1", &second_path)
            .expect("second workspace activates");
        assert_eq!(
            active
                .resolve("main", &first_path)
                .expect("first root resolves"),
            std::fs::canonicalize(first.path()).expect("canonical first root")
        );
        assert_eq!(
            active
                .resolve("project-1", &second_path)
                .expect("second root resolves"),
            std::fs::canonicalize(second.path()).expect("canonical second root")
        );
        assert!(matches!(
            active.resolve("main", &second_path),
            Err(WorkspaceError::NotAuthorized { .. })
        ));
        active.remove("main");
        assert!(matches!(
            active.resolve("main", &first_path),
            Err(WorkspaceError::NotAuthorized { .. })
        ));
    }

    #[test]
    fn pending_repository_windows_are_unique_and_consumed_once() {
        let pending = PendingRepositoryWindows::default();
        let first = pending
            .reserve(PathBuf::from("/repo/first"))
            .expect("first window");
        let second = pending
            .reserve(PathBuf::from("/repo/second"))
            .expect("second window");
        assert_ne!(first, second);
        assert_eq!(
            pending.take(&first).expect("pending path"),
            Some("/repo/first".to_string())
        );
        assert_eq!(pending.take(&first).expect("path consumed"), None);
    }

    #[test]
    fn window_chrome_mode_matches_native_control_ownership() {
        assert_eq!(window_chrome_mode_for(true), "macos-native");
        assert_eq!(window_chrome_mode_for(false), "custom-right");
    }

    #[test]
    fn scan_registry_isolates_and_cleans_window_requests() {
        let scans = ScanRegistry::default();
        let main = CancellationToken::new();
        let second = CancellationToken::new();
        {
            let mut state = scans.inner.lock().expect("scan registry");
            state
                .active
                .insert(("main".to_string(), "1-1".to_string()), main.clone());
            state
                .active
                .insert(("project-1".to_string(), "1-1".to_string()), second.clone());
        }
        scans.remove_window("main");
        assert!(main.is_cancelled());
        assert!(!second.is_cancelled());
        assert_eq!(scans.inner.lock().expect("scan registry").active.len(), 1);
    }

    #[test]
    fn workspace_write_registry_reuses_only_matching_root_locks() {
        let registry = WorkspaceWriteRegistry::default();
        let first = registry.lock_for("root-a".to_string()).expect("lock");
        let same = registry.lock_for("root-a".to_string()).expect("same lock");
        let other = registry.lock_for("root-b".to_string()).expect("other lock");

        assert!(Arc::ptr_eq(&first, &same));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[test]
    fn remote_registry_serializes_by_repository_and_cancels_exact_ids() {
        let mut registry = RemoteOperationRegistryState::default();
        let first = registry
            .register("/repo", "one", "fetch")
            .expect("first operation registers");
        let duplicate = registry
            .register("/repo", "two", "push")
            .expect_err("same repository is serialized");
        assert!(matches!(duplicate, GitError::UnsafeOperation { .. }));

        let other = registry
            .register("/other", "one", "fetch")
            .expect("different repository can run independently");
        registry.cancel("/repo".to_string(), "wrong".to_string());
        assert!(!first.is_cancelled());
        assert!(!other.is_cancelled());

        registry.cancel("/repo".to_string(), "one".to_string());
        assert!(first.is_cancelled());
        registry.finish("/repo", "one", &first);
        assert!(!registry.active.contains_key("/repo"));

        registry.cancel("/future".to_string(), "queued".to_string());
        let queued = registry
            .register("/future", "queued", "pull")
            .expect("pre-cancelled operation registers as cancelled");
        assert!(queued.is_cancelled());
    }

    #[test]
    fn workspace_search_registry_supersedes_and_finishes_exact_requests() {
        let mut registry = WorkspaceSearchRegistryState::default();
        let first = registry.register("main", "/repo", "one");
        let second = registry.register("main", "/repo", "two");
        let other_window = registry.register("project-1", "/repo", "one");
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
        assert!(!other_window.is_cancelled());

        registry.finish("main", "/repo", "one", &first);
        assert_eq!(
            registry
                .active
                .get(&("main".to_string(), "/repo".to_string()))
                .map(|active| active.id.as_str()),
            Some("two")
        );

        registry.cancel("main".to_string(), "/repo".to_string(), "wrong".to_string());
        assert!(!second.is_cancelled());
        assert!(!other_window.is_cancelled());
        registry.cancel("main".to_string(), "/repo".to_string(), "two".to_string());
        assert!(second.is_cancelled());
        assert!(
            !registry
                .active
                .contains_key(&("main".to_string(), "/repo".to_string()))
        );
        assert!(
            registry
                .active
                .contains_key(&("project-1".to_string(), "/repo".to_string()))
        );

        registry.cancel(
            "main".to_string(),
            "/future".to_string(),
            "queued".to_string(),
        );
        let queued = registry.register("main", "/future", "queued");
        assert!(queued.is_cancelled());

        registry.remove_window("project-1");
        assert!(other_window.is_cancelled());
    }
}
