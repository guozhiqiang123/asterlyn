mod commit_file_restore;
mod git_operation_coordinator;
pub(crate) mod git_worktree_transactions;
mod operation_supervisor;
mod plugin_marketplace;
mod plugin_process_query;
mod plugin_runtime;
pub(crate) mod plugin_task_cache;
mod search_session;
mod task;
mod task_artifacts;
pub(crate) mod trust;
mod workspace_catalog;
mod workspace_document;
mod workspace_mutation;
mod workspace_replacement;
mod workspace_search;
mod workspace_search_index;
mod workspace_session;
mod workspace_watch;

pub(crate) use commit_file_restore::{
    CommitFileRestorePreview, CommitFileRestoreRegistry, execute_commit_file_restore_plan,
    finalize_commit_file_restore, list_commit_file_restore_recoveries,
    prepare_commit_file_restore_plan, rollback_commit_file_restore,
};
pub(crate) use git_operation_coordinator::GitOperationCoordinator;
pub(crate) use operation_supervisor::{RemoteOperationRegistry, ScanRegistry};
pub(crate) use plugin_marketplace::{PendingPluginAdmission, PluginMarketplaceCoordinator};
pub(crate) use plugin_process_query::{
    PluginProcessQueryManager, PluginProcessQueryResult, PluginToolOperationResult,
};
pub(crate) use plugin_runtime::build_plugin_host_supervisor;
pub(crate) use search_session::{WorkspaceReplacementRegistry, WorkspaceSearchRegistry};
pub(crate) use task::TaskManager;
pub(crate) use task_artifacts::{TaskArtifactDiscovery, scan_task_artifacts};
#[cfg(test)]
pub(crate) use workspace_catalog::PROJECT_FILE_LIMIT;
pub(crate) use workspace_catalog::{
    exact_git_repository, load_ignored_project_directory, load_project_catalog,
    reauthorize_session_file_for_read, resolve_workspace_entry,
};
#[cfg(test)]
pub(crate) use workspace_document::{read_authorized_text_file, save_authorized_text_file};
pub(crate) use workspace_document::{read_session_text_file, save_session_text_file};
pub(crate) use workspace_mutation::{
    WorkspaceEntryInspection, WorkspaceMutationCoordinator, WorkspaceMutationPreview,
    acknowledge_workspace_mutation_recovery, execute_workspace_mutation_plan,
    finalize_workspace_mutation_recovery, inspect_workspace_entry_inventory,
    load_workspace_mutation_recoveries, prepare_workspace_mutation_plan,
    rollback_workspace_mutation_recovery,
};
pub use workspace_replacement::WORKSPACE_REPLACEMENT_LIMITS;
pub(crate) use workspace_replacement::{
    WorkspaceReplacementDiff, WorkspaceReplacementPreview, apply_authorized_replacement,
    finalize_replacement, list_replacement_recoveries, prepare_authorized_replacement,
    rollback_replacement,
};
pub use workspace_search::WORKSPACE_SEARCH_LIMITS;
#[cfg(test)]
pub(crate) use workspace_search::search_authorized_workspace;
pub(crate) use workspace_search::{
    WorkspaceTextSearchReport, search_authorized_workspace_with_index,
};
pub(crate) use workspace_search_index::WorkspaceSearchIndexRegistry;
pub(crate) use workspace_session::{
    ActiveWorkspaces, GitMutationRegistry, PendingRepositoryWindowReservation,
    PendingRepositoryWindows, WorkspaceWatchRoots, WorkspaceWriteRegistry,
};
pub(crate) use workspace_watch::{WorkspaceWatchService, WorkspaceWatchStatus};
