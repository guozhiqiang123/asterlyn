mod error;
mod model;
mod parser;
mod repository;

pub use error::GitError;
pub use model::{
    BranchKind, BranchState, BranchSummary, ChangeKind, CommitSummary, DiffResult, FileChange,
    RepositorySnapshot,
};
pub use repository::GitRepository;
