mod error;
mod model;
mod parser;
mod repository;

pub use error::{GitError, RemoteFailureKind};
pub use model::{
    BranchKind, BranchState, BranchSummary, ChangeKind, CommitDetails, CommitDiffResult,
    CommitFileChange, CommitSummary, DiffResult, FileChange, GitRootDescriptor, GitRootKind,
    HistoryOrder, HistoryPage, HistoryPath, HistoryQuery, HistoryRef, ProjectFile, ProjectFileList,
    RemoteSummary, RepositorySnapshot, UntrackedScan, UntrackedState,
};
pub use repository::{CancellationToken, GitRepository};
