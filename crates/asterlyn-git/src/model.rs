#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub root: String,
    pub git_dir: String,
    pub branch: BranchState,
    pub operation: Option<String>,
    pub changes: Vec<FileChange>,
    pub commits: Vec<CommitSummary>,
    pub branches: Vec<BranchSummary>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BranchState {
    pub head: Option<String>,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub detached: bool,
    pub unborn: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: ChangeKind,
    pub worktree_status: ChangeKind,
    pub conflicted: bool,
    pub submodule: bool,
}

impl FileChange {
    pub fn has_staged_change(&self) -> bool {
        !matches!(
            self.index_status,
            ChangeKind::Unmodified | ChangeKind::Ignored
        )
    }

    pub fn has_worktree_change(&self) -> bool {
        !matches!(
            self.worktree_status,
            ChangeKind::Unmodified | ChangeKind::Ignored
        )
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Unmodified,
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Unmerged,
    Untracked,
    Ignored,
    Unknown,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub short_oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: i64,
    pub decorations: Vec<String>,
    pub subject: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchSummary {
    pub full_name: String,
    pub name: String,
    pub oid: String,
    pub current: bool,
    pub kind: BranchKind,
    pub upstream: Option<String>,
    pub tracking: Option<String>,
    pub committed_at: i64,
    pub subject: String,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BranchKind {
    Local,
    Remote,
    Tag,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub path: String,
    pub staged: bool,
    pub patch: String,
    pub binary: bool,
    pub truncated: bool,
}
