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
    HistoryPageCacheRegistry, PendingRepositoryWindowReservation, PendingRepositoryWindows,
    PluginMarketplaceCoordinator, PluginProcessQueryManager, ScanRegistry, TaskManager,
    WorkspaceEntryInspection, WorkspaceMutationCoordinator, WorkspaceMutationPreview,
    WorkspaceReplacementDiff, WorkspaceReplacementPreview, WorkspaceReplacementRegistry,
    WorkspaceSearchIndexRegistry, WorkspaceSearchRegistry, WorkspaceTextSearchReport,
    WorkspaceWatchService, WorkspaceWatchStatus, WorkspaceWriteRegistry,
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
        .setup(|app| {
            let diagnostics = DiagnosticsLog::open(
                app.path()
                    .app_log_dir()
                    .map_err(std::io::Error::other)?
                    .join("diagnostics"),
            )?;
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
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
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
            app.state::<TaskManager>().cancel_all();
            app.state::<PluginProcessQueryManager>().cancel_all();
            let _ = abandon_plugin_activations(app);
            app.state::<PluginHostSupervisor>()
                .cancel_all(ShutdownReason::ApplicationExit);
        }
    });
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
    fn project_navigation_catalog_fits_the_complete_search_candidate_budget() {
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
        assert_eq!(WORKSPACE_SEARCH_LIMITS.max_candidates, PROJECT_FILE_LIMIT);
        assert!(catalog.files.len() <= WORKSPACE_SEARCH_LIMITS.max_candidates);
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
        let ignored = GitRepository::open(directory.path())
            .and_then(|repository| repository.project_files(PROJECT_FILE_LIMIT))
            .expect("project catalog includes ignored previews")
            .files
            .into_iter()
            .find(|file| file.path == "ignored.txt")
            .expect("ignored file identity");
        let ignored_snapshot =
            read_session_text_file(directory.path(), &ignored).expect("ignored file is readable");
        assert_eq!(ignored_snapshot.content, "ignored\n");
        save_session_text_file(
            directory.path(),
            &ignored,
            ignored_snapshot.revision,
            "saved ignored\n".to_string(),
            false,
            "native-save-ignored".to_string(),
            &WorkspaceWriteRegistry::default(),
        )
        .expect("catalogued ignored file saves");
        assert_eq!(
            fs::read_to_string(directory.path().join("ignored.txt")).unwrap(),
            "saved ignored\n"
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
    fn workspace_search_persists_a_source_free_index_and_revalidates_changes() {
        let directory = tempfile::tempdir().expect("temporary repository");
        let cache = tempfile::tempdir().expect("search cache");
        git(directory.path(), &["init", "-b", "main"]);
        fs::write(directory.path().join("hit.kt"), "class SearchNeedle\n").expect("hit file");
        fs::write(directory.path().join("miss.kt"), "class Unrelated\n").expect("miss file");
        git(directory.path(), &["add", "."]);
        let indexes = WorkspaceSearchIndexRegistry::default();

        let cold = indexes
            .with_index(cache.path(), directory.path(), |index| {
                search_authorized_workspace_with_index(
                    directory.path(),
                    "indexed-cold",
                    "SearchNeedle",
                    &SearchOptions::default(),
                    &SearchCancellationToken::new(),
                    index,
                )
            })
            .expect("cold indexed search");
        assert_eq!(cold.matches.len(), 1);
        assert_eq!(cold.index_pruned_candidates, 0);

        let warm = indexes
            .with_index(cache.path(), directory.path(), |index| {
                search_authorized_workspace_with_index(
                    directory.path(),
                    "indexed-warm",
                    "SearchNeedle",
                    &SearchOptions::default(),
                    &SearchCancellationToken::new(),
                    index,
                )
            })
            .expect("warm indexed search");
        assert_eq!(warm.matches.len(), 1);
        assert_eq!(warm.index_pruned_candidates, 1);
        assert_eq!(warm.files_searched, 1);

        let cache_file = fs::read_dir(cache.path())
            .expect("cache directory")
            .next()
            .expect("cache file")
            .expect("cache entry")
            .path();
        let stored = fs::read_to_string(cache_file).expect("stored index");
        assert!(!stored.contains("SearchNeedle"));
        assert!(!stored.contains("Unrelated"));

        fs::write(directory.path().join("miss.kt"), "class AlsoSearchNeedle\n")
            .expect("changed miss file");
        let refreshed = indexes
            .with_index(cache.path(), directory.path(), |index| {
                search_authorized_workspace_with_index(
                    directory.path(),
                    "indexed-refreshed",
                    "SearchNeedle",
                    &SearchOptions::default(),
                    &SearchCancellationToken::new(),
                    index,
                )
            })
            .expect("refreshed indexed search");
        assert_eq!(refreshed.matches.len(), 2);
        assert_eq!(refreshed.index_pruned_candidates, 0);
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
            ..SearchOptions::default()
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
    fn workspace_search_can_include_ignored_files_as_editable_results() {
        let directory = tempfile::tempdir().expect("temporary repository");
        git(directory.path(), &["init", "-b", "main"]);
        fs::write(directory.path().join(".gitignore"), "ignored.txt\n").expect("ignore file");
        fs::write(directory.path().join("ignored.txt"), "hidden needle\n").expect("ignored file");
        git(directory.path(), &["add", ".gitignore"]);

        let filtered = search_authorized_workspace(
            directory.path(),
            "ignored-filtered",
            "needle",
            &SearchOptions::default(),
            &SearchCancellationToken::new(),
        )
        .expect("filtered search");
        assert!(filtered.matches.is_empty());

        let included = search_authorized_workspace(
            directory.path(),
            "ignored-included",
            "needle",
            &SearchOptions {
                exclude_ignored: false,
                ..SearchOptions::default()
            },
            &SearchCancellationToken::new(),
        )
        .expect("search including ignored files");
        assert_eq!(included.matches.len(), 1);
        assert_eq!(included.matches[0].workspace_path, "ignored.txt");
        assert!(!included.matches[0].read_only);
        assert!(included.matches[0].ignored);
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
        let reviewed_diff = stored
            .diff("tracked.txt", false)
            .expect("reviewed replacement diff");
        assert!(reviewed_diff.patch.contains("-needle tracked"));
        assert!(reviewed_diff.patch.contains("+found tracked"));

        let writes = WorkspaceWriteRegistry::default();
        let applied = apply_authorized_replacement(
            directory.path(),
            recovery.path(),
            stored.clone(),
            &["tracked.txt".to_string()],
            &SearchCancellationToken::new(),
            &writes,
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
        let revoked = apply_authorized_replacement(
            directory.path(),
            recovery.path(),
            stored,
            &["untracked.txt".to_string()],
            &SearchCancellationToken::new(),
            &writes,
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
            .activate("main", first.path(), None)
            .expect("first workspace activates");
        active
            .activate("project-1", second.path(), Some(second.path()))
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
    fn active_workspace_catalog_authorizes_constant_identity_lookups_until_refresh() {
        let active = ActiveWorkspaces::default();
        let directory = tempfile::tempdir().expect("ordinary workspace");
        fs::write(directory.path().join("first.txt"), "first\n").expect("first file");
        fs::create_dir(directory.path().join("src")).expect("source directory");
        fs::write(directory.path().join("src/nested.txt"), "nested\n").expect("nested file");
        active
            .activate("main", directory.path(), None)
            .expect("workspace activates");
        let root = std::fs::canonicalize(directory.path()).expect("canonical workspace");
        let first_catalog = load_project_catalog(&root).expect("initial catalog");
        active
            .install_catalog(
                "main",
                active.activation_token("main").unwrap(),
                &root,
                &first_catalog,
            )
            .expect("catalog installs");
        active
            .activate("main", &root, None)
            .expect("same workspace metadata refreshes");
        let watch_roots = active
            .watch_roots("main", root.to_string_lossy().as_ref(), &[])
            .expect("watch roots resolve");
        assert_eq!(watch_roots.directories, [root.clone(), root.join("src")]);
        assert_eq!(
            active
                .authorize_catalogued_file("main", &root, "workspace", "first.txt")
                .expect("catalogued identity resolves")
                .workspace_path,
            "first.txt"
        );

        fs::write(directory.path().join("second.txt"), "second\n").expect("second file");
        assert!(matches!(
            active.authorize_catalogued_file("main", &root, "workspace", "second.txt"),
            Err(WorkspaceError::NotAuthorized { .. })
        ));
        let refreshed = load_project_catalog(&root).expect("refreshed catalog");
        active
            .install_catalog(
                "main",
                active.activation_token("main").unwrap(),
                &root,
                &refreshed,
            )
            .expect("refreshed catalog installs");
        assert!(
            active
                .authorize_catalogued_file("main", &root, "workspace", "second.txt")
                .is_ok()
        );
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
        let PendingRepositoryWindowReservation::Reserved(first) = pending
            .reserve(PathBuf::from("/repo/first"))
            .expect("first window")
        else {
            panic!("first path must reserve a window");
        };
        let PendingRepositoryWindowReservation::Reserved(second) = pending
            .reserve(PathBuf::from("/repo/second"))
            .expect("second window")
        else {
            panic!("second path must reserve a window");
        };
        assert_ne!(first, second);
        let PendingRepositoryWindowReservation::Existing(existing) = pending
            .reserve(PathBuf::from("/repo/first"))
            .expect("duplicate path resolves")
        else {
            panic!("duplicate path must reuse its pending window");
        };
        assert_eq!(existing, first);
        assert_eq!(
            pending.take(&first).expect("pending path"),
            Some("/repo/first".to_string())
        );
        assert_eq!(pending.take(&first).expect("path consumed"), None);
        assert_eq!(
            pending
                .window_for_root(Path::new("/repo/first"))
                .expect("consumed path remains reserved until activation"),
            Some(first.clone())
        );
        pending.remove(&first);
        assert_eq!(
            pending
                .window_for_root(Path::new("/repo/first"))
                .expect("removed path is released"),
            None
        );
    }

    #[test]
    fn window_chrome_mode_matches_native_control_ownership() {
        assert_eq!(window_chrome_mode_for(true), "macos-native");
        assert_eq!(window_chrome_mode_for(false), "custom-right");
    }

    #[test]
    fn stale_disconnected_monitor_position_is_not_considered_visible() {
        let window_size = PhysicalSize::new(1_320, 820);
        let monitor_position = PhysicalPosition::new(0, 0);
        let monitor_size = PhysicalSize::new(1_512, 982);
        assert!(!window_has_usable_monitor_intersection(
            PhysicalPosition::new(-36, -973),
            window_size,
            monitor_position,
            monitor_size,
        ));
        assert!(window_has_usable_monitor_intersection(
            PhysicalPosition::new(96, 62),
            window_size,
            monitor_position,
            monitor_size,
        ));
    }

    #[test]
    fn a_tiny_edge_sliver_does_not_leave_the_window_stranded() {
        assert!(!window_has_usable_monitor_intersection(
            PhysicalPosition::new(1_900, 100),
            PhysicalSize::new(1_320, 820),
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1_920, 1_080),
        ));
        assert!(window_has_usable_monitor_intersection(
            PhysicalPosition::new(1_800, 100),
            PhysicalSize::new(1_320, 820),
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1_920, 1_080),
        ));
    }

    #[test]
    fn offscreen_windows_are_centered_on_the_selected_monitor() {
        assert_eq!(
            centered_window_position(
                PhysicalSize::new(1_320, 820),
                PhysicalPosition::new(-1_920, 0),
                PhysicalSize::new(1_920, 1_080),
            ),
            PhysicalPosition::new(-1_620, 130),
        );
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
