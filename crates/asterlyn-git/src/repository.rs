use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::error::{GitError, RemoteFailureKind};
use crate::model::{
    BinaryDiffResult, ChangeKind, CommitDetails, CommitDiffResult, CommitFileChange, CommitSummary,
    DiffResult, FileChange, GitRootDescriptor, GitRootKind, HistoryOrder, HistoryPage, HistoryPath,
    HistoryQuery, HistoryRef, ProjectEntryKind, ProjectFile, ProjectFileList, ProjectIgnoredEntry,
    PushPreview, RemoteSummary, RepositorySnapshot, SelectedCommitResult, TrackedChangeScan,
    UntrackedScan, UntrackedState,
};
use crate::parser::{parse_branches, parse_commits, parse_status};

const DIFF_LIMIT_BYTES: usize = 4 * 1024 * 1024;
// Git has no "all context" switch. A deliberately unreachable practical line count requests the
// complete file while the existing byte limit remains the authoritative output bound.
const EXPANDED_DIFF_CONTEXT_LINES: usize = 1_000_000;
const MAX_BINARY_PREVIEW_BYTES: usize = 16 * 1024 * 1024;
const REMOTE_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const MAX_HISTORY_WINDOW: usize = 3_000;
const MAX_HISTORY_PAGE_SIZE: usize = MAX_HISTORY_WINDOW;
const MAX_PUSH_PREVIEW_WINDOW: usize = 1_000;
const MAX_PUSH_PREVIEW_PAGE_SIZE: usize = 200;
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(2);

fn diff_context_argument(expanded_unchanged: bool) -> OsString {
    let lines = if expanded_unchanged {
        EXPANDED_DIFF_CONTEXT_LINES
    } else {
        3
    };
    OsString::from(format!("--unified={lines}"))
}

fn project_entry_kind_order(kind: ProjectEntryKind) -> u8 {
    match kind {
        ProjectEntryKind::Directory => 0,
        ProjectEntryKind::File => 1,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UpstreamTarget {
    remote: String,
    merge_ref: String,
    tracking_ref: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CurrentBranchContext {
    full_ref: String,
    oid: String,
    upstream: Option<UpstreamTarget>,
    behind: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PushTargetContext {
    remote: String,
    branch: String,
    source_ref: String,
    destination_ref: String,
    head_oid: String,
    comparison_base_oid: Option<String>,
    publish: bool,
}

#[derive(Debug, Clone)]
pub struct GitRepository {
    root: PathBuf,
    git_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct DiscoveredGitRoot {
    descriptor: GitRootDescriptor,
    repository: GitRepository,
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn refers_to(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }
}

impl GitRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, GitError> {
        let requested = path.as_ref();
        if requested.as_os_str().is_empty() {
            return Err(GitError::InvalidInput {
                field: "repository path".to_string(),
                message: "a path is required".to_string(),
            });
        }

        let root_output = run_from(
            requested,
            "discover repository root",
            ["rev-parse", "--show-toplevel"],
        )?;
        let git_dir_output = run_from(
            requested,
            "discover Git directory",
            ["rev-parse", "--absolute-git-dir"],
        )?;

        let root = output_path(&root_output, "repository root")?;
        let git_dir = output_path(&git_dir_output, "Git directory")?;
        Ok(Self { root, git_dir })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn main_root_descriptor(&self) -> GitRootDescriptor {
        GitRootDescriptor {
            id: ".".to_string(),
            relative_path: ".".to_string(),
            display_name: self
                .root
                .file_name()
                .and_then(OsStr::to_str)
                .unwrap_or("Repository")
                .to_string(),
            kind: GitRootKind::Main,
        }
    }

    fn discovered_roots(&self) -> Result<Vec<DiscoveredGitRoot>, GitError> {
        let canonical_main = fs::canonicalize(&self.root).map_err(|error| GitError::Io {
            operation: "resolve main repository root".to_string(),
            message: error.to_string(),
        })?;
        let main = DiscoveredGitRoot {
            descriptor: self.main_root_descriptor(),
            repository: self.clone(),
        };
        let mut roots = vec![main.clone()];
        let mut pending = vec![main];
        let mut seen = HashSet::from([canonical_main.clone()]);

        while let Some(parent) = pending.pop() {
            for path in parent.repository.gitlink_paths()? {
                let candidate = parent.repository.root.join(path);
                let Ok(canonical_candidate) = fs::canonicalize(candidate) else {
                    continue;
                };
                if !canonical_candidate.starts_with(&canonical_main)
                    || seen.contains(&canonical_candidate)
                {
                    continue;
                }
                let Ok(repository) = GitRepository::open(&canonical_candidate) else {
                    continue;
                };
                let Ok(canonical_repository) = fs::canonicalize(repository.root()) else {
                    continue;
                };
                if canonical_repository != canonical_candidate {
                    continue;
                }
                let Ok(relative) = canonical_repository.strip_prefix(&canonical_main) else {
                    continue;
                };
                let Some(relative_path) = path_to_git_string(relative) else {
                    continue;
                };
                if relative_path.is_empty() {
                    continue;
                }
                seen.insert(canonical_repository);
                let discovered = DiscoveredGitRoot {
                    descriptor: GitRootDescriptor {
                        id: relative_path.clone(),
                        relative_path,
                        display_name: repository
                            .root
                            .file_name()
                            .and_then(OsStr::to_str)
                            .unwrap_or("Submodule")
                            .to_string(),
                        kind: GitRootKind::Submodule,
                    },
                    repository,
                };
                pending.push(discovered.clone());
                roots.push(discovered);
            }
        }

        roots[1..].sort_by(|left, right| left.descriptor.id.cmp(&right.descriptor.id));
        Ok(roots)
    }

    fn gitlink_paths(&self) -> Result<Vec<String>, GitError> {
        let output = self.run_read(
            "discover initialized submodule candidates",
            ["ls-files", "--stage", "-z"],
        )?;
        let mut paths = Vec::new();
        for record in output.stdout.split(|byte| *byte == 0) {
            if !record.starts_with(b"160000 ") {
                continue;
            }
            let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
                return Err(GitError::Parse {
                    context: "Git link catalog".to_string(),
                    message: "a staged Git link had no path separator".to_string(),
                });
            };
            let path = std::str::from_utf8(&record[tab + 1..]).map_err(|_| GitError::Parse {
                context: "Git link catalog".to_string(),
                message: "non-UTF-8 submodule paths are not supported".to_string(),
            })?;
            validate_relative_path(path)?;
            paths.push(path.to_string());
        }
        paths.sort();
        paths.dedup();
        Ok(paths)
    }

    fn resolve_history_root(&self, repository_id: &str) -> Result<DiscoveredGitRoot, GitError> {
        self.discovered_roots()?
            .into_iter()
            .find(|root| root.descriptor.id == repository_id)
            .ok_or_else(|| GitError::InvalidInput {
                field: "repository root".to_string(),
                message: "select a currently initialized repository root".to_string(),
            })
    }

    pub fn snapshot(&self, commit_limit: usize) -> Result<RepositorySnapshot, GitError> {
        let mut snapshot = self.tracked_snapshot(commit_limit)?;
        let scan = self.untracked_changes(&CancellationToken::new())?;
        snapshot.changes.extend(scan.changes);
        snapshot
            .changes
            .sort_by(|left, right| left.path.cmp(&right.path));
        snapshot.untracked_state = UntrackedState::Complete;
        Ok(snapshot)
    }

    pub fn tracked_snapshot(&self, commit_limit: usize) -> Result<RepositorySnapshot, GitError> {
        let roots = self.discovered_roots()?;
        let mut snapshot = self.tracked_root_snapshot(commit_limit)?;
        snapshot.repository_roots = roots.iter().map(|root| root.descriptor.clone()).collect();

        let mut histories = vec![snapshot.commits];
        for root in roots.iter().skip(1) {
            let child = root.repository.tracked_root_snapshot(commit_limit)?;
            let mut branches = child.branches;
            let mut commits = child.commits;
            scope_branches(&mut branches, &root.descriptor.id);
            scope_commits(&mut commits, &root.descriptor.id);
            snapshot.branches.extend(branches);
            histories.push(commits);
        }
        snapshot.branches.sort_by(|left, right| {
            right
                .committed_at
                .cmp(&left.committed_at)
                .then_with(|| left.repository_id.cmp(&right.repository_id))
                .then_with(|| left.full_name.cmp(&right.full_name))
        });
        snapshot.commits = merge_root_histories(histories, commit_limit);
        Ok(snapshot)
    }

    pub fn tracked_changes(&self) -> Result<TrackedChangeScan, GitError> {
        let status = self.run_read(
            "read tracked working tree status",
            ["status", "--porcelain=v2", "-z", "--untracked-files=no"],
        )?;
        let (_, changes) = parse_status(&status.stdout)?;
        Ok(TrackedChangeScan {
            root: self.root.to_string_lossy().into_owned(),
            changes,
        })
    }

    fn tracked_root_snapshot(&self, commit_limit: usize) -> Result<RepositorySnapshot, GitError> {
        let status = self.run_read(
            "read working tree status",
            [
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=no",
            ],
        )?;
        let (mut branch, changes) = parse_status(&status.stdout)?;
        if let Some(head) = branch.head.as_deref()
            && let Some(upstream) = self.read_upstream_target(head)?
        {
            branch.upstream_remote = Some(upstream.remote);
            branch.upstream_ref = Some(upstream.merge_ref);
        }

        let refs = self.run_read(
            "read branches and tags",
            [
                "for-each-ref",
                "--sort=-committerdate",
                "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)%00%(subject)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;
        let branches = parse_branches(&refs.stdout)?;
        let mut history_tips: Vec<_> = branches
            .iter()
            .map(|reference| reference.oid.clone())
            .collect();
        if let Some(oid) = branch.oid.as_ref() {
            history_tips.push(oid.clone());
        }
        history_tips.sort_unstable();
        history_tips.dedup();
        let commits = self.read_all_commit_history(&history_tips, commit_limit)?;
        let remotes = self.remote_summaries()?;

        Ok(RepositorySnapshot {
            root: self.root.to_string_lossy().into_owned(),
            git_dir: self.git_dir.to_string_lossy().into_owned(),
            repository_roots: vec![self.main_root_descriptor()],
            branch,
            operation: self.detect_operation(),
            changes,
            commits,
            branches,
            remotes,
            untracked_state: UntrackedState::Pending,
        })
    }

    pub fn repository_roots(&self) -> Result<Vec<GitRootDescriptor>, GitError> {
        Ok(self
            .discovered_roots()?
            .into_iter()
            .map(|root| root.descriptor)
            .collect())
    }

    pub fn commit_history(
        &self,
        full_name: &str,
        commit_limit: usize,
    ) -> Result<Vec<CommitSummary>, GitError> {
        let reference = validate_history_ref(full_name)?;
        if !self.ref_is_valid(reference)? {
            return Err(GitError::InvalidInput {
                field: "history ref".to_string(),
                message: "select a valid branch or tag".to_string(),
            });
        }
        let oid = self.resolve_history_ref(reference)?;
        self.read_commit_history(&oid, commit_limit)
    }

    pub fn query_commit_history(
        &self,
        query: &HistoryQuery,
        commit_limit: usize,
    ) -> Result<Vec<CommitSummary>, GitError> {
        let commit_limit = commit_limit.clamp(1, MAX_HISTORY_WINDOW);
        Ok(self
            .query_commit_history_page(query, 0, commit_limit)?
            .commits)
    }

    pub fn query_commit_history_page(
        &self,
        query: &HistoryQuery,
        offset: usize,
        page_size: usize,
    ) -> Result<HistoryPage, GitError> {
        validate_history_query(query)?;
        if offset > MAX_HISTORY_WINDOW {
            return Err(GitError::InvalidInput {
                field: "history offset".to_string(),
                message: format!("must not exceed {MAX_HISTORY_WINDOW}"),
            });
        }
        if page_size == 0 || page_size > MAX_HISTORY_PAGE_SIZE {
            return Err(GitError::InvalidInput {
                field: "history page size".to_string(),
                message: format!("must be between 1 and {MAX_HISTORY_PAGE_SIZE}"),
            });
        }
        if offset == MAX_HISTORY_WINDOW {
            return Ok(HistoryPage {
                commits: Vec::new(),
                offset,
                has_more: false,
            });
        }
        let page_size = page_size.min(MAX_HISTORY_WINDOW - offset);
        let requested = offset
            .saturating_add(page_size)
            .saturating_add(1)
            .min(MAX_HISTORY_WINDOW + 1);
        let roots = self.discovered_roots()?;
        validate_query_roots(query, &roots)?;
        let selected_roots: HashSet<&str> =
            query.repository_ids.iter().map(String::as_str).collect();
        let mut histories = Vec::new();

        for root in roots {
            let repository_id = root.descriptor.id.as_str();
            if !selected_roots.is_empty() && !selected_roots.contains(repository_id) {
                continue;
            }
            let refs: Vec<&HistoryRef> = query
                .refs
                .iter()
                .filter(|reference| reference.repository_id == repository_id)
                .collect();
            let paths: Vec<&HistoryPath> = query
                .paths
                .iter()
                .filter(|path| path.repository_id == repository_id)
                .collect();
            if (!query.refs.is_empty() && refs.is_empty())
                || (!query.paths.is_empty() && paths.is_empty())
            {
                continue;
            }

            let selectors = if query.refs.is_empty() {
                root.repository.history_tip_oids()?
            } else {
                let mut oids = Vec::with_capacity(refs.len());
                for selected in refs {
                    let reference = validate_history_ref(&selected.full_name)?;
                    if !root.repository.ref_is_valid(reference)? {
                        return Err(GitError::InvalidInput {
                            field: "history refs".to_string(),
                            message: "select only existing refs from their owning repository"
                                .to_string(),
                        });
                    }
                    oids.push(root.repository.resolve_history_ref(reference)?);
                }
                oids.sort_unstable();
                oids.dedup();
                oids
            };
            if selectors.is_empty() {
                continue;
            }
            let path_values: Vec<String> =
                paths.into_iter().map(|path| path.path.clone()).collect();
            let mut commits = root.repository.run_commit_history_query(
                "query commit history",
                selectors.iter().map(OsString::from).collect(),
                query,
                &path_values,
                requested,
            )?;
            scope_commits(&mut commits, repository_id);
            histories.push(commits);
        }
        let merged = merge_root_histories(histories, requested);
        let has_more = offset + page_size < MAX_HISTORY_WINDOW && merged.len() > offset + page_size;
        let commits = merged.into_iter().skip(offset).take(page_size).collect();
        Ok(HistoryPage {
            commits,
            offset,
            has_more,
        })
    }

    fn read_commit_history(
        &self,
        oid: &str,
        commit_limit: usize,
    ) -> Result<Vec<CommitSummary>, GitError> {
        validate_object_id(oid)?;
        self.run_commit_history(
            "read commit history",
            vec![OsString::from(oid)],
            commit_limit,
        )
    }

    fn read_all_commit_history(
        &self,
        tip_oids: &[String],
        commit_limit: usize,
    ) -> Result<Vec<CommitSummary>, GitError> {
        if tip_oids.is_empty() {
            return Ok(Vec::new());
        }
        for oid in tip_oids {
            validate_object_id(oid)?;
        }
        self.run_commit_history(
            "read all-ref commit history",
            tip_oids.iter().map(OsString::from).collect(),
            commit_limit,
        )
    }

    fn run_commit_history(
        &self,
        operation: &str,
        selectors: Vec<OsString>,
        commit_limit: usize,
    ) -> Result<Vec<CommitSummary>, GitError> {
        self.run_commit_history_query(
            operation,
            selectors,
            &HistoryQuery::default(),
            &[],
            commit_limit,
        )
    }

    fn run_commit_history_query(
        &self,
        operation: &str,
        selectors: Vec<OsString>,
        query: &HistoryQuery,
        paths: &[String],
        commit_limit: usize,
    ) -> Result<Vec<CommitSummary>, GitError> {
        let limit = commit_limit.clamp(1, MAX_HISTORY_WINDOW + 1).to_string();
        let mut arguments = vec![
            OsString::from("--literal-pathspecs"),
            OsString::from("log"),
            OsString::from(match query.order {
                HistoryOrder::Topological => "--topo-order",
                HistoryOrder::Date => "--date-order",
            }),
            OsString::from("--decorate=short"),
            OsString::from(format!("--max-count={limit}")),
            OsString::from("--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e"),
        ];
        if query.first_parent {
            arguments.push(OsString::from("--first-parent"));
        }
        if query.exclude_merges {
            arguments.push(OsString::from("--no-merges"));
        }
        if let Some(since_epoch) = query.since_epoch {
            arguments.push(OsString::from(format!("--since=@{since_epoch}")));
        }
        let mut author_emails = query.author_emails.clone();
        if query.current_author {
            author_emails.push(self.current_author_email()?);
        }
        author_emails.sort_unstable();
        author_emails.dedup();
        for email in author_emails {
            arguments.push(OsString::from(format!(
                "--author=<{}>",
                escape_git_regexp(&email)
            )));
        }
        arguments.extend(selectors);
        arguments.push(OsString::from("--"));
        for path in paths {
            arguments.push(OsString::from(path));
        }
        let output = self.run_read_owned(operation, arguments)?;
        parse_commits(&output.stdout)
    }

    fn history_tip_oids(&self) -> Result<Vec<String>, GitError> {
        let refs = self.run_read(
            "read history tips",
            [
                "for-each-ref",
                "--format=%(objectname)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;
        let mut oids: Vec<_> = String::from_utf8_lossy(&refs.stdout)
            .lines()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();
        let head = run_git_output(
            &self.root,
            ["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"],
        )
        .map_err(|error| GitError::Io {
            operation: "read history HEAD".to_string(),
            message: error.to_string(),
        })?;
        if head.status.success() {
            let oid = String::from_utf8_lossy(&head.stdout).trim().to_string();
            if !oid.is_empty() {
                oids.push(oid);
            }
        }
        for oid in &oids {
            validate_object_id(oid)?;
        }
        oids.sort_unstable();
        oids.dedup();
        Ok(oids)
    }

    fn current_author_email(&self) -> Result<String, GitError> {
        let output =
            run_git_output(&self.root, ["config", "--get", "user.email"]).map_err(|error| {
                GitError::Io {
                    operation: "read Git user email".to_string(),
                    message: error.to_string(),
                }
            })?;
        if !output.status.success() {
            return Err(GitError::InvalidInput {
                field: "history user".to_string(),
                message: "configure Git user.email before filtering by me".to_string(),
            });
        }
        let email = String::from_utf8_lossy(&output.stdout).trim().to_string();
        validate_author_email(&email)?;
        Ok(email)
    }

    pub fn untracked_changes(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<UntrackedScan, GitError> {
        let output = self.run_cancellable_read(
            "scan untracked files",
            ["ls-files", "--others", "--exclude-standard", "-z"],
            cancellation,
        )?;
        let mut changes: Vec<_> = output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| FileChange {
                path: String::from_utf8_lossy(path).into_owned(),
                original_path: None,
                index_status: ChangeKind::Unmodified,
                worktree_status: ChangeKind::Untracked,
                conflicted: false,
                submodule: false,
            })
            .collect();
        changes.sort_by(|left, right| left.path.cmp(&right.path));

        Ok(UntrackedScan {
            root: self.root.to_string_lossy().into_owned(),
            changes,
        })
    }

    pub fn project_files(&self, limit: usize) -> Result<ProjectFileList, GitError> {
        self.project_files_with_ignored(limit, true)
    }

    pub fn authorized_project_files(&self, limit: usize) -> Result<ProjectFileList, GitError> {
        self.project_files_with_ignored(limit, false)
    }

    fn project_files_with_ignored(
        &self,
        limit: usize,
        include_ignored: bool,
    ) -> Result<ProjectFileList, GitError> {
        let roots = self.discovered_roots()?;
        let maximum = limit.clamp(1, 100_000);
        let mut files = Vec::new();
        let mut ignored_entries = Vec::new();
        for root in &roots {
            for path in root.repository.project_file_paths()? {
                let workspace_path = if root.descriptor.relative_path == "." {
                    path.clone()
                } else {
                    format!("{}/{path}", root.descriptor.relative_path)
                };
                files.push(ProjectFile {
                    repository_id: root.descriptor.id.clone(),
                    path,
                    workspace_path,
                });
            }
            if include_ignored {
                for entry in root.repository.project_ignored_entries()? {
                    let workspace_path = if root.descriptor.relative_path == "." {
                        entry.workspace_path
                    } else {
                        format!("{}/{}", root.descriptor.relative_path, entry.workspace_path)
                    };
                    ignored_entries.push(ProjectIgnoredEntry {
                        workspace_path,
                        kind: entry.kind,
                    });
                }
            }
        }
        files.sort_by(|left, right| {
            left.workspace_path
                .cmp(&right.workspace_path)
                .then_with(|| left.repository_id.cmp(&right.repository_id))
                .then_with(|| left.path.cmp(&right.path))
        });
        files.dedup_by(|left, right| {
            left.repository_id == right.repository_id && left.path == right.path
        });
        let files_truncated = files.len() > maximum;
        files.truncate(maximum);
        ignored_entries.sort_by(|left, right| {
            left.workspace_path
                .cmp(&right.workspace_path)
                .then_with(|| {
                    project_entry_kind_order(left.kind).cmp(&project_entry_kind_order(right.kind))
                })
        });
        ignored_entries.dedup();
        let ignored_truncated = ignored_entries.len() > maximum;
        ignored_entries.truncate(maximum);
        let nested_roots: HashSet<&str> = roots
            .iter()
            .skip(1)
            .map(|root| root.descriptor.relative_path.as_str())
            .collect();
        let mut paths: Vec<String> = files
            .iter()
            .filter(|file| !nested_roots.contains(file.workspace_path.as_str()))
            .map(|file| file.workspace_path.clone())
            .collect();
        paths.sort();
        paths.dedup();
        Ok(ProjectFileList {
            root: self.root.to_string_lossy().into_owned(),
            paths,
            files,
            ignored_entries,
            repository_roots: roots.into_iter().map(|root| root.descriptor).collect(),
            truncated: files_truncated || ignored_truncated,
        })
    }

    pub fn authorize_project_file(
        &self,
        repository_id: &str,
        path: &str,
        limit: usize,
    ) -> Result<ProjectFile, GitError> {
        validate_relative_path(path)?;
        self.authorized_project_files(limit)?
            .files
            .into_iter()
            .find(|file| file.repository_id == repository_id && file.path == path)
            .ok_or_else(|| GitError::InvalidInput {
                field: "project file".to_string(),
                message: "select a tracked or non-ignored untracked file from the current project catalog"
                    .to_string(),
            })
    }

    fn project_file_paths(&self) -> Result<Vec<String>, GitError> {
        let output = self.run_read(
            "list project files",
            [
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "-z",
            ],
        )?;
        let mut paths: Vec<_> = output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| String::from_utf8_lossy(path).into_owned())
            .collect();
        paths.sort();
        paths.dedup();
        Ok(paths)
    }

    fn project_ignored_entries(&self) -> Result<Vec<ProjectIgnoredEntry>, GitError> {
        let output = self.run_read(
            "list ignored project entries",
            [
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
                "--no-empty-directory",
                "-z",
            ],
        )?;
        let mut entries = Vec::new();
        for raw_path in output.stdout.split(|byte| *byte == 0) {
            if raw_path.is_empty() {
                continue;
            }
            let value = String::from_utf8_lossy(raw_path);
            let kind = if value.ends_with('/') {
                ProjectEntryKind::Directory
            } else {
                ProjectEntryKind::File
            };
            let path = value.trim_end_matches('/');
            if path.is_empty() {
                continue;
            }
            validate_relative_path(path)?;
            entries.push(ProjectIgnoredEntry {
                workspace_path: path.to_string(),
                kind,
            });
        }
        entries.sort_by(|left, right| {
            left.workspace_path
                .cmp(&right.workspace_path)
                .then_with(|| {
                    project_entry_kind_order(left.kind).cmp(&project_entry_kind_order(right.kind))
                })
        });
        entries.dedup();
        Ok(entries)
    }

    pub fn diff(&self, path: &str, staged: bool) -> Result<DiffResult, GitError> {
        validate_relative_path(path)?;
        let mut args = vec![
            OsString::from("diff"),
            OsString::from("--no-ext-diff"),
            OsString::from("--no-color"),
            OsString::from("--unified=3"),
        ];
        if staged {
            args.push(OsString::from("--cached"));
        }
        args.push(OsString::from("--"));
        args.push(OsString::from(path));

        let output = self.run_read_owned("read file diff", args)?;
        let mut patch = output.stdout;
        let mut binary = patch.windows(15).any(|window| window == b"Binary files ");

        if patch.is_empty() && !staged {
            let candidate = self.root.join(path);
            if candidate.is_file() {
                let data = fs::read(&candidate).map_err(|error| GitError::Io {
                    operation: "read untracked file".to_string(),
                    message: error.to_string(),
                })?;
                binary = data.contains(&0);
                if binary {
                    patch = format!("Binary file: {path}\n").into_bytes();
                } else {
                    patch = untracked_patch(path, &data).into_bytes();
                }
            }
        }

        let truncated = patch.len() > DIFF_LIMIT_BYTES;
        if truncated {
            patch.truncate(DIFF_LIMIT_BYTES);
            patch.extend_from_slice(b"\n\n[Diff truncated at 4 MiB]\n");
        }

        Ok(DiffResult {
            path: path.to_string(),
            staged,
            patch: String::from_utf8_lossy(&patch).into_owned(),
            binary,
            truncated,
        })
    }

    pub fn local_diff(&self, selected: &FileChange) -> Result<DiffResult, GitError> {
        self.local_diff_with_unchanged(selected, false)
    }

    pub fn local_diff_with_unchanged(
        &self,
        selected: &FileChange,
        expanded_unchanged: bool,
    ) -> Result<DiffResult, GitError> {
        let changes = self.status_changes_with_untracked()?;
        let current =
            match_fresh_changes(&changes, std::slice::from_ref(selected), "read local diff")?
                .pop()
                .expect("one selected change produces one fresh match");
        let mut args = vec![
            OsString::from("--literal-pathspecs"),
            OsString::from("diff"),
            OsString::from("--no-ext-diff"),
            OsString::from("--no-color"),
            diff_context_argument(expanded_unchanged),
        ];
        if self.head_oid()?.is_some() {
            args.push(OsString::from("HEAD"));
        }
        args.push(OsString::from("--"));
        args.push(OsString::from(&current.path));
        if let Some(original) = &current.original_path {
            args.push(OsString::from(original));
        }

        let (output, output_truncated) =
            self.run_read_owned_bounded("read complete local diff", args, DIFF_LIMIT_BYTES + 1)?;
        let mut patch = output.stdout;
        let mut binary = patch.windows(15).any(|window| window == b"Binary files ");
        if patch.is_empty() {
            let candidate = self.root.join(&current.path);
            if candidate.is_file() {
                let data = fs::read(&candidate).map_err(|error| GitError::Io {
                    operation: "read untracked file".to_string(),
                    message: error.to_string(),
                })?;
                binary = data.contains(&0);
                patch = if binary {
                    format!("Binary file: {}\n", current.path).into_bytes()
                } else {
                    untracked_patch(&current.path, &data).into_bytes()
                };
            }
        }

        let truncated = output_truncated || patch.len() > DIFF_LIMIT_BYTES;
        if truncated {
            patch.truncate(DIFF_LIMIT_BYTES);
            patch.extend_from_slice(b"\n\n[Diff truncated at 4 MiB]\n");
        }
        Ok(DiffResult {
            path: current.path,
            staged: false,
            patch: String::from_utf8_lossy(&patch).into_owned(),
            binary,
            truncated,
        })
    }

    pub fn local_binary_diff(&self, selected: &FileChange) -> Result<BinaryDiffResult, GitError> {
        let changes = self.status_changes_with_untracked()?;
        let current = match_fresh_changes(
            &changes,
            std::slice::from_ref(selected),
            "read local image diff",
        )?
        .pop()
        .expect("one selected change produces one fresh match");
        let before_path = current.original_path.as_deref().unwrap_or(&current.path);
        let before = self
            .head_oid()?
            .map(|head| self.read_binary_at_revision(&head, before_path))
            .transpose()?
            .flatten();
        let after = self.read_binary_from_worktree(&current.path)?;
        Ok(BinaryDiffResult {
            path: current.path,
            before,
            after,
        })
    }

    pub fn commit_details(&self, oid: &str) -> Result<CommitDetails, GitError> {
        validate_object_id(oid)?;
        let parent_oid = self.first_parent(oid)?;
        let output = if let Some(parent) = &parent_oid {
            self.run_read_owned(
                "read commit file list",
                vec![
                    OsString::from("diff"),
                    OsString::from("--no-ext-diff"),
                    OsString::from("--name-status"),
                    OsString::from("-z"),
                    OsString::from("-M"),
                    OsString::from("-C"),
                    OsString::from(parent),
                    OsString::from(oid),
                ],
            )?
        } else {
            self.run_read_owned(
                "read root commit file list",
                vec![
                    OsString::from("diff-tree"),
                    OsString::from("--root"),
                    OsString::from("--no-commit-id"),
                    OsString::from("--name-status"),
                    OsString::from("-z"),
                    OsString::from("-r"),
                    OsString::from("-M"),
                    OsString::from("-C"),
                    OsString::from(oid),
                ],
            )?
        };

        Ok(CommitDetails {
            repository_id: ".".to_string(),
            oid: oid.to_string(),
            parent_oid,
            files: parse_commit_files(&output.stdout)?,
        })
    }

    pub fn repository_commit_details(
        &self,
        repository_id: &str,
        oid: &str,
    ) -> Result<CommitDetails, GitError> {
        let root = self.resolve_history_root(repository_id)?;
        let mut details = root.repository.commit_details(oid)?;
        details.repository_id = root.descriptor.id;
        Ok(details)
    }

    pub fn commit_diff(
        &self,
        oid: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<CommitDiffResult, GitError> {
        self.commit_diff_with_unchanged(oid, path, original_path, false)
    }

    pub fn commit_diff_with_unchanged(
        &self,
        oid: &str,
        path: &str,
        original_path: Option<&str>,
        expanded_unchanged: bool,
    ) -> Result<CommitDiffResult, GitError> {
        validate_object_id(oid)?;
        validate_relative_path(path)?;
        if let Some(original_path) = original_path {
            validate_relative_path(original_path)?;
        }

        let parent_oid = self.first_parent(oid)?;
        let mut args = if let Some(parent) = parent_oid {
            vec![
                OsString::from("diff"),
                OsString::from("--no-ext-diff"),
                OsString::from("--no-color"),
                diff_context_argument(expanded_unchanged),
                OsString::from("-M"),
                OsString::from("-C"),
                OsString::from(parent),
                OsString::from(oid),
            ]
        } else {
            vec![
                OsString::from("show"),
                OsString::from("--format="),
                OsString::from("--no-ext-diff"),
                OsString::from("--no-color"),
                diff_context_argument(expanded_unchanged),
                OsString::from("-M"),
                OsString::from("-C"),
                OsString::from(oid),
            ]
        };
        args.push(OsString::from("--"));
        if let Some(original_path) = original_path {
            args.push(OsString::from(original_path));
        }
        args.push(OsString::from(path));

        let (output, output_truncated) =
            self.run_read_owned_bounded("read commit file diff", args, DIFF_LIMIT_BYTES + 1)?;
        let mut patch = output.stdout;
        let binary = patch.windows(15).any(|window| window == b"Binary files ");
        let truncated = output_truncated || patch.len() > DIFF_LIMIT_BYTES;
        if truncated {
            patch.truncate(DIFF_LIMIT_BYTES);
            patch.extend_from_slice(b"\n\n[Diff truncated at 4 MiB]\n");
        }

        Ok(CommitDiffResult {
            repository_id: ".".to_string(),
            oid: oid.to_string(),
            path: path.to_string(),
            patch: String::from_utf8_lossy(&patch).into_owned(),
            binary,
            truncated,
        })
    }

    pub fn repository_commit_diff(
        &self,
        repository_id: &str,
        oid: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<CommitDiffResult, GitError> {
        self.repository_commit_diff_with_unchanged(repository_id, oid, path, original_path, false)
    }

    pub fn repository_commit_diff_with_unchanged(
        &self,
        repository_id: &str,
        oid: &str,
        path: &str,
        original_path: Option<&str>,
        expanded_unchanged: bool,
    ) -> Result<CommitDiffResult, GitError> {
        let root = self.resolve_history_root(repository_id)?;
        let mut diff = root.repository.commit_diff_with_unchanged(
            oid,
            path,
            original_path,
            expanded_unchanged,
        )?;
        diff.repository_id = root.descriptor.id;
        Ok(diff)
    }

    pub fn repository_commit_binary_diff(
        &self,
        repository_id: &str,
        oid: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<BinaryDiffResult, GitError> {
        let root = self.resolve_history_root(repository_id)?;
        root.repository.commit_binary_diff(oid, path, original_path)
    }

    fn commit_binary_diff(
        &self,
        oid: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<BinaryDiffResult, GitError> {
        validate_object_id(oid)?;
        validate_relative_path(path)?;
        if let Some(original_path) = original_path {
            validate_relative_path(original_path)?;
        }
        let details = self.commit_details(oid)?;
        let selected = details
            .files
            .iter()
            .find(|file| file.path == path && file.original_path.as_deref() == original_path)
            .ok_or_else(|| GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "select a file from the current commit details".to_string(),
            })?;
        let before_path = selected.original_path.as_deref().unwrap_or(&selected.path);
        let before = details
            .parent_oid
            .as_deref()
            .map(|parent| self.read_binary_at_revision(parent, before_path))
            .transpose()?
            .flatten();
        let after = self.read_binary_at_revision(oid, &selected.path)?;
        Ok(BinaryDiffResult {
            path: selected.path.clone(),
            before,
            after,
        })
    }

    fn read_binary_at_revision(
        &self,
        revision: &str,
        path: &str,
    ) -> Result<Option<Vec<u8>>, GitError> {
        validate_object_id(revision)?;
        validate_relative_path(path)?;
        let listing = self.run_read_owned(
            "resolve image blob",
            vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("ls-tree"),
                OsString::from("-z"),
                OsString::from(revision),
                OsString::from("--"),
                OsString::from(path),
            ],
        )?;
        let mut records = listing
            .stdout
            .split(|byte| *byte == 0)
            .filter(|row| !row.is_empty());
        let Some(record) = records.next() else {
            return Ok(None);
        };
        if records.next().is_some() {
            return Err(GitError::Parse {
                context: "image blob".to_string(),
                message: "the selected path resolved to multiple tree entries".to_string(),
            });
        }
        let tab = record
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or_else(|| GitError::Parse {
                context: "image blob".to_string(),
                message: "the tree entry had no path separator".to_string(),
            })?;
        let listed_path = std::str::from_utf8(&record[tab + 1..]).map_err(|_| GitError::Parse {
            context: "image blob".to_string(),
            message: "non-UTF-8 image paths are not supported".to_string(),
        })?;
        if listed_path != path {
            return Err(GitError::InvalidInput {
                field: "image path".to_string(),
                message: "the selected path did not resolve exactly".to_string(),
            });
        }
        let header = std::str::from_utf8(&record[..tab]).map_err(|_| GitError::Parse {
            context: "image blob".to_string(),
            message: "the tree entry header was not UTF-8".to_string(),
        })?;
        let mut fields = header.split_ascii_whitespace();
        let _mode = fields.next();
        let kind = fields.next();
        let object = fields.next();
        if kind != Some("blob") || fields.next().is_some() {
            return Err(GitError::InvalidInput {
                field: "image path".to_string(),
                message: "the selected revision entry is not a regular file".to_string(),
            });
        }
        let object = object.ok_or_else(|| GitError::Parse {
            context: "image blob".to_string(),
            message: "the tree entry had no object id".to_string(),
        })?;
        validate_object_id(object)?;
        let size = self.run_read_owned(
            "measure image blob",
            vec![
                OsString::from("cat-file"),
                OsString::from("-s"),
                OsString::from(object),
            ],
        )?;
        let size = String::from_utf8_lossy(&size.stdout)
            .trim()
            .parse::<usize>()
            .map_err(|_| GitError::Parse {
                context: "image blob".to_string(),
                message: "Git returned an invalid blob size".to_string(),
            })?;
        if size > MAX_BINARY_PREVIEW_BYTES {
            return Err(GitError::InvalidInput {
                field: "image file".to_string(),
                message: format!(
                    "image preview is limited to {MAX_BINARY_PREVIEW_BYTES} bytes per side"
                ),
            });
        }
        let output = self.run_read_owned(
            "read image blob",
            vec![
                OsString::from("cat-file"),
                OsString::from("blob"),
                OsString::from(object),
            ],
        )?;
        if output.stdout.len() != size || output.stdout.len() > MAX_BINARY_PREVIEW_BYTES {
            return Err(GitError::Io {
                operation: "read image blob".to_string(),
                message: "the image blob changed size while it was read".to_string(),
            });
        }
        Ok(Some(output.stdout))
    }

    fn read_binary_from_worktree(&self, path: &str) -> Result<Option<Vec<u8>>, GitError> {
        validate_relative_path(path)?;
        let candidate = self.root.join(path);
        let metadata = match fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(GitError::Io {
                    operation: "inspect image file".to_string(),
                    message: error.to_string(),
                });
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(GitError::InvalidInput {
                field: "image path".to_string(),
                message: "image preview requires a regular non-symlink file".to_string(),
            });
        }
        if metadata.len() > MAX_BINARY_PREVIEW_BYTES as u64 {
            return Err(GitError::InvalidInput {
                field: "image file".to_string(),
                message: format!(
                    "image preview is limited to {MAX_BINARY_PREVIEW_BYTES} bytes per side"
                ),
            });
        }
        let canonical = fs::canonicalize(&candidate).map_err(|error| GitError::Io {
            operation: "resolve image file".to_string(),
            message: error.to_string(),
        })?;
        let canonical_root = fs::canonicalize(&self.root).map_err(|error| GitError::Io {
            operation: "resolve repository root".to_string(),
            message: error.to_string(),
        })?;
        if !canonical.starts_with(&canonical_root) {
            return Err(GitError::InvalidInput {
                field: "image path".to_string(),
                message: "the image file resolves outside the repository".to_string(),
            });
        }
        let bytes = fs::read(&canonical).map_err(|error| GitError::Io {
            operation: "read image file".to_string(),
            message: error.to_string(),
        })?;
        if bytes.len() > MAX_BINARY_PREVIEW_BYTES {
            return Err(GitError::InvalidInput {
                field: "image file".to_string(),
                message: format!(
                    "image preview is limited to {MAX_BINARY_PREVIEW_BYTES} bytes per side"
                ),
            });
        }
        Ok(Some(bytes))
    }

    pub fn stage(&self, paths: &[String]) -> Result<(), GitError> {
        let paths = validate_paths(paths)?;
        let mut args = vec![OsString::from("add"), OsString::from("--")];
        args.extend(paths);
        self.run_mutation("stage paths", args)?;
        Ok(())
    }

    pub fn unstage(&self, paths: &[String]) -> Result<(), GitError> {
        let paths = validate_paths(paths)?;
        let has_head = run_git_output(&self.root, ["rev-parse", "--verify", "HEAD"])
            .map(|output| output.status.success())
            .unwrap_or(false);
        let mut args = if has_head {
            vec![
                OsString::from("restore"),
                OsString::from("--staged"),
                OsString::from("--"),
            ]
        } else {
            vec![
                OsString::from("rm"),
                OsString::from("--cached"),
                OsString::from("--quiet"),
                OsString::from("--"),
            ]
        };
        args.extend(paths);
        self.run_mutation("unstage paths", args)?;
        Ok(())
    }

    pub fn commit(&self, message: &str) -> Result<String, GitError> {
        let message = message.trim();
        if message.is_empty() {
            return Err(GitError::InvalidInput {
                field: "commit message".to_string(),
                message: "the message cannot be empty".to_string(),
            });
        }

        let mut child = base_command(&self.root)
            .args(["commit", "--file=-", "--cleanup=strip"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitError::Io {
                operation: "create commit".to_string(),
                message: error.to_string(),
            })?;
        child
            .stdin
            .take()
            .ok_or_else(|| GitError::Io {
                operation: "create commit".to_string(),
                message: "Git stdin was not available".to_string(),
            })?
            .write_all(message.as_bytes())
            .map_err(|error| GitError::Io {
                operation: "create commit".to_string(),
                message: error.to_string(),
            })?;

        let output = child.wait_with_output().map_err(|error| GitError::Io {
            operation: "create commit".to_string(),
            message: error.to_string(),
        })?;
        ensure_success("create commit", output)?;

        let oid = self.run_read("read new commit id", ["rev-parse", "HEAD"])?;
        Ok(String::from_utf8_lossy(&oid.stdout).trim().to_string())
    }

    pub fn commit_selected(
        &self,
        message: &str,
        selected: &[FileChange],
    ) -> Result<SelectedCommitResult, GitError> {
        let message = validate_commit_message(message)?;
        self.ensure_no_repository_operation("create selected commit")?;
        let changes = self.status_changes_with_untracked()?;
        if changes.iter().any(|change| change.conflicted) {
            return Err(GitError::UnsafeOperation {
                operation: "create selected commit".to_string(),
                message: "resolve every conflicted path before committing".to_string(),
                blockers: changes
                    .iter()
                    .filter(|change| change.conflicted)
                    .map(|change| change.path.clone())
                    .collect(),
            });
        }
        let selected = match_fresh_changes(&changes, selected, "create selected commit")?;
        reject_submodule_changes(&selected, "create selected commit")?;
        let pathspecs = expanded_change_paths(&selected)?;
        let introduced = selected
            .iter()
            .filter(|change| change.worktree_status == ChangeKind::Untracked)
            .map(|change| change.path.clone())
            .collect::<Vec<_>>();
        let before_head = self.head_oid()?;

        if !introduced.is_empty() {
            let mut args = vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("add"),
                OsString::from("--intent-to-add"),
                OsString::from("--"),
            ];
            args.extend(introduced.iter().map(OsString::from));
            self.run_mutation("prepare untracked selected paths", args)?;
        }

        let commit_result = (|| {
            let mut command = base_command(&self.root);
            command
                .arg("--literal-pathspecs")
                .args(["commit", "--only", "--file=-", "--cleanup=strip", "--"])
                .args(&pathspecs)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let mut child = command.spawn().map_err(|error| GitError::Io {
                operation: "create selected commit".to_string(),
                message: error.to_string(),
            })?;
            child
                .stdin
                .take()
                .ok_or_else(|| GitError::Io {
                    operation: "create selected commit".to_string(),
                    message: "Git stdin was not available".to_string(),
                })?
                .write_all(message.as_bytes())
                .map_err(|error| GitError::Io {
                    operation: "create selected commit".to_string(),
                    message: error.to_string(),
                })?;
            child.wait_with_output().map_err(|error| GitError::Io {
                operation: "create selected commit".to_string(),
                message: error.to_string(),
            })
        })();
        let output = match commit_result {
            Ok(output) => output,
            Err(error) => {
                return match self
                    .remove_introduced_index_entries(&introduced, before_head.is_some())
                {
                    Ok(()) => Err(error),
                    Err(cleanup) => Err(GitError::Io {
                        operation: "recover rejected selected commit".to_string(),
                        message: format!("{error}; cleanup also failed: {cleanup}"),
                    }),
                };
            }
        };
        let after_head = match self.head_oid() {
            Ok(oid) => oid,
            Err(error) if output.status.success() => {
                return Ok(SelectedCommitResult {
                    oid: None,
                    verification_warning: Some(format!(
                        "Git reported commit success, but the final HEAD could not be verified: {error}. Refresh and inspect history before committing again."
                    )),
                });
            }
            Err(error) => return Err(error),
        };
        if !output.status.success() && after_head == before_head {
            let command_error = ensure_success("create selected commit", output)
                .expect_err("non-success status produces a Git error");
            return match self.remove_introduced_index_entries(&introduced, before_head.is_some()) {
                Ok(()) => Err(command_error),
                Err(cleanup) => Err(GitError::Io {
                    operation: "recover rejected selected commit".to_string(),
                    message: format!("{command_error}; cleanup also failed: {cleanup}"),
                }),
            };
        }
        if !output.status.success() {
            return Err(GitError::UnsafeOperation {
                operation: "create selected commit".to_string(),
                message: "Git rejected the commit while HEAD changed concurrently; Asterlyn preserved the observed history and did not alter the index during recovery. Refresh and inspect the repository before retrying."
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        let Some(oid) = after_head else {
            return Ok(SelectedCommitResult {
                oid: None,
                verification_warning: Some(
                    "Git reported commit success, but HEAD is unborn. Refresh and inspect history before committing again."
                        .to_string(),
                ),
            });
        };
        if Some(&oid) == before_head.as_ref() {
            return Ok(SelectedCommitResult {
                oid: None,
                verification_warning: Some(
                    "Git reported commit success, but HEAD did not advance. Refresh and inspect history before committing again."
                        .to_string(),
                ),
            });
        }
        let verification_warning = self
            .verify_selected_commit(&oid, before_head.as_deref(), &pathspecs)
            .err()
            .map(|error| {
                format!(
                    "Git reported commit success, but the final repository state could not be verified: {error}. Asterlyn preserved the observed history; inspect it before committing again."
                )
            });
        Ok(SelectedCommitResult {
            oid: verification_warning.is_none().then_some(oid),
            verification_warning,
        })
    }

    pub fn revert_selected(&self, selected: &[FileChange]) -> Result<(), GitError> {
        self.ensure_no_repository_operation("revert selected changes")?;
        if self.head_oid()?.is_none() {
            return Err(GitError::UnsafeOperation {
                operation: "revert selected changes".to_string(),
                message: "revert requires an existing HEAD commit".to_string(),
                blockers: selected.iter().map(|change| change.path.clone()).collect(),
            });
        }
        let changes = self.status_changes_with_untracked()?;
        let selected = match_fresh_changes(&changes, selected, "revert selected changes")?;
        reject_submodule_changes(&selected, "revert selected changes")?;
        let unsupported = selected
            .iter()
            .filter(|change| {
                change.conflicted
                    || change.worktree_status == ChangeKind::Untracked
                    || matches!(change.index_status, ChangeKind::Added | ChangeKind::Copied)
            })
            .map(|change| change.path.clone())
            .collect::<Vec<_>>();
        if !unsupported.is_empty() {
            return Err(GitError::UnsafeOperation {
                operation: "revert selected changes".to_string(),
                message: "this version only reverts ordinary tracked files; added, untracked, conflicted, and submodule paths are left untouched".to_string(),
                blockers: unsupported,
            });
        }
        let pathspecs = expanded_change_paths(&selected)?;
        let mut args = vec![
            OsString::from("--literal-pathspecs"),
            OsString::from("restore"),
            OsString::from("--source=HEAD"),
            OsString::from("--staged"),
            OsString::from("--worktree"),
            OsString::from("--"),
        ];
        args.extend(pathspecs);
        self.run_mutation("revert selected changes", args)?;
        Ok(())
    }

    fn status_changes_with_untracked(&self) -> Result<Vec<FileChange>, GitError> {
        let status = self.run_read(
            "read current working tree changes",
            ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
        )?;
        let (_, changes) = parse_status(&status.stdout)?;
        Ok(changes)
    }

    fn head_oid(&self) -> Result<Option<String>, GitError> {
        let output =
            run_git_output(&self.root, ["rev-parse", "--verify", "HEAD"]).map_err(|error| {
                GitError::Io {
                    operation: "read HEAD".to_string(),
                    message: error.to_string(),
                }
            })?;
        if output.status.success() {
            Ok(Some(
                String::from_utf8_lossy(&output.stdout).trim().to_string(),
            ))
        } else {
            Ok(None)
        }
    }

    fn remove_introduced_index_entries(
        &self,
        introduced: &[String],
        has_head: bool,
    ) -> Result<(), GitError> {
        if introduced.is_empty() {
            return Ok(());
        }
        let mut args = if has_head {
            vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("reset"),
                OsString::from("--quiet"),
                OsString::from("HEAD"),
                OsString::from("--"),
            ]
        } else {
            vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("rm"),
                OsString::from("--cached"),
                OsString::from("--quiet"),
                OsString::from("--force"),
                OsString::from("--"),
            ]
        };
        args.extend(introduced.iter().map(OsString::from));
        self.run_mutation("restore index after rejected commit", args)?;
        Ok(())
    }

    fn verify_selected_commit(
        &self,
        oid: &str,
        before_head: Option<&str>,
        allowed_paths: &[OsString],
    ) -> Result<(), GitError> {
        let parents = self.run_read_owned(
            "verify selected commit parent",
            vec![
                OsString::from("rev-list"),
                OsString::from("--parents"),
                OsString::from("-n"),
                OsString::from("1"),
                OsString::from(oid),
            ],
        )?;
        let line = String::from_utf8_lossy(&parents.stdout);
        let actual_parents = line.split_ascii_whitespace().skip(1).collect::<Vec<_>>();
        let parent_valid = match before_head {
            Some(before) => actual_parents == [before],
            None => actual_parents.is_empty(),
        };
        let changed = self.run_read_owned(
            "verify selected commit paths",
            vec![
                OsString::from("diff-tree"),
                OsString::from("--root"),
                OsString::from("--no-commit-id"),
                OsString::from("--name-only"),
                OsString::from("-z"),
                OsString::from("-r"),
                OsString::from("--no-renames"),
                OsString::from(oid),
            ],
        )?;
        let allowed = allowed_paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<HashSet<_>>();
        let unexpected = changed
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| String::from_utf8_lossy(path).into_owned())
            .filter(|path| !allowed.contains(path))
            .collect::<Vec<_>>();
        if parent_valid && unexpected.is_empty() {
            return Ok(());
        }
        Err(GitError::UnsafeOperation {
            operation: "verify selected commit".to_string(),
            message: "the observed HEAD did not match the selected commit parent/path boundary"
                .to_string(),
            blockers: unexpected,
        })
    }

    pub fn switch_branch(&self, target_full_name: &str) -> Result<(), GitError> {
        let target_name = validate_local_branch_ref(target_full_name)?;
        self.ensure_local_branch_exists(target_full_name)?;
        let current = self.current_branch()?;
        if current.as_deref() == Some(target_name) {
            return Err(GitError::InvalidInput {
                field: "target branch".to_string(),
                message: format!("'{target_name}' is already checked out"),
            });
        }
        self.ensure_clean_worktree("switch branch")?;
        self.run_mutation(
            "switch branch",
            vec![
                OsString::from("switch"),
                OsString::from("--no-guess"),
                OsString::from("--"),
                OsString::from(target_name),
            ],
        )?;
        Ok(())
    }

    pub fn create_branch(&self, name: &str) -> Result<(), GitError> {
        let name = self.validate_branch_name(name)?;
        let full_name = format!("refs/heads/{name}");
        if self.local_branch_exists(&full_name)? {
            return Err(GitError::InvalidInput {
                field: "branch name".to_string(),
                message: format!("'{name}' already exists"),
            });
        }
        self.ensure_clean_worktree("create branch")?;
        self.run_mutation(
            "create branch",
            vec![
                OsString::from("switch"),
                OsString::from("--create"),
                OsString::from(name),
            ],
        )?;
        Ok(())
    }

    pub fn fetch_remote(
        &self,
        remote: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        self.ensure_no_repository_operation("fetch")?;
        let remote = self.validated_remote(remote, false)?;
        let refspec = canonical_fetch_refspec(&remote.name);
        self.run_remote_operation(
            "fetch",
            &remote.name,
            vec![
                OsString::from("fetch"),
                OsString::from("--no-prune"),
                OsString::from("--no-prune-tags"),
                OsString::from("--no-tags"),
                OsString::from("--no-recurse-submodules"),
                OsString::from("--"),
                OsString::from(&remote.name),
                OsString::from(refspec),
            ],
            cancellation,
            true,
            false,
        )?;
        Ok(())
    }

    pub fn pull_ff_only(&self, cancellation: &CancellationToken) -> Result<(), GitError> {
        self.ensure_no_repository_operation("pull")?;
        self.ensure_clean_worktree("pull")?;
        let before = self.current_branch_context("pull")?;
        let upstream = before
            .upstream
            .as_ref()
            .ok_or_else(|| GitError::InvalidInput {
                field: "upstream".to_string(),
                message: "the current branch has no supported remote upstream".to_string(),
            })?;
        self.validated_upstream(upstream, false)?;

        let pull_refspec = format!("+{}:{}", upstream.merge_ref, upstream.tracking_ref);
        self.run_remote_operation(
            "pull fetch",
            &upstream.remote,
            vec![
                OsString::from("fetch"),
                OsString::from("--no-prune"),
                OsString::from("--no-prune-tags"),
                OsString::from("--no-tags"),
                OsString::from("--no-recurse-submodules"),
                OsString::from("--"),
                OsString::from(&upstream.remote),
                OsString::from(pull_refspec),
            ],
            cancellation,
            true,
            false,
        )?;

        if cancellation.is_cancelled() {
            return Err(remote_cancelled("pull", true, false));
        }
        self.ensure_no_repository_operation("pull")?;
        self.ensure_clean_worktree("pull")?;
        let after = self.current_branch_context("pull")?;
        if before.full_ref != after.full_ref
            || before.oid != after.oid
            || before.upstream != after.upstream
        {
            return Err(GitError::UnsafeOperation {
                operation: "pull".to_string(),
                message: "HEAD or upstream changed while fetching; refresh before retrying"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        let upstream = after.upstream.as_ref().expect("upstream equality checked");
        self.validated_upstream(upstream, false)?;
        let target_oid = self.resolve_commit(&upstream.tracking_ref, "read fetched upstream")?;

        if self.is_ancestor(&target_oid, &after.oid)? {
            return Ok(());
        }
        if !self.is_ancestor(&after.oid, &target_oid)? {
            return Err(GitError::UnsafeOperation {
                operation: "pull".to_string(),
                message:
                    "the current branch and upstream have diverged; merge or rebase explicitly"
                        .to_string(),
                blockers: Vec::new(),
            });
        }

        self.ensure_no_repository_operation("pull")?;
        self.ensure_clean_worktree("pull")?;
        let before_merge = self.current_branch_context("pull")?;
        let current_target =
            before_merge
                .upstream
                .as_ref()
                .ok_or_else(|| GitError::InvalidInput {
                    field: "upstream".to_string(),
                    message: "the current branch no longer has a supported upstream".to_string(),
                })?;
        let current_target_oid =
            self.resolve_commit(&current_target.tracking_ref, "recheck fetched upstream")?;
        if before_merge != after || current_target_oid != target_oid {
            return Err(GitError::UnsafeOperation {
                operation: "pull".to_string(),
                message:
                    "branch or upstream state changed before fast-forward; refresh before retrying"
                        .to_string(),
                blockers: Vec::new(),
            });
        }

        self.run_remote_operation(
            "fast-forward pull",
            &upstream.remote,
            vec![
                OsString::from("-c"),
                OsString::from("submodule.recurse=false"),
                OsString::from("merge"),
                OsString::from("--ff-only"),
                OsString::from("--no-autostash"),
                OsString::from("--"),
                OsString::from(target_oid),
            ],
            cancellation,
            true,
            false,
        )?;
        Ok(())
    }

    pub fn push_current_confirmed(
        &self,
        remote: &str,
        expected_preview_token: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        self.push_current_internal(remote, Some(expected_preview_token), cancellation, || {})
    }

    pub fn push_preview(
        &self,
        remote: &str,
        offset: usize,
        page_size: usize,
    ) -> Result<PushPreview, GitError> {
        self.ensure_no_repository_operation("push")?;
        if page_size == 0 || page_size > MAX_PUSH_PREVIEW_PAGE_SIZE {
            return Err(GitError::InvalidInput {
                field: "push preview page size".to_string(),
                message: format!("must be between 1 and {MAX_PUSH_PREVIEW_PAGE_SIZE}"),
            });
        }
        if offset > MAX_PUSH_PREVIEW_WINDOW {
            return Err(GitError::InvalidInput {
                field: "push preview offset".to_string(),
                message: format!("must not exceed {MAX_PUSH_PREVIEW_WINDOW}"),
            });
        }

        let target = self.push_target_context(remote)?;
        let selectors = push_revision_selectors(&target);
        let total_commits = self.count_revisions(&selectors, "count outgoing commits")?;
        let preview_token = push_preview_token(&target);
        if offset == MAX_PUSH_PREVIEW_WINDOW || offset >= total_commits {
            return Ok(PushPreview {
                remote: target.remote,
                branch: target.branch,
                source_ref: target.source_ref,
                destination_ref: target.destination_ref,
                head_oid: target.head_oid,
                comparison_base_oid: target.comparison_base_oid,
                publish: target.publish,
                commits: Vec::new(),
                offset,
                total_commits,
                has_more: false,
                truncated: total_commits > MAX_PUSH_PREVIEW_WINDOW,
                preview_token,
            });
        }

        let page_size = page_size
            .min(MAX_PUSH_PREVIEW_WINDOW - offset)
            .min(total_commits - offset);
        let mut log_selectors = vec![OsString::from(format!("--skip={offset}"))];
        log_selectors.extend(selectors.iter().map(OsString::from));
        let mut commits =
            self.run_commit_history("read outgoing commits", log_selectors, page_size)?;
        scope_commits(&mut commits, ".");
        let next_offset = offset.saturating_add(commits.len());
        Ok(PushPreview {
            remote: target.remote,
            branch: target.branch,
            source_ref: target.source_ref,
            destination_ref: target.destination_ref,
            head_oid: target.head_oid,
            comparison_base_oid: target.comparison_base_oid,
            publish: target.publish,
            commits,
            offset,
            total_commits,
            has_more: next_offset < total_commits && next_offset < MAX_PUSH_PREVIEW_WINDOW,
            truncated: total_commits > MAX_PUSH_PREVIEW_WINDOW,
            preview_token,
        })
    }

    fn push_current_internal<F>(
        &self,
        remote: &str,
        expected_preview_token: Option<&str>,
        cancellation: &CancellationToken,
        before_execute: F,
    ) -> Result<(), GitError>
    where
        F: FnOnce(),
    {
        self.ensure_no_repository_operation("push")?;
        let target = self.push_target_context(remote)?;
        if expected_preview_token.is_some_and(|expected| expected != push_preview_token(&target)) {
            return Err(GitError::UnsafeOperation {
                operation: "push".to_string(),
                message: "the branch, HEAD, upstream, or remote-tracking state changed after confirmation; review the push again"
                    .to_string(),
                blockers: Vec::new(),
            });
        }

        let mut args = vec![
            OsString::from("-c"),
            OsString::from("push.followTags=false"),
            OsString::from("-c"),
            OsString::from("push.recurseSubmodules=no"),
            OsString::from("push"),
            OsString::from("--porcelain"),
            OsString::from("--no-progress"),
            OsString::from("--no-force"),
            OsString::from("--no-mirror"),
            OsString::from("--no-follow-tags"),
            OsString::from("--no-signed"),
            OsString::from("--recurse-submodules=no"),
        ];
        self.ensure_no_repository_operation("push")?;
        let before_push = self.push_target_context(remote)?;
        if before_push != target {
            return Err(GitError::UnsafeOperation {
                operation: "push".to_string(),
                message: "branch or upstream state changed before push; review the push again"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        before_execute();
        args.extend([
            OsString::from("--"),
            OsString::from(&target.remote),
            OsString::from(format!("{}:{}", target.head_oid, target.destination_ref)),
        ]);
        self.run_remote_operation("push", &target.remote, args, cancellation, true, true)?;
        if target.publish {
            let tracking_ref = format!("refs/remotes/{}/{}", target.remote, target.branch);
            if self
                .run_mutation(
                    "configure published branch upstream",
                    vec![
                        OsString::from("branch"),
                        OsString::from(format!("--set-upstream-to={tracking_ref}")),
                        OsString::from("--"),
                        OsString::from(&target.branch),
                    ],
                )
                .is_err()
            {
                return Err(GitError::UnsafeOperation {
                    operation: "configure published branch upstream".to_string(),
                    message: "the remote branch was published, but its local upstream could not be configured; do not retry Push, refresh and inspect the branch"
                        .to_string(),
                    blockers: Vec::new(),
                });
            }
        }
        Ok(())
    }

    fn push_target_context(&self, remote: &str) -> Result<PushTargetContext, GitError> {
        let context = self.current_branch_context("push")?;
        let configured_remote = self.validated_remote(remote, true)?;
        let branch = context
            .full_ref
            .strip_prefix("refs/heads/")
            .expect("current branch refs are validated")
            .to_string();
        let (destination_ref, comparison_base_oid, publish) = match context.upstream.as_ref() {
            Some(upstream) => {
                self.validated_upstream(upstream, true)?;
                if upstream.remote != configured_remote.name {
                    return Err(GitError::InvalidInput {
                        field: "push remote".to_string(),
                        message: "the selected remote does not match the current upstream"
                            .to_string(),
                    });
                }
                if context.behind > 0 {
                    return Err(GitError::UnsafeOperation {
                        operation: "push".to_string(),
                        message:
                            "the current branch is behind or diverged; fetch and reconcile it first"
                                .to_string(),
                        blockers: Vec::new(),
                    });
                }
                let base =
                    self.resolve_commit(&upstream.tracking_ref, "read push comparison base")?;
                if !self.is_ancestor(&base, &context.oid)? {
                    return Err(GitError::UnsafeOperation {
                            operation: "push".to_string(),
                            message: "the current branch has diverged from its locally known upstream; fetch and reconcile it first"
                                .to_string(),
                            blockers: Vec::new(),
                        });
                }
                (upstream.merge_ref.clone(), Some(base), false)
            }
            None => {
                let tracking_ref = format!("refs/remotes/{}/{}", configured_remote.name, branch);
                let base =
                    if self.reference_exists(&tracking_ref)? {
                        Some(self.resolve_commit(
                            &tracking_ref,
                            "read unpublished branch comparison base",
                        )?)
                    } else {
                        None
                    };
                if let Some(base_oid) = base.as_ref() {
                    if !self.is_ancestor(base_oid, &context.oid)? {
                        return Err(GitError::UnsafeOperation {
                                operation: "push".to_string(),
                                message: "the same-named remote-tracking branch has diverged; fetch and reconcile it before publishing"
                                    .to_string(),
                                blockers: Vec::new(),
                            });
                    }
                }
                (context.full_ref.clone(), base, true)
            }
        };

        Ok(PushTargetContext {
            remote: configured_remote.name,
            branch,
            source_ref: context.full_ref,
            destination_ref,
            head_oid: context.oid,
            comparison_base_oid,
            publish,
        })
    }

    fn count_revisions(&self, selectors: &[String], operation: &str) -> Result<usize, GitError> {
        let mut arguments = vec![OsString::from("rev-list"), OsString::from("--count")];
        arguments.extend(selectors.iter().map(OsString::from));
        arguments.push(OsString::from("--"));
        let output = self.run_read_owned(operation, arguments)?;
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<usize>()
            .map_err(|error| GitError::Parse {
                context: operation.to_string(),
                message: error.to_string(),
            })
    }

    fn remote_summaries(&self) -> Result<Vec<RemoteSummary>, GitError> {
        let output = self.run_read("read remotes", ["remote"])?;
        let mut names: Vec<_> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect();
        names.sort();
        names.dedup();
        names
            .into_iter()
            .map(|name| {
                let fetch_supported = self.remote_fetch_is_supported(&name)?;
                let push_supported = fetch_supported && !self.remote_is_mirror(&name)?;
                Ok(RemoteSummary {
                    name,
                    fetch_supported,
                    push_supported,
                })
            })
            .collect()
    }

    fn validated_remote(&self, name: &str, require_push: bool) -> Result<RemoteSummary, GitError> {
        if name.is_empty()
            || name != name.trim()
            || name.contains(['\0', '\n', '\r'])
            || name == "."
        {
            return Err(invalid_remote("select a configured non-local remote"));
        }
        let remote = self
            .remote_summaries()?
            .into_iter()
            .find(|remote| remote.name == name)
            .ok_or_else(|| invalid_remote("the selected remote is no longer configured"))?;
        if !remote.fetch_supported {
            return Err(invalid_remote(
                "the remote uses a custom or unsafe fetch refspec that U5 does not support",
            ));
        }
        if require_push && !remote.push_supported {
            return Err(invalid_remote(
                "mirror remotes cannot be pushed by Asterlyn",
            ));
        }
        Ok(remote)
    }

    fn remote_fetch_is_supported(&self, remote: &str) -> Result<bool, GitError> {
        let probe_ref = format!("refs/remotes/{remote}/asterlyn-probe");
        if !self.ref_is_valid(&probe_ref)? {
            return Ok(false);
        }
        let key = format!("remote.{remote}.fetch");
        let values = self.read_config_values(&key, "read remote fetch mapping")?;
        let expected = canonical_fetch_refspec(remote);
        Ok(values.len() == 1
            && values[0].trim_start_matches('+') == expected.trim_start_matches('+'))
    }

    fn remote_is_mirror(&self, remote: &str) -> Result<bool, GitError> {
        let key = format!("remote.{remote}.mirror");
        let output = run_git_output(&self.root, ["config", "--bool", "--get-all", &key]).map_err(
            |error| GitError::Io {
                operation: "read remote mirror mode".to_string(),
                message: error.to_string(),
            },
        )?;
        match output.status.code() {
            Some(0) => Ok(String::from_utf8_lossy(&output.stdout)
                .lines()
                .any(|value| value.trim() == "true")),
            Some(1) => Ok(false),
            _ => Err(GitError::CommandFailed {
                operation: "read remote mirror mode".to_string(),
                status: output.status.code(),
                message: "Git could not read the remote mirror mode".to_string(),
            }),
        }
    }

    fn read_config_values(&self, key: &str, operation: &str) -> Result<Vec<String>, GitError> {
        let output = run_git_output(&self.root, ["config", "--get-all", key]).map_err(|error| {
            GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            }
        })?;
        match output.status.code() {
            Some(0) => Ok(String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect()),
            Some(1) => Ok(Vec::new()),
            _ => Err(GitError::CommandFailed {
                operation: operation.to_string(),
                status: output.status.code(),
                message: "Git could not read the remote configuration".to_string(),
            }),
        }
    }

    fn read_upstream_target(&self, branch: &str) -> Result<Option<UpstreamTarget>, GitError> {
        let branch_ref = format!("refs/heads/{branch}");
        let output = self.run_read_owned(
            "read branch upstream",
            vec![
                OsString::from("for-each-ref"),
                OsString::from(
                    "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)",
                ),
                OsString::from(branch_ref),
            ],
        )?;
        let value = String::from_utf8_lossy(&output.stdout);
        let value = value.trim_end_matches(['\r', '\n']);
        if value.is_empty() {
            return Ok(None);
        }
        let fields: Vec<_> = value.split('\0').collect();
        if fields.len() != 3 {
            return Err(GitError::Parse {
                context: "branch upstream".to_string(),
                message: "Git returned an unexpected upstream record".to_string(),
            });
        }
        if fields.iter().all(|field| field.is_empty()) {
            return Ok(None);
        }
        Ok(Some(UpstreamTarget {
            remote: fields[0].to_string(),
            merge_ref: fields[1].to_string(),
            tracking_ref: fields[2].to_string(),
        }))
    }

    fn validated_upstream(
        &self,
        upstream: &UpstreamTarget,
        require_push: bool,
    ) -> Result<RemoteSummary, GitError> {
        let remote = self.validated_remote(&upstream.remote, require_push)?;
        if !upstream.merge_ref.starts_with("refs/heads/")
            || !self.ref_is_valid(&upstream.merge_ref)?
            || !self.ref_is_valid(&upstream.tracking_ref)?
        {
            return Err(invalid_remote(
                "the current upstream does not point to a valid remote branch",
            ));
        }
        let suffix = upstream
            .merge_ref
            .strip_prefix("refs/heads/")
            .expect("prefix checked");
        let expected_tracking = format!("refs/remotes/{}/{suffix}", remote.name);
        if upstream.tracking_ref != expected_tracking {
            return Err(invalid_remote(
                "the current upstream uses a custom tracking namespace that U5 does not support",
            ));
        }
        Ok(remote)
    }

    fn current_branch_context(&self, operation: &str) -> Result<CurrentBranchContext, GitError> {
        let status = self.run_read(
            "read current branch state",
            [
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=no",
            ],
        )?;
        let (branch, _) = parse_status(&status.stdout)?;
        let name = branch.head.ok_or_else(|| GitError::UnsafeOperation {
            operation: operation.to_string(),
            message: "a checked-out local branch is required".to_string(),
            blockers: Vec::new(),
        })?;
        let oid = branch.oid.ok_or_else(|| GitError::UnsafeOperation {
            operation: operation.to_string(),
            message: "the current branch does not have a commit yet".to_string(),
            blockers: Vec::new(),
        })?;
        validate_object_id(&oid)?;
        let full_ref = self.symbolic_head(operation)?;
        if full_ref.strip_prefix("refs/heads/") != Some(name.as_str())
            || !self.ref_is_valid(&full_ref)?
        {
            return Err(GitError::Parse {
                context: "current branch".to_string(),
                message: "Git returned an invalid current branch ref".to_string(),
            });
        }
        let upstream = self.read_upstream_target(&name)?;
        Ok(CurrentBranchContext {
            full_ref,
            oid,
            upstream,
            behind: branch.behind,
        })
    }

    fn symbolic_head(&self, operation: &str) -> Result<String, GitError> {
        let output =
            run_git_output(&self.root, ["symbolic-ref", "--quiet", "HEAD"]).map_err(|error| {
                GitError::Io {
                    operation: "read symbolic HEAD".to_string(),
                    message: error.to_string(),
                }
            })?;
        match output.status.code() {
            Some(0) => {
                let reference = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if reference.starts_with("refs/heads/") {
                    Ok(reference)
                } else {
                    Err(GitError::UnsafeOperation {
                        operation: operation.to_string(),
                        message: "HEAD must point to a local branch".to_string(),
                        blockers: Vec::new(),
                    })
                }
            }
            Some(1) => Err(GitError::UnsafeOperation {
                operation: operation.to_string(),
                message: "a checked-out local branch is required".to_string(),
                blockers: Vec::new(),
            }),
            _ => Err(GitError::CommandFailed {
                operation: "read symbolic HEAD".to_string(),
                status: output.status.code(),
                message: "Git could not resolve the current branch".to_string(),
            }),
        }
    }

    fn ensure_no_repository_operation(&self, operation: &str) -> Result<(), GitError> {
        if let Some(active) = self.detect_operation() {
            return Err(GitError::UnsafeOperation {
                operation: operation.to_string(),
                message: format!("finish the active {active} operation first"),
                blockers: Vec::new(),
            });
        }
        Ok(())
    }

    fn ref_is_valid(&self, reference: &str) -> Result<bool, GitError> {
        let output =
            run_git_output(&self.root, ["check-ref-format", reference]).map_err(|error| {
                GitError::Io {
                    operation: "validate Git ref".to_string(),
                    message: error.to_string(),
                }
            })?;
        match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => Err(GitError::CommandFailed {
                operation: "validate Git ref".to_string(),
                status: output.status.code(),
                message: "Git could not validate a ref".to_string(),
            }),
        }
    }

    fn resolve_history_ref(&self, reference: &str) -> Result<String, GitError> {
        let expression = format!("{reference}^{{commit}}");
        let output = run_git_output(
            &self.root,
            [
                OsStr::new("rev-parse"),
                OsStr::new("--verify"),
                OsStr::new("--end-of-options"),
                OsStr::new(&expression),
            ],
        )
        .map_err(|error| GitError::Io {
            operation: "resolve history ref".to_string(),
            message: error.to_string(),
        })?;
        if !output.status.success() {
            return Err(GitError::InvalidInput {
                field: "history ref".to_string(),
                message: "the selected ref no longer resolves to a commit".to_string(),
            });
        }
        let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        validate_object_id(&oid)?;
        Ok(oid)
    }

    fn resolve_commit(&self, reference: &str, operation: &str) -> Result<String, GitError> {
        let output = self.run_read_owned(
            operation,
            vec![
                OsString::from("rev-parse"),
                OsString::from("--verify"),
                OsString::from(format!("{reference}^{{commit}}")),
            ],
        )?;
        let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        validate_object_id(&oid)?;
        Ok(oid)
    }

    fn is_ancestor(&self, ancestor: &str, descendant: &str) -> Result<bool, GitError> {
        let output = run_git_output(
            &self.root,
            ["merge-base", "--is-ancestor", ancestor, descendant],
        )
        .map_err(|error| GitError::Io {
            operation: "compare branch ancestry".to_string(),
            message: error.to_string(),
        })?;
        match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => Err(GitError::CommandFailed {
                operation: "compare branch ancestry".to_string(),
                status: output.status.code(),
                message: "Git could not compare branch ancestry".to_string(),
            }),
        }
    }

    fn validate_branch_name<'a>(&self, name: &'a str) -> Result<&'a str, GitError> {
        let name = name.trim();
        if name.is_empty() || name.contains('\0') || name.starts_with('-') || name.starts_with("@{")
        {
            return Err(GitError::InvalidInput {
                field: "branch name".to_string(),
                message: "enter a literal local branch name".to_string(),
            });
        }
        let output = run_git_output(&self.root, ["check-ref-format", "--branch", name]).map_err(
            |error| GitError::Io {
                operation: "validate branch name".to_string(),
                message: error.to_string(),
            },
        )?;
        let normalized = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !output.status.success() || normalized != name {
            return Err(GitError::InvalidInput {
                field: "branch name".to_string(),
                message: sanitize_stderr(&output.stderr, "Git rejected the branch name"),
            });
        }
        Ok(name)
    }

    fn current_branch(&self) -> Result<Option<String>, GitError> {
        let output = self.run_read("read current branch", ["branch", "--show-current"])?;
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok((!branch.is_empty()).then_some(branch))
    }

    fn ensure_local_branch_exists(&self, full_name: &str) -> Result<(), GitError> {
        if self.local_branch_exists(full_name)? {
            Ok(())
        } else {
            Err(GitError::InvalidInput {
                field: "target branch".to_string(),
                message: "the local branch no longer exists".to_string(),
            })
        }
    }

    fn local_branch_exists(&self, full_name: &str) -> Result<bool, GitError> {
        self.reference_exists(full_name)
    }

    fn reference_exists(&self, full_name: &str) -> Result<bool, GitError> {
        let output = run_git_output(&self.root, ["show-ref", "--verify", "--quiet", full_name])
            .map_err(|error| GitError::Io {
                operation: "verify Git ref".to_string(),
                message: error.to_string(),
            })?;
        match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => Err(GitError::CommandFailed {
                operation: "verify Git ref".to_string(),
                status: output.status.code(),
                message: sanitize_stderr(&output.stderr, "could not verify Git ref"),
            }),
        }
    }

    fn ensure_clean_worktree(&self, operation: &str) -> Result<(), GitError> {
        let status = self.run_read(
            "preflight working tree",
            ["status", "--porcelain=v2", "-z", "--untracked-files=normal"],
        )?;
        let (_, changes) = parse_status(&status.stdout)?;
        if changes.is_empty() {
            return Ok(());
        }
        Err(GitError::UnsafeOperation {
            operation: operation.to_string(),
            message: "commit, stash, or remove working-tree changes before continuing".to_string(),
            blockers: changes.into_iter().map(|change| change.path).collect(),
        })
    }

    fn run_read<const N: usize>(
        &self,
        operation: &str,
        args: [&str; N],
    ) -> Result<Output, GitError> {
        let output = run_git_output(&self.root, args).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
        ensure_success(operation, output)
    }

    fn run_read_owned(&self, operation: &str, args: Vec<OsString>) -> Result<Output, GitError> {
        let output = run_git_output(&self.root, args).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
        ensure_success(operation, output)
    }

    fn run_read_owned_bounded(
        &self,
        operation: &str,
        args: Vec<OsString>,
        stdout_limit: usize,
    ) -> Result<(Output, bool), GitError> {
        let mut child = base_command(&self.root)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })?;
        let stdout = child.stdout.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git stdout was not available".to_string(),
        })?;
        let stderr = child.stderr.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git stderr was not available".to_string(),
        })?;
        let (limit_sender, limit_receiver) = std::sync::mpsc::sync_channel(1);
        let stdout_reader = thread::spawn(move || {
            read_stream_limited_with_signal(stdout, stdout_limit, Some(limit_sender))
        });
        let stderr_reader = thread::spawn(move || read_stream_bounded(stderr));
        let mut terminated_at_limit = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if limit_receiver.try_recv().is_ok() => {
                    terminated_at_limit = true;
                    let _ = child.kill();
                    break child.wait().map_err(|error| GitError::Io {
                        operation: operation.to_string(),
                        message: error.to_string(),
                    })?;
                }
                Ok(None) => thread::sleep(CANCELLATION_POLL_INTERVAL),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = join_limited_stream(stdout_reader, operation, "stdout");
                    let _ = join_stream(stderr_reader, operation, "stderr");
                    return Err(GitError::Io {
                        operation: operation.to_string(),
                        message: error.to_string(),
                    });
                }
            }
        };
        let (stdout, stdout_truncated) = join_limited_stream(stdout_reader, operation, "stdout")?;
        let output = Output {
            status,
            stdout,
            stderr: join_stream(stderr_reader, operation, "stderr")?,
        };
        if terminated_at_limit || stdout_truncated {
            Ok((output, true))
        } else {
            Ok((ensure_success(operation, output)?, false))
        }
    }

    fn run_mutation(&self, operation: &str, args: Vec<OsString>) -> Result<Output, GitError> {
        let output = run_git_output(&self.root, args).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
        ensure_success(operation, output)
    }

    #[allow(clippy::too_many_arguments)]
    fn run_remote_operation(
        &self,
        operation: &str,
        remote: &str,
        args: Vec<OsString>,
        cancellation: &CancellationToken,
        repository_state_may_have_changed: bool,
        remote_state_may_have_changed: bool,
    ) -> Result<Output, GitError> {
        if cancellation.is_cancelled() {
            return Err(remote_cancelled(
                operation,
                repository_state_may_have_changed,
                remote_state_may_have_changed,
            ));
        }

        let mut child = remote_command(&self.root)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })?;
        let stdout = child.stdout.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git stdout was not available".to_string(),
        })?;
        let stderr = child.stderr.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git stderr was not available".to_string(),
        })?;
        let stdout_reader = thread::spawn(move || read_stream_bounded(stdout));
        let stderr_reader = thread::spawn(move || read_stream_bounded(stderr));

        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if cancellation.is_cancelled() => {
                    terminate_process_tree(&mut child);
                    let _ = join_stream(stdout_reader, operation, "stdout");
                    let _ = join_stream(stderr_reader, operation, "stderr");
                    return Err(remote_cancelled(
                        operation,
                        repository_state_may_have_changed,
                        remote_state_may_have_changed,
                    ));
                }
                Ok(None) => thread::sleep(CANCELLATION_POLL_INTERVAL),
                Err(error) => {
                    terminate_process_tree(&mut child);
                    let _ = join_stream(stdout_reader, operation, "stdout");
                    let _ = join_stream(stderr_reader, operation, "stderr");
                    return Err(GitError::Io {
                        operation: operation.to_string(),
                        message: error.to_string(),
                    });
                }
            }
        };

        let stdout = join_stream(stdout_reader, operation, "stdout")?;
        let stderr = join_stream(stderr_reader, operation, "stderr")?;
        let output = Output {
            status,
            stdout,
            stderr,
        };
        if output.status.success() {
            Ok(output)
        } else {
            Err(GitError::RemoteFailed {
                operation: operation.to_string(),
                remote: remote.to_string(),
                reason: classify_remote_failure(&output.stdout, &output.stderr),
            })
        }
    }

    fn run_cancellable_read<const N: usize>(
        &self,
        operation: &str,
        args: [&str; N],
        cancellation: &CancellationToken,
    ) -> Result<Output, GitError> {
        if cancellation.is_cancelled() {
            return Err(GitError::Cancelled {
                operation: operation.to_string(),
            });
        }

        let mut child = base_command(&self.root)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })?;
        let stdout = child.stdout.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git stdout was not available".to_string(),
        })?;
        let stderr = child.stderr.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git stderr was not available".to_string(),
        })?;
        let stdout_reader = thread::spawn(move || read_stream(stdout));
        let stderr_reader = thread::spawn(move || read_stream(stderr));

        let status = loop {
            if cancellation.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_stream(stdout_reader, operation, "stdout");
                let _ = join_stream(stderr_reader, operation, "stderr");
                return Err(GitError::Cancelled {
                    operation: operation.to_string(),
                });
            }
            let wait_result = child.try_wait();
            match wait_result {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(CANCELLATION_POLL_INTERVAL),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = join_stream(stdout_reader, operation, "stdout");
                    let _ = join_stream(stderr_reader, operation, "stderr");
                    return Err(GitError::Io {
                        operation: operation.to_string(),
                        message: error.to_string(),
                    });
                }
            }
        };

        let output = Output {
            status,
            stdout: join_stream(stdout_reader, operation, "stdout")?,
            stderr: join_stream(stderr_reader, operation, "stderr")?,
        };
        ensure_success(operation, output)
    }

    fn first_parent(&self, oid: &str) -> Result<Option<String>, GitError> {
        let output = self.run_read_owned(
            "read commit parents",
            vec![
                OsString::from("rev-list"),
                OsString::from("--parents"),
                OsString::from("--max-count=1"),
                OsString::from(oid),
            ],
        )?;
        let line = String::from_utf8_lossy(&output.stdout);
        let mut objects = line.split_ascii_whitespace();
        let Some(resolved_oid) = objects.next() else {
            return Err(GitError::Parse {
                context: "commit parents".to_string(),
                message: "Git returned no commit".to_string(),
            });
        };
        if !resolved_oid.eq_ignore_ascii_case(oid) {
            return Err(GitError::Parse {
                context: "commit parents".to_string(),
                message: "Git returned an unexpected commit id".to_string(),
            });
        }
        Ok(objects.next().map(str::to_string))
    }

    fn detect_operation(&self) -> Option<String> {
        let candidates = [
            ("rebase-merge", "rebase"),
            ("rebase-apply", "rebase"),
            ("MERGE_HEAD", "merge"),
            ("CHERRY_PICK_HEAD", "cherry-pick"),
            ("REVERT_HEAD", "revert"),
            ("BISECT_LOG", "bisect"),
        ];
        candidates
            .iter()
            .find(|(marker, _)| self.git_dir.join(marker).exists())
            .map(|(_, operation)| (*operation).to_string())
    }
}

fn push_revision_selectors(target: &PushTargetContext) -> Vec<String> {
    match target.comparison_base_oid.as_ref() {
        Some(base) => vec![format!("{base}..{}", target.head_oid)],
        None => vec![
            target.head_oid.clone(),
            "--not".to_string(),
            format!("--remotes={}", target.remote),
        ],
    }
}

fn push_preview_token(target: &PushTargetContext) -> String {
    let fields = [
        target.remote.as_str(),
        target.source_ref.as_str(),
        target.destination_ref.as_str(),
        target.head_oid.as_str(),
        target.comparison_base_oid.as_deref().unwrap_or("new"),
        if target.publish {
            "publish"
        } else {
            "upstream"
        },
    ];
    let mut token = String::from("v1");
    for field in fields {
        token.push('|');
        token.push_str(&field.len().to_string());
        token.push(':');
        token.push_str(field);
    }
    token
}

fn path_to_git_string(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        let std::path::Component::Normal(value) = component else {
            return None;
        };
        parts.push(value.to_str()?);
    }
    Some(parts.join("/"))
}

fn scope_commits(commits: &mut [CommitSummary], repository_id: &str) {
    for commit in commits {
        commit.repository_id = repository_id.to_string();
    }
}

fn scope_branches(branches: &mut [crate::model::BranchSummary], repository_id: &str) {
    for branch in branches {
        branch.repository_id = repository_id.to_string();
    }
}

fn merge_root_histories(
    histories: Vec<Vec<CommitSummary>>,
    commit_limit: usize,
) -> Vec<CommitSummary> {
    let limit = commit_limit.clamp(1, MAX_HISTORY_WINDOW + 1);
    let mut positions = vec![0_usize; histories.len()];
    let mut merged = Vec::with_capacity(limit);
    while merged.len() < limit {
        let next = histories
            .iter()
            .enumerate()
            .filter_map(|(index, history)| {
                history.get(positions[index]).map(|commit| (index, commit))
            })
            .max_by(|(_, left), (_, right)| {
                left.authored_at
                    .cmp(&right.authored_at)
                    .then_with(|| right.repository_id.cmp(&left.repository_id))
                    .then_with(|| right.oid.cmp(&left.oid))
            })
            .map(|(index, _)| index);
        let Some(index) = next else {
            break;
        };
        merged.push(histories[index][positions[index]].clone());
        positions[index] += 1;
    }
    merged
}

fn validate_query_roots(query: &HistoryQuery, roots: &[DiscoveredGitRoot]) -> Result<(), GitError> {
    let available: HashSet<&str> = roots
        .iter()
        .map(|root| root.descriptor.id.as_str())
        .collect();
    let requested = query
        .repository_ids
        .iter()
        .map(String::as_str)
        .chain(
            query
                .refs
                .iter()
                .map(|reference| reference.repository_id.as_str()),
        )
        .chain(query.paths.iter().map(|path| path.repository_id.as_str()));
    if requested.into_iter().any(|id| !available.contains(id)) {
        return Err(GitError::InvalidInput {
            field: "repository root".to_string(),
            message: "a selected repository root is no longer initialized".to_string(),
        });
    }
    Ok(())
}

fn read_stream(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn read_stream_bounded(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    read_stream_limited(&mut stream, REMOTE_OUTPUT_LIMIT_BYTES).map(|(bytes, _)| bytes)
}

fn read_stream_limited(stream: impl Read, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    read_stream_limited_with_signal(stream, limit, None)
}

fn read_stream_limited_with_signal(
    mut stream: impl Read,
    limit: usize,
    limit_reached: Option<std::sync::mpsc::SyncSender<()>>,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::new();
    let mut truncated = false;
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(retained.len());
        retained.extend_from_slice(&buffer[..count.min(remaining)]);
        if count > remaining && !truncated {
            truncated = true;
            if let Some(sender) = limit_reached.as_ref() {
                let _ = sender.try_send(());
            }
        }
    }
    Ok((retained, truncated))
}

fn join_stream(
    reader: thread::JoinHandle<std::io::Result<Vec<u8>>>,
    operation: &str,
    stream: &str,
) -> Result<Vec<u8>, GitError> {
    reader
        .join()
        .map_err(|_| GitError::Io {
            operation: operation.to_string(),
            message: format!("Git {stream} reader stopped unexpectedly"),
        })?
        .map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: format!("could not read Git {stream}: {error}"),
        })
}

fn join_limited_stream(
    reader: thread::JoinHandle<std::io::Result<(Vec<u8>, bool)>>,
    operation: &str,
    stream: &str,
) -> Result<(Vec<u8>, bool), GitError> {
    reader
        .join()
        .map_err(|_| GitError::Io {
            operation: operation.to_string(),
            message: format!("Git {stream} reader stopped unexpectedly"),
        })?
        .map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: format!("could not read Git {stream}: {error}"),
        })
}

fn run_from<const N: usize>(
    path: &Path,
    operation: &str,
    args: [&str; N],
) -> Result<Output, GitError> {
    let output = run_git_output(path, args).map_err(|error| GitError::InvalidRepository {
        path: path.to_string_lossy().into_owned(),
        message: error.to_string(),
    })?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(GitError::InvalidRepository {
            path: path.to_string_lossy().into_owned(),
            message: sanitize_stderr(&output.stderr, operation),
        })
    }
}

fn run_git_output<I, S>(path: &Path, args: I) -> std::io::Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    base_command(path).args(args).output()
}

fn base_command(path: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(path)
        .arg("--no-pager")
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("GIT_TERMINAL_PROMPT", "0");
    command
}

fn remote_command(path: &Path) -> Command {
    let mut command = base_command(path);
    command
        .arg("-c")
        .arg("credential.interactive=never")
        .arg("-c")
        .arg("core.askPass=")
        .env("GCM_INTERACTIVE", "Never")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS")
        .env_remove("GIT_CONFIG_PARAMETERS")
        .stdin(Stdio::null());
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name.starts_with("GIT_TRACE")
            || name == "GIT_CURL_VERBOSE"
            || name == "GIT_CONFIG_COUNT"
            || name == "GIT_CONFIG_GLOBAL"
            || name == "GIT_CONFIG_SYSTEM"
            || name == "GIT_CONFIG_NOSYSTEM"
            || name == "GIT_EXEC_PATH"
            || name.starts_with("GIT_CONFIG_KEY_")
            || name.starts_with("GIT_CONFIG_VALUE_")
        {
            command.env_remove(key);
        }
    }
    #[cfg(unix)]
    command.process_group(0);
    command
}

fn terminate_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = -(child.id() as i32);
        // SAFETY: the child was placed in its own process group before spawn. Signals target only
        // that group, and failures fall back to Child::kill below.
        unsafe {
            libc::kill(process_group, libc::SIGTERM);
        }
        for _ in 0..25 {
            if child.try_wait().ok().flatten().is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(4));
        }
        // SAFETY: same dedicated process-group invariant as above. Sending SIGKILL even after the
        // direct child exits also removes a descendant that ignored SIGTERM.
        unsafe {
            libc::kill(process_group, libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    let _ = child.wait();
}

fn ensure_success(operation: &str, output: Output) -> Result<Output, GitError> {
    if output.status.success() {
        Ok(output)
    } else {
        Err(GitError::CommandFailed {
            operation: operation.to_string(),
            status: output.status.code(),
            message: sanitize_stderr(&output.stderr, operation),
        })
    }
}

fn sanitize_stderr(stderr: &[u8], fallback: &str) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

fn output_path(output: &Output, context: &str) -> Result<PathBuf, GitError> {
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        Err(GitError::Parse {
            context: context.to_string(),
            message: "Git returned an empty path".to_string(),
        })
    } else {
        Ok(PathBuf::from(value))
    }
}

fn validate_paths(paths: &[String]) -> Result<Vec<OsString>, GitError> {
    if paths.is_empty() {
        return Err(GitError::InvalidInput {
            field: "paths".to_string(),
            message: "select at least one path".to_string(),
        });
    }
    paths
        .iter()
        .map(|path| {
            validate_relative_path(path)?;
            Ok(OsString::from(path))
        })
        .collect()
}

fn validate_commit_message(message: &str) -> Result<&str, GitError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(GitError::InvalidInput {
            field: "commit message".to_string(),
            message: "the message cannot be empty".to_string(),
        });
    }
    Ok(message)
}

fn match_fresh_changes(
    current: &[FileChange],
    selected: &[FileChange],
    operation: &str,
) -> Result<Vec<FileChange>, GitError> {
    if selected.is_empty() {
        return Err(GitError::InvalidInput {
            field: "selected changes".to_string(),
            message: "select at least one changed file".to_string(),
        });
    }
    let mut seen = HashSet::new();
    let mut matched = Vec::with_capacity(selected.len());
    for requested in selected {
        validate_relative_path(&requested.path)?;
        if !seen.insert(requested.path.as_str()) {
            return Err(GitError::InvalidInput {
                field: "selected changes".to_string(),
                message: format!("'{}' was selected more than once", requested.path),
            });
        }
        let fresh = current
            .iter()
            .find(|change| change.path == requested.path)
            .ok_or_else(|| GitError::UnsafeOperation {
                operation: operation.to_string(),
                message: "the selected change is stale; refresh and try again".to_string(),
                blockers: vec![requested.path.clone()],
            })?;
        if fresh != requested {
            return Err(GitError::UnsafeOperation {
                operation: operation.to_string(),
                message: "the selected change changed since the last refresh".to_string(),
                blockers: vec![requested.path.clone()],
            });
        }
        matched.push(fresh.clone());
    }
    Ok(matched)
}

fn reject_submodule_changes(selected: &[FileChange], operation: &str) -> Result<(), GitError> {
    let blockers = selected
        .iter()
        .filter(|change| change.submodule)
        .map(|change| change.path.clone())
        .collect::<Vec<_>>();
    if blockers.is_empty() {
        Ok(())
    } else {
        Err(GitError::UnsafeOperation {
            operation: operation.to_string(),
            message: "submodule changes require a dedicated repository-root workflow".to_string(),
            blockers,
        })
    }
}

fn expanded_change_paths(selected: &[FileChange]) -> Result<Vec<OsString>, GitError> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    for change in selected {
        for path in std::iter::once(change.path.as_str()).chain(change.original_path.as_deref()) {
            validate_relative_path(path)?;
            if seen.insert(path.to_string()) {
                paths.push(OsString::from(path));
            }
        }
    }
    Ok(paths)
}

fn validate_relative_path(path: &str) -> Result<(), GitError> {
    let candidate = Path::new(path);
    if path.is_empty()
        || path
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n' | '\\'))
        || candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::CurDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(GitError::InvalidInput {
            field: "path".to_string(),
            message: "the path must be an unambiguous repository-relative path".to_string(),
        });
    }
    Ok(())
}

fn validate_object_id(oid: &str) -> Result<(), GitError> {
    if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(GitError::InvalidInput {
            field: "commit id".to_string(),
            message: "expected a full hexadecimal object id".to_string(),
        });
    }
    Ok(())
}

fn validate_local_branch_ref(full_name: &str) -> Result<&str, GitError> {
    let name = full_name.strip_prefix("refs/heads/").unwrap_or_default();
    if name.is_empty() || name.contains('\0') {
        return Err(GitError::InvalidInput {
            field: "target branch".to_string(),
            message: "select an existing local branch".to_string(),
        });
    }
    Ok(name)
}

fn validate_history_ref(full_name: &str) -> Result<&str, GitError> {
    let suffix = ["refs/heads/", "refs/remotes/", "refs/tags/"]
        .iter()
        .find_map(|prefix| full_name.strip_prefix(prefix));
    if suffix.is_none_or(|name| name.is_empty()) || full_name.contains('\0') {
        return Err(GitError::InvalidInput {
            field: "history ref".to_string(),
            message: "select a complete local, remote, or tag ref".to_string(),
        });
    }
    Ok(full_name)
}

fn validate_history_query(query: &HistoryQuery) -> Result<(), GitError> {
    if query.repository_ids.len() > 64 {
        return Err(GitError::InvalidInput {
            field: "repository roots".to_string(),
            message: "select at most 64 repository roots".to_string(),
        });
    }
    for repository_id in &query.repository_ids {
        validate_repository_id(repository_id)?;
    }
    if query.refs.len() > 256 {
        return Err(GitError::InvalidInput {
            field: "history refs".to_string(),
            message: "select at most 256 refs".to_string(),
        });
    }
    for reference in &query.refs {
        validate_repository_id(&reference.repository_id)?;
        validate_history_ref(&reference.full_name)?;
    }
    if query.author_emails.len() > 64 {
        return Err(GitError::InvalidInput {
            field: "history users".to_string(),
            message: "select at most 64 authors".to_string(),
        });
    }
    for email in &query.author_emails {
        validate_author_email(email)?;
    }
    if query.since_epoch.is_some_and(|value| value <= 0) {
        return Err(GitError::InvalidInput {
            field: "history date".to_string(),
            message: "the lower date bound must be a positive Unix timestamp".to_string(),
        });
    }
    if query.paths.len() > 256 {
        return Err(GitError::InvalidInput {
            field: "history paths".to_string(),
            message: "select at most 256 paths".to_string(),
        });
    }
    for path in &query.paths {
        validate_repository_id(&path.repository_id)?;
        validate_relative_path(&path.path)?;
    }
    Ok(())
}

fn validate_repository_id(repository_id: &str) -> Result<(), GitError> {
    if repository_id.is_empty()
        || repository_id.len() > 4_096
        || repository_id
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err(GitError::InvalidInput {
            field: "repository root".to_string(),
            message: "select a valid repository root".to_string(),
        });
    }
    Ok(())
}

fn validate_author_email(email: &str) -> Result<(), GitError> {
    if email.is_empty()
        || email.len() > 320
        || email
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
        || !email.contains('@')
    {
        return Err(GitError::InvalidInput {
            field: "history user".to_string(),
            message: "select a valid author email".to_string(),
        });
    }
    Ok(())
}

fn escape_git_regexp(value: &str) -> String {
    value.chars().fold(String::new(), |mut escaped, character| {
        if matches!(
            character,
            '\\' | '.' | '^' | '$' | '|' | '?' | '*' | '+' | '(' | ')' | '[' | ']' | '{' | '}'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
        escaped
    })
}

fn canonical_fetch_refspec(remote: &str) -> String {
    format!("+refs/heads/*:refs/remotes/{remote}/*")
}

fn invalid_remote(message: &str) -> GitError {
    GitError::InvalidInput {
        field: "remote".to_string(),
        message: message.to_string(),
    }
}

fn remote_cancelled(
    operation: &str,
    repository_state_may_have_changed: bool,
    remote_state_may_have_changed: bool,
) -> GitError {
    GitError::RemoteCancelled {
        operation: operation.to_string(),
        repository_state_may_have_changed,
        remote_state_may_have_changed,
    }
}

fn classify_remote_failure(stdout: &[u8], stderr: &[u8]) -> RemoteFailureKind {
    let mut output = Vec::with_capacity(stdout.len() + stderr.len());
    output.extend_from_slice(stdout);
    output.extend_from_slice(stderr);
    let message = String::from_utf8_lossy(&output).to_ascii_lowercase();
    if [
        "authentication failed",
        "could not read username",
        "permission denied",
        "publickey",
        "access denied",
    ]
    .iter()
    .any(|needle| message.contains(needle))
    {
        RemoteFailureKind::Authentication
    } else if [
        "could not resolve host",
        "couldn't connect",
        "connection refused",
        "connection timed out",
        "network is unreachable",
        "unable to access",
    ]
    .iter()
    .any(|needle| message.contains(needle))
    {
        RemoteFailureKind::Network
    } else if ["non-fast-forward", "rejected", "failed to push some refs"]
        .iter()
        .any(|needle| message.contains(needle))
    {
        RemoteFailureKind::Rejected
    } else {
        RemoteFailureKind::Unknown
    }
}

fn parse_commit_files(output: &[u8]) -> Result<Vec<CommitFileChange>, GitError> {
    let fields: Vec<_> = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect();
    let mut files = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let status = fields[index];
        index += 1;
        let Some(code) = status.first().copied() else {
            return Err(commit_file_parse_error("empty status"));
        };
        let kind = commit_change_kind(code);
        if matches!(kind, ChangeKind::Renamed | ChangeKind::Copied) {
            let Some(original_path) = fields.get(index) else {
                return Err(commit_file_parse_error(
                    "rename/copy source path is missing",
                ));
            };
            let Some(path) = fields.get(index + 1) else {
                return Err(commit_file_parse_error(
                    "rename/copy destination path is missing",
                ));
            };
            files.push(CommitFileChange {
                path: String::from_utf8_lossy(path).into_owned(),
                original_path: Some(String::from_utf8_lossy(original_path).into_owned()),
                status: kind,
            });
            index += 2;
        } else {
            let Some(path) = fields.get(index) else {
                return Err(commit_file_parse_error("changed path is missing"));
            };
            files.push(CommitFileChange {
                path: String::from_utf8_lossy(path).into_owned(),
                original_path: None,
                status: kind,
            });
            index += 1;
        }
    }
    Ok(files)
}

fn commit_change_kind(code: u8) -> ChangeKind {
    match code {
        b'A' => ChangeKind::Added,
        b'M' => ChangeKind::Modified,
        b'D' => ChangeKind::Deleted,
        b'R' => ChangeKind::Renamed,
        b'C' => ChangeKind::Copied,
        b'T' => ChangeKind::TypeChanged,
        b'U' => ChangeKind::Unmerged,
        _ => ChangeKind::Unknown,
    }
}

fn commit_file_parse_error(message: &str) -> GitError {
    GitError::Parse {
        context: "commit file list".to_string(),
        message: message.to_string(),
    }
}

fn untracked_patch(path: &str, data: &[u8]) -> String {
    let content = String::from_utf8_lossy(data);
    let line_count = content.lines().count().max(1);
    let mut patch = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{line_count} @@\n"
    );
    for line in content.split_inclusive('\n') {
        patch.push('+');
        patch.push_str(line);
    }
    if !content.ends_with('\n') {
        patch.push_str("\n\\ No newline at end of file\n");
    }
    patch
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .expect("git should start");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .expect("git should start");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn fixture() -> TempDir {
        let directory = tempfile::tempdir().expect("temp directory");
        git(directory.path(), &["init", "-b", "main"]);
        git(directory.path(), &["config", "user.name", "Asterlyn Test"]);
        git(
            directory.path(),
            &["config", "user.email", "test@asterlyn.invalid"],
        );
        directory
    }

    fn history_ref(full_name: &str) -> HistoryRef {
        HistoryRef {
            repository_id: ".".to_string(),
            full_name: full_name.to_string(),
        }
    }

    fn history_path(path: &str) -> HistoryPath {
        HistoryPath {
            repository_id: ".".to_string(),
            path: path.to_string(),
        }
    }

    struct RemoteFixture {
        _directory: TempDir,
        remote: PathBuf,
        local: PathBuf,
        peer: PathBuf,
    }

    fn remote_fixture() -> RemoteFixture {
        let directory = tempfile::tempdir().expect("remote temp directory");
        let remote = directory.path().join("remote.git");
        let seed = directory.path().join("seed");
        let local = directory.path().join("local");
        let peer = directory.path().join("peer");
        let remote_path = remote.to_string_lossy().into_owned();
        let seed_path = seed.to_string_lossy().into_owned();
        let local_path = local.to_string_lossy().into_owned();
        let peer_path = peer.to_string_lossy().into_owned();

        git(directory.path(), &["init", "--bare", &remote_path]);
        git(directory.path(), &["init", "-b", "main", &seed_path]);
        git(&seed, &["config", "user.name", "Asterlyn Test"]);
        git(&seed, &["config", "user.email", "test@asterlyn.invalid"]);
        fs::write(seed.join("base.txt"), "base\n").expect("seed file");
        git(&seed, &["add", "base.txt"]);
        git(&seed, &["commit", "-m", "Root"]);
        git(&seed, &["remote", "add", "origin", &remote_path]);
        git(&seed, &["push", "--set-upstream", "origin", "main"]);
        git(&remote, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        git(directory.path(), &["clone", &remote_path, &local_path]);
        git(directory.path(), &["clone", &remote_path, &peer_path]);
        for repository in [&local, &peer] {
            git(repository, &["config", "user.name", "Asterlyn Test"]);
            git(
                repository,
                &["config", "user.email", "test@asterlyn.invalid"],
            );
        }

        RemoteFixture {
            _directory: directory,
            remote,
            local,
            peer,
        }
    }

    fn commit_file(repository: &Path, path: &str, contents: &str, message: &str) -> String {
        fs::write(repository.join(path), contents).expect("commit fixture file");
        git(repository, &["add", path]);
        git(repository, &["commit", "-m", message]);
        git_stdout(repository, &["rev-parse", "HEAD"])
    }

    #[test]
    fn opens_repository_and_reads_unborn_state() {
        let directory = fixture();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let snapshot = repository.snapshot(50).expect("snapshot loads");
        assert_eq!(snapshot.branch.head.as_deref(), Some("main"));
        assert!(snapshot.branch.unborn);
        assert!(snapshot.commits.is_empty());
    }

    #[test]
    fn tracked_snapshot_defers_untracked_discovery() {
        let directory = fixture();
        fs::write(directory.path().join("later.txt"), "later\n").expect("fixture file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        let tracked = repository
            .tracked_snapshot(50)
            .expect("tracked snapshot loads");
        assert_eq!(tracked.untracked_state, UntrackedState::Pending);
        assert!(tracked.changes.is_empty());

        let scan = repository
            .untracked_changes(&CancellationToken::new())
            .expect("untracked scan loads");
        assert_eq!(scan.changes.len(), 1);
        assert_eq!(scan.changes[0].path, "later.txt");

        let complete = repository.snapshot(50).expect("full snapshot loads");
        assert_eq!(complete.untracked_state, UntrackedState::Complete);
        assert_eq!(complete.changes.len(), 1);
    }

    #[test]
    fn tracked_change_scan_refreshes_worktree_state_without_history_or_untracked_files() {
        let directory = fixture();
        commit_file(directory.path(), "tracked.txt", "before\n", "Initial file");
        fs::write(directory.path().join("tracked.txt"), "after\n").expect("modify tracked file");
        fs::write(directory.path().join("untracked.txt"), "later\n")
            .expect("create untracked file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        let scan = repository.tracked_changes().expect("tracked changes load");

        assert_eq!(scan.root, directory.path().to_string_lossy());
        assert_eq!(scan.changes.len(), 1);
        assert_eq!(scan.changes[0].path, "tracked.txt");
        assert_eq!(scan.changes[0].worktree_status, ChangeKind::Modified);
    }

    #[test]
    fn history_is_scoped_to_all_refs_or_an_exact_valid_ref() {
        let directory = fixture();
        let root = commit_file(directory.path(), "base.txt", "base\n", "Root");
        git(directory.path(), &["switch", "-c", "feature"]);
        let feature = commit_file(directory.path(), "feature.txt", "feature\n", "Feature only");
        git(directory.path(), &["switch", "main"]);
        let main = commit_file(directory.path(), "main.txt", "main\n", "Main only");
        git(
            directory.path(),
            &["update-ref", "refs/remotes/origin/feature", &feature],
        );
        git(directory.path(), &["tag", "light", &feature]);
        git(
            directory.path(),
            &["tag", "-a", "release", "-m", "Release", &root],
        );
        git(
            directory.path(),
            &["update-ref", "refs/heads/--all", &feature],
        );

        let blob_path = directory.path().join("blob.txt");
        fs::write(&blob_path, "blob\n").expect("blob fixture");
        let blob = git_stdout(directory.path(), &["hash-object", "-w", "blob.txt"]);
        git(
            directory.path(),
            &["update-ref", "refs/tags/blob-only", &blob],
        );

        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let snapshot = repository
            .tracked_snapshot(50)
            .expect("tracked snapshot loads");
        assert_eq!(snapshot.commits.len(), 3);
        assert!(snapshot.commits.iter().any(|commit| commit.oid == root));
        assert!(snapshot.commits.iter().any(|commit| commit.oid == main));
        assert!(snapshot.commits.iter().any(|commit| commit.oid == feature));

        let feature_history = repository
            .commit_history("refs/heads/feature", 50)
            .expect("local history loads");
        assert_eq!(feature_history[0].oid, feature);
        assert_eq!(
            repository
                .commit_history("refs/heads/feature", 0)
                .expect("zero limit clamps to one")
                .len(),
            1
        );
        assert_eq!(
            repository
                .commit_history("refs/heads/feature", 1)
                .expect("one-commit history loads")
                .len(),
            1
        );
        assert_eq!(
            repository
                .commit_history("refs/heads/feature", 150)
                .expect("desktop history limit loads")
                .len(),
            2
        );
        assert_eq!(
            repository
                .commit_history("refs/heads/feature", usize::MAX)
                .expect("excessive limit clamps safely")
                .len(),
            2
        );
        assert!(!feature_history.iter().any(|commit| commit.oid == main));
        assert_eq!(
            repository
                .commit_history("refs/remotes/origin/feature", 50)
                .expect("remote history loads")[0]
                .oid,
            feature
        );
        assert_eq!(
            repository
                .commit_history("refs/tags/light", 50)
                .expect("lightweight tag history loads")[0]
                .oid,
            feature
        );
        assert_eq!(
            repository
                .commit_history("refs/tags/release", 50)
                .expect("annotated tag history loads")[0]
                .oid,
            root
        );
        assert_eq!(
            repository
                .commit_history("refs/heads/--all", 0)
                .expect("option-looking literal ref remains safe")
                .len(),
            1
        );

        for invalid in [
            "HEAD",
            "main",
            "refs/notes/example",
            "refs/heads/main~1",
            "refs/heads/missing",
            "refs/tags/blob-only",
        ] {
            let error = repository
                .commit_history(invalid, 50)
                .expect_err("invalid history source is rejected");
            assert!(matches!(error, GitError::InvalidInput { .. }), "{invalid}");
        }
    }

    #[test]
    fn detached_snapshot_keeps_all_ref_history() {
        let directory = fixture();
        let root = commit_file(directory.path(), "base.txt", "base\n", "Root");
        let tip = commit_file(directory.path(), "tip.txt", "tip\n", "Tip");
        git(directory.path(), &["switch", "--detach", &root]);

        let snapshot = GitRepository::open(directory.path())
            .expect("repository opens")
            .tracked_snapshot(50)
            .expect("detached snapshot loads");
        assert!(snapshot.branch.detached);
        assert_eq!(snapshot.commits.len(), 2);
        assert!(snapshot.commits.iter().any(|commit| commit.oid == root));
        assert!(snapshot.commits.iter().any(|commit| commit.oid == tip));
    }

    #[test]
    fn all_ref_history_is_topological_and_keeps_every_merge_parent() {
        let directory = fixture();
        let root = commit_file(directory.path(), "base.txt", "base\n", "Root");
        git(directory.path(), &["branch", "side"]);
        let main = commit_file(directory.path(), "main.txt", "main\n", "Main");
        git(directory.path(), &["switch", "side"]);
        let side = commit_file(directory.path(), "side.txt", "side\n", "Side");
        git(directory.path(), &["switch", "main"]);
        git(
            directory.path(),
            &["merge", "--no-ff", "side", "-m", "Merge side"],
        );
        let merge_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);

        let commits = GitRepository::open(directory.path())
            .expect("repository opens")
            .tracked_snapshot(50)
            .expect("all-ref history loads")
            .commits;
        let merge = commits
            .iter()
            .find(|commit| commit.oid == merge_oid)
            .expect("merge commit is present");
        assert_eq!(merge.parents, vec![main, side]);
        assert!(commits.iter().any(|commit| commit.oid == root));

        for (child_index, commit) in commits.iter().enumerate() {
            for parent in &commit.parents {
                if let Some(parent_index) = commits.iter().position(|item| &item.oid == parent) {
                    assert!(
                        child_index < parent_index,
                        "child {} must precede parent {}",
                        commit.oid,
                        parent
                    );
                }
            }
        }
    }

    #[test]
    fn typed_history_query_filters_refs_authors_dates_paths_and_topology() {
        let directory = fixture();
        let root = commit_file(directory.path(), "base.txt", "base\n", "Root");
        git(directory.path(), &["branch", "side"]);
        let main = commit_file(directory.path(), "main.txt", "main\n", "Main by test");
        git(directory.path(), &["switch", "side"]);
        git(directory.path(), &["config", "user.name", "Grace Hopper"]);
        git(
            directory.path(),
            &["config", "user.email", "grace@example.invalid"],
        );
        let side = commit_file(directory.path(), "side.txt", "side\n", "Side by Grace");
        git(directory.path(), &["switch", "main"]);
        git(directory.path(), &["config", "user.name", "Asterlyn Test"]);
        git(
            directory.path(),
            &["config", "user.email", "test@asterlyn.invalid"],
        );
        git(
            directory.path(),
            &["merge", "--no-ff", "side", "-m", "Merge side"],
        );
        let merge_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        let multi_ref = repository
            .query_commit_history(
                &HistoryQuery {
                    refs: vec![
                        history_ref("refs/heads/main"),
                        history_ref("refs/heads/side"),
                    ],
                    ..HistoryQuery::default()
                },
                50,
            )
            .expect("multi-ref history loads");
        for oid in [&root, &main, &side, &merge_oid] {
            assert!(multi_ref.iter().any(|commit| &commit.oid == oid));
        }

        let grace = repository
            .query_commit_history(
                &HistoryQuery {
                    author_emails: vec!["grace@example.invalid".to_string()],
                    ..HistoryQuery::default()
                },
                50,
            )
            .expect("author history loads");
        assert_eq!(
            grace
                .iter()
                .map(|commit| commit.subject.as_str())
                .collect::<Vec<_>>(),
            ["Side by Grace"]
        );

        git(
            directory.path(),
            &["config", "user.email", "grace@example.invalid"],
        );
        let current_author = repository
            .query_commit_history(
                &HistoryQuery {
                    current_author: true,
                    ..HistoryQuery::default()
                },
                50,
            )
            .expect("current author history loads");
        assert_eq!(current_author.len(), 1);
        assert_eq!(current_author[0].oid, side);

        let path_history = repository
            .query_commit_history(
                &HistoryQuery {
                    paths: vec![history_path("side.txt")],
                    ..HistoryQuery::default()
                },
                50,
            )
            .expect("path history loads");
        assert!(path_history.iter().any(|commit| commit.oid == side));
        assert!(!path_history.iter().any(|commit| commit.oid == main));

        let first_parent = repository
            .query_commit_history(
                &HistoryQuery {
                    refs: vec![history_ref("refs/heads/main")],
                    first_parent: true,
                    ..HistoryQuery::default()
                },
                50,
            )
            .expect("first-parent history loads");
        assert!(first_parent.iter().any(|commit| commit.oid == merge_oid));
        assert!(!first_parent.iter().any(|commit| commit.oid == side));

        let without_merges = repository
            .query_commit_history(
                &HistoryQuery {
                    exclude_merges: true,
                    order: HistoryOrder::Date,
                    ..HistoryQuery::default()
                },
                50,
            )
            .expect("no-merge date history loads");
        assert!(!without_merges.iter().any(|commit| commit.oid == merge_oid));
        for (child_index, commit) in without_merges.iter().enumerate() {
            for parent in &commit.parents {
                if let Some(parent_index) =
                    without_merges.iter().position(|item| &item.oid == parent)
                {
                    assert!(child_index < parent_index);
                }
            }
        }

        let future = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock is after epoch")
            .as_secs() as i64
            + 86_400;
        assert!(
            repository
                .query_commit_history(
                    &HistoryQuery {
                        since_epoch: Some(future),
                        ..HistoryQuery::default()
                    },
                    50,
                )
                .expect("future date query loads")
                .is_empty()
        );
    }

    #[test]
    fn typed_history_query_rejects_untrusted_values() {
        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Root");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let invalid_queries = [
            HistoryQuery {
                refs: vec![history_ref("HEAD")],
                ..HistoryQuery::default()
            },
            HistoryQuery {
                refs: vec![history_ref("refs/heads/missing")],
                ..HistoryQuery::default()
            },
            HistoryQuery {
                author_emails: vec!["not-an-email".to_string()],
                ..HistoryQuery::default()
            },
            HistoryQuery {
                paths: vec![history_path("../outside")],
                ..HistoryQuery::default()
            },
            HistoryQuery {
                since_epoch: Some(0),
                ..HistoryQuery::default()
            },
        ];
        for query in invalid_queries {
            let error = repository
                .query_commit_history(&query, 50)
                .expect_err("invalid history query is rejected");
            assert!(matches!(error, GitError::InvalidInput { .. }));
        }
    }

    #[test]
    fn history_pages_are_contiguous_bounded_and_report_completion() {
        let directory = fixture();
        for index in 0..7 {
            commit_file(
                directory.path(),
                &format!("page-{index}.txt"),
                &format!("{index}\n"),
                &format!("Page {index}"),
            );
        }
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let query = HistoryQuery::default();

        let first = repository
            .query_commit_history_page(&query, 0, 3)
            .expect("first page loads");
        let second = repository
            .query_commit_history_page(&query, 3, 3)
            .expect("second page loads");
        let last = repository
            .query_commit_history_page(&query, 6, 3)
            .expect("last page loads");

        assert_eq!(first.offset, 0);
        assert_eq!(first.commits.len(), 3);
        assert!(first.has_more);
        assert_eq!(second.offset, 3);
        assert_eq!(second.commits.len(), 3);
        assert!(second.has_more);
        assert_eq!(last.offset, 6);
        assert_eq!(last.commits.len(), 1);
        assert!(!last.has_more);
        let oids: HashSet<_> = first
            .commits
            .iter()
            .chain(&second.commits)
            .chain(&last.commits)
            .map(|commit| commit.oid.as_str())
            .collect();
        assert_eq!(oids.len(), 7);

        for (offset, limit) in [(3_001, 3), (0, 0), (0, 3_001)] {
            assert!(matches!(
                repository.query_commit_history_page(&query, offset, limit),
                Err(GitError::InvalidInput { .. })
            ));
        }
    }

    #[test]
    fn project_file_list_is_sorted_bounded_and_authorizes_visible_files_only() {
        let directory = fixture();
        fs::create_dir_all(directory.path().join("src")).expect("fixture directory");
        fs::create_dir_all(directory.path().join("ignored-dir")).expect("ignored directory");
        fs::write(directory.path().join("src/zeta.rs"), "zeta\n").expect("tracked file");
        fs::write(directory.path().join("alpha.txt"), "alpha\n").expect("tracked file");
        fs::write(directory.path().join("untracked.txt"), "later\n").expect("untracked file");
        fs::write(directory.path().join("ignored.txt"), "hidden\n").expect("ignored file");
        fs::write(
            directory.path().join("ignored-dir/cache.bin"),
            "hidden directory content\n",
        )
        .expect("ignored directory content");
        fs::write(
            directory.path().join(".gitignore"),
            "ignored.txt\nignored-dir/\n",
        )
        .expect("ignore file");
        git(
            directory.path(),
            &["add", ".gitignore", "alpha.txt", "src/zeta.rs"],
        );
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        let complete = repository.project_files(10).expect("project files load");
        assert_eq!(
            complete.paths,
            [".gitignore", "alpha.txt", "src/zeta.rs", "untracked.txt"]
        );
        assert_eq!(
            complete.ignored_entries,
            [
                ProjectIgnoredEntry {
                    workspace_path: "ignored-dir".to_string(),
                    kind: ProjectEntryKind::Directory,
                },
                ProjectIgnoredEntry {
                    workspace_path: "ignored.txt".to_string(),
                    kind: ProjectEntryKind::File,
                },
            ]
        );
        assert!(!complete.truncated);
        let authorized = repository
            .authorized_project_files(10)
            .expect("authorization catalog loads without ignored display entries");
        assert!(authorized.ignored_entries.is_empty());
        assert_eq!(
            repository
                .authorize_project_file(".", "untracked.txt", 10)
                .expect("visible untracked file is authorized")
                .workspace_path,
            "untracked.txt"
        );
        assert!(matches!(
            repository.authorize_project_file(".", "ignored.txt", 10),
            Err(GitError::InvalidInput { .. })
        ));
        assert!(matches!(
            repository.authorize_project_file(".", "../outside", 10),
            Err(GitError::InvalidInput { .. })
        ));

        let bounded = repository.project_files(1).expect("bounded files load");
        assert_eq!(bounded.paths, [".gitignore"]);
        assert!(bounded.truncated);
        assert!(matches!(
            repository.authorize_project_file(".", "untracked.txt", 1),
            Err(GitError::InvalidInput { .. })
        ));
    }

    #[test]
    fn initialized_submodule_history_is_root_qualified_and_routed() {
        let directory = tempfile::tempdir().expect("temp directory");
        let main = directory.path().join("main");
        let source = directory.path().join("source");
        fs::create_dir_all(&main).expect("main directory");
        fs::create_dir_all(&source).expect("source directory");
        for repository in [&main, &source] {
            git(repository, &["init", "-b", "main"]);
            git(repository, &["config", "user.name", "Asterlyn Test"]);
            git(
                repository,
                &["config", "user.email", "test@asterlyn.invalid"],
            );
        }
        fs::write(source.join("shared.txt"), "submodule content\n").expect("submodule file");
        git(&source, &["add", "shared.txt"]);
        git(&source, &["commit", "-m", "Submodule root"]);
        let child_oid = git_stdout(&source, &["rev-parse", "HEAD"]);
        fs::write(main.join("main.txt"), "main content\n").expect("main file");
        git(&main, &["add", "main.txt"]);
        git(&main, &["commit", "-m", "Main root"]);
        let source_path = source.to_string_lossy().into_owned();
        git(
            &main,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                &source_path,
                "modules/library",
            ],
        );
        git(&main, &["commit", "-am", "Add submodule"]);

        let repository = GitRepository::open(&main).expect("main repository opens");
        let roots = repository.repository_roots().expect("root catalog loads");
        assert_eq!(
            roots
                .iter()
                .map(|root| root.id.as_str())
                .collect::<Vec<_>>(),
            [".", "modules/library"]
        );

        let snapshot = repository
            .tracked_snapshot(50)
            .expect("workspace history loads");
        assert!(snapshot.commits.iter().any(|commit| {
            commit.repository_id == "modules/library" && commit.oid == child_oid
        }));
        assert!(snapshot.branches.iter().any(|branch| {
            branch.repository_id == "modules/library" && branch.full_name == "refs/heads/main"
        }));

        let child_history = repository
            .query_commit_history(
                &HistoryQuery {
                    repository_ids: vec!["modules/library".to_string()],
                    refs: vec![HistoryRef {
                        repository_id: "modules/library".to_string(),
                        full_name: "refs/heads/main".to_string(),
                    }],
                    paths: vec![HistoryPath {
                        repository_id: "modules/library".to_string(),
                        path: "shared.txt".to_string(),
                    }],
                    ..HistoryQuery::default()
                },
                50,
            )
            .expect("child history loads");
        assert!(!child_history.is_empty());
        assert!(
            child_history
                .iter()
                .all(|commit| commit.repository_id == "modules/library")
        );

        let details = repository
            .repository_commit_details("modules/library", &child_oid)
            .expect("child details load");
        assert_eq!(details.repository_id, "modules/library");
        assert_eq!(details.files[0].path, "shared.txt");
        let diff = repository
            .repository_commit_diff("modules/library", &child_oid, "shared.txt", None)
            .expect("child diff loads");
        assert_eq!(diff.repository_id, "modules/library");
        assert!(diff.patch.contains("submodule content"));

        let files = repository.project_files(50).expect("workspace files load");
        assert!(files.files.iter().any(|file| {
            file.repository_id == "modules/library"
                && file.path == "shared.txt"
                && file.workspace_path == "modules/library/shared.txt"
        }));
        assert_eq!(
            repository
                .authorize_project_file("modules/library", "shared.txt", 50)
                .expect("child file is freshly authorized")
                .workspace_path,
            "modules/library/shared.txt"
        );
        assert!(matches!(
            repository.repository_commit_details("../source", &child_oid),
            Err(GitError::InvalidInput { .. })
        ));

        git(&main, &["submodule", "deinit", "-f", "modules/library"]);
        assert_eq!(
            repository
                .repository_roots()
                .expect("deinitialized catalog loads")
                .len(),
            1
        );
    }

    #[test]
    fn untracked_discovery_honors_preemptive_cancellation() {
        let directory = fixture();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let error = repository
            .untracked_changes(&cancellation)
            .expect_err("cancelled scan should stop");
        assert!(matches!(error, GitError::Cancelled { .. }));
    }

    #[test]
    fn stages_unstages_diffs_and_commits_without_touching_user_data() {
        let directory = fixture();
        fs::write(directory.path().join("hello.txt"), "hello\nworld\n").expect("fixture file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        let snapshot = repository.snapshot(50).expect("snapshot loads");
        assert_eq!(snapshot.changes.len(), 1);
        assert_eq!(snapshot.changes[0].path, "hello.txt");

        let diff = repository.diff("hello.txt", false).expect("untracked diff");
        assert!(diff.patch.contains("+hello"));

        repository
            .stage(&["hello.txt".to_string()])
            .expect("stage succeeds");
        let snapshot = repository.snapshot(50).expect("staged snapshot loads");
        assert!(snapshot.changes[0].has_staged_change());

        repository
            .unstage(&["hello.txt".to_string()])
            .expect("unstage succeeds on unborn branch");
        let snapshot = repository.snapshot(50).expect("unstaged snapshot loads");
        assert!(!snapshot.changes[0].has_staged_change());

        repository
            .stage(&["hello.txt".to_string()])
            .expect("restage succeeds");
        let oid = repository
            .commit("Initial fixture")
            .expect("commit succeeds");
        assert_eq!(oid.len(), 40);
        let snapshot = repository.snapshot(50).expect("committed snapshot loads");
        assert_eq!(snapshot.commits[0].subject, "Initial fixture");
        assert!(snapshot.changes.is_empty());
    }

    #[test]
    fn selected_commit_keeps_unselected_index_entries_and_commits_worktree_content() {
        let directory = fixture();
        fs::write(directory.path().join("selected.txt"), "before\n").expect("selected base");
        fs::write(directory.path().join("kept.txt"), "before\n").expect("kept base");
        git(directory.path(), &["add", "selected.txt", "kept.txt"]);
        git(directory.path(), &["commit", "-m", "Base"]);
        fs::write(directory.path().join("selected.txt"), "staged version\n")
            .expect("selected staged version");
        git(directory.path(), &["add", "selected.txt"]);
        fs::write(directory.path().join("selected.txt"), "working version\n")
            .expect("selected working version");
        fs::write(directory.path().join("kept.txt"), "kept staged\n").expect("kept change");
        git(directory.path(), &["add", "kept.txt"]);

        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "selected.txt")
            .expect("selected change");
        repository
            .commit_selected("Selected only", &[selected])
            .expect("selected commit");

        assert_eq!(
            git_stdout(directory.path(), &["show", "HEAD:selected.txt"]),
            "working version"
        );
        assert_eq!(
            git_stdout(
                directory.path(),
                &["show", "--format=", "--name-only", "HEAD"]
            ),
            "selected.txt"
        );
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "kept.txt"
        );
    }

    #[test]
    fn selected_commit_supports_untracked_and_unborn_paths_without_absorbing_other_index_entries() {
        let directory = fixture();
        fs::write(directory.path().join("selected.txt"), "selected\n").expect("selected file");
        fs::write(directory.path().join("kept.txt"), "kept\n").expect("kept file");
        git(directory.path(), &["add", "kept.txt"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "selected.txt")
            .expect("selected change");

        repository
            .commit_selected("Selected root", &[selected])
            .expect("root commit");

        assert_eq!(
            git_stdout(directory.path(), &["show", "HEAD:selected.txt"]),
            "selected"
        );
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "kept.txt"
        );
        assert_eq!(
            git_stdout(directory.path(), &["ls-tree", "--name-only", "HEAD"]),
            "selected.txt"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejected_selected_commit_removes_only_introduced_intent_entries() {
        use std::os::unix::fs::PermissionsExt;

        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        fs::write(directory.path().join("kept.txt"), "kept\n").expect("kept file");
        git(directory.path(), &["add", "kept.txt"]);
        fs::write(directory.path().join("selected.txt"), "selected\n").expect("selected file");
        let hook = directory.path().join(".git/hooks/pre-commit");
        fs::write(&hook, "#!/bin/sh\nexit 1\n").expect("hook");
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).expect("hook mode");
        let before = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "selected.txt")
            .expect("selected change");

        repository
            .commit_selected("Rejected", &[selected])
            .expect_err("hook rejection is returned");

        assert_eq!(git_stdout(directory.path(), &["rev-parse", "HEAD"]), before);
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "kept.txt"
        );
        assert!(
            git_stdout(directory.path(), &["status", "--short"])
                .lines()
                .any(|line| line == "?? selected.txt")
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejected_commit_does_not_roll_back_a_concurrent_head_advance() {
        use std::os::unix::fs::PermissionsExt;

        let directory = fixture();
        fs::write(directory.path().join("selected.txt"), "before\n").expect("selected base");
        fs::write(directory.path().join("kept.txt"), "before\n").expect("kept base");
        git(directory.path(), &["add", "selected.txt", "kept.txt"]);
        git(directory.path(), &["commit", "-m", "Base"]);
        fs::write(directory.path().join("selected.txt"), "after\n").expect("selected edit");
        fs::write(directory.path().join("kept.txt"), "staged\n").expect("kept edit");
        git(directory.path(), &["add", "kept.txt"]);
        let before = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        let tree = git_stdout(directory.path(), &["rev-parse", "HEAD^{tree}"]);
        let concurrent = git_stdout(
            directory.path(),
            &["commit-tree", &tree, "-p", &before, "-m", "Concurrent"],
        );
        let cached_before = git_stdout(directory.path(), &["diff", "--cached", "--binary"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "selected.txt")
            .expect("selected change");
        let hook = directory.path().join(".git/hooks/pre-commit");
        fs::write(
            &hook,
            format!("#!/bin/sh\ngit update-ref refs/heads/main {concurrent} {before}\nexit 1\n"),
        )
        .expect("hook");
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).expect("hook mode");

        let error = repository
            .commit_selected("Rejected after concurrent update", &[selected])
            .expect_err("rejected commit reports concurrent HEAD");

        assert!(matches!(error, GitError::UnsafeOperation { .. }));
        assert_eq!(
            git_stdout(directory.path(), &["rev-parse", "HEAD"]),
            concurrent
        );
        assert_eq!(
            git_stdout(directory.path(), &["show", "-s", "--format=%s", "HEAD"]),
            "Concurrent"
        );
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--binary"]),
            cached_before
        );
    }

    #[cfg(unix)]
    #[test]
    fn successful_commit_preserves_concurrent_history_when_final_verification_warns() {
        use std::os::unix::fs::PermissionsExt;

        let directory = fixture();
        fs::write(directory.path().join("selected.txt"), "before\n").expect("selected base");
        fs::write(directory.path().join("kept.txt"), "before\n").expect("kept base");
        git(directory.path(), &["add", "selected.txt", "kept.txt"]);
        git(directory.path(), &["commit", "-m", "Base"]);
        fs::write(directory.path().join("selected.txt"), "staged\n").expect("selected staged");
        git(directory.path(), &["add", "selected.txt"]);
        fs::write(directory.path().join("selected.txt"), "working\n").expect("selected working");
        fs::write(directory.path().join("kept.txt"), "kept staged\n").expect("kept staged");
        git(directory.path(), &["add", "kept.txt"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "selected.txt")
            .expect("selected change");
        let hook = directory.path().join(".git/hooks/post-commit");
        fs::write(
            &hook,
            "#!/bin/sh\nrm \"$0\"\nparent=$(git rev-parse HEAD)\ntree=$(git rev-parse HEAD^{tree})\noid=$(printf 'Concurrent after selected\\n' | git commit-tree \"$tree\" -p \"$parent\")\ngit update-ref refs/heads/main \"$oid\" \"$parent\"\n",
        )
        .expect("hook");
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).expect("hook mode");

        let result = repository
            .commit_selected("Selected with concurrency", &[selected])
            .expect("successful Git commit returns a warning outcome");

        assert_eq!(result.oid, None);
        assert!(result.verification_warning.is_some());
        assert_eq!(
            git_stdout(directory.path(), &["log", "-2", "--format=%s"]),
            "Concurrent after selected\nSelected with concurrency"
        );
        assert_eq!(
            git_stdout(directory.path(), &["show", "HEAD~1:selected.txt"]),
            "working"
        );
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "kept.txt"
        );
    }

    #[test]
    fn selected_commit_handles_renames_and_literal_pathspec_characters() {
        let directory = fixture();
        fs::write(directory.path().join("old-name.txt"), "rename me\n").expect("rename base");
        git(directory.path(), &["add", "old-name.txt"]);
        git(directory.path(), &["commit", "-m", "Base"]);
        fs::rename(
            directory.path().join("old-name.txt"),
            directory.path().join("new-name.txt"),
        )
        .expect("rename fixture");
        git(directory.path(), &["add", "old-name.txt", "new-name.txt"]);
        fs::write(
            directory.path().join(":(glob)selected.txt"),
            "literal path\n",
        )
        .expect("literal path file");
        fs::write(directory.path().join("unselected.txt"), "leave me\n").expect("unselected file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let changes = repository.snapshot(50).expect("snapshot").changes;
        let selected = changes
            .into_iter()
            .filter(|change| change.path == "new-name.txt" || change.path == ":(glob)selected.txt")
            .collect::<Vec<_>>();

        repository
            .commit_selected("Rename and literal path", &selected)
            .expect("selected commit");

        let committed = git_stdout(
            directory.path(),
            &["show", "--format=", "--name-only", "--no-renames", "HEAD"],
        );
        assert!(committed.lines().any(|path| path == "old-name.txt"));
        assert!(committed.lines().any(|path| path == "new-name.txt"));
        assert!(committed.lines().any(|path| path == ":(glob)selected.txt"));
        assert!(!committed.lines().any(|path| path == "unselected.txt"));
        assert!(directory.path().join("unselected.txt").exists());
    }

    #[test]
    fn selected_commit_rejects_a_stale_change_identity() {
        let directory = fixture();
        commit_file(directory.path(), "stale.txt", "before\n", "Base");
        fs::write(directory.path().join("stale.txt"), "after\n").expect("working edit");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let stale = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "stale.txt")
            .expect("stale candidate");
        git(directory.path(), &["add", "stale.txt"]);
        let before = git_stdout(directory.path(), &["rev-parse", "HEAD"]);

        let error = repository
            .commit_selected("Must refresh", &[stale])
            .expect_err("stale identity is rejected");

        assert!(matches!(error, GitError::UnsafeOperation { .. }));
        assert_eq!(git_stdout(directory.path(), &["rev-parse", "HEAD"]), before);
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "stale.txt"
        );
    }

    #[test]
    fn complete_local_diff_includes_staged_and_worktree_content() {
        let directory = fixture();
        commit_file(directory.path(), "mixed.txt", "before\n", "Base");
        fs::write(directory.path().join("mixed.txt"), "staged\n").expect("staged edit");
        git(directory.path(), &["add", "mixed.txt"]);
        fs::write(directory.path().join("mixed.txt"), "working\n").expect("working edit");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "mixed.txt")
            .expect("mixed change");

        let diff = repository
            .local_diff(&selected)
            .expect("complete local diff");

        assert!(diff.patch.contains("-before"));
        assert!(diff.patch.contains("+working"));
        assert!(!diff.patch.contains("+staged"));
    }

    #[test]
    fn unchanged_context_expands_only_when_requested() {
        let directory = fixture();
        let mut before = (1..=30)
            .map(|line| format!("line-{line}"))
            .collect::<Vec<_>>();
        before[0] = "far-start-context".to_string();
        before[14] = "before-target".to_string();
        let mut after = before.clone();
        after[14] = "after-target".to_string();
        commit_file(
            directory.path(),
            "context.txt",
            &format!("{}\n", before.join("\n")),
            "Base",
        );
        fs::write(
            directory.path().join("context.txt"),
            format!("{}\n", after.join("\n")),
        )
        .expect("working context edit");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "context.txt")
            .expect("context change");

        let collapsed = repository
            .local_diff(&selected)
            .expect("collapsed local diff");
        let expanded = repository
            .local_diff_with_unchanged(&selected, true)
            .expect("expanded local diff");
        assert!(!collapsed.patch.contains("far-start-context"));
        assert!(expanded.patch.contains("far-start-context"));

        git(directory.path(), &["add", "context.txt"]);
        git(directory.path(), &["commit", "-m", "Change context"]);
        let oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        let collapsed = repository
            .commit_diff(&oid, "context.txt", None)
            .expect("collapsed commit diff");
        let expanded = repository
            .commit_diff_with_unchanged(&oid, "context.txt", None, true)
            .expect("expanded commit diff");
        assert!(!collapsed.patch.contains("far-start-context"));
        assert!(expanded.patch.contains("far-start-context"));
    }

    #[test]
    fn expanded_context_is_bounded_while_git_output_is_consumed() {
        let directory = fixture();
        let before = format!("{}\n", "a".repeat(DIFF_LIMIT_BYTES + 1_024));
        let after = format!("{}\n", "b".repeat(DIFF_LIMIT_BYTES + 1_024));
        commit_file(directory.path(), "large.txt", &before, "Large base");
        fs::write(directory.path().join("large.txt"), &after).expect("large working edit");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "large.txt")
            .expect("large change");

        let local = repository
            .local_diff_with_unchanged(&selected, true)
            .expect("bounded expanded local diff");
        assert!(local.truncated);
        assert!(local.patch.ends_with("[Diff truncated at 4 MiB]\n"));

        git(directory.path(), &["add", "large.txt"]);
        git(directory.path(), &["commit", "-m", "Large change"]);
        let oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        let committed = repository
            .commit_diff_with_unchanged(&oid, "large.txt", None, true)
            .expect("bounded expanded commit diff");
        assert!(committed.truncated);
        assert!(committed.patch.ends_with("[Diff truncated at 4 MiB]\n"));
    }

    #[test]
    fn binary_diff_reads_fresh_worktree_and_commit_sides() {
        let directory = fixture();
        let path = directory.path().join("image.png");
        let before = b"\x89PNG\r\n\x1a\n-before";
        let after = b"\x89PNG\r\n\x1a\n-after";
        fs::write(&path, before).expect("write original image");
        git(directory.path(), &["add", "image.png"]);
        git(directory.path(), &["commit", "-m", "Original image"]);
        fs::write(&path, after).expect("write changed image");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "image.png")
            .expect("image change");

        let local = repository
            .local_binary_diff(&selected)
            .expect("local binary diff");
        assert_eq!(local.before.as_deref(), Some(before.as_slice()));
        assert_eq!(local.after.as_deref(), Some(after.as_slice()));

        git(directory.path(), &["add", "image.png"]);
        git(directory.path(), &["commit", "-m", "Changed image"]);
        let oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        let committed = repository
            .repository_commit_binary_diff(".", &oid, "image.png", None)
            .expect("commit binary diff");
        assert_eq!(committed.before.as_deref(), Some(before.as_slice()));
        assert_eq!(committed.after.as_deref(), Some(after.as_slice()));
        assert!(matches!(
            repository.repository_commit_binary_diff(".", &oid, "other.png", None),
            Err(GitError::InvalidInput { .. })
        ));
    }

    #[test]
    fn revert_selected_restores_tracked_paths_and_rejects_destructive_classes() {
        let directory = fixture();
        commit_file(directory.path(), "tracked.txt", "before\n", "Base");
        fs::write(directory.path().join("tracked.txt"), "after\n").expect("tracked edit");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let tracked = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "tracked.txt")
            .expect("tracked change");
        repository
            .revert_selected(&[tracked])
            .expect("tracked revert");
        assert_eq!(
            fs::read_to_string(directory.path().join("tracked.txt")).unwrap(),
            "before\n"
        );

        fs::write(directory.path().join("new.txt"), "new\n").expect("untracked file");
        let untracked = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "new.txt")
            .expect("untracked change");
        assert!(matches!(
            repository.revert_selected(&[untracked]),
            Err(GitError::UnsafeOperation { .. })
        ));
        assert!(directory.path().join("new.txt").exists());
    }

    #[test]
    fn reads_root_and_ordinary_commit_files_and_patches() {
        let directory = fixture();
        fs::write(directory.path().join("kept.txt"), "before\n").expect("fixture file");
        fs::write(directory.path().join("old-name.txt"), "rename me\n").expect("fixture file");
        fs::write(directory.path().join("removed.txt"), "remove me\n").expect("fixture file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        repository
            .stage(&[
                "kept.txt".to_string(),
                "old-name.txt".to_string(),
                "removed.txt".to_string(),
            ])
            .expect("initial files stage");
        let root_oid = repository.commit("Root").expect("root commit succeeds");

        let root = repository
            .commit_details(&root_oid)
            .expect("root details load");
        assert_eq!(root.parent_oid, None);
        assert_eq!(root.files.len(), 3);
        assert!(
            root.files
                .iter()
                .all(|file| file.status == ChangeKind::Added)
        );
        let root_patch = repository
            .commit_diff(&root_oid, "kept.txt", None)
            .expect("root patch loads");
        assert!(root_patch.patch.contains("+before"));

        fs::write(directory.path().join("kept.txt"), "after\n").expect("modified file");
        fs::rename(
            directory.path().join("old-name.txt"),
            directory.path().join("new-name.txt"),
        )
        .expect("rename fixture");
        fs::remove_file(directory.path().join("removed.txt")).expect("remove fixture");
        fs::write(directory.path().join("added.txt"), "new\n").expect("new fixture");
        repository
            .stage(&[
                "kept.txt".to_string(),
                "old-name.txt".to_string(),
                "new-name.txt".to_string(),
                "removed.txt".to_string(),
                "added.txt".to_string(),
            ])
            .expect("changed files stage");
        let oid = repository.commit("Change files").expect("commit succeeds");

        let details = repository.commit_details(&oid).expect("details load");
        assert_eq!(details.parent_oid.as_deref(), Some(root_oid.as_str()));
        assert_eq!(details.files.len(), 4);
        assert_eq!(
            details
                .files
                .iter()
                .find(|file| file.path == "kept.txt")
                .map(|file| file.status),
            Some(ChangeKind::Modified)
        );
        assert_eq!(
            details
                .files
                .iter()
                .find(|file| file.path == "added.txt")
                .map(|file| file.status),
            Some(ChangeKind::Added)
        );
        assert_eq!(
            details
                .files
                .iter()
                .find(|file| file.path == "removed.txt")
                .map(|file| file.status),
            Some(ChangeKind::Deleted)
        );
        let renamed = details
            .files
            .iter()
            .find(|file| file.path == "new-name.txt")
            .expect("renamed file is present");
        assert_eq!(renamed.status, ChangeKind::Renamed);
        assert_eq!(renamed.original_path.as_deref(), Some("old-name.txt"));

        let patch = repository
            .commit_diff(&oid, &renamed.path, renamed.original_path.as_deref())
            .expect("rename patch loads");
        assert!(patch.patch.contains("rename from old-name.txt"));
        assert!(patch.patch.contains("rename to new-name.txt"));
    }

    #[test]
    fn merge_commit_details_compare_against_first_parent() {
        let directory = fixture();
        fs::write(directory.path().join("base.txt"), "base\n").expect("fixture file");
        git(directory.path(), &["add", "base.txt"]);
        git(directory.path(), &["commit", "-m", "Root"]);
        git(directory.path(), &["branch", "side"]);

        fs::write(directory.path().join("main.txt"), "main\n").expect("main file");
        git(directory.path(), &["add", "main.txt"]);
        git(directory.path(), &["commit", "-m", "Main"]);
        let main_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);

        git(directory.path(), &["checkout", "side"]);
        fs::write(directory.path().join("side.txt"), "side\n").expect("side file");
        git(directory.path(), &["add", "side.txt"]);
        git(directory.path(), &["commit", "-m", "Side"]);
        git(directory.path(), &["checkout", "main"]);
        git(
            directory.path(),
            &["merge", "--no-ff", "side", "-m", "Merge side"],
        );
        let merge_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);

        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let details = repository
            .commit_details(&merge_oid)
            .expect("merge details load");
        assert_eq!(details.parent_oid.as_deref(), Some(main_oid.as_str()));
        assert_eq!(details.files.len(), 1);
        assert_eq!(details.files[0].path, "side.txt");
        assert_eq!(details.files[0].status, ChangeKind::Added);
    }

    #[test]
    fn rejects_untrusted_commit_detail_arguments() {
        let directory = fixture();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let invalid_oid = repository
            .commit_details("HEAD")
            .expect_err("symbolic revision is rejected");
        assert!(matches!(invalid_oid, GitError::InvalidInput { .. }));

        let oid = "a".repeat(40);
        let invalid_path = repository
            .commit_diff(&oid, "../outside", None)
            .expect_err("path traversal is rejected before Git runs");
        assert!(matches!(invalid_path, GitError::InvalidInput { .. }));
    }

    #[test]
    fn switches_only_clean_local_branches() {
        let directory = fixture();
        fs::write(directory.path().join("base.txt"), "base\n").expect("fixture file");
        git(directory.path(), &["add", "base.txt"]);
        git(directory.path(), &["commit", "-m", "Root"]);
        git(directory.path(), &["branch", "feature"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        repository
            .switch_branch("refs/heads/feature")
            .expect("clean switch succeeds");
        assert_eq!(
            repository
                .tracked_snapshot(10)
                .expect("snapshot loads")
                .branch
                .head
                .as_deref(),
            Some("feature")
        );

        fs::write(directory.path().join("base.txt"), "dirty\n").expect("dirty file");
        let dirty = repository
            .switch_branch("refs/heads/main")
            .expect_err("tracked changes block switching");
        assert!(matches!(
            dirty,
            GitError::UnsafeOperation { ref blockers, .. } if blockers == &["base.txt"]
        ));
        assert_eq!(
            git_stdout(directory.path(), &["branch", "--show-current"]),
            "feature"
        );

        git(directory.path(), &["restore", "base.txt"]);
        fs::write(directory.path().join("untracked.txt"), "untracked\n").expect("untracked file");
        let untracked = repository
            .switch_branch("refs/heads/main")
            .expect_err("untracked changes block switching");
        assert!(matches!(
            untracked,
            GitError::UnsafeOperation { ref blockers, .. } if blockers == &["untracked.txt"]
        ));
        assert_eq!(
            git_stdout(directory.path(), &["branch", "--show-current"]),
            "feature"
        );

        fs::remove_file(directory.path().join("untracked.txt")).expect("remove fixture");
        repository
            .switch_branch("refs/heads/main")
            .expect("clean switch succeeds");
        assert_eq!(
            git_stdout(directory.path(), &["branch", "--show-current"]),
            "main"
        );

        git(
            directory.path(),
            &["update-ref", "refs/heads/--detach", "HEAD"],
        );
        repository
            .switch_branch("refs/heads/--detach")
            .expect("option-shaped branch is passed as a literal target");
        assert_eq!(
            git_stdout(directory.path(), &["branch", "--show-current"]),
            "--detach"
        );
    }

    #[test]
    fn creates_valid_branches_only_from_a_clean_worktree() {
        let directory = fixture();
        fs::write(directory.path().join("base.txt"), "base\n").expect("fixture file");
        git(directory.path(), &["add", "base.txt"]);
        git(directory.path(), &["commit", "-m", "Root"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        for invalid in ["", "-danger", "@{-1}", "bad name", "topic..name"] {
            let error = repository
                .create_branch(invalid)
                .expect_err("invalid branch name is rejected");
            assert!(matches!(error, GitError::InvalidInput { .. }));
        }

        fs::write(directory.path().join("pending.txt"), "pending\n").expect("pending file");
        let dirty = repository
            .create_branch("feature/safe")
            .expect_err("dirty worktree blocks branch creation");
        assert!(matches!(dirty, GitError::UnsafeOperation { .. }));
        assert_eq!(
            git_stdout(directory.path(), &["branch", "--show-current"]),
            "main"
        );

        fs::remove_file(directory.path().join("pending.txt")).expect("remove fixture");
        repository
            .create_branch("feature/safe")
            .expect("clean branch creation succeeds");
        assert_eq!(
            git_stdout(directory.path(), &["branch", "--show-current"]),
            "feature/safe"
        );
        let duplicate = repository
            .create_branch("main")
            .expect_err("existing branch is rejected");
        assert!(matches!(duplicate, GitError::InvalidInput { .. }));

        let remote = repository
            .switch_branch("refs/remotes/origin/main")
            .expect_err("remote refs are not implicit local branches");
        assert!(matches!(remote, GitError::InvalidInput { .. }));
    }

    #[test]
    fn parses_nul_delimited_commit_paths_without_text_delimiter_ambiguity() {
        let files = parse_commit_files(
            b"M\0dir/file with spaces.txt\0R100\0old\tname.txt\0new\nname.txt\0",
        )
        .expect("file list parses");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "dir/file with spaces.txt");
        assert_eq!(files[1].original_path.as_deref(), Some("old\tname.txt"));
        assert_eq!(files[1].path, "new\nname.txt");
        assert_eq!(files[1].status, ChangeKind::Renamed);
    }

    #[test]
    fn rejects_paths_outside_repository() {
        let directory = fixture();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let error = repository
            .stage(&["../outside".to_string()])
            .expect_err("traversal should fail");
        assert!(matches!(error, GitError::InvalidInput { .. }));
    }

    #[test]
    fn snapshots_remote_capabilities_without_exposing_urls() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        let snapshot = repository
            .tracked_snapshot(10)
            .expect("tracked snapshot loads");
        assert_eq!(snapshot.branch.upstream_remote.as_deref(), Some("origin"));
        assert_eq!(
            snapshot.branch.upstream_ref.as_deref(),
            Some("refs/heads/main")
        );
        assert_eq!(
            snapshot.remotes,
            vec![RemoteSummary {
                name: "origin".to_string(),
                fetch_supported: true,
                push_supported: true,
            }]
        );

        let remote_path = fixture.remote.to_string_lossy().into_owned();
        git(&fixture.local, &["remote", "add", "unsafe", &remote_path]);
        git(
            &fixture.local,
            &["config", "--unset-all", "remote.unsafe.fetch"],
        );
        git(
            &fixture.local,
            &[
                "config",
                "--add",
                "remote.unsafe.fetch",
                "+refs/tags/*:refs/tags/*",
            ],
        );
        let snapshot = repository
            .tracked_snapshot(10)
            .expect("snapshot with unsupported remote loads");
        let unsafe_remote = snapshot
            .remotes
            .iter()
            .find(|remote| remote.name == "unsafe")
            .expect("unsupported remote is visible");
        assert!(!unsafe_remote.fetch_supported);
        assert!(!unsafe_remote.push_supported);
        let rejected = repository
            .fetch_remote("unsafe", &CancellationToken::new())
            .expect_err("unsafe fetch mapping is rejected");
        assert!(matches!(rejected, GitError::InvalidInput { .. }));
    }

    #[test]
    fn fetches_supported_remote_without_touching_worktree_changes() {
        let fixture = remote_fixture();
        let peer_oid = commit_file(&fixture.peer, "peer.txt", "peer\n", "Peer change");
        git(&fixture.peer, &["push", "origin", "main"]);
        fs::write(fixture.local.join("base.txt"), "dirty\n").expect("dirty local file");
        let original_oid = git_stdout(&fixture.local, &["rev-parse", "HEAD"]);
        git(
            &fixture.local,
            &["update-ref", "refs/remotes/origin/stale", &original_oid],
        );
        git(&fixture.local, &["config", "fetch.prune", "true"]);
        git(&fixture.local, &["config", "fetch.pruneTags", "true"]);
        git(&fixture.local, &["config", "remote.origin.prune", "true"]);
        git(
            &fixture.local,
            &["config", "remote.origin.pruneTags", "true"],
        );

        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        repository
            .fetch_remote("origin", &CancellationToken::new())
            .expect("fetch succeeds with dirty worktree");

        assert_eq!(
            fs::read_to_string(fixture.local.join("base.txt")).expect("dirty file remains"),
            "dirty\n"
        );
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]),
            peer_oid
        );
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "refs/remotes/origin/stale"]),
            original_oid
        );
        assert_eq!(
            repository
                .tracked_snapshot(10)
                .expect("snapshot loads")
                .branch
                .behind,
            1
        );
    }

    #[test]
    fn pulls_only_clean_fast_forwards_and_blocks_divergence() {
        let fixture = remote_fixture();
        let peer_oid = commit_file(&fixture.peer, "peer.txt", "peer\n", "Peer change");
        git(&fixture.peer, &["push", "origin", "main"]);
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        let old_tracking = git_stdout(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]);
        git(
            &fixture.local,
            &["update-ref", "refs/remotes/origin/stale", &old_tracking],
        );
        git(&fixture.local, &["config", "fetch.prune", "true"]);
        git(&fixture.local, &["config", "remote.origin.prune", "true"]);

        fs::write(fixture.local.join("pending.txt"), "pending\n").expect("untracked blocker");
        let dirty = repository
            .pull_ff_only(&CancellationToken::new())
            .expect_err("untracked path blocks pull before fetch");
        assert!(matches!(dirty, GitError::UnsafeOperation { .. }));
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]),
            old_tracking
        );

        fs::remove_file(fixture.local.join("pending.txt")).expect("remove blocker");
        repository
            .pull_ff_only(&CancellationToken::new())
            .expect("clean fast-forward pull succeeds");
        assert_eq!(git_stdout(&fixture.local, &["rev-parse", "HEAD"]), peer_oid);
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "refs/remotes/origin/stale"]),
            old_tracking
        );

        let local_oid = commit_file(&fixture.local, "local.txt", "local\n", "Local change");
        let remote_oid = commit_file(&fixture.peer, "remote.txt", "remote\n", "Remote change");
        git(&fixture.peer, &["push", "origin", "main"]);
        let diverged = repository
            .pull_ff_only(&CancellationToken::new())
            .expect_err("divergence is not merged automatically");
        assert!(matches!(diverged, GitError::UnsafeOperation { .. }));
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "HEAD"]),
            local_oid
        );
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]),
            remote_oid
        );
    }

    #[test]
    fn pushes_commits_and_publishes_new_branch_without_force() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        let main_oid = commit_file(&fixture.local, "local.txt", "local\n", "Local change");
        fs::write(fixture.local.join("pending.txt"), "pending\n").expect("untracked local file");
        let main_preview = repository
            .push_preview("origin", 0, 100)
            .expect("main push preview loads");
        repository
            .push_current_confirmed(
                "origin",
                &main_preview.preview_token,
                &CancellationToken::new(),
            )
            .expect("push ignores uncommitted worktree content");
        assert_eq!(
            git_stdout(&fixture.remote, &["rev-parse", "refs/heads/main"]),
            main_oid
        );
        assert!(fixture.local.join("pending.txt").exists());

        fs::remove_file(fixture.local.join("pending.txt")).expect("remove untracked file");
        repository
            .create_branch("feature/publish")
            .expect("clean branch creation succeeds");
        let feature_oid = commit_file(&fixture.local, "feature.txt", "feature\n", "Feature change");
        let feature_preview = repository
            .push_preview("origin", 0, 100)
            .expect("publication preview loads");
        repository
            .push_current_confirmed(
                "origin",
                &feature_preview.preview_token,
                &CancellationToken::new(),
            )
            .expect("new branch is published with upstream");
        assert_eq!(
            git_stdout(
                &fixture.remote,
                &["rev-parse", "refs/heads/feature/publish"]
            ),
            feature_oid
        );
        assert_eq!(
            git_stdout(
                &fixture.local,
                &["rev-parse", "--abbrev-ref", "@{upstream}"]
            ),
            "origin/feature/publish"
        );

        git(&fixture.local, &["config", "remote.origin.mirror", "TRUE"]);
        let mirror = repository
            .push_preview("origin", 0, 100)
            .expect_err("mirror remote is rejected");
        assert!(matches!(mirror, GitError::InvalidInput { .. }));
    }

    #[test]
    fn previews_outgoing_commits_and_rejects_a_stale_confirmation() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        commit_file(&fixture.local, "first.txt", "first\n", "First outgoing");
        let second_oid = commit_file(&fixture.local, "second.txt", "second\n", "Second outgoing");

        let first_page = repository
            .push_preview("origin", 0, 1)
            .expect("push preview loads");
        assert_eq!(first_page.remote, "origin");
        assert_eq!(first_page.branch, "main");
        assert_eq!(first_page.source_ref, "refs/heads/main");
        assert_eq!(first_page.destination_ref, "refs/heads/main");
        assert_eq!(first_page.head_oid, second_oid);
        assert!(!first_page.publish);
        assert_eq!(first_page.total_commits, 2);
        assert_eq!(first_page.commits.len(), 1);
        assert_eq!(first_page.commits[0].subject, "Second outgoing");
        assert!(first_page.has_more);

        let second_page = repository
            .push_preview("origin", 1, 1)
            .expect("second push preview page loads");
        assert_eq!(second_page.preview_token, first_page.preview_token);
        assert_eq!(second_page.commits[0].subject, "First outgoing");
        assert!(!second_page.has_more);

        let remote_path = fixture.remote.to_string_lossy().into_owned();
        git(&fixture.local, &["remote", "add", "backup", &remote_path]);
        let wrong_remote = repository
            .push_preview("backup", 0, 1)
            .expect_err("a tracked branch cannot be redirected during confirmation");
        assert!(matches!(wrong_remote, GitError::InvalidInput { .. }));

        commit_file(&fixture.local, "third.txt", "third\n", "Third outgoing");
        let stale = repository
            .push_current_confirmed(
                "origin",
                &first_page.preview_token,
                &CancellationToken::new(),
            )
            .expect_err("a changed HEAD invalidates confirmation");
        assert!(matches!(stale, GitError::UnsafeOperation { .. }));

        let current = repository
            .push_preview("origin", 0, 100)
            .expect("fresh push preview loads");
        repository
            .push_current_confirmed("origin", &current.preview_token, &CancellationToken::new())
            .expect("confirmed non-force push succeeds");
        assert_eq!(
            git_stdout(&fixture.remote, &["rev-parse", "refs/heads/main"]),
            current.head_oid
        );
    }

    #[test]
    fn confirmed_push_pins_the_previewed_head_across_a_branch_race() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        let previewed_oid = commit_file(
            &fixture.local,
            "previewed.txt",
            "previewed\n",
            "Previewed outgoing",
        );
        let raced_oid = commit_file(
            &fixture.local,
            "raced.txt",
            "raced\n",
            "Concurrent outgoing",
        );
        git(&fixture.local, &["reset", "--hard", &previewed_oid]);
        let preview = repository
            .push_preview("origin", 0, 100)
            .expect("push preview loads");

        repository
            .push_current_internal(
                "origin",
                Some(&preview.preview_token),
                &CancellationToken::new(),
                || {
                    git(
                        &fixture.local,
                        &["update-ref", "refs/heads/main", &raced_oid, &previewed_oid],
                    );
                },
            )
            .expect("push uses the already confirmed object id");

        assert_eq!(
            git_stdout(&fixture.remote, &["rev-parse", "refs/heads/main"]),
            previewed_oid
        );
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "refs/heads/main"]),
            raced_oid
        );
    }

    #[test]
    fn pinned_push_retains_remote_non_fast_forward_protection() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        commit_file(&fixture.local, "local.txt", "local\n", "Local outgoing");
        let preview = repository
            .push_preview("origin", 0, 100)
            .expect("push preview loads");
        let remote_oid = commit_file(&fixture.peer, "remote.txt", "remote\n", "Remote outgoing");
        git(&fixture.peer, &["push", "origin", "main"]);

        let error = repository
            .push_current_confirmed("origin", &preview.preview_token, &CancellationToken::new())
            .expect_err("the remote rejects the pinned non-fast-forward update");
        assert!(matches!(error, GitError::RemoteFailed { .. }));
        assert_eq!(
            git_stdout(&fixture.remote, &["rev-parse", "refs/heads/main"]),
            remote_oid
        );
    }

    #[test]
    fn previews_first_publication_against_locally_known_remote_refs() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        repository
            .create_branch("feature/preview")
            .expect("branch is created");
        let feature_oid = commit_file(
            &fixture.local,
            "feature-preview.txt",
            "feature\n",
            "Feature preview",
        );

        let preview = repository
            .push_preview("origin", 0, 100)
            .expect("publication preview loads");
        assert!(preview.publish);
        assert_eq!(preview.branch, "feature/preview");
        assert_eq!(preview.destination_ref, "refs/heads/feature/preview");
        assert_eq!(preview.head_oid, feature_oid);
        assert_eq!(preview.commits.len(), 1);
        assert_eq!(preview.commits[0].subject, "Feature preview");
        assert_eq!(preview.total_commits, 1);

        let remote_path = fixture.remote.to_string_lossy().into_owned();
        git(&fixture.local, &["remote", "add", "backup", &remote_path]);
        let backup_preview = repository
            .push_preview("backup", 0, 100)
            .expect("an unpublished branch can explicitly target another supported remote");
        assert_eq!(backup_preview.remote, "backup");
        assert_ne!(backup_preview.preview_token, preview.preview_token);
        let cross_remote = repository
            .push_current_confirmed("backup", &preview.preview_token, &CancellationToken::new())
            .expect_err("a preview token is bound to its selected remote");
        assert!(matches!(cross_remote, GitError::UnsafeOperation { .. }));
    }

    #[test]
    fn push_preview_identity_is_unambiguous_for_legal_ref_separators() {
        let common = |remote: &str, source_ref: &str| PushTargetContext {
            remote: remote.to_string(),
            branch: "main".to_string(),
            source_ref: source_ref.to_string(),
            destination_ref: "refs/heads/main".to_string(),
            head_oid: "a".repeat(40),
            comparison_base_oid: Some("b".repeat(40)),
            publish: false,
        };
        let first = common("one|refs", "heads/main");
        let second = common("one", "refs|heads/main");
        assert_ne!(push_preview_token(&first), push_preview_token(&second));
    }

    #[test]
    fn remote_cancellation_and_failures_are_typed_without_child_output() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let cancelled = repository
            .fetch_remote("origin", &cancellation)
            .expect_err("preemptive cancellation stops fetch");
        assert!(matches!(
            cancelled,
            GitError::RemoteCancelled {
                repository_state_may_have_changed: true,
                remote_state_may_have_changed: false,
                ..
            }
        ));

        assert_eq!(
            classify_remote_failure(&[], b"fatal: Authentication failed for secret"),
            RemoteFailureKind::Authentication
        );
        assert_eq!(
            classify_remote_failure(&[], b"fatal: unable to access token: connection refused"),
            RemoteFailureKind::Network
        );
        assert_eq!(
            classify_remote_failure(b"! refs/heads/main [rejected]", b""),
            RemoteFailureKind::Rejected
        );

        git(&fixture.local, &["checkout", "--detach"]);
        let detached = repository
            .push_preview("origin", 0, 100)
            .expect_err("detached HEAD cannot be pushed implicitly");
        assert!(matches!(detached, GitError::UnsafeOperation { .. }));
    }
}
