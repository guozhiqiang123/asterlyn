mod error;
mod model;
mod operation;
mod parser;
mod process;
mod repository;
mod text_diff;

pub use error::{GitError, RemoteFailureKind};
pub use model::{
    BinaryDiffResult, BranchKind, BranchMutationKind, BranchMutationPlan, BranchMutationRequest,
    BranchMutationSourceKind, BranchState, BranchSummary, ChangeKind, CommitComparisonDetails,
    CommitComparisonDiffResult, CommitComparisonRelation, CommitDetails, CommitDiffResult,
    CommitFileChange, CommitFileVersion, CommitSummary, DiffResult, FileChange, GitBlameHunk,
    GitBlameResult, GitConflictContent, GitConflictFile, GitOperationAction, GitOperationKind,
    GitOperationPhase, GitOperationPlan, GitOperationProgress, GitOperationSnapshot, GitResetMode,
    GitResetPlan, GitRootDescriptor, GitRootKind, HistoryCommitStart, HistoryOrder, HistoryPage,
    HistoryPath, HistoryQuery, HistoryRef, ProjectEntryKind, ProjectFile, ProjectFileList,
    ProjectIgnoredEntry, PushMode, PushPreview, PushTagMode, PushTagSummary,
    RemoteAuthenticationStatus, RemoteBranchDeletionTarget, RemoteMutationKind, RemoteMutationPlan,
    RemoteMutationRequest, RemoteSummary, RemoteTransport, RepositoryReadPlan,
    RepositorySliceSnapshot, RepositorySnapshot, SelectedCommitResult, TrackedChangeScan,
    UntrackedScan, UntrackedState,
};
pub use process::CancellationToken;
pub use repository::GitRepository;
pub use text_diff::{BoundedTextDiff, bounded_text_diff};
