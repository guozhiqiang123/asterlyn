mod git_operation_coordinator;
mod operation_supervisor;
mod search_session;
mod workspace_session;
mod workspace_watch;

pub(crate) use git_operation_coordinator::GitOperationCoordinator;
pub(crate) use operation_supervisor::{RemoteOperationRegistry, ScanRegistry};
pub(crate) use search_session::{
    AuthorizedReplacementFile, StoredReplacementPlan, WorkspaceReplacementRegistry,
    WorkspaceSearchRegistry,
};
pub(crate) use workspace_session::{
    ActiveWorkspaces, GitMutationRegistry, PendingRepositoryWindows, WorkspaceWatchRoots,
    WorkspaceWriteRegistry,
};
pub(crate) use workspace_watch::{WorkspaceWatchService, WorkspaceWatchStatus};
