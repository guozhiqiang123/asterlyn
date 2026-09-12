#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub root: String,
    pub git_dir: String,
    pub repository_roots: Vec<GitRootDescriptor>,
    pub branch: BranchState,
    pub operation: Option<GitOperationSnapshot>,
    pub changes: Vec<FileChange>,
    pub commits: Vec<CommitSummary>,
    pub branches: Vec<BranchSummary>,
    pub remotes: Vec<RemoteSummary>,
    pub untracked_state: UntrackedState,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitOperationKind {
    Merge,
    CherryPick,
    Rebase,
    Squash,
    Revert,
    Bisect,
}

impl GitOperationKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::CherryPick => "cherry-pick",
            Self::Rebase => "rebase",
            Self::Squash => "squash",
            Self::Revert => "revert",
            Self::Bisect => "bisect",
        }
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitOperationPhase {
    Conflicted,
    Paused,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitOperationAction {
    Continue,
    Skip,
    Abort,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictFile {
    pub path: String,
    pub base_oid: Option<String>,
    pub ours_oid: Option<String>,
    pub theirs_oid: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationProgress {
    pub current: Option<u32>,
    pub total: Option<u32>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationSnapshot {
    pub kind: GitOperationKind,
    pub phase: GitOperationPhase,
    pub original_head_oid: Option<String>,
    pub current_head_oid: Option<String>,
    pub head_ref: Option<String>,
    pub target_oids: Vec<String>,
    pub conflicts: Vec<GitConflictFile>,
    pub progress: GitOperationProgress,
    pub allowed_actions: Vec<GitOperationAction>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationPlan {
    pub kind: GitOperationKind,
    pub repository_root: String,
    pub start_head_oid: String,
    pub start_head_ref: String,
    pub target_refs: Vec<String>,
    pub target_oids: Vec<String>,
    pub commit_count: usize,
    pub summary: String,
    pub message: Option<String>,
    pub preview_token: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictContent {
    pub path: String,
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub worktree: Option<String>,
    pub binary: bool,
    pub revision_token: String,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UntrackedState {
    Pending,
    Complete,
    Failed,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UntrackedScan {
    pub root: String,
    pub changes: Vec<FileChange>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackedChangeScan {
    pub root: String,
    pub changes: Vec<FileChange>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileList {
    pub root: String,
    pub paths: Vec<String>,
    pub files: Vec<ProjectFile>,
    pub ignored_entries: Vec<ProjectIgnoredEntry>,
    pub repository_roots: Vec<GitRootDescriptor>,
    pub truncated: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub repository_id: String,
    pub path: String,
    pub workspace_path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIgnoredEntry {
    pub workspace_path: String,
    pub kind: ProjectEntryKind,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRootDescriptor {
    pub id: String,
    pub relative_path: String,
    pub display_name: String,
    pub kind: GitRootKind,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitRootKind {
    Main,
    Submodule,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BranchState {
    pub head: Option<String>,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub upstream_remote: Option<String>,
    pub upstream_ref: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub detached: bool,
    pub unborn: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSummary {
    pub name: String,
    pub fetch_supported: bool,
    pub push_supported: bool,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedCommitResult {
    pub oid: Option<String>,
    pub verification_warning: Option<String>,
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
    pub repository_id: String,
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
pub struct PushPreview {
    pub remote: String,
    pub branch: String,
    pub source_ref: String,
    pub destination_ref: String,
    pub head_oid: String,
    pub comparison_base_oid: Option<String>,
    pub publish: bool,
    pub ordinary_allowed: bool,
    pub ordinary_block_reason: Option<String>,
    pub force_with_lease_allowed: bool,
    pub force_with_lease_block_reason: Option<String>,
    pub tag_mode: PushTagMode,
    pub tags: Vec<PushTagSummary>,
    pub files: Vec<CommitFileChange>,
    pub files_truncated: bool,
    pub commits: Vec<CommitSummary>,
    pub offset: usize,
    pub total_commits: usize,
    pub has_more: bool,
    pub truncated: bool,
    pub preview_token: String,
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PushMode {
    #[default]
    Ordinary,
    ForceWithLease,
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PushTagMode {
    #[default]
    None,
    All,
    CurrentBranch,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PushTagSummary {
    pub name: String,
    pub full_ref: String,
    pub object_oid: String,
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryOrder {
    #[default]
    Topological,
    Date,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    pub repository_ids: Vec<String>,
    pub refs: Vec<HistoryRef>,
    pub author_emails: Vec<String>,
    pub current_author: bool,
    pub since_epoch: Option<i64>,
    pub paths: Vec<HistoryPath>,
    pub first_parent: bool,
    pub exclude_merges: bool,
    pub order: HistoryOrder,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord,
)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRef {
    pub repository_id: String,
    pub full_name: String,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord,
)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPath {
    pub repository_id: String,
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub commits: Vec<CommitSummary>,
    pub offset: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub repository_id: String,
    pub oid: String,
    pub parent_oid: Option<String>,
    pub files: Vec<CommitFileChange>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileChange {
    pub path: String,
    pub original_path: Option<String>,
    pub status: ChangeKind,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiffResult {
    pub repository_id: String,
    pub oid: String,
    pub path: String,
    pub patch: String,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchSummary {
    pub repository_id: String,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinaryDiffResult {
    pub path: String,
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
}
