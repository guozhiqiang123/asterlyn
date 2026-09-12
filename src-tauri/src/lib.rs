use std::collections::HashSet;
use std::path::{Path, PathBuf};

use asterlyn_git::{
    CommitDetails, CommitDiffResult, DiffResult, FileChange, GitError, GitRepository, HistoryPage,
    HistoryQuery, ProjectFile, ProjectFileList, PushMode, PushPreview, PushTagMode,
    RepositorySnapshot, TrackedChangeScan, UntrackedScan,
};
#[cfg(test)]
use asterlyn_workspace::SearchMode;
use asterlyn_workspace::{
    ReplacementApplyResult, ReplacementFilePreview, ReplacementLimits, ReplacementRecoverySummary,
    SaveTextFileRequest, SaveTextFileResult, SearchCancellationToken, SearchCandidate,
    SearchCoverageReason, SearchLimits, SearchOptions, SearchSkipReason, TextFileSnapshot,
    Workspace, WorkspaceError,
};
use base64::Engine;
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

mod application;
mod commands;

use application::{
    ActiveWorkspaces, AuthorizedReplacementFile, GitOperationCoordinator, PendingRepositoryWindows,
    ScanRegistry, StoredReplacementPlan, WorkspaceReplacementRegistry, WorkspaceSearchRegistry,
    WorkspaceWriteRegistry,
};
#[cfg(test)]
use application::{GitMutationRegistry, RemoteOperationRegistry};
use commands::*;

const COMMIT_LIMIT: usize = 150;
const PROJECT_FILE_LIMIT: usize = 100_000;
const IMAGE_PREVIEW_LIMIT_BYTES: usize = 16 * 1024 * 1024;
const IMAGE_PREVIEW_LIMIT_PIXELS: u64 = 16_000_000;
const IMAGE_DIFF_LIMIT_PIXELS: u64 = 24_000_000;
const WORKSPACE_SEARCH_CANDIDATE_LIMIT: usize = 5_000;
const PROJECT_WINDOW_WIDTH: f64 = 1320.0;
const PROJECT_WINDOW_HEIGHT: f64 = 820.0;
const PROJECT_WINDOW_MIN_WIDTH: f64 = 920.0;
const PROJECT_WINDOW_MIN_HEIGHT: f64 = 600.0;

pub const WORKSPACE_SEARCH_LIMITS: SearchLimits = SearchLimits {
    max_candidates: WORKSPACE_SEARCH_CANDIDATE_LIMIT,
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitSelectedResult {
    oid: Option<String>,
    snapshot: Option<RepositorySnapshot>,
    refresh_error: Option<String>,
    verification_warning: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedProject {
    root: String,
    repository: Option<RepositorySnapshot>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ImagePreview {
    path: String,
    media_type: String,
    data_url: String,
    width: u32,
    height: u32,
    byte_length: usize,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ImageDiffPreview {
    path: String,
    before: Option<ImagePreview>,
    after: Option<ImagePreview>,
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

fn window_chrome_mode_for(is_macos: bool) -> &'static str {
    if is_macos {
        "macos-native"
    } else {
        "custom-right"
    }
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

fn exact_git_repository(root: &Path) -> Result<Option<GitRepository>, WorkspaceError> {
    match GitRepository::open(root) {
        Ok(repository) => {
            let discovered =
                std::fs::canonicalize(repository.root()).map_err(|error| WorkspaceError::Io {
                    operation: "resolve discovered Git root".to_string(),
                    message: error.to_string(),
                })?;
            Ok((discovered == root).then_some(repository))
        }
        Err(error) if root.join(".git").exists() => Err(WorkspaceError::Io {
            operation: "open Git project".to_string(),
            message: error.to_string(),
        }),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn list_project_files(
    repository_root: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ProjectFileList, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    run_workspace_blocking("list project files", move || load_project_catalog(&root)).await
}

fn load_project_catalog(root: &Path) -> Result<ProjectFileList, WorkspaceError> {
    if let Some(repository) = exact_git_repository(root)? {
        return repository
            .project_files(PROJECT_FILE_LIMIT)
            .map_err(|error| WorkspaceError::Io {
                operation: "list Git project files".to_string(),
                message: error.to_string(),
            });
    }
    let catalog = Workspace::open(root)?.list_files(PROJECT_FILE_LIMIT)?;
    let root = root.to_string_lossy().into_owned();
    let files = catalog
        .paths
        .iter()
        .map(|path| ProjectFile {
            repository_id: "workspace".to_string(),
            path: path.clone(),
            workspace_path: path.clone(),
        })
        .collect();
    Ok(ProjectFileList {
        root,
        paths: catalog.paths,
        files,
        ignored_entries: Vec::new(),
        repository_roots: Vec::new(),
        truncated: catalog.truncated,
    })
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
    let cancellation = searches.register(&window_label, &repository_root, &request_id)?;

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

    searches.finish(&window_label, &repository_root, &request_id, &cancellation)?;
    result
}

#[tauri::command]
fn cancel_workspace_text_search(
    repository_root: String,
    request_id: String,
    window: tauri::WebviewWindow,
    searches: State<'_, WorkspaceSearchRegistry>,
) -> Result<(), WorkspaceError> {
    searches.cancel(window.label().to_string(), repository_root, request_id)
}

fn search_authorized_workspace(
    root: &Path,
    request_id: &str,
    query: &str,
    options: &SearchOptions,
    cancellation: &SearchCancellationToken,
) -> Result<WorkspaceTextSearchReport, WorkspaceError> {
    let catalog = load_project_catalog(root)?;
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
    let cancellation = replacements.register(&window_label, &repository_root, &plan_id)?;
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

    match result {
        Ok((stored, preview)) => {
            replacements.finish_preview(
                &window_label,
                &repository_root,
                &plan_id,
                &cancellation,
                Some(stored),
            )?;
            Ok(preview)
        }
        Err(error) => {
            replacements.finish_preview(
                &window_label,
                &repository_root,
                &plan_id,
                &cancellation,
                None,
            )?;
            Err(error)
        }
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
    let (stored, cancellation) =
        replacements.start_application(&window_label, &repository_root, &root, &plan_id)?;
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

    replacements.finish_application(&window_label, &repository_root, &plan_id, &cancellation)?;
    result
}

#[tauri::command]
fn cancel_workspace_replacement(
    repository_root: String,
    operation_id: String,
    window: tauri::WebviewWindow,
    replacements: State<'_, WorkspaceReplacementRegistry>,
) -> Result<(), WorkspaceError> {
    replacements.cancel(window.label().to_string(), repository_root, operation_id)
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
    let catalog = load_project_catalog(root)?;
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
    let current = load_project_catalog(root)?;
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
async fn read_image_file(
    repository_root: String,
    repository_id: String,
    path: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ImagePreview, WorkspaceError> {
    let root = active_workspaces.resolve(window.label(), &repository_root)?;
    run_workspace_blocking("read image file", move || {
        let authorized = authorize_project_file(&root, &repository_id, &path)?;
        let snapshot = Workspace::open(&root)?
            .read_binary_file(&authorized.workspace_path, IMAGE_PREVIEW_LIMIT_BYTES)?;
        encode_image_preview(&snapshot.workspace_path, snapshot.bytes)
            .map_err(|message| WorkspaceError::UnsupportedFile { message })
    })
    .await
}

#[tauri::command]
async fn read_local_image_diff(
    repository_root: String,
    selected: FileChange,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ImageDiffPreview, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read local image diff", move || {
        let diff = GitRepository::open(root)?.local_binary_diff(&selected)?;
        encode_image_diff(diff.path, diff.before, diff.after)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn read_commit_image_diff(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    path: String,
    original_path: Option<String>,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<ImageDiffPreview, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read commit image diff", move || {
        let diff = GitRepository::open(root)?.repository_commit_binary_diff(
            &repository_id,
            &commit_oid,
            &path,
            original_path.as_deref(),
        )?;
        encode_image_diff(diff.path, diff.before, diff.after)
    })
    .await
}

fn encode_image_diff(
    path: String,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
) -> Result<ImageDiffPreview, GitError> {
    let before = before
        .map(|bytes| encode_image_preview(&path, bytes))
        .transpose()
        .map_err(image_preview_git_error)?;
    let after = after
        .map(|bytes| encode_image_preview(&path, bytes))
        .transpose()
        .map_err(image_preview_git_error)?;
    let pixels = before
        .as_ref()
        .map(image_pixels)
        .unwrap_or(0)
        .saturating_add(after.as_ref().map(image_pixels).unwrap_or(0));
    if pixels > IMAGE_DIFF_LIMIT_PIXELS {
        return Err(image_preview_git_error(format!(
            "image Diff is limited to {IMAGE_DIFF_LIMIT_PIXELS} decoded pixels across both sides"
        )));
    }
    Ok(ImageDiffPreview {
        path,
        before,
        after,
    })
}

fn image_preview_git_error(message: String) -> GitError {
    GitError::InvalidInput {
        field: "image preview".to_string(),
        message,
    }
}

fn image_pixels(image: &ImagePreview) -> u64 {
    u64::from(image.width).saturating_mul(u64::from(image.height))
}

fn encode_image_preview(path: &str, bytes: Vec<u8>) -> Result<ImagePreview, String> {
    if bytes.len() > IMAGE_PREVIEW_LIMIT_BYTES {
        return Err(format!(
            "image preview is limited to {IMAGE_PREVIEW_LIMIT_BYTES} bytes per file"
        ));
    }
    let (media_type, width, height) = inspect_image(&bytes)?;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if width == 0 || height == 0 || pixels > IMAGE_PREVIEW_LIMIT_PIXELS {
        return Err(format!(
            "image preview is limited to {IMAGE_PREVIEW_LIMIT_PIXELS} decoded pixels per file"
        ));
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(ImagePreview {
        path: path.to_string(),
        media_type: media_type.to_string(),
        data_url: format!("data:{media_type};base64,{encoded}"),
        width,
        height,
        byte_length: bytes.len(),
    })
}

fn inspect_image(bytes: &[u8]) -> Result<(&'static str, u32, u32), String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24 {
        if png_has_animation(bytes)? {
            return Err("animated PNG preview is not supported".to_string());
        }
        return Ok((
            "image/png",
            u32::from_be_bytes(bytes[16..20].try_into().expect("PNG width slice")),
            u32::from_be_bytes(bytes[20..24].try_into().expect("PNG height slice")),
        ));
    }
    if bytes.starts_with(b"\xff\xd8") {
        let (width, height) = jpeg_dimensions(bytes)?;
        return Ok(("image/jpeg", width, height));
    }
    if (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) && bytes.len() >= 13 {
        if gif_frame_count(bytes)? > 1 {
            return Err("animated GIF preview is not supported".to_string());
        }
        return Ok((
            "image/gif",
            u32::from(u16::from_le_bytes([bytes[6], bytes[7]])),
            u32::from(u16::from_le_bytes([bytes[8], bytes[9]])),
        ));
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        let (width, height, animated) = webp_dimensions(bytes)?;
        if animated {
            return Err("animated WebP preview is not supported".to_string());
        }
        return Ok(("image/webp", width, height));
    }
    if bytes.starts_with(b"BM") && bytes.len() >= 26 {
        let width = i32::from_le_bytes(bytes[18..22].try_into().expect("BMP width slice"));
        let height = i32::from_le_bytes(bytes[22..26].try_into().expect("BMP height slice"));
        return Ok(("image/bmp", width.unsigned_abs(), height.unsigned_abs()));
    }
    if bytes.starts_with(b"\0\0\x01\0") && bytes.len() >= 6 {
        let count = usize::from(u16::from_le_bytes([bytes[4], bytes[5]]));
        if count == 0 || bytes.len() < 6 + count.saturating_mul(16) {
            return Err("the ICO directory is incomplete".to_string());
        }
        let mut width = 0_u32;
        let mut height = 0_u32;
        for entry in bytes[6..6 + count * 16].chunks_exact(16) {
            width = width.max(if entry[0] == 0 {
                256
            } else {
                u32::from(entry[0])
            });
            height = height.max(if entry[1] == 0 {
                256
            } else {
                u32::from(entry[1])
            });
        }
        return Ok(("image/x-icon", width, height));
    }
    Err("supported image formats are PNG, JPEG, static GIF, static WebP, BMP, and ICO".to_string())
}

fn png_has_animation(bytes: &[u8]) -> Result<bool, String> {
    let mut cursor = 8_usize;
    while cursor + 12 <= bytes.len() {
        let length = u32::from_be_bytes(
            bytes[cursor..cursor + 4]
                .try_into()
                .expect("PNG chunk length slice"),
        ) as usize;
        let end = cursor.saturating_add(12).saturating_add(length);
        if end > bytes.len() {
            return Err("the PNG chunk table is incomplete".to_string());
        }
        let kind = &bytes[cursor + 4..cursor + 8];
        if kind == b"acTL" {
            return Ok(true);
        }
        cursor = end;
        if kind == b"IEND" {
            return Ok(false);
        }
    }
    Err("the PNG end marker is missing".to_string())
}

fn jpeg_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let mut cursor = 2_usize;
    while cursor + 4 <= bytes.len() {
        if bytes[cursor] != 0xff {
            cursor += 1;
            continue;
        }
        while cursor < bytes.len() && bytes[cursor] == 0xff {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            break;
        }
        let marker = bytes[cursor];
        cursor += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if cursor + 2 > bytes.len() {
            break;
        }
        let length = usize::from(u16::from_be_bytes([bytes[cursor], bytes[cursor + 1]]));
        if length < 2 || cursor + length > bytes.len() {
            return Err("the JPEG segment table is incomplete".to_string());
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if length < 7 {
                return Err("the JPEG size segment is incomplete".to_string());
            }
            let height = u32::from(u16::from_be_bytes([bytes[cursor + 3], bytes[cursor + 4]]));
            let width = u32::from(u16::from_be_bytes([bytes[cursor + 5], bytes[cursor + 6]]));
            return Ok((width, height));
        }
        cursor += length;
    }
    Err("the JPEG dimensions could not be read".to_string())
}

fn gif_frame_count(bytes: &[u8]) -> Result<usize, String> {
    let packed = bytes[10];
    let table_bytes = if packed & 0x80 != 0 {
        3_usize << ((packed & 0x07) + 1)
    } else {
        0
    };
    let mut cursor = 13_usize.saturating_add(table_bytes);
    let mut frames = 0_usize;
    while cursor < bytes.len() {
        match bytes[cursor] {
            0x3b => return Ok(frames),
            0x2c => {
                frames += 1;
                if frames > 1 {
                    return Ok(frames);
                }
                if cursor + 10 > bytes.len() {
                    return Err("the GIF image descriptor is incomplete".to_string());
                }
                let local = bytes[cursor + 9];
                cursor += 10;
                if local & 0x80 != 0 {
                    cursor = cursor.saturating_add(3_usize << ((local & 0x07) + 1));
                }
                if cursor >= bytes.len() {
                    return Err("the GIF image data is incomplete".to_string());
                }
                cursor += 1;
                cursor = skip_gif_sub_blocks(bytes, cursor)?;
            }
            0x21 => {
                if cursor + 2 > bytes.len() {
                    return Err("the GIF extension is incomplete".to_string());
                }
                cursor = skip_gif_sub_blocks(bytes, cursor + 2)?;
            }
            _ => return Err("the GIF block stream is invalid".to_string()),
        }
    }
    Err("the GIF trailer is missing".to_string())
}

fn skip_gif_sub_blocks(bytes: &[u8], mut cursor: usize) -> Result<usize, String> {
    loop {
        let Some(&length) = bytes.get(cursor) else {
            return Err("the GIF data blocks are incomplete".to_string());
        };
        cursor += 1;
        if length == 0 {
            return Ok(cursor);
        }
        cursor = cursor.saturating_add(usize::from(length));
        if cursor > bytes.len() {
            return Err("the GIF data blocks are incomplete".to_string());
        }
    }
}

fn webp_dimensions(bytes: &[u8]) -> Result<(u32, u32, bool), String> {
    let mut cursor = 12_usize;
    let mut dimensions = None;
    let mut animated = false;
    while cursor + 8 <= bytes.len() {
        let kind = &bytes[cursor..cursor + 4];
        let length = u32::from_le_bytes(
            bytes[cursor + 4..cursor + 8]
                .try_into()
                .expect("WebP length slice"),
        ) as usize;
        let body = cursor + 8;
        let end = body.saturating_add(length);
        if end > bytes.len() {
            return Err("the WebP chunk table is incomplete".to_string());
        }
        if kind == b"ANIM" {
            animated = true;
        } else if kind == b"VP8X" && length >= 10 {
            animated |= bytes[body] & 0x02 != 0;
            let width = 1
                + u32::from(bytes[body + 4])
                + (u32::from(bytes[body + 5]) << 8)
                + (u32::from(bytes[body + 6]) << 16);
            let height = 1
                + u32::from(bytes[body + 7])
                + (u32::from(bytes[body + 8]) << 8)
                + (u32::from(bytes[body + 9]) << 16);
            dimensions = Some((width, height));
        } else if kind == b"VP8 " && length >= 10 && bytes[body + 3..body + 6] == [0x9d, 0x01, 0x2a]
        {
            let width = u32::from(u16::from_le_bytes([bytes[body + 6], bytes[body + 7]]) & 0x3fff);
            let height = u32::from(u16::from_le_bytes([bytes[body + 8], bytes[body + 9]]) & 0x3fff);
            dimensions.get_or_insert((width, height));
        } else if kind == b"VP8L" && length >= 5 && bytes[body] == 0x2f {
            let width = 1 + u32::from(bytes[body + 1]) + (u32::from(bytes[body + 2] & 0x3f) << 8);
            let height = 1
                + u32::from(bytes[body + 2] >> 6)
                + (u32::from(bytes[body + 3]) << 2)
                + (u32::from(bytes[body + 4] & 0x0f) << 10);
            dimensions.get_or_insert((width, height));
        }
        cursor = end.saturating_add(length & 1);
    }
    dimensions
        .map(|(width, height)| (width, height, animated))
        .ok_or_else(|| "the WebP dimensions could not be read".to_string())
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
    if let Some(repository) = exact_git_repository(root)? {
        return repository
            .authorize_project_file(repository_id, path, PROJECT_FILE_LIMIT)
            .map_err(|_| WorkspaceError::NotAuthorized {
                message: "select a current tracked or non-ignored project file".to_string(),
            });
    }
    if repository_id != "workspace" {
        return Err(WorkspaceError::NotAuthorized {
            message: "select a current file from the active ordinary folder".to_string(),
        });
    }
    let catalog = Workspace::open(root)?.list_files(PROJECT_FILE_LIMIT)?;
    if !catalog.paths.iter().any(|candidate| candidate == path) {
        return Err(WorkspaceError::NotAuthorized {
            message: "select a current file from the active ordinary folder catalog".to_string(),
        });
    }
    Ok(ProjectFile {
        repository_id: repository_id.to_string(),
        path: path.to_string(),
        workspace_path: path.to_string(),
    })
}

#[tauri::command]
async fn read_commit_details(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitDetails, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read commit details", move || {
        GitRepository::open(root)?.repository_commit_details(&repository_id, &commit_oid)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn read_commit_diff(
    repository_root: String,
    repository_id: String,
    commit_oid: String,
    path: String,
    original_path: Option<String>,
    expanded_unchanged: bool,
    window: tauri::WebviewWindow,
    active_workspaces: State<'_, ActiveWorkspaces>,
) -> Result<CommitDiffResult, GitError> {
    let root = active_workspaces.require_git(window.label(), &repository_root)?;
    run_blocking("read commit diff", move || {
        GitRepository::open(root)?.repository_commit_diff_with_unchanged(
            &repository_id,
            &commit_oid,
            &path,
            original_path.as_deref(),
            expanded_unchanged,
        )
    })
    .await
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
        .manage(GitOperationCoordinator::default())
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
                window
                    .state::<WorkspaceSearchRegistry>()
                    .remove_window(window.label());
                window
                    .state::<WorkspaceReplacementRegistry>()
                    .remove_window(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            initial_repository,
            window_chrome_mode,
            open_project,
            open_repository_window,
            read_tracked_changes,
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
            read_image_file,
            save_text_file,
            read_diff,
            read_local_diff,
            read_local_image_diff,
            read_commit_details,
            read_commit_diff,
            read_commit_image_diff,
            stage_paths,
            unstage_paths,
            commit_changes,
            revert_changes,
            switch_branch,
            create_branch,
            fetch_remote,
            read_push_preview,
            read_push_file_commit,
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
    use std::sync::Arc;

    fn png(width: u32, height: u32, animated: bool) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&13_u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes.extend_from_slice(&[0; 4]);
        if animated {
            bytes.extend_from_slice(&8_u32.to_be_bytes());
            bytes.extend_from_slice(b"acTL");
            bytes.extend_from_slice(&1_u32.to_be_bytes());
            bytes.extend_from_slice(&0_u32.to_be_bytes());
            bytes.extend_from_slice(&[0; 4]);
        }
        bytes.extend_from_slice(&0_u32.to_be_bytes());
        bytes.extend_from_slice(b"IEND");
        bytes.extend_from_slice(&[0; 4]);
        bytes
    }

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
    fn project_navigation_catalog_exceeds_the_search_scan_budget() {
        let directory = tempfile::tempdir().expect("temporary repository");
        git(directory.path(), &["init", "-b", "main"]);
        for module in 0..51 {
            let module_path = directory.path().join(format!("module-{module:02}"));
            fs::create_dir(&module_path).expect("module directory");
            let file_count = if module == 50 { 1 } else { 100 };
            for file in 0..file_count {
                fs::write(
                    module_path.join(format!("source-{file:03}.txt")),
                    b"fixture\n",
                )
                .expect("project file");
            }
        }

        let catalog = GitRepository::open(directory.path())
            .and_then(|repository| repository.project_files(PROJECT_FILE_LIMIT))
            .expect("navigation catalog");
        assert_eq!(catalog.files.len(), 5_001);
        assert!(!catalog.truncated);
        assert_eq!(WORKSPACE_SEARCH_LIMITS.max_candidates, 5_000);
        assert!(catalog.files.len() > WORKSPACE_SEARCH_LIMITS.max_candidates);
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
        let registry = WorkspaceReplacementRegistry::default();
        registry.store("main", first).expect("store first plan");
        registry
            .store("main", second.clone())
            .expect("replace first plan");
        registry
            .store("project-1", second)
            .expect("store other-window plan");
        assert!(registry.plan("main", &canonical, "plan-one").is_err());
        assert!(registry.plan("main", &canonical, "plan-two").is_ok());
        assert!(registry.plan("project-1", &canonical, "plan-two").is_ok());
        registry
            .cancel(
                "main".to_string(),
                canonical.to_string_lossy().to_string(),
                "plan-two".to_string(),
            )
            .expect("cancel stored plan");
        assert!(registry.plan("main", &canonical, "plan-two").is_err());
        assert!(registry.plan("project-1", &canonical, "plan-two").is_ok());
        assert!(
            !registry
                .register("main", &canonical.to_string_lossy(), "plan-two")
                .expect("register removed plan id")
                .is_cancelled()
        );

        registry
            .cancel(
                "main".to_string(),
                "/repo".to_string(),
                "cancelled".to_string(),
            )
            .expect("queue cancellation");
        assert!(
            registry
                .register("main", "/repo", "cancelled")
                .expect("register pre-cancelled operation")
                .is_cancelled()
        );
        let active = registry
            .register("main", "/repo", "active")
            .expect("register active operation");
        registry
            .cancel(
                "main".to_string(),
                "/repo".to_string(),
                "active".to_string(),
            )
            .expect("cancel active operation");
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
            .activate("main", first.path(), false)
            .expect("first workspace activates");
        active
            .activate("project-1", second.path(), true)
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
        assert!(matches!(
            active.require_git("main", &first_path),
            Err(GitError::InvalidInput { .. })
        ));
        assert_eq!(
            active
                .require_git("project-1", &second_path)
                .expect("Git workspace resolves"),
            std::fs::canonicalize(second.path()).expect("canonical second root")
        );
        active.remove("main");
        assert!(matches!(
            active.resolve("main", &first_path),
            Err(WorkspaceError::NotAuthorized { .. })
        ));
    }

    #[test]
    fn ordinary_folder_catalog_is_explicit_and_nested_git_folders_stay_ordinary() {
        let directory = tempfile::tempdir().expect("ordinary workspace");
        fs::write(directory.path().join("notes.txt"), "notes\n").expect("ordinary file");
        let catalog = load_project_catalog(directory.path()).expect("ordinary catalog");
        assert_eq!(catalog.paths, ["notes.txt"]);
        assert_eq!(catalog.files[0].repository_id, "workspace");
        assert!(catalog.repository_roots.is_empty());

        let repository = directory.path().join("repository");
        let nested = repository.join("nested");
        fs::create_dir_all(&nested).expect("nested folder");
        git(&repository, &["init", "-b", "main"]);
        assert!(
            exact_git_repository(&repository)
                .expect("repository detection")
                .is_some()
        );
        assert!(
            exact_git_repository(&nested)
                .expect("nested detection")
                .is_none()
        );
    }

    #[test]
    fn image_preview_accepts_static_png_and_rejects_animation_and_pixel_bombs() {
        let preview =
            encode_image_preview("image.png", png(320, 200, false)).expect("static PNG preview");
        assert_eq!(preview.media_type, "image/png");
        assert_eq!((preview.width, preview.height), (320, 200));
        assert!(preview.data_url.starts_with("data:image/png;base64,"));

        assert!(
            encode_image_preview("animated.png", png(32, 32, true))
                .expect_err("APNG is rejected")
                .contains("animated PNG")
        );
        assert!(
            encode_image_preview("large.png", png(8_000, 8_000, false))
                .expect_err("pixel bomb is rejected")
                .contains("decoded pixels")
        );
        assert!(
            encode_image_preview("fake.png", b"not an image".to_vec())
                .expect_err("signature is authoritative")
                .contains("supported image formats")
        );
        assert!(
            encode_image_preview("oversized.png", vec![0; IMAGE_PREVIEW_LIMIT_BYTES + 1])
                .expect_err("encoded source limit is enforced")
                .contains("bytes per file")
        );
        assert!(matches!(
            encode_image_diff(
                "wide.png".to_string(),
                Some(png(4_000, 4_000, false)),
                Some(png(4_000, 4_000, false)),
            ),
            Err(GitError::InvalidInput { .. })
        ));
    }

    #[test]
    fn image_preview_recognizes_every_advertised_static_format() {
        let jpeg = [
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x03, 0x00, 0x05, 0xff, 0xd9,
        ];
        assert_eq!(inspect_image(&jpeg), Ok(("image/jpeg", 5, 3)));

        let mut gif = b"GIF89a\x02\x00\x03\x00\x00\x00\x00".to_vec();
        gif.extend_from_slice(&[0x2c, 0, 0, 0, 0, 2, 0, 3, 0, 0, 2, 1, 0, 0, 0x3b]);
        assert_eq!(inspect_image(&gif), Ok(("image/gif", 2, 3)));

        let mut webp = b"RIFF\x12\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00".to_vec();
        webp.extend_from_slice(&[0, 0, 0, 0, 4, 0, 0, 2, 0, 0]);
        assert_eq!(inspect_image(&webp), Ok(("image/webp", 5, 3)));

        let mut bmp = vec![0; 26];
        bmp[..2].copy_from_slice(b"BM");
        bmp[18..22].copy_from_slice(&5_i32.to_le_bytes());
        bmp[22..26].copy_from_slice(&(-3_i32).to_le_bytes());
        assert_eq!(inspect_image(&bmp), Ok(("image/bmp", 5, 3)));

        let mut ico = vec![0; 22];
        ico[..6].copy_from_slice(&[0, 0, 1, 0, 1, 0]);
        ico[6] = 5;
        ico[7] = 3;
        assert_eq!(inspect_image(&ico), Ok(("image/x-icon", 5, 3)));

        let first_frame = gif.len() - 1;
        gif.splice(
            first_frame..first_frame,
            [0x2c, 0, 0, 0, 0, 2, 0, 3, 0, 0, 2, 1, 0, 0],
        );
        assert!(
            inspect_image(&gif)
                .expect_err("animated GIF is rejected")
                .contains("animated GIF")
        );

        webp[20] = 0x02;
        assert!(
            inspect_image(&webp)
                .expect_err("animated WebP is rejected")
                .contains("animated WebP")
        );
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
        let (_, _, main) = scans
            .register("main", "1-1".to_string())
            .expect("main scan");
        let (_, _, second) = scans
            .register("project-1", "1-1".to_string())
            .expect("second scan");
        scans.remove_window("main");
        assert!(main.is_cancelled());
        assert!(!second.is_cancelled());
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
    fn git_mutation_registry_serializes_only_matching_roots() {
        let registry = GitMutationRegistry::default();
        let first = registry.lock_for("root-a".to_string()).expect("lock");
        let same = registry.lock_for("root-a".to_string()).expect("same lock");
        let other = registry.lock_for("root-b".to_string()).expect("other lock");

        assert!(Arc::ptr_eq(&first, &same));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[test]
    fn remote_registry_serializes_by_repository_and_cancels_exact_ids() {
        let registry = RemoteOperationRegistry::default();
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
        registry
            .cancel("/repo".to_string(), "wrong".to_string())
            .expect("wrong id is retained");
        assert!(!first.is_cancelled());
        assert!(!other.is_cancelled());

        registry
            .cancel("/repo".to_string(), "one".to_string())
            .expect("exact operation cancels");
        assert!(first.is_cancelled());
        registry
            .finish("/repo", "one", &first)
            .expect("finished operation is removed");

        registry
            .cancel("/future".to_string(), "queued".to_string())
            .expect("future cancellation is retained");
        let queued = registry
            .register("/future", "queued", "pull")
            .expect("pre-cancelled operation registers as cancelled");
        assert!(queued.is_cancelled());
    }

    #[test]
    fn workspace_search_registry_supersedes_and_finishes_exact_requests() {
        let registry = WorkspaceSearchRegistry::default();
        let first = registry
            .register("main", "/repo", "one")
            .expect("register first request");
        let second = registry
            .register("main", "/repo", "two")
            .expect("register replacement request");
        let other_window = registry
            .register("project-1", "/repo", "one")
            .expect("register other-window request");
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
        assert!(!other_window.is_cancelled());

        registry
            .finish("main", "/repo", "one", &first)
            .expect("ignore stale finish");

        registry
            .cancel("main".to_string(), "/repo".to_string(), "wrong".to_string())
            .expect("retain nonmatching cancellation");
        assert!(!second.is_cancelled());
        assert!(!other_window.is_cancelled());
        registry
            .cancel("main".to_string(), "/repo".to_string(), "two".to_string())
            .expect("cancel exact request");
        assert!(second.is_cancelled());

        registry
            .cancel(
                "main".to_string(),
                "/future".to_string(),
                "queued".to_string(),
            )
            .expect("queue future cancellation");
        let queued = registry
            .register("main", "/future", "queued")
            .expect("register queued request");
        assert!(queued.is_cancelled());

        registry.remove_window("project-1");
        assert!(other_window.is_cancelled());
    }
}
