mod commit_file_restore;
mod git_operation_coordinator;
pub(crate) mod git_worktree_transactions;
mod operation_supervisor;
mod search_session;
mod workspace_catalog;
mod workspace_document;
mod workspace_mutation;
mod workspace_replacement;
mod workspace_search;
mod workspace_session;
mod workspace_watch;

pub(crate) use commit_file_restore::{
    CommitFileRestorePreview, CommitFileRestoreRegistry, execute_commit_file_restore_plan,
    finalize_commit_file_restore, list_commit_file_restore_recoveries,
    prepare_commit_file_restore_plan, rollback_commit_file_restore,
};
pub(crate) use git_operation_coordinator::GitOperationCoordinator;
pub(crate) use operation_supervisor::{RemoteOperationRegistry, ScanRegistry};
pub(crate) use search_session::{WorkspaceReplacementRegistry, WorkspaceSearchRegistry};
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
    execute_workspace_mutation_plan, inspect_workspace_entry_inventory,
    load_workspace_mutation_recoveries, prepare_workspace_mutation_plan,
};
pub use workspace_replacement::WORKSPACE_REPLACEMENT_LIMITS;
pub(crate) use workspace_replacement::{
    WorkspaceReplacementPreview, apply_authorized_replacement, finalize_replacement,
    list_replacement_recoveries, prepare_authorized_replacement, rollback_replacement,
};
pub use workspace_search::WORKSPACE_SEARCH_LIMITS;
pub(crate) use workspace_search::{WorkspaceTextSearchReport, search_authorized_workspace};
pub(crate) use workspace_session::{
    ActiveWorkspaces, GitMutationRegistry, PendingRepositoryWindowReservation,
    PendingRepositoryWindows, WorkspaceWatchRoots, WorkspaceWriteRegistry,
};
pub(crate) use workspace_watch::{WorkspaceWatchService, WorkspaceWatchStatus};
