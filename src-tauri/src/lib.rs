use std::collections::HashSet;
use std::path::{Path, PathBuf};

use asterlyn_git::{
    BranchMutationPlan, BranchMutationRequest, CommitComparisonDetails, CommitComparisonDiffResult,
    CommitDetails, CommitDiffResult, CommitFileChange, DiffResult, FileChange, GitBlameResult,
    GitConflictContent, GitError, GitOperationAction, GitOperationKind, GitOperationPlan,
    GitOperationSnapshot, GitRepository, GitResetMode, GitResetPlan, HeadCommitMutationKind,
    HistoryPage, HistoryQuery, ProjectFile, ProjectFileList, PushMode, PushPreview, PushTagMode,
    RemoteAuthenticationStatus, RemoteMutationPlan, RemoteMutationRequest, RepositoryPushTarget,
    RepositoryReadPlan, RepositorySliceSnapshot, RepositorySnapshot, StashCatalog,
    StashMutationKind, StashMutationRequest, TagMutationKind, TagMutationRequest,
    TrackedChangeScan, UntrackedScan, WorktreeCreationPlan, WorktreeCreationRequest,
};
use asterlyn_terminal::TerminalSessions;
use asterlyn_workspace::{
    BinaryFileSnapshot, ReplacementApplyResult, ReplacementRecoverySummary, SaveTextFileResult,
    SearchOptions, TextFileSnapshot, Workspace, WorkspaceCollisionPolicy, WorkspaceError,
    WorkspaceMutationLimits, WorkspaceMutationOperation, WorkspaceMutationOutcome,
    WorkspaceMutationRecoverySummary,
};
#[cfg(test)]
use asterlyn_workspace::{SearchCancellationToken, SearchMode};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

mod adapters;
mod application;
mod commands;

use adapters::commit_file_comparison::{CommitFileComparison, compare_commit_file};
use adapters::commit_file_preview::{CommitFilePreview, commit_file_preview};
#[cfg(test)]
use adapters::image_preview::inspect_image;
use adapters::image_preview::{
    IMAGE_PREVIEW_LIMIT_BYTES, ImageDiffPreview, ImagePreview, encode_image_diff,
    encode_image_preview,
};
use adapters::system_file_clipboard::{
    SystemFileClipboardEntry, read_system_file_clipboard, write_system_file_clipboard,
};
use adapters::working_diff::{WorkingDiffBase, working_diff_base};
use application::{
    ActiveWorkspaces, CommitFileRestoreRegistry, DiagnosticsLog, GitOperationCoordinator,
    HistoryPageCacheRegistry, LanguageServiceManager, PendingRepositoryWindowReservation,
    PendingRepositoryWindows, PluginMarketplaceCoordinator, PluginProcessQueryManager,
    ScanRegistry, TaskManager, WorkspaceEntryInspection, WorkspaceMutationCoordinator,
    WorkspaceMutationPreview, WorkspaceReplacementDiff, WorkspaceReplacementPreview,
    WorkspaceReplacementRegistry, WorkspaceSearchIndexRegistry, WorkspaceSearchRegistry,
    WorkspaceTextSearchReport, WorkspaceWatchService, WorkspaceWatchStatus, WorkspaceWriteRegistry,
    acknowledge_workspace_mutation_recovery as acknowledge_workspace_mutation_recovery_application,
    apply_authorized_replacement, build_plugin_host_supervisor, exact_git_repository,
    execute_workspace_mutation_plan, finalize_replacement, finalize_workspace_mutation_recovery,
    inspect_workspace_entry_inventory, list_replacement_recoveries, load_ignored_project_directory,
    load_project_catalog, load_workspace_mutation_recoveries, prepare_authorized_replacement,
    prepare_workspace_mutation_plan, read_session_text_file, reauthorize_session_file_for_read,
    resolve_workspace_entry, rollback_replacement, rollback_workspace_mutation_recovery,
    save_session_text_file, search_authorized_workspace_with_index,
    supervise_plugin_host_terminations,
};
#[cfg(test)]
use application::{
    GitMutationRegistry, PROJECT_FILE_LIMIT, RemoteOperationRegistry, read_authorized_text_file,
    save_authorized_text_file, search_authorized_workspace,
};
pub use application::{WORKSPACE_REPLACEMENT_LIMITS, WORKSPACE_SEARCH_LIMITS};
use asterlyn_plugin_runtime::PluginHostSupervisor;
use asterlyn_plugin_runtime_protocol::ShutdownReason;
use commands::*;

const COMMIT_LIMIT: usize = 150;
const PROJECT_WINDOW_WIDTH: f64 = 1320.0;
const PROJECT_WINDOW_HEIGHT: f64 = 820.0;
const PROJECT_WINDOW_MIN_WIDTH: f64 = 920.0;
const PROJECT_WINDOW_MIN_HEIGHT: f64 = 600.0;
const MIN_VISIBLE_WINDOW_WIDTH: i64 = 96;
const MIN_VISIBLE_WINDOW_HEIGHT: i64 = 48;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitSelectedResult {
    oid: Option<String>,
    snapshot: Option<RepositorySnapshot>,
    invalidated_slices: Vec<RepositoryStateSlice>,
    refresh_error: Option<String>,
    verification_warning: Option<String>,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord,
)]
#[serde(rename_all = "camelCase")]
enum RepositoryStateSlice {
    WorkspaceCatalog,
    OpenDocuments,
    RepositoryCapability,
    WorkingTree,
    Head,
    Refs,
    History,
    Operation,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryMutationOutcome {
    snapshot: RepositorySnapshot,
    invalidated_slices: Vec<RepositoryStateSlice>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkingTreeMutationOutcome {
    tracked: TrackedChangeScan,
    invalidated_slices: Vec<RepositoryStateSlice>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GitOperationMutationOutcome {
    tracked: TrackedChangeScan,
    operation: Option<GitOperationSnapshot>,
    invalidated_slices: Vec<RepositoryStateSlice>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedProject {
    root: String,
    repository: Option<RepositorySnapshot>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum ProjectWindowMatch {
    NotOpen,
    Current,
    FocusedExisting,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWindowOpenResult {
    window_label: String,
    focused_existing: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositorySliceProject {
    root: String,
    repository: Option<RepositorySliceSnapshot>,
}

fn window_chrome_mode_for(is_macos: bool) -> &'static str {
    if is_macos {
        "macos-native"
    } else {
        "custom-right"
    }
}

fn window_has_usable_monitor_intersection(
    window_position: PhysicalPosition<i32>,
    window_size: PhysicalSize<u32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
) -> bool {
    let window_left = i64::from(window_position.x);
    let window_top = i64::from(window_position.y);
    let window_right = window_left + i64::from(window_size.width);
    let window_bottom = window_top + i64::from(window_size.height);
    let monitor_left = i64::from(monitor_position.x);
    let monitor_top = i64::from(monitor_position.y);
    let monitor_right = monitor_left + i64::from(monitor_size.width);
    let monitor_bottom = monitor_top + i64::from(monitor_size.height);
    let visible_width = window_right.min(monitor_right) - window_left.max(monitor_left);
    let visible_height = window_bottom.min(monitor_bottom) - window_top.max(monitor_top);
    let required_width = MIN_VISIBLE_WINDOW_WIDTH.min(i64::from(window_size.width));
    let required_height = MIN_VISIBLE_WINDOW_HEIGHT.min(i64::from(window_size.height));
    visible_width >= required_width && visible_height >= required_height
}

fn centered_window_position(
    window_size: PhysicalSize<u32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let offset_x = monitor_size.width.saturating_sub(window_size.width) / 2;
    let offset_y = monitor_size.height.saturating_sub(window_size.height) / 2;
    PhysicalPosition::new(
        monitor_position
            .x
            .saturating_add(i32::try_from(offset_x).unwrap_or(i32::MAX)),
        monitor_position
            .y
            .saturating_add(i32::try_from(offset_y).unwrap_or(i32::MAX)),
    )
}

fn ensure_window_is_visible(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let monitors = window.available_monitors()?;
    if monitors.iter().any(|monitor| {
        window_has_usable_monitor_intersection(position, size, *monitor.position(), *monitor.size())
    }) {
        return Ok(());
    }
    if let Some(monitor) = window
        .primary_monitor()?
        .or_else(|| monitors.into_iter().next())
    {
        window.set_position(centered_window_position(
            size,
            *monitor.position(),
            *monitor.size(),
        ))?;
    }
    Ok(())
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

    let window = builder.visible(true).focused(true).build()?;
    window.show()?;
    ensure_window_is_visible(&window)?;
    window.set_focus()?;
    Ok(window)
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
    let writes = WorkspaceWriteRegistry::default();
    let workspace_mutations = WorkspaceMutationCoordinator::new(writes.clone());
    let commit_file_restores = CommitFileRestoreRegistry::new(writes.clone());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ScanRegistry::default())
        .manage(GitOperationCoordinator::new(writes.clone()))
        .manage(HistoryPageCacheRegistry::default())
        .manage(ActiveWorkspaces::default())
        .manage(PendingRepositoryWindows::default())
        .manage(writes)
        .manage(WorkspaceSearchRegistry::default())
        .manage(WorkspaceSearchIndexRegistry::default())
        .manage(WorkspaceReplacementRegistry::default())
        .manage(workspace_mutations)
        .manage(commit_file_restores)
        .manage(WorkspaceWatchService::default())
        .manage(TerminalSessions::default())
        .manage(TaskManager::default())
        .manage(PluginMarketplaceCoordinator::default())
        .manage(PluginProcessQueryManager::default())
        .manage(LanguageServiceManager::default())
        .setup(|app| {
            let diagnostics = app
                .path()
                .app_log_dir()
                .map(|directory| DiagnosticsLog::open(directory.join("diagnostics")))
                .unwrap_or_else(|_| DiagnosticsLog::memory_only());
            diagnostics.install_panic_hook();
            app.state::<GitOperationCoordinator>()
                .install_diagnostics(diagnostics.clone())
                .map_err(std::io::Error::other)?;
            diagnostics.info(
                "host",
                "application.starting",
                None,
                serde_json::json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "buildId": env!("ASTERLYN_BUILD_ID"),
                    "os": std::env::consts::OS,
                    "architecture": std::env::consts::ARCH,
                    "processId": std::process::id(),
                }),
            );
            app.manage(diagnostics);
            ensure_bundled_plugins(app.handle()).map_err(std::io::Error::other)?;
            recover_interrupted_plugin_activations(app.handle()).map_err(std::io::Error::other)?;
            let plugin_hosts = build_plugin_host_supervisor(app.handle().clone())
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            supervise_plugin_host_terminations(app.handle().clone(), &plugin_hosts)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(plugin_hosts);
            build_project_window(app.handle(), "main", "Asterlyn")?;
            app.state::<DiagnosticsLog>().info(
                "host",
                "application.native_ready",
                None,
                serde_json::json!({"buildId": env!("ASTERLYN_BUILD_ID")}),
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                window
                    .state::<LanguageServiceManager>()
                    .cancel_owner(window.label());
                window.state::<ScanRegistry>().remove_window(window.label());
                window.state::<TaskManager>().cancel_owner(window.label());
                window
                    .state::<PluginProcessQueryManager>()
                    .cancel_owner(window.label());
                window
                    .state::<PluginHostSupervisor>()
                    .cancel_owner(window.label(), ShutdownReason::WindowClosed);
                if window.state::<PluginHostSupervisor>().active_count() == 0 {
                    let _ = abandon_plugin_activations(window.app_handle());
                }
                window.state::<ActiveWorkspaces>().remove(window.label());
                window
                    .state::<WorkspaceWatchService>()
                    .remove_window(window.label());
                window
                    .state::<PendingRepositoryWindows>()
                    .remove(window.label());
                window
                    .state::<WorkspaceSearchRegistry>()
                    .remove_window(window.label());
                window
                    .state::<WorkspaceReplacementRegistry>()
                    .remove_window(window.label());
                window
                    .state::<WorkspaceMutationCoordinator>()
                    .remove_window(window.label());
                window
                    .state::<CommitFileRestoreRegistry>()
                    .remove_window(window.label());
                window
                    .state::<TerminalSessions>()
                    .remove_owner(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_for_app_updates,
            install_app_update,
            open_app_update_release,
            list_plugin_sources,
            upsert_plugin_source,
            set_plugin_source_enabled,
            remove_plugin_source,
            refresh_plugin_source,
            list_plugin_installations,
            list_installed_plugin_manifests,
            prepare_plugin_install,
            confirm_plugin_install,
            cancel_plugin_install,
            restart_for_plugin_changes,
            set_installed_plugin_enabled,
            select_installed_plugin_rollback,
            repair_installed_plugin_version,
            uninstall_installed_plugin,
            activate_installed_plugin_runtime,
            confirm_installed_plugin_runtime_healthy,
            fail_installed_plugin_runtime_activation,
            abandon_installed_plugin_runtime_activation,
            invoke_installed_plugin_callback,
            deactivate_installed_plugin_runtime,
            read_installed_plugin_runtime_diagnostics,
            prepare_language_service,
            start_language_service,
            open_language_document,
            change_language_document,
            close_language_document,
            request_language_service,
            cancel_language_request,
            stop_language_service,
            initial_repository,
            window_chrome_mode,
            is_last_project_window,
            existing_project_directories,
            focus_existing_project_window,
            open_project,
            read_project_snapshot,
            read_repository_slices,
            open_repository_window,
            start_workspace_watch,
            stop_workspace_watch,
            start_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            read_tracked_changes,
            read_history_count,
            read_history_page,
            scan_untracked,
            cancel_untracked_scan,
            list_project_files,
            list_ignored_project_directory,
            reveal_workspace_entry,
            reveal_registered_worktree,
            inspect_workspace_entry,
            copy_workspace_entry_to_system_clipboard,
            read_system_file_clipboard_entry,
            import_system_file_clipboard_entry,
            plan_workspace_mutation,
            execute_workspace_mutation,
            cancel_workspace_mutation,
            list_workspace_mutation_recoveries,
            rollback_workspace_mutation,
            finalize_workspace_mutation,
            acknowledge_workspace_mutation_recovery,
            search_workspace_text,
            cancel_workspace_text_search,
            preview_workspace_replacement,
            read_workspace_replacement_diff,
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
            read_working_diff_base,
            read_local_image_diff,
            read_commit_details,
            read_commit_comparison_details,
            read_commit_file,
            compare_commit_file_to_current,
            prepare_commit_file_restore,
            execute_commit_file_restore,
            list_commit_file_restore_recoveries,
            rollback_commit_file_restore,
            finalize_commit_file_restore,
            read_git_blame,
            read_commit_diff,
            read_commit_comparison_diff,
            read_commit_image_diff,
            read_commit_comparison_image_diff,
            read_stash_catalog,
            read_stash_details,
            read_stash_diff,
            stage_paths,
            trash_untracked_paths,
            unstage_paths,
            commit_changes,
            stash_changes,
            revert_changes,
            prepare_restore_changes,
            list_git_worktree_recoveries,
            undo_git_worktree_recovery,
            switch_branch,
            create_branch,
            prepare_branch_mutation,
            execute_branch_mutation,
            prepare_worktree_creation,
            execute_worktree_creation,
            execute_tag_mutation,
            execute_stash_mutation,
            prepare_remote_mutation,
            execute_remote_mutation,
            prepare_git_reset,
            execute_git_reset,
            prepare_head_commit_mutation,
            execute_head_commit_mutation,
            fetch_remote,
            read_remote_authentication,
            store_remote_https_credential,
            configure_remote_ssh,
            read_push_preview,
            read_push_file_commit,
            pull_current,
            update_local_branch,
            push_current,
            cancel_remote_operation,
            read_git_operation,
            prepare_git_operation,
            execute_git_operation,
            run_git_operation_action,
            read_conflict_content,
            resolve_conflict,
            read_workspace_trust,
            set_workspace_trust,
            prepare_task_execution,
            read_task_confirmation,
            start_task_execution,
            cancel_task_execution,
            discover_task_artifacts,
            compute_workspace_fingerprint,
            read_plugin_task_cache,
            write_plugin_task_cache,
            mark_plugin_task_cache_dirty,
            cleanup_plugin_task_cache,
            execute_plugin_process_query,
            execute_plugin_tool_operation,
            cancel_plugin_tool_operation,
            write_frontend_diagnostic,
            diagnostic_log_health,
            diagnostic_log_directory
        ])
        .build(tauri::generate_context!())
        .expect("Asterlyn desktop runtime failed");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<DiagnosticsLog>().info(
                "host",
                "application.exiting",
                None,
                serde_json::json!({}),
            );
            app.state::<LanguageServiceManager>().cancel_all();
            app.state::<TaskManager>().cancel_all();
            app.state::<PluginProcessQueryManager>().cancel_all();
            let _ = abandon_plugin_activations(app);
            app.state::<PluginHostSupervisor>()
                .cancel_all(ShutdownReason::ApplicationExit);
            let diagnostics = app.state::<DiagnosticsLog>();
            diagnostics.info(
                "host",
                "application.shutdown_dispatched",
                None,
                serde_json::json!({"meaning": "cleanup and cancellation requests dispatched"}),
            );
            diagnostics.shutdown(std::time::Duration::from_millis(500));
        }
    });
}

#[cfg(test)]
mod tests;
