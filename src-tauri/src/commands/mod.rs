mod app_updates;
mod commit_file_restore;
mod git_operations;
mod git_recovery;
mod plugin_cache;
mod plugin_process_query;
pub(crate) use git_recovery::{
    list_git_worktree_recoveries, prepare_restore_changes, undo_git_worktree_recovery,
};
pub(crate) use plugin_cache::{
    cleanup_plugin_task_cache, compute_workspace_fingerprint, mark_plugin_task_cache_dirty,
    read_plugin_task_cache, write_plugin_task_cache,
};
pub(crate) use plugin_process_query::{
    cancel_plugin_tool_operation, execute_plugin_process_query, execute_plugin_tool_operation,
};
mod git_reads;
mod image;
mod shell;
mod task;
mod terminal;
mod trust;
mod workspace;
mod workspace_watch;

pub(crate) use app_updates::{check_for_app_updates, install_app_update, open_app_update_release};
pub(crate) use commit_file_restore::{
    execute_commit_file_restore, finalize_commit_file_restore, list_commit_file_restore_recoveries,
    prepare_commit_file_restore, rollback_commit_file_restore,
};
pub(crate) use git_operations::{
    cancel_remote_operation, commit_changes, configure_remote_ssh, create_branch,
    execute_branch_mutation, execute_git_operation, execute_git_reset,
    execute_head_commit_mutation, execute_remote_mutation, execute_stash_mutation,
    execute_tag_mutation, execute_worktree_creation, fetch_remote, prepare_branch_mutation,
    prepare_git_operation, prepare_git_reset, prepare_head_commit_mutation,
    prepare_remote_mutation, prepare_worktree_creation, pull_current, push_current,
    read_conflict_content, read_git_operation, read_push_file_commit, read_push_preview,
    read_remote_authentication, resolve_conflict, revert_changes, run_git_operation_action,
    stage_paths, stash_changes, store_remote_https_credential, switch_branch,
    trash_untracked_paths, unstage_paths, update_local_branch,
};
pub(crate) use git_reads::{
    cancel_untracked_scan, compare_commit_file_to_current, read_commit_comparison_details,
    read_commit_comparison_diff, read_commit_details, read_commit_diff, read_commit_file,
    read_diff, read_git_blame, read_history_page, read_local_diff, read_stash_catalog,
    read_stash_details, read_stash_diff, read_tracked_changes, read_working_diff_base,
    scan_untracked,
};
pub(crate) use image::{
    read_commit_comparison_image_diff, read_commit_image_diff, read_image_file,
    read_local_image_diff,
};
pub(crate) use shell::{
    existing_project_directories, focus_existing_project_window, initial_repository,
    is_last_project_window, open_project, open_repository_window, read_project_snapshot,
    read_repository_slices, window_chrome_mode,
};
pub(crate) use task::{
    cancel_task_execution, discover_task_artifacts, prepare_task_execution, read_task_confirmation,
    start_task_execution,
};
pub(crate) use terminal::{close_terminal, resize_terminal, start_terminal, write_terminal};
pub(crate) use trust::{read_workspace_trust, set_workspace_trust};
pub(crate) use workspace::{
    acknowledge_workspace_mutation_recovery, apply_workspace_replacement,
    cancel_workspace_mutation, cancel_workspace_replacement, cancel_workspace_text_search,
    copy_workspace_entry_to_system_clipboard, execute_workspace_mutation,
    finalize_workspace_mutation, finalize_workspace_replacement,
    import_system_file_clipboard_entry, inspect_workspace_entry, list_ignored_project_directory,
    list_project_files, list_workspace_mutation_recoveries, list_workspace_replacement_recoveries,
    plan_workspace_mutation, preview_workspace_replacement, read_system_file_clipboard_entry,
    read_text_file, read_workspace_replacement_diff, reveal_registered_worktree,
    reveal_workspace_entry, rollback_workspace_mutation, rollback_workspace_replacement,
    save_text_file, search_workspace_text,
};
pub(crate) use workspace_watch::{start_workspace_watch, stop_workspace_watch};
