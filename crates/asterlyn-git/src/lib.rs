mod error;
mod model;
mod parser;
mod repository;

pub use error::{GitError, RemoteFailureKind};
pub use model::{
    BinaryDiffResult, BranchKind, BranchState, BranchSummary, ChangeKind, CommitDetails,
    CommitDiffResult, CommitFileChange, CommitSummary, DiffResult, FileChange, GitRootDescriptor,
    GitRootKind, HistoryOrder, HistoryPage, HistoryPath, HistoryQuery, HistoryRef,
    ProjectEntryKind, ProjectFile, ProjectFileList, ProjectIgnoredEntry, PushPreview,
    RemoteSummary, RepositorySnapshot, SelectedCommitResult, TrackedChangeScan, UntrackedScan,
    UntrackedState,
};
pub use repository::{CancellationToken, GitRepository};
