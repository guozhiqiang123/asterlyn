mod error;
mod model;
mod parser;
mod repository;

pub use error::GitError;
pub use model::{
    BranchKind, BranchState, BranchSummary, ChangeKind, CommitDetails, CommitDiffResult,
    CommitFileChange, CommitSummary, DiffResult, FileChange, RepositorySnapshot, UntrackedScan,
    UntrackedState,
};
pub use repository::{CancellationToken, GitRepository};
