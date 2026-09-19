mod error;
mod model;
mod operation;
mod parser;
mod repository;

pub use error::{GitError, RemoteFailureKind};
pub use model::{
    BinaryDiffResult, BranchKind, BranchMutationKind, BranchMutationPlan, BranchMutationRequest,
    BranchMutationSourceKind, BranchState, BranchSummary, ChangeKind, CommitComparisonDetails,
    CommitComparisonDiffResult, CommitComparisonRelation, CommitDetails, CommitDiffResult,
    CommitFileChange, CommitFileVersion, CommitSummary, DiffResult, FileChange, GitBlameHunk,
    GitBlameResult, GitConflictContent, GitConflictFile, GitOperationAction, GitOperationKind,
    GitOperationPhase, GitOperationPlan, GitOperationProgress, GitOperationSnapshot,
    GitRootDescriptor, GitRootKind, HistoryCommitStart, HistoryOrder, HistoryPage, HistoryPath,
    HistoryQuery, HistoryRef, ProjectEntryKind, ProjectFile, ProjectFileList, ProjectIgnoredEntry,
    PushMode, PushPreview, PushTagMode, PushTagSummary, RemoteAuthenticationStatus, RemoteSummary,
    RemoteTransport, RepositoryReadPlan, RepositorySliceSnapshot, RepositorySnapshot,
    SelectedCommitResult, TrackedChangeScan, UntrackedScan, UntrackedState,
};
pub use repository::{CancellationToken, GitRepository};
