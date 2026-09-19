mod commit_file_restore;
mod git_operation_coordinator;
pub(crate) mod git_worktree_transactions;
mod operation_supervisor;
mod search_session;
mod workspace_catalog;
mod workspace_mutation;
mod workspace_replacement;
mod workspace_search;
mod workspace_session;
mod workspace_watch;

pub(crate) use commit_file_restore::{CommitFileRestoreRegistry, StoredCommitFileRestorePlan};
pub(crate) use git_operation_coordinator::GitOperationCoordinator;
pub(crate) use operation_supervisor::{RemoteOperationRegistry, ScanRegistry};
pub(crate) use search_session::{WorkspaceReplacementRegistry, WorkspaceSearchRegistry};
#[cfg(test)]
pub(crate) use workspace_catalog::authorize_project_file;
pub(crate) use workspace_catalog::{
    PROJECT_FILE_LIMIT, exact_git_repository, load_project_catalog, reauthorize_session_file,
    reauthorize_session_file_for_read,
};
pub(crate) use workspace_mutation::{StoredWorkspaceMutationPlan, WorkspaceMutationCoordinator};
pub(crate) use workspace_replacement::{
    WorkspaceReplacementPreview, authorize_replacement_selection, prepare_authorized_replacement,
};
#[cfg(test)]
pub(crate) use workspace_search::WORKSPACE_SEARCH_LIMITS;
pub(crate) use workspace_search::{WorkspaceTextSearchReport, search_authorized_workspace};
pub(crate) use workspace_session::{
    ActiveWorkspaces, GitMutationRegistry, PendingRepositoryWindowReservation,
    PendingRepositoryWindows, WorkspaceWatchRoots, WorkspaceWriteRegistry,
};
pub(crate) use workspace_watch::{WorkspaceWatchService, WorkspaceWatchStatus};
