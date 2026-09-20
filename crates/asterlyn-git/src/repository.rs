use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Output;
#[cfg(test)]
use std::sync::{Arc, Mutex};
use std::thread;

use crate::error::{GitError, RemoteFailureKind};
use crate::model::{
    BinaryDiffResult, BranchMutationKind, BranchMutationPlan, BranchMutationRequest,
    BranchMutationSourceKind, ChangeKind, CommitComparisonDetails, CommitComparisonDiffResult,
    CommitComparisonRelation, CommitDetails, CommitDiffResult, CommitFileChange, CommitFileVersion,
    CommitSummary, DiffResult, FileChange, GitBlameResult, GitResetMode, GitResetPlan,
    GitRootDescriptor, GitRootKind, HistoryOrder, HistoryPage, HistoryPath, HistoryQuery,
    HistoryRef, ProjectEntryKind, ProjectFile, ProjectFileList, ProjectIgnoredEntry, PushMode,
    PushPreview, PushTagMode, PushTagSummary, RemoteAuthenticationStatus,
    RemoteBranchDeletionTarget, RemoteMutationKind, RemoteMutationPlan, RemoteMutationRequest,
    RemoteSummary, RemoteTransport, RepositoryReadPlan, RepositorySliceSnapshot,
    RepositorySnapshot, SelectedCommitResult, TrackedChangeScan, UntrackedScan, UntrackedState,
    WorkingDiffBaseVersion,
};
use crate::parser::{parse_blame_incremental, parse_branches, parse_commits, parse_status};
use crate::process::{
    CancellableOutput, CancellationToken, GitRunner, GitStdin, join_stream, read_stream_bounded,
};

const DIFF_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const COMMIT_FILE_LIST_LIMIT_BYTES: usize = 16 * 1024 * 1024;
const MAX_COMMIT_FILE_CHANGES: usize = 20_000;
const BLAME_OUTPUT_LIMIT_BYTES: usize = 16 * 1024 * 1024;
// Git has no "all context" switch. A deliberately unreachable practical line count requests the
// complete file while the existing byte limit remains the authoritative output bound.
const EXPANDED_DIFF_CONTEXT_LINES: usize = 1_000_000;
const MAX_BINARY_PREVIEW_BYTES: usize = 16 * 1024 * 1024;
const TREE_ENTRY_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const MAX_HISTORY_SESSION: usize = 100_000;
const MAX_HISTORY_PAGE_SIZE: usize = MAX_HISTORY_SESSION;
const MAX_OUTGOING_COMMITS: usize = 100_000;
const MAX_PUSH_PREVIEW_WINDOW: usize = 1_000;
const MAX_PUSH_PREVIEW_PAGE_SIZE: usize = 200;
const MAX_PUSH_PREVIEW_FILES: usize = 20_000;
const MAX_PUSH_PREVIEW_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_PUSH_TAGS: usize = 1_000;

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
    set_upstream_after_push: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RemoteEndpoint {
    transport: RemoteTransport,
    host: Option<String>,
    path: Option<String>,
    username: Option<String>,
    suggested_ssh_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GitRepository {
    root: PathBuf,
    git_dir: PathBuf,
    #[cfg(test)]
    read_trace: Arc<Mutex<Vec<String>>>,
}

#[derive(Debug, Clone)]
struct DiscoveredGitRoot {
    descriptor: GitRootDescriptor,
    repository: GitRepository,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RevisionFile {
    source_path: String,
    blob_oid: String,
    file_mode: String,
    bytes: Vec<u8>,
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
        Ok(Self {
            root,
            git_dir,
            #[cfg(test)]
            read_trace: Arc::new(Mutex::new(Vec::new())),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn git_directory(&self) -> &Path {
        &self.git_dir
    }

    #[cfg(test)]
    fn take_read_trace(&self) -> Vec<String> {
        std::mem::take(&mut *self.read_trace.lock().unwrap())
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
                if roots.len() >= 1_024 {
                    return Err(GitError::InvalidInput {
                        field: "Git roots".into(),
                        message: "repository discovery exceeds the 1,024-root limit".into(),
                    });
                }
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

    pub fn read_slices(
        &self,
        plan: RepositoryReadPlan,
        commit_limit: usize,
    ) -> Result<RepositorySliceSnapshot, GitError> {
        let (main_branch, changes) = if plan.working_tree && (plan.head || plan.history) {
            let (branch, changes) = self.read_branch_and_changes()?;
            (Some(branch), Some(changes))
        } else if plan.working_tree {
            (None, Some(self.tracked_changes()?.changes))
        } else if plan.head {
            (Some(self.read_head_state()?), None)
        } else if plan.history {
            (
                Some(crate::model::BranchState {
                    oid: self.head_oid()?,
                    ..crate::model::BranchState::default()
                }),
                None,
            )
        } else {
            (None, None)
        };

        let roots = if plan.refs || plan.history {
            self.discovered_roots()?
        } else {
            Vec::new()
        };
        let mut projected_branches = Vec::new();
        let mut histories = Vec::new();
        if plan.refs || plan.history {
            for (index, root) in roots.iter().enumerate() {
                let mut branches = root.repository.read_references()?;
                let repository_id = &root.descriptor.id;
                if plan.history {
                    let branch = if index == 0 {
                        main_branch.clone().expect("history reads the main branch")
                    } else {
                        root.repository.read_branch_and_changes()?.0
                    };
                    let mut tips: Vec<_> = branches
                        .iter()
                        .map(|reference| reference.oid.clone())
                        .collect();
                    if let Some(oid) = branch.oid {
                        tips.push(oid);
                    }
                    tips.sort_unstable();
                    tips.dedup();
                    let mut commits = root
                        .repository
                        .read_all_commit_history(&tips, commit_limit)?;
                    if index > 0 {
                        scope_commits(&mut commits, repository_id);
                    }
                    histories.push(commits);
                }
                if plan.refs {
                    if index > 0 {
                        scope_branches(&mut branches, repository_id);
                    }
                    projected_branches.extend(branches);
                }
            }
        }
        if plan.refs {
            projected_branches.sort_by(|left, right| {
                right
                    .committed_at
                    .cmp(&left.committed_at)
                    .then_with(|| left.repository_id.cmp(&right.repository_id))
                    .then_with(|| left.full_name.cmp(&right.full_name))
            });
        }

        Ok(RepositorySliceSnapshot {
            root: self.root.to_string_lossy().into_owned(),
            git_dir: self.git_dir.to_string_lossy().into_owned(),
            repository_roots: plan
                .refs
                .then(|| roots.iter().map(|root| root.descriptor.clone()).collect()),
            branch: plan
                .head
                .then(|| main_branch.expect("head reads the main branch")),
            operation: plan
                .operation
                .then(|| self.operation_snapshot())
                .transpose()?,
            changes,
            commits: plan
                .history
                .then(|| merge_root_histories(histories, commit_limit)),
            branches: plan.refs.then_some(projected_branches),
            remotes: plan.refs.then(|| self.remote_summaries()).transpose()?,
            untracked_state: plan.working_tree.then_some(UntrackedState::Pending),
        })
    }

    fn read_branch_and_changes(
        &self,
    ) -> Result<(crate::model::BranchState, Vec<FileChange>), GitError> {
        let status = self.run_read(
            "read working tree branch state",
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
        Ok((branch, changes))
    }

    fn read_head_state(&self) -> Result<crate::model::BranchState, GitError> {
        let head = self.current_branch()?;
        let oid = self.head_oid()?;
        let mut branch = crate::model::BranchState {
            detached: head.is_none() && oid.is_some(),
            unborn: head.is_some() && oid.is_none(),
            head,
            oid,
            ..crate::model::BranchState::default()
        };
        if let Some(head) = branch.head.as_deref()
            && let Some(upstream) = self.read_upstream_target(head)?
        {
            let (ahead, behind) = if branch.oid.is_some() {
                self.ahead_behind(&upstream.tracking_ref)?
            } else {
                (0, 0)
            };
            branch.upstream = Some(short_tracking_ref(&upstream.tracking_ref));
            branch.upstream_remote = Some(upstream.remote);
            branch.upstream_ref = Some(upstream.merge_ref);
            branch.ahead = ahead;
            branch.behind = behind;
        }
        Ok(branch)
    }

    fn ahead_behind(&self, tracking_ref: &str) -> Result<(u32, u32), GitError> {
        if !self.reference_exists(tracking_ref)? {
            return Ok((0, 0));
        }
        let output = self.run_read_owned(
            "read branch divergence",
            vec![
                OsString::from("rev-list"),
                OsString::from("--left-right"),
                OsString::from("--count"),
                OsString::from(format!("HEAD...{tracking_ref}")),
                OsString::from("--"),
            ],
        )?;
        let counts: Vec<_> = String::from_utf8_lossy(&output.stdout)
            .split_ascii_whitespace()
            .map(str::to_string)
            .collect();
        if counts.len() != 2 {
            return Err(GitError::Parse {
                context: "branch divergence".to_string(),
                message: "Git returned an unexpected ahead/behind count".to_string(),
            });
        }
        let parse = |value: &str| {
            value.parse::<u32>().map_err(|error| GitError::Parse {
                context: "branch divergence".to_string(),
                message: error.to_string(),
            })
        };
        Ok((parse(&counts[0])?, parse(&counts[1])?))
    }

    fn read_references(&self) -> Result<Vec<crate::model::BranchSummary>, GitError> {
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
        parse_branches(&refs.stdout)
    }

    fn tracked_root_snapshot(&self, commit_limit: usize) -> Result<RepositorySnapshot, GitError> {
        let (branch, changes) = self.read_branch_and_changes()?;
        let branches = self.read_references()?;
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
            operation: self.operation_snapshot()?,
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
        let commit_limit = commit_limit.clamp(1, MAX_HISTORY_SESSION);
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
        if offset > MAX_HISTORY_SESSION {
            return Err(GitError::InvalidInput {
                field: "history offset".to_string(),
                message: format!("must not exceed {MAX_HISTORY_SESSION}"),
            });
        }
        if page_size == 0 || page_size > MAX_HISTORY_PAGE_SIZE {
            return Err(GitError::InvalidInput {
                field: "history page size".to_string(),
                message: format!("must be between 1 and {MAX_HISTORY_PAGE_SIZE}"),
            });
        }
        if offset == MAX_HISTORY_SESSION {
            return Ok(HistoryPage {
                commits: Vec::new(),
                offset,
                has_more: false,
            });
        }
        let page_size = page_size.min(MAX_HISTORY_SESSION - offset);
        let requested = offset
            .saturating_add(page_size)
            .saturating_add(1)
            .min(MAX_HISTORY_SESSION + 1);
        let roots = self.discovered_roots()?;
        validate_query_roots(query, &roots)?;
        let selected_roots: HashSet<&str> =
            query.repository_ids.iter().map(String::as_str).collect();
        let eligible_roots: Vec<_> = roots
            .into_iter()
            .filter(|root| {
                let repository_id = root.descriptor.id.as_str();
                (selected_roots.is_empty() || selected_roots.contains(repository_id))
                    && query
                        .start_commit
                        .as_ref()
                        .is_none_or(|start| start.repository_id == repository_id)
                    && (query.refs.is_empty()
                        || query
                            .refs
                            .iter()
                            .any(|reference| reference.repository_id == repository_id))
                    && (query.paths.is_empty()
                        || query
                            .paths
                            .iter()
                            .any(|path| path.repository_id == repository_id))
            })
            .collect();
        let single_root = eligible_roots.len() == 1;
        let mut histories = Vec::new();

        for root in eligible_roots {
            let repository_id = root.descriptor.id.as_str();
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
            let selectors = if let Some(start) = &query.start_commit {
                root.repository.first_parent(&start.oid)?;
                vec![start.oid.clone()]
            } else if query.refs.is_empty() {
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
            let root_offset = if single_root { offset } else { 0 };
            let root_limit = if single_root {
                page_size.saturating_add(1)
            } else {
                requested
            };
            let mut commits = root.repository.run_commit_history_query(
                "query commit history",
                selectors.iter().map(OsString::from).collect(),
                query,
                &path_values,
                root_offset,
                root_limit,
            )?;
            scope_commits(&mut commits, repository_id);
            histories.push(commits);
        }
        let page_offset = if single_root { 0 } else { offset };
        let merged = merge_root_histories(
            histories,
            if single_root {
                page_size + 1
            } else {
                requested
            },
        );
        let has_more =
            offset + page_size < MAX_HISTORY_SESSION && merged.len() > page_offset + page_size;
        let commits = merged
            .into_iter()
            .skip(page_offset)
            .take(page_size)
            .collect();
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
            0,
            commit_limit,
        )
    }

    fn run_commit_history_query(
        &self,
        operation: &str,
        selectors: Vec<OsString>,
        query: &HistoryQuery,
        paths: &[String],
        offset: usize,
        commit_limit: usize,
    ) -> Result<Vec<CommitSummary>, GitError> {
        let limit = commit_limit.clamp(1, MAX_HISTORY_SESSION + 1).to_string();
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
        if offset > 0 {
            arguments.push(OsString::from(format!(
                "--skip={}",
                offset.min(MAX_HISTORY_SESSION)
            )));
        }
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
        let mut commits = parse_commits(&output.stdout)?;
        self.mark_outgoing_commits(&mut commits)?;
        Ok(commits)
    }

    fn mark_outgoing_commits(&self, commits: &mut [CommitSummary]) -> Result<(), GitError> {
        if commits.is_empty() {
            return Ok(());
        }
        let Some(branch) = self.current_branch()? else {
            return Ok(());
        };
        let mut arguments = vec![
            OsString::from("rev-list"),
            OsString::from(format!("--max-count={MAX_OUTGOING_COMMITS}")),
            OsString::from("HEAD"),
        ];
        if let Some(upstream) = self.read_upstream_target(&branch)? {
            if !self.reference_exists(&upstream.tracking_ref)? {
                return Ok(());
            }
            arguments.push(OsString::from(format!("^{}", upstream.tracking_ref)));
        } else {
            arguments.push(OsString::from("--not"));
            arguments.push(OsString::from("--remotes"));
        }
        arguments.push(OsString::from("--"));
        let output = self.run_read_owned("read outgoing commits", arguments)?;
        let outgoing: HashSet<_> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();
        for commit in commits {
            commit.outgoing = outgoing.contains(commit.oid.as_str());
        }
        Ok(())
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
        let mut ignored_files = Vec::new();
        let mut ignored_entries = Vec::new();
        let mut files_truncated = false;
        let mut ignored_truncated = false;
        for root in &roots {
            let (root_paths, truncated) = root
                .repository
                .project_file_paths(maximum.saturating_sub(files.len()))?;
            files_truncated |= truncated;
            for path in root_paths {
                let workspace_path = if root.descriptor.relative_path == "." {
                    path.clone()
                } else {
                    format!("{}/{path}", root.descriptor.relative_path)
                };
                files.push(ProjectFile {
                    repository_id: root.descriptor.id.clone(),
                    path,
                    workspace_path,
                    read_only: false,
                });
            }
            if include_ignored {
                let (root_entries, truncated) = root
                    .repository
                    .project_ignored_entries(maximum.saturating_sub(ignored_entries.len()))?;
                ignored_truncated |= truncated;
                for entry in root_entries {
                    let path = entry.workspace_path;
                    let workspace_path = if root.descriptor.relative_path == "." {
                        path.clone()
                    } else {
                        format!("{}/{}", root.descriptor.relative_path, path)
                    };
                    if entry.kind == ProjectEntryKind::File {
                        ignored_files.push(ProjectFile {
                            repository_id: root.descriptor.id.clone(),
                            path,
                            workspace_path: workspace_path.clone(),
                            read_only: true,
                        });
                    }
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
        files_truncated |= files.len() > maximum;
        files.truncate(maximum);
        ignored_files.sort_by(|left, right| {
            left.workspace_path
                .cmp(&right.workspace_path)
                .then_with(|| left.repository_id.cmp(&right.repository_id))
                .then_with(|| left.path.cmp(&right.path))
        });
        ignored_files.dedup_by(|left, right| {
            left.repository_id == right.repository_id && left.path == right.path
        });
        ignored_truncated |= ignored_files.len() > maximum;
        ignored_files.truncate(maximum);
        ignored_entries.sort_by(|left, right| {
            left.workspace_path
                .cmp(&right.workspace_path)
                .then_with(|| {
                    project_entry_kind_order(left.kind).cmp(&project_entry_kind_order(right.kind))
                })
        });
        ignored_entries.dedup();
        ignored_truncated |= ignored_entries.len() > maximum;
        ignored_entries.truncate(maximum);
        let nested_roots: HashSet<&str> = roots
            .iter()
            .skip(1)
            .map(|root| root.descriptor.relative_path.as_str())
            .collect();
        let mut paths: Vec<String> = files
            .iter()
            .filter(|file| !file.read_only && !nested_roots.contains(file.workspace_path.as_str()))
            .map(|file| file.workspace_path.clone())
            .collect();
        paths.sort();
        paths.dedup();
        files.extend(ignored_files);
        files.sort_by(|left, right| {
            left.workspace_path
                .cmp(&right.workspace_path)
                .then_with(|| left.repository_id.cmp(&right.repository_id))
                .then_with(|| left.path.cmp(&right.path))
        });
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

    /// Authorizes an exact working-tree target without requiring it to exist in the bounded file
    /// catalog. This is intended for reviewed operations that can recreate a tracked historical
    /// path. The workspace transaction layer remains responsible for rejecting links, non-regular
    /// files, missing parent directories, and concurrent filesystem changes.
    pub fn authorize_project_file_target(
        &self,
        repository_id: &str,
        path: &str,
    ) -> Result<ProjectFile, GitError> {
        validate_relative_path(path)?;
        let root = self.resolve_history_root(repository_id)?;
        let ignored = run_git_output(
            root.repository.root(),
            [
                OsStr::new("check-ignore"),
                OsStr::new("--quiet"),
                OsStr::new("--"),
                OsStr::new(path),
            ],
        )
        .map_err(|error| GitError::Io {
            operation: "authorize project-file target".to_string(),
            message: error.to_string(),
        })?;
        match ignored.status.code() {
            Some(0) => {
                return Err(GitError::InvalidInput {
                    field: "project file".to_string(),
                    message: "the selected historical path is ignored by the current repository"
                        .to_string(),
                });
            }
            Some(1) => {}
            status => {
                return Err(GitError::CommandFailed {
                    operation: "authorize project-file target".to_string(),
                    status,
                    message: sanitize_stderr(
                        &ignored.stderr,
                        "Git could not evaluate the current ignore policy",
                    ),
                });
            }
        }
        let workspace_path = if root.descriptor.id == "." {
            path.to_string()
        } else {
            format!("{}/{path}", root.descriptor.id)
        };
        Ok(ProjectFile {
            repository_id: root.descriptor.id,
            path: path.to_string(),
            workspace_path,
            read_only: false,
        })
    }

    /// Revalidates one file identity without rebuilding the complete project catalog.
    ///
    /// The caller must first obtain `file` from this repository's bounded project catalog. This
    /// method rechecks the exact repository root and current ignore policy, while the workspace
    /// boundary remains responsible for component-by-component non-link traversal and file type.
    pub fn reauthorize_project_file(&self, file: &ProjectFile) -> Result<ProjectFile, GitError> {
        if file.read_only {
            return Err(GitError::InvalidInput {
                field: "project file".to_string(),
                message: "the selected project file is read-only".to_string(),
            });
        }
        self.reauthorize_project_file_for_read(file)
    }

    /// Revalidates a catalogued file for a bounded read. Ignored catalog entries are admitted only
    /// while they remain ignored, and retain their read-only identity.
    pub fn reauthorize_project_file_for_read(
        &self,
        file: &ProjectFile,
    ) -> Result<ProjectFile, GitError> {
        validate_relative_path(&file.path)?;
        let repository = if file.repository_id == "." {
            self.clone()
        } else {
            validate_relative_path(&file.repository_id)?;
            let candidate = self.root.join(&file.repository_id);
            let canonical_main = fs::canonicalize(&self.root).map_err(|error| GitError::Io {
                operation: "resolve project root".to_string(),
                message: error.to_string(),
            })?;
            let canonical_candidate =
                fs::canonicalize(&candidate).map_err(|error| GitError::InvalidInput {
                    field: "project file".to_string(),
                    message: format!("the selected repository root is unavailable: {error}"),
                })?;
            if !canonical_candidate.starts_with(&canonical_main) {
                return Err(GitError::InvalidInput {
                    field: "project file".to_string(),
                    message: "the selected repository root is outside the active project"
                        .to_string(),
                });
            }
            let repository = GitRepository::open(&canonical_candidate)?;
            if fs::canonicalize(repository.root()).ok().as_ref() != Some(&canonical_candidate) {
                return Err(GitError::InvalidInput {
                    field: "project file".to_string(),
                    message: "the selected nested repository identity is stale".to_string(),
                });
            }
            repository
        };
        let expected_workspace_path = if file.repository_id == "." {
            file.path.clone()
        } else {
            format!("{}/{}", file.repository_id, file.path)
        };
        if file.workspace_path != expected_workspace_path {
            return Err(GitError::InvalidInput {
                field: "project file".to_string(),
                message: "the selected project-file identity is inconsistent".to_string(),
            });
        }

        let tracked = repository.run_read_owned(
            "reauthorize tracked project file",
            vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("ls-files"),
                OsString::from("--cached"),
                OsString::from("-z"),
                OsString::from("--"),
                OsString::from(&file.path),
            ],
        )?;
        let is_tracked = tracked
            .stdout
            .split(|byte| *byte == 0)
            .any(|candidate| candidate == file.path.as_bytes());
        if file.read_only && is_tracked {
            return Err(GitError::InvalidInput {
                field: "project file".to_string(),
                message: "the selected ignored-file identity is stale".to_string(),
            });
        }
        if !is_tracked {
            let ignored = run_git_output(
                repository.root(),
                [
                    OsStr::new("check-ignore"),
                    OsStr::new("--quiet"),
                    OsStr::new("--"),
                    OsStr::new(&file.path),
                ],
            )
            .map_err(|error| GitError::Io {
                operation: "reauthorize untracked project file".to_string(),
                message: error.to_string(),
            })?;
            match ignored.status.code() {
                Some(0) => {
                    if !file.read_only {
                        return Err(GitError::InvalidInput {
                            field: "project file".to_string(),
                            message: "the selected project file is now ignored".to_string(),
                        });
                    }
                }
                Some(1) => {
                    if file.read_only {
                        return Err(GitError::InvalidInput {
                            field: "project file".to_string(),
                            message: "the selected ignored-file identity is stale".to_string(),
                        });
                    }
                }
                status => {
                    return Err(GitError::CommandFailed {
                        operation: "reauthorize untracked project file".to_string(),
                        status,
                        message: sanitize_stderr(
                            &ignored.stderr,
                            "Git could not evaluate the current ignore policy",
                        ),
                    });
                }
            }
        }
        Ok(file.clone())
    }

    fn project_file_paths(&self, limit: usize) -> Result<(Vec<String>, bool), GitError> {
        self.read_catalog_records(
            &[
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "-z",
            ],
            limit,
        )
    }

    fn project_ignored_entries(
        &self,
        limit: usize,
    ) -> Result<(Vec<ProjectIgnoredEntry>, bool), GitError> {
        let (mut records, files_truncated) = self.read_catalog_records(
            &[
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "-z",
            ],
            limit,
        )?;
        let (collapsed, directories_truncated) = self.read_catalog_records(
            &[
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--directory",
                "--no-empty-directory",
                "-z",
            ],
            limit,
        )?;
        records.extend(collapsed);
        let mut entries = Vec::new();
        for raw_path in records.iter().map(|record| record.as_bytes()) {
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
        Ok((entries, files_truncated || directories_truncated))
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

    pub fn working_diff_base(
        &self,
        selected: &FileChange,
        limit_bytes: usize,
    ) -> Result<WorkingDiffBaseVersion, GitError> {
        if limit_bytes == 0 {
            return Err(GitError::InvalidInput {
                field: "working diff".to_string(),
                message: "the content limit must be greater than zero".to_string(),
            });
        }
        let changes = self.status_changes_with_untracked()?;
        let current = match_fresh_changes(
            &changes,
            std::slice::from_ref(selected),
            "read editable working diff",
        )?
        .pop()
        .expect("one selected change produces one fresh match");
        if current.conflicted || current.submodule {
            return Err(GitError::InvalidInput {
                field: "working diff".to_string(),
                message: "conflicts and submodules require their dedicated editor".to_string(),
            });
        }
        let head_oid = self.head_oid()?;
        let source_path = current.original_path.as_deref().unwrap_or(&current.path);
        let base = head_oid
            .as_deref()
            .map(|head| self.read_file_at_revision(head, source_path, limit_bytes))
            .transpose()?
            .flatten();
        Ok(WorkingDiffBaseVersion {
            path: current.path,
            original_path: current.original_path,
            head_oid,
            blob_oid: base.as_ref().map(|file| file.blob_oid.clone()),
            bytes: base.map(|file| file.bytes).unwrap_or_default(),
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
        let (output, truncated) = if let Some(parent) = &parent_oid {
            self.run_read_owned_bounded(
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
                COMMIT_FILE_LIST_LIMIT_BYTES + 1,
            )?
        } else {
            self.run_read_owned_bounded(
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
                COMMIT_FILE_LIST_LIMIT_BYTES + 1,
            )?
        };
        let files = parse_bounded_commit_files(
            output,
            truncated,
            "commit file list",
            "the changed-file list",
        )?;

        Ok(CommitDetails {
            repository_id: ".".to_string(),
            oid: oid.to_string(),
            parent_oid,
            files,
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

    pub fn commit_file_version(
        &self,
        commit_oid: &str,
        selected: &CommitFileChange,
        limit_bytes: usize,
    ) -> Result<CommitFileVersion, GitError> {
        validate_object_id(commit_oid)?;
        validate_relative_path(&selected.path)?;
        if let Some(original_path) = selected.original_path.as_deref() {
            validate_relative_path(original_path)?;
        }
        if limit_bytes == 0 {
            return Err(GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "the content limit must be greater than zero".to_string(),
            });
        }
        let details = self.commit_details(commit_oid)?;
        let current = details
            .files
            .iter()
            .find(|candidate| *candidate == selected)
            .ok_or_else(|| GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "select an exact file from the current commit details".to_string(),
            })?;
        let (revision_oid, source_path) = if current.status == ChangeKind::Deleted {
            let parent = details.parent_oid.ok_or_else(|| GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "a root commit has no pre-commit file version".to_string(),
            })?;
            (
                parent,
                current
                    .original_path
                    .clone()
                    .unwrap_or_else(|| current.path.clone()),
            )
        } else {
            (details.oid.clone(), current.path.clone())
        };
        let file = self
            .read_file_at_revision(&revision_oid, &source_path, limit_bytes)?
            .ok_or_else(|| GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "the selected historical file version no longer resolves".to_string(),
            })?;
        Ok(CommitFileVersion {
            repository_id: ".".to_string(),
            commit_oid: details.oid,
            revision_oid,
            path: current.path.clone(),
            source_path: file.source_path,
            blob_oid: file.blob_oid,
            file_mode: file.file_mode,
            bytes: file.bytes,
        })
    }

    pub fn repository_commit_file_version(
        &self,
        repository_id: &str,
        commit_oid: &str,
        selected: &CommitFileChange,
        limit_bytes: usize,
    ) -> Result<CommitFileVersion, GitError> {
        let root = self.resolve_history_root(repository_id)?;
        let mut version = root
            .repository
            .commit_file_version(commit_oid, selected, limit_bytes)?;
        version.repository_id = root.descriptor.id;
        Ok(version)
    }

    pub fn commit_comparison_details(
        &self,
        before_oid: &str,
        after_oid: &str,
    ) -> Result<CommitComparisonDetails, GitError> {
        validate_distinct_commit_ids(before_oid, after_oid)?;
        self.first_parent(before_oid)?;
        self.first_parent(after_oid)?;
        let relation = if self.is_ancestor(before_oid, after_oid)? {
            CommitComparisonRelation::BeforeIsAncestor
        } else if self.is_ancestor(after_oid, before_oid)? {
            CommitComparisonRelation::AfterIsAncestor
        } else {
            CommitComparisonRelation::Divergent
        };
        let (output, truncated) = self.run_read_owned_bounded(
            "read commit comparison file list",
            vec![
                OsString::from("diff"),
                OsString::from("--no-ext-diff"),
                OsString::from("--name-status"),
                OsString::from("-z"),
                OsString::from("-M"),
                OsString::from("-C"),
                OsString::from(before_oid),
                OsString::from(after_oid),
            ],
            COMMIT_FILE_LIST_LIMIT_BYTES + 1,
        )?;
        let files = parse_bounded_commit_files(
            output,
            truncated,
            "commit comparison",
            "the comparison changed-file list",
        )?;
        Ok(CommitComparisonDetails {
            repository_id: ".".to_string(),
            before_oid: before_oid.to_string(),
            after_oid: after_oid.to_string(),
            relation,
            files,
        })
    }

    pub fn repository_commit_comparison_details(
        &self,
        repository_id: &str,
        before_oid: &str,
        after_oid: &str,
    ) -> Result<CommitComparisonDetails, GitError> {
        let root = self.resolve_history_root(repository_id)?;
        let mut details = root
            .repository
            .commit_comparison_details(before_oid, after_oid)?;
        details.repository_id = root.descriptor.id;
        Ok(details)
    }

    pub fn repository_blame(
        &self,
        repository_id: &str,
        path: &str,
        commit_oid: Option<&str>,
        parent: bool,
    ) -> Result<GitBlameResult, GitError> {
        if parent && commit_oid.is_none() {
            return Err(GitError::InvalidInput {
                field: "blame revision".to_string(),
                message: "a commit id is required when requesting its parent".to_string(),
            });
        }
        if let Some(oid) = commit_oid {
            validate_object_id(oid)?;
        }
        validate_relative_path(path)?;

        let root = self.resolve_history_root(repository_id)?;
        let revision = match (commit_oid, parent) {
            (Some(oid), true) => root.repository.first_parent(oid)?,
            (Some(oid), false) => Some(oid.to_string()),
            (None, false) => None,
            (None, true) => unreachable!("parent without commit is rejected above"),
        };
        if parent && revision.is_none() {
            return Ok(GitBlameResult {
                repository_id: root.descriptor.id,
                path: path.to_string(),
                revision: None,
                hunks: Vec::new(),
                truncated: false,
            });
        }

        let mut args = vec![
            OsString::from("--literal-pathspecs"),
            OsString::from("blame"),
            OsString::from("--incremental"),
            OsString::from("--no-progress"),
        ];
        if let Some(revision) = &revision {
            args.push(OsString::from(revision));
        }
        args.push(OsString::from("--"));
        args.push(OsString::from(path));
        let (mut output, truncated) = root.repository.run_read_owned_bounded(
            "read Git blame",
            args,
            BLAME_OUTPUT_LIMIT_BYTES,
        )?;
        if truncated {
            retain_complete_blame_records(&mut output.stdout);
        }
        let hunks = parse_blame_incremental(&output.stdout)?;
        Ok(GitBlameResult {
            repository_id: root.descriptor.id,
            path: path.to_string(),
            revision,
            hunks,
            truncated,
        })
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

    pub fn commit_comparison_diff(
        &self,
        before_oid: &str,
        after_oid: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<CommitComparisonDiffResult, GitError> {
        self.commit_comparison_diff_with_unchanged(
            before_oid,
            after_oid,
            path,
            original_path,
            false,
        )
    }

    pub fn commit_comparison_diff_with_unchanged(
        &self,
        before_oid: &str,
        after_oid: &str,
        path: &str,
        original_path: Option<&str>,
        expanded_unchanged: bool,
    ) -> Result<CommitComparisonDiffResult, GitError> {
        let selected =
            self.require_commit_comparison_file(before_oid, after_oid, path, original_path)?;
        let mut args = vec![
            OsString::from("diff"),
            OsString::from("--no-ext-diff"),
            OsString::from("--no-color"),
            diff_context_argument(expanded_unchanged),
            OsString::from("-M"),
            OsString::from("-C"),
            OsString::from(before_oid),
            OsString::from(after_oid),
            OsString::from("--"),
        ];
        if let Some(original_path) = selected.original_path.as_deref() {
            args.push(OsString::from(original_path));
        }
        args.push(OsString::from(&selected.path));

        let (output, output_truncated) = self.run_read_owned_bounded(
            "read commit comparison file diff",
            args,
            DIFF_LIMIT_BYTES + 1,
        )?;
        let mut patch = output.stdout;
        let binary = patch.windows(15).any(|window| window == b"Binary files ");
        let truncated = output_truncated || patch.len() > DIFF_LIMIT_BYTES;
        if truncated {
            patch.truncate(DIFF_LIMIT_BYTES);
            patch.extend_from_slice(b"\n\n[Diff truncated at 4 MiB]\n");
        }
        Ok(CommitComparisonDiffResult {
            repository_id: ".".to_string(),
            before_oid: before_oid.to_string(),
            after_oid: after_oid.to_string(),
            path: selected.path,
            patch: String::from_utf8_lossy(&patch).into_owned(),
            binary,
            truncated,
        })
    }

    pub fn repository_commit_comparison_diff_with_unchanged(
        &self,
        repository_id: &str,
        before_oid: &str,
        after_oid: &str,
        path: &str,
        original_path: Option<&str>,
        expanded_unchanged: bool,
    ) -> Result<CommitComparisonDiffResult, GitError> {
        let root = self.resolve_history_root(repository_id)?;
        let mut diff = root.repository.commit_comparison_diff_with_unchanged(
            before_oid,
            after_oid,
            path,
            original_path,
            expanded_unchanged,
        )?;
        diff.repository_id = root.descriptor.id;
        Ok(diff)
    }

    pub fn repository_commit_comparison_binary_diff(
        &self,
        repository_id: &str,
        before_oid: &str,
        after_oid: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<BinaryDiffResult, GitError> {
        let root = self.resolve_history_root(repository_id)?;
        root.repository
            .commit_comparison_binary_diff(before_oid, after_oid, path, original_path)
    }

    fn commit_comparison_binary_diff(
        &self,
        before_oid: &str,
        after_oid: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<BinaryDiffResult, GitError> {
        let selected =
            self.require_commit_comparison_file(before_oid, after_oid, path, original_path)?;
        let before_path = selected.original_path.as_deref().unwrap_or(&selected.path);
        let before = self.read_binary_at_revision(before_oid, before_path)?;
        let after = self.read_binary_at_revision(after_oid, &selected.path)?;
        Ok(BinaryDiffResult {
            path: selected.path,
            before,
            after,
        })
    }

    fn require_commit_comparison_file(
        &self,
        before_oid: &str,
        after_oid: &str,
        path: &str,
        original_path: Option<&str>,
    ) -> Result<CommitFileChange, GitError> {
        validate_relative_path(path)?;
        if let Some(original_path) = original_path {
            validate_relative_path(original_path)?;
        }
        let details = self.commit_comparison_details(before_oid, after_oid)?;
        details
            .files
            .into_iter()
            .find(|file| file.path == path && file.original_path.as_deref() == original_path)
            .ok_or_else(|| GitError::InvalidInput {
                field: "comparison file".to_string(),
                message: "select a file from the current commit comparison".to_string(),
            })
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
        Ok(self
            .read_file_at_revision(revision, path, MAX_BINARY_PREVIEW_BYTES)?
            .map(|file| file.bytes))
    }

    fn read_file_at_revision(
        &self,
        revision: &str,
        path: &str,
        limit_bytes: usize,
    ) -> Result<Option<RevisionFile>, GitError> {
        validate_object_id(revision)?;
        validate_relative_path(path)?;
        if limit_bytes == 0 {
            return Err(GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "the content limit must be greater than zero".to_string(),
            });
        }
        let (listing, listing_truncated) = self.run_read_owned_bounded(
            "resolve historical file",
            vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("ls-tree"),
                OsString::from("-z"),
                OsString::from(revision),
                OsString::from("--"),
                OsString::from(path),
            ],
            TREE_ENTRY_OUTPUT_LIMIT_BYTES,
        )?;
        if listing_truncated {
            return Err(GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "the historical tree entry exceeded the path output limit".to_string(),
            });
        }
        let mut records = listing
            .stdout
            .split(|byte| *byte == 0)
            .filter(|row| !row.is_empty());
        let Some(record) = records.next() else {
            return Ok(None);
        };
        if records.next().is_some() {
            return Err(GitError::Parse {
                context: "historical file".to_string(),
                message: "the selected path resolved to multiple tree entries".to_string(),
            });
        }
        let tab = record
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or_else(|| GitError::Parse {
                context: "historical file".to_string(),
                message: "the tree entry had no path separator".to_string(),
            })?;
        let listed_path = std::str::from_utf8(&record[tab + 1..]).map_err(|_| GitError::Parse {
            context: "historical file".to_string(),
            message: "non-UTF-8 historical paths are not supported".to_string(),
        })?;
        if listed_path != path {
            return Err(GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "the selected path did not resolve exactly".to_string(),
            });
        }
        let header = std::str::from_utf8(&record[..tab]).map_err(|_| GitError::Parse {
            context: "historical file".to_string(),
            message: "the tree entry header was not UTF-8".to_string(),
        })?;
        let mut fields = header.split_ascii_whitespace();
        let mode = fields.next();
        let kind = fields.next();
        let object = fields.next();
        if !matches!(mode, Some("100644" | "100755"))
            || kind != Some("blob")
            || fields.next().is_some()
        {
            return Err(GitError::InvalidInput {
                field: "commit file".to_string(),
                message: "the selected revision entry is not a supported regular file".to_string(),
            });
        }
        let object = object.ok_or_else(|| GitError::Parse {
            context: "historical file".to_string(),
            message: "the tree entry had no object id".to_string(),
        })?;
        validate_object_id(object)?;
        let (size, size_truncated) = self.run_read_owned_bounded(
            "measure historical file",
            vec![
                OsString::from("cat-file"),
                OsString::from("-s"),
                OsString::from(object),
            ],
            128,
        )?;
        if size_truncated {
            return Err(GitError::Parse {
                context: "historical file".to_string(),
                message: "Git returned an overlong blob size".to_string(),
            });
        }
        let size = String::from_utf8_lossy(&size.stdout)
            .trim()
            .parse::<usize>()
            .map_err(|_| GitError::Parse {
                context: "historical file".to_string(),
                message: "Git returned an invalid blob size".to_string(),
            })?;
        if size > limit_bytes {
            return Err(GitError::InvalidInput {
                field: "commit file".to_string(),
                message: format!("historical file reads are limited to {limit_bytes} bytes"),
            });
        }
        let (output, output_truncated) = self.run_read_owned_bounded(
            "read historical file",
            vec![
                OsString::from("cat-file"),
                OsString::from("blob"),
                OsString::from(object),
            ],
            limit_bytes.saturating_add(1),
        )?;
        if output_truncated || output.stdout.len() != size || output.stdout.len() > limit_bytes {
            return Err(GitError::Io {
                operation: "read historical file".to_string(),
                message: "the blob size did not match the exact bounded read".to_string(),
            });
        }
        Ok(Some(RevisionFile {
            source_path: path.to_string(),
            blob_oid: object.to_string(),
            file_mode: mode.expect("validated file mode").to_string(),
            bytes: output.stdout,
        }))
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
        let mut args = vec![
            OsString::from("--literal-pathspecs"),
            OsString::from("add"),
            OsString::from("--"),
        ];
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
                OsString::from("--literal-pathspecs"),
                OsString::from("restore"),
                OsString::from("--staged"),
                OsString::from("--"),
            ]
        } else {
            vec![
                OsString::from("--literal-pathspecs"),
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

        let runner = GitRunner::new(&self.root);
        let mut child = runner
            .spawn(["commit", "--file=-", "--cleanup=strip"], GitStdin::Piped)
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

        let output = runner.wait(child).map_err(|error| GitError::Io {
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
            let mut args = vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("commit"),
                OsString::from("--only"),
                OsString::from("--file=-"),
                OsString::from("--cleanup=strip"),
                OsString::from("--"),
            ];
            args.extend(pathspecs.iter().cloned());
            let runner = GitRunner::new(&self.root);
            let mut child = runner
                .spawn(args, GitStdin::Piped)
                .map_err(|error| GitError::Io {
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
            runner.wait(child).map_err(|error| GitError::Io {
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

    pub fn review_revert_selected(
        &self,
        selected: &[FileChange],
    ) -> Result<(String, Vec<String>), GitError> {
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
                    || change.index_status == ChangeKind::Copied
            })
            .map(|change| change.path.clone())
            .collect::<Vec<_>>();
        if !unsupported.is_empty() {
            return Err(GitError::UnsafeOperation {
                operation: "revert selected changes".to_string(),
                message: "revert supports tracked files and staged additions; untracked, copied, conflicted, and submodule paths are left untouched".to_string(),
                blockers: unsupported,
            });
        }
        let paths = expanded_change_paths(&selected)?
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        Ok((
            self.head_oid()?.ok_or_else(|| GitError::InvalidInput {
                field: "HEAD".into(),
                message: "HEAD disappeared during review".into(),
            })?,
            paths,
        ))
    }

    pub fn revert_selected_reviewed(
        &self,
        selected: &[FileChange],
        expected_head: &str,
        preflight: impl FnOnce() -> Result<(), GitError>,
    ) -> Result<(), GitError> {
        let (head, paths) = self.review_revert_selected(selected)?;
        if head != expected_head {
            return Err(GitError::UnsafeOperation {
                operation: "restore changes".into(),
                message: "HEAD changed after review".into(),
                blockers: paths,
            });
        }
        preflight()?;
        let mut args = vec![
            OsString::from("--literal-pathspecs"),
            OsString::from("restore"),
            OsString::from(format!("--source={expected_head}")),
            OsString::from("--staged"),
            OsString::from("--worktree"),
            OsString::from("--"),
        ];
        args.extend(paths.into_iter().map(OsString::from));
        self.run_mutation("restore reviewed changes", args)?;
        Ok(())
    }

    #[cfg(test)]
    fn revert_selected(&self, selected: &[FileChange]) -> Result<(), GitError> {
        let (head, _) = self.review_revert_selected(selected)?;
        self.revert_selected_reviewed(selected, &head, || Ok(()))
    }

    fn status_changes_with_untracked(&self) -> Result<Vec<FileChange>, GitError> {
        let status = self.run_read(
            "read current working tree changes",
            ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
        )?;
        let (_, changes) = parse_status(&status.stdout)?;
        Ok(changes)
    }

    pub fn head_oid(&self) -> Result<Option<String>, GitError> {
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

    pub fn prepare_branch_mutation(
        &self,
        request: &BranchMutationRequest,
    ) -> Result<BranchMutationPlan, GitError> {
        self.ensure_no_repository_operation("prepare branch mutation")?;
        validate_object_id(&request.source_oid)?;
        if request.delete_remote && request.kind != BranchMutationKind::Delete {
            return Err(GitError::InvalidInput {
                field: "delete remote branch".to_string(),
                message: "remote deletion is available only while deleting a local branch"
                    .to_string(),
            });
        }
        let start_name = self
            .current_branch()?
            .ok_or_else(|| GitError::UnsafeOperation {
                operation: "prepare branch mutation".to_string(),
                message: "a checked-out local branch with an existing HEAD is required".to_string(),
                blockers: Vec::new(),
            })?;
        let start_head_ref = format!("refs/heads/{start_name}");
        let start_head_oid = self.resolve_commit("HEAD", "read branch mutation HEAD")?;
        let references = self.read_references()?;
        let reference = references
            .iter()
            .find(|candidate| candidate.full_name == request.source_full_name);
        let (source_kind, source_name, source_oid, upstream) = match request.kind {
            BranchMutationKind::Switch
            | BranchMutationKind::Rename
            | BranchMutationKind::Delete => {
                let source = reference
                    .filter(|candidate| {
                        candidate.kind == crate::model::BranchKind::Local
                            && candidate.repository_id == "."
                    })
                    .ok_or_else(|| GitError::InvalidInput {
                        field: "source branch".to_string(),
                        message: "select an existing local branch".to_string(),
                    })?;
                (
                    BranchMutationSourceKind::Local,
                    source.name.clone(),
                    source.oid.clone(),
                    source.upstream.clone(),
                )
            }
            BranchMutationKind::CheckoutRemote => {
                let source = reference
                    .filter(|candidate| {
                        candidate.kind == crate::model::BranchKind::Remote
                            && candidate.repository_id == "."
                    })
                    .ok_or_else(|| GitError::InvalidInput {
                        field: "source branch".to_string(),
                        message: "select an existing remote-tracking branch".to_string(),
                    })?;
                (
                    BranchMutationSourceKind::Remote,
                    source.name.clone(),
                    source.oid.clone(),
                    None,
                )
            }
            BranchMutationKind::Create => match reference {
                Some(source)
                    if source.repository_id == "."
                        && matches!(
                            source.kind,
                            crate::model::BranchKind::Local | crate::model::BranchKind::Remote
                        ) =>
                {
                    (
                        match source.kind {
                            crate::model::BranchKind::Local => BranchMutationSourceKind::Local,
                            crate::model::BranchKind::Remote => BranchMutationSourceKind::Remote,
                            crate::model::BranchKind::Tag => unreachable!(),
                        },
                        source.name.clone(),
                        source.oid.clone(),
                        None,
                    )
                }
                _ if request.source_full_name == request.source_oid => (
                    BranchMutationSourceKind::Commit,
                    request.source_oid.chars().take(12).collect(),
                    self.resolve_commit(&request.source_oid, "resolve branch starting commit")?,
                    None,
                ),
                _ => {
                    return Err(GitError::InvalidInput {
                        field: "source branch".to_string(),
                        message: "select an existing local branch, remote branch, or exact commit"
                            .to_string(),
                    });
                }
            },
        };
        if source_oid != request.source_oid {
            return Err(GitError::UnsafeOperation {
                operation: "prepare branch mutation".to_string(),
                message: "the selected branch moved; reopen its menu and review the current object"
                    .to_string(),
                blockers: Vec::new(),
            });
        }

        let current_source = request.source_full_name == start_head_ref;
        match request.kind {
            BranchMutationKind::Switch if current_source => {
                return Err(GitError::InvalidInput {
                    field: "source branch".to_string(),
                    message: "the selected branch is already checked out".to_string(),
                });
            }
            BranchMutationKind::Delete if current_source => {
                return Err(GitError::UnsafeOperation {
                    operation: "prepare branch deletion".to_string(),
                    message: "the checked-out branch cannot be deleted".to_string(),
                    blockers: Vec::new(),
                });
            }
            _ => {}
        }

        let checked_out = if source_kind == BranchMutationSourceKind::Local {
            self.branch_worktree_checkout_count(&request.source_full_name)?
        } else {
            0
        };
        let allowed_here = usize::from(current_source);
        if (matches!(
            request.kind,
            BranchMutationKind::Switch | BranchMutationKind::Delete
        ) && checked_out > 0)
            || (request.kind == BranchMutationKind::Rename && checked_out > allowed_here)
        {
            return Err(GitError::UnsafeOperation {
                operation: "prepare branch mutation".to_string(),
                message: "the selected branch is checked out in another Git worktree".to_string(),
                blockers: Vec::new(),
            });
        }

        if matches!(
            request.kind,
            BranchMutationKind::Switch
                | BranchMutationKind::Create
                | BranchMutationKind::CheckoutRemote
        ) {
            self.ensure_clean_worktree("prepare branch mutation")?;
        }

        let (new_name, target_full_name) = match request.kind {
            BranchMutationKind::Create
            | BranchMutationKind::CheckoutRemote
            | BranchMutationKind::Rename => {
                let name =
                    self.validate_branch_name(request.new_name.as_deref().unwrap_or_default())?;
                let target = format!("refs/heads/{name}");
                if request.kind == BranchMutationKind::Rename && target == request.source_full_name
                {
                    return Err(GitError::InvalidInput {
                        field: "branch name".to_string(),
                        message: "enter a different local branch name".to_string(),
                    });
                }
                if target != request.source_full_name && self.reference_exists(&target)? {
                    return Err(GitError::InvalidInput {
                        field: "branch name".to_string(),
                        message: format!("'{name}' already exists"),
                    });
                }
                (Some(name.to_string()), Some(target))
            }
            BranchMutationKind::Switch | BranchMutationKind::Delete => (None, None),
        };
        let merged_into_current = if request.kind == BranchMutationKind::Delete {
            let merged = self.is_ancestor(&source_oid, &start_head_oid)?;
            if !merged {
                return Err(GitError::UnsafeOperation {
                    operation: "prepare branch deletion".to_string(),
                    message: "only a branch already merged into the current HEAD can be deleted"
                        .to_string(),
                    blockers: Vec::new(),
                });
            }
            Some(true)
        } else {
            None
        };
        let remote_deletion = if request.delete_remote {
            let target =
                self.read_upstream_target(&source_name)?
                    .ok_or_else(|| GitError::InvalidInput {
                        field: "remote branch".to_string(),
                        message: "the selected local branch has no remote upstream to delete"
                            .to_string(),
                    })?;
            let remote = self.validated_upstream(&target, true)?;
            let oid = self.resolve_commit(
                &target.tracking_ref,
                "resolve last-fetched remote branch for deletion",
            )?;
            Some(RemoteBranchDeletionTarget {
                remote: remote.name,
                branch_full_name: target.merge_ref,
                tracking_full_name: target.tracking_ref,
                oid,
            })
        } else {
            None
        };
        let preview_token = branch_mutation_token(&[
            request.kind.label(),
            &request.source_full_name,
            &source_oid,
            source_kind.label(),
            new_name.as_deref().unwrap_or(""),
            &start_head_ref,
            &start_head_oid,
            upstream.as_deref().unwrap_or(""),
            if merged_into_current == Some(true) {
                "merged"
            } else {
                ""
            },
            if request.delete_remote {
                "delete-remote"
            } else {
                "local-only"
            },
            remote_deletion
                .as_ref()
                .map(|target| target.remote.as_str())
                .unwrap_or(""),
            remote_deletion
                .as_ref()
                .map(|target| target.branch_full_name.as_str())
                .unwrap_or(""),
            remote_deletion
                .as_ref()
                .map(|target| target.tracking_full_name.as_str())
                .unwrap_or(""),
            remote_deletion
                .as_ref()
                .map(|target| target.oid.as_str())
                .unwrap_or(""),
        ]);
        Ok(BranchMutationPlan {
            repository_root: self.root.to_string_lossy().into_owned(),
            kind: request.kind,
            source_full_name: request.source_full_name.clone(),
            source_oid,
            source_kind,
            source_name,
            target_full_name,
            new_name,
            start_head_ref,
            start_head_oid,
            upstream,
            merged_into_current,
            delete_remote: request.delete_remote,
            remote_deletion,
            preview_token,
        })
    }

    pub fn execute_branch_mutation(&self, plan: &BranchMutationPlan) -> Result<(), GitError> {
        self.revalidate_branch_mutation_plan(plan)?;
        if plan.delete_remote {
            return Err(GitError::InvalidInput {
                field: "branch mutation plan".to_string(),
                message: "remote branch deletion requires the cancellable remote executor"
                    .to_string(),
            });
        }
        self.apply_local_branch_mutation(plan)
    }

    pub fn execute_branch_mutation_with_remote(
        &self,
        plan: &BranchMutationPlan,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        self.revalidate_branch_mutation_plan(plan)?;
        if plan.kind != BranchMutationKind::Delete || !plan.delete_remote {
            return Err(GitError::InvalidInput {
                field: "branch mutation plan".to_string(),
                message: "the plan does not authorize remote branch deletion".to_string(),
            });
        }
        self.delete_remote_branch_from_plan(plan, cancellation)?;
        self.delete_branch_from_plan(plan).map_err(|error| GitError::UnsafeOperation {
            operation: "delete local branch after remote deletion".to_string(),
            message: format!(
                "the exact remote branch was deleted, but the local branch was retained: {error}"
            ),
            blockers: vec![plan.source_full_name.clone()],
        })
    }

    fn revalidate_branch_mutation_plan(&self, plan: &BranchMutationPlan) -> Result<(), GitError> {
        if plan.repository_root != self.root.to_string_lossy() {
            return Err(stale_branch_plan(
                "the reviewed plan belongs to another repository",
            ));
        }
        let request = BranchMutationRequest {
            kind: plan.kind,
            source_full_name: plan.source_full_name.clone(),
            source_oid: plan.source_oid.clone(),
            new_name: plan.new_name.clone(),
            delete_remote: plan.delete_remote,
        };
        let refreshed = self.prepare_branch_mutation(&request)?;
        if refreshed.preview_token != plan.preview_token {
            return Err(stale_branch_plan(
                "HEAD, the source ref, its upstream, or the destination changed",
            ));
        }
        Ok(())
    }

    fn apply_local_branch_mutation(&self, plan: &BranchMutationPlan) -> Result<(), GitError> {
        match plan.kind {
            BranchMutationKind::Switch => self.switch_branch(&plan.source_full_name),
            BranchMutationKind::Create => self.create_branch_from(plan, false),
            BranchMutationKind::CheckoutRemote => self.create_branch_from(plan, true),
            BranchMutationKind::Rename => self.rename_branch_from_plan(plan),
            BranchMutationKind::Delete => self.delete_branch_from_plan(plan),
        }
    }

    fn create_branch_from(
        &self,
        plan: &BranchMutationPlan,
        track_source: bool,
    ) -> Result<(), GitError> {
        let name = plan
            .new_name
            .as_deref()
            .ok_or_else(|| GitError::InvalidInput {
                field: "branch mutation plan".to_string(),
                message: "a destination branch name is required".to_string(),
            })?;
        self.run_mutation(
            "create branch from reviewed object",
            vec![
                OsString::from("switch"),
                OsString::from("--no-track"),
                OsString::from("--create"),
                OsString::from(name),
                OsString::from(&plan.source_oid),
            ],
        )?;
        if track_source
            && let Err(error) = self.run_mutation(
                "set reviewed branch upstream",
                vec![
                    OsString::from("branch"),
                    OsString::from(format!("--set-upstream-to={}", plan.source_full_name)),
                    OsString::from(name),
                ],
            )
        {
            return Err(GitError::UnsafeOperation {
                operation: "checkout remote branch".to_string(),
                message: format!(
                    "the local branch was created at the reviewed object, but its upstream could not be set: {error}"
                ),
                blockers: vec![format!("refs/heads/{name}")],
            });
        }
        Ok(())
    }

    fn rename_branch_from_plan(&self, plan: &BranchMutationPlan) -> Result<(), GitError> {
        let old_name = validate_local_branch_ref(&plan.source_full_name)?;
        let new_name = plan
            .new_name
            .as_deref()
            .ok_or_else(|| GitError::InvalidInput {
                field: "branch mutation plan".to_string(),
                message: "a destination branch name is required".to_string(),
            })?;
        let mut arguments = vec![OsString::from("branch"), OsString::from("--move")];
        if plan.source_full_name != plan.start_head_ref {
            arguments.push(OsString::from(old_name));
        }
        arguments.push(OsString::from(new_name));
        self.run_mutation("rename reviewed branch", arguments)?;
        Ok(())
    }

    fn delete_branch_from_plan(&self, plan: &BranchMutationPlan) -> Result<(), GitError> {
        self.run_mutation(
            "delete reviewed branch",
            vec![
                OsString::from("update-ref"),
                OsString::from("-d"),
                OsString::from(&plan.source_full_name),
                OsString::from(&plan.source_oid),
            ],
        )?;
        let name = validate_local_branch_ref(&plan.source_full_name)?;
        let _ = run_git_output(
            &self.root,
            ["config", "--remove-section", &format!("branch.{name}")],
        );
        Ok(())
    }

    fn delete_remote_branch_from_plan(
        &self,
        plan: &BranchMutationPlan,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        let target = plan
            .remote_deletion
            .as_ref()
            .ok_or_else(|| stale_branch_plan("the remote deletion target is missing"))?;
        let args = vec![
            OsString::from("-c"),
            OsString::from("push.followTags=false"),
            OsString::from("-c"),
            OsString::from("push.recurseSubmodules=no"),
            OsString::from("push"),
            OsString::from("--porcelain"),
            OsString::from("--no-progress"),
            OsString::from("--no-mirror"),
            OsString::from("--no-follow-tags"),
            OsString::from("--no-signed"),
            OsString::from("--recurse-submodules=no"),
            OsString::from(format!(
                "--force-with-lease={}:{}",
                target.branch_full_name, target.oid
            )),
            OsString::from("--"),
            OsString::from(&target.remote),
            OsString::from(format!(":{}", target.branch_full_name)),
        ];
        self.run_remote_operation(
            "delete remote branch",
            &target.remote,
            args,
            cancellation,
            true,
            true,
        )?;
        Ok(())
    }

    fn branch_worktree_checkout_count(&self, full_name: &str) -> Result<usize, GitError> {
        let output = self.run_read(
            "read linked worktree branches",
            ["worktree", "list", "--porcelain", "-z"],
        )?;
        let expected = format!("branch {full_name}");
        Ok(output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|field| String::from_utf8_lossy(field).trim() == expected)
            .count())
    }

    pub fn prepare_remote_mutation(
        &self,
        request: &RemoteMutationRequest,
    ) -> Result<RemoteMutationPlan, GitError> {
        self.ensure_no_repository_operation("prepare remote mutation")?;
        let target_name = self.validate_remote_name(&request.name)?.to_string();
        let target_url = match request.kind {
            RemoteMutationKind::Add | RemoteMutationKind::Edit => {
                Some(validate_remote_url(request.url.as_deref().unwrap_or_default())?.to_string())
            }
            RemoteMutationKind::Delete => {
                if request.url.is_some() {
                    return Err(invalid_remote_mutation(
                        "a remote URL is not accepted while deleting a remote",
                    ));
                }
                None
            }
        };
        let remotes = self.remote_summaries()?;
        let (source_name, source_url, configuration_token) = match request.kind {
            RemoteMutationKind::Add => {
                if request.source_name.is_some() {
                    return Err(invalid_remote_mutation(
                        "a new remote must not include an existing source name",
                    ));
                }
                if remotes.iter().any(|remote| remote.name == target_name) {
                    return Err(invalid_remote_mutation("the remote name already exists"));
                }
                (None, None, String::new())
            }
            RemoteMutationKind::Edit | RemoteMutationKind::Delete => {
                let source = request.source_name.as_deref().ok_or_else(|| {
                    invalid_remote_mutation("select an existing remote to change")
                })?;
                let source = self.validate_remote_name(source)?.to_string();
                let configured = remotes
                    .iter()
                    .find(|remote| remote.name == source)
                    .ok_or_else(|| {
                        invalid_remote_mutation("the selected remote no longer exists")
                    })?;
                if request.kind == RemoteMutationKind::Delete && target_name != source {
                    return Err(invalid_remote_mutation(
                        "the reviewed remote name changed while preparing deletion",
                    ));
                }
                if request.kind == RemoteMutationKind::Edit
                    && target_name != source
                    && remotes.iter().any(|remote| remote.name == target_name)
                {
                    return Err(invalid_remote_mutation(
                        "the new remote name already exists",
                    ));
                }
                (
                    Some(source.clone()),
                    configured.url.clone(),
                    self.remote_configuration_token(&source)?,
                )
            }
        };
        if request.kind == RemoteMutationKind::Edit
            && source_name.as_deref() == Some(target_name.as_str())
            && source_url == target_url
        {
            return Err(invalid_remote_mutation(
                "change the remote name or URL before saving",
            ));
        }
        let preview_token = mutation_token(
            "asterlyn-remote-mutation-v1",
            &[
                request.kind.label(),
                source_name.as_deref().unwrap_or_default(),
                &target_name,
                source_url.as_deref().unwrap_or_default(),
                target_url.as_deref().unwrap_or_default(),
                &configuration_token,
            ],
        );
        Ok(RemoteMutationPlan {
            repository_root: self.root.to_string_lossy().into_owned(),
            kind: request.kind,
            source_name,
            target_name,
            source_url,
            target_url,
            configuration_token,
            preview_token,
        })
    }

    pub fn execute_remote_mutation(&self, plan: &RemoteMutationPlan) -> Result<(), GitError> {
        if plan.repository_root != self.root.to_string_lossy() {
            return Err(stale_remote_mutation(
                "the reviewed plan belongs to another repository",
            ));
        }
        let refreshed = self.prepare_remote_mutation(&RemoteMutationRequest {
            kind: plan.kind,
            source_name: plan.source_name.clone(),
            name: plan.target_name.clone(),
            url: plan.target_url.clone(),
        })?;
        if &refreshed != plan {
            return Err(stale_remote_mutation(
                "the selected remote configuration changed after review",
            ));
        }
        match plan.kind {
            RemoteMutationKind::Add => {
                self.run_mutation(
                    "add reviewed remote",
                    vec![
                        OsString::from("remote"),
                        OsString::from("add"),
                        OsString::from("--"),
                        OsString::from(&plan.target_name),
                        OsString::from(plan.target_url.as_deref().unwrap_or_default()),
                    ],
                )?;
            }
            RemoteMutationKind::Edit => self.edit_remote_from_plan(plan)?,
            RemoteMutationKind::Delete => {
                self.run_mutation(
                    "delete reviewed remote",
                    vec![
                        OsString::from("remote"),
                        OsString::from("remove"),
                        OsString::from(plan.source_name.as_deref().unwrap_or_default()),
                    ],
                )?;
            }
        }
        self.verify_remote_mutation(plan)
    }

    fn edit_remote_from_plan(&self, plan: &RemoteMutationPlan) -> Result<(), GitError> {
        let source = plan.source_name.as_deref().unwrap_or_default();
        let renamed = source != plan.target_name;
        if renamed {
            self.run_mutation(
                "rename reviewed remote",
                vec![
                    OsString::from("remote"),
                    OsString::from("rename"),
                    OsString::from(source),
                    OsString::from(&plan.target_name),
                ],
            )?;
        }
        if plan.source_url == plan.target_url {
            return Ok(());
        }
        let mut arguments = vec![OsString::from("remote"), OsString::from("set-url")];
        if plan.source_url.is_none() {
            arguments.push(OsString::from("--add"));
        }
        arguments.extend([
            OsString::from("--"),
            OsString::from(&plan.target_name),
            OsString::from(plan.target_url.as_deref().unwrap_or_default()),
        ]);
        if let Err(error) = self.run_mutation("update reviewed remote URL", arguments) {
            if renamed
                && self
                    .run_mutation(
                        "roll back remote rename",
                        vec![
                            OsString::from("remote"),
                            OsString::from("rename"),
                            OsString::from(&plan.target_name),
                            OsString::from(source),
                        ],
                    )
                    .is_err()
            {
                return Err(GitError::UnsafeOperation {
                    operation: "update reviewed remote".to_string(),
                    message: "the URL update failed and the remote rename could not be rolled back; refresh and inspect the repository configuration".to_string(),
                    blockers: vec![source.to_string(), plan.target_name.clone()],
                });
            }
            return Err(error);
        }
        Ok(())
    }

    fn verify_remote_mutation(&self, plan: &RemoteMutationPlan) -> Result<(), GitError> {
        let remotes = self.remote_summaries()?;
        if plan.kind == RemoteMutationKind::Delete {
            if remotes.iter().any(|remote| remote.name == plan.target_name) {
                return Err(stale_remote_mutation(
                    "Git did not remove the reviewed remote",
                ));
            }
            return Ok(());
        }
        let configured = remotes
            .iter()
            .find(|remote| remote.name == plan.target_name)
            .ok_or_else(|| stale_remote_mutation("Git did not retain the reviewed remote"))?;
        if configured.url != plan.target_url {
            return Err(stale_remote_mutation(
                "Git did not retain the reviewed remote URL",
            ));
        }
        if plan.source_name.as_deref().is_some_and(|source| {
            source != plan.target_name && remotes.iter().any(|remote| remote.name == source)
        }) {
            return Err(stale_remote_mutation(
                "the previous remote name still exists after rename",
            ));
        }
        Ok(())
    }

    pub fn prepare_git_reset(&self, target: &str) -> Result<GitResetPlan, GitError> {
        self.ensure_no_repository_operation("prepare reset")?;
        let current = self.current_branch_context("prepare reset")?;
        let target_oid = self.resolve_commit(target, "resolve reset target")?;
        if current.oid == target_oid {
            return Err(invalid_git_reset(
                "select a commit other than the current HEAD",
            ));
        }
        if !self.is_ancestor(&target_oid, &current.oid)? {
            return Err(invalid_git_reset(
                "the selected commit is not contained in the current branch",
            ));
        }
        let preview_token = mutation_token(
            "asterlyn-git-reset-v1",
            &[&current.full_ref, &current.oid, &target_oid],
        );
        Ok(GitResetPlan {
            repository_root: self.root.to_string_lossy().into_owned(),
            start_head_ref: current.full_ref,
            start_head_oid: current.oid,
            target_oid,
            preview_token,
        })
    }

    pub fn execute_git_reset(
        &self,
        plan: &GitResetPlan,
        mode: GitResetMode,
    ) -> Result<(), GitError> {
        if plan.repository_root != self.root.to_string_lossy() {
            return Err(stale_git_reset(
                "the reviewed plan belongs to another repository",
            ));
        }
        let refreshed = self.prepare_git_reset(&plan.target_oid)?;
        if &refreshed != plan {
            return Err(stale_git_reset(
                "the current branch or selected commit changed after review",
            ));
        }
        self.run_mutation(
            "reset reviewed current branch",
            vec![
                OsString::from("reset"),
                OsString::from(mode.argument()),
                OsString::from("--no-recurse-submodules"),
                OsString::from(&plan.target_oid),
            ],
        )?;
        let after = self.current_branch_context("verify completed reset")?;
        if after.full_ref != plan.start_head_ref || after.oid != plan.target_oid {
            return Err(GitError::UnsafeOperation {
                operation: "verify completed reset".to_string(),
                message: "Git returned success, but the reviewed current branch was not observed at the selected commit; refresh and inspect the repository before another operation".to_string(),
                blockers: Vec::new(),
            });
        }
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

    pub fn remote_authentication_status(
        &self,
        remote: &str,
    ) -> Result<RemoteAuthenticationStatus, GitError> {
        let remote = self.validated_remote(remote, true)?;
        let url = self.remote_push_url(&remote.name)?;
        let endpoint = parse_remote_endpoint(&url);
        let credential_helper_configured = match endpoint.transport {
            RemoteTransport::Https => self.credential_helper_configured(&endpoint)?,
            _ => false,
        };
        let credential_available = match endpoint.transport {
            RemoteTransport::Https => self.https_credential_available(&endpoint)?,
            RemoteTransport::Ssh => ssh_identity_configured(),
            RemoteTransport::Local => true,
            RemoteTransport::Other => true,
        };
        Ok(RemoteAuthenticationStatus {
            remote: remote.name,
            transport: endpoint.transport,
            host: endpoint.host,
            credential_available,
            credential_helper_configured,
            suggested_ssh_url: endpoint.suggested_ssh_url,
        })
    }

    pub fn store_remote_https_credential(
        &self,
        remote: &str,
        username: &str,
        token: &str,
    ) -> Result<RemoteAuthenticationStatus, GitError> {
        validate_credential_field("username", username, 256)?;
        validate_credential_field("personal access token", token, 4096)?;
        let remote = self.validated_remote(remote, true)?;
        let endpoint = parse_remote_endpoint(&self.remote_push_url(&remote.name)?);
        if endpoint.transport != RemoteTransport::Https {
            return Err(GitError::InvalidInput {
                field: "remote authentication".to_string(),
                message: "personal access tokens can be stored only for HTTPS remotes".to_string(),
            });
        }
        self.ensure_secure_credential_helper(&endpoint)?;

        let mut input = credential_input(&endpoint, Some(username), Some(token));
        let output = self.run_credential_command("store remote credential", "approve", &input);
        input.fill(0);
        let output = output?;
        if !output.status.success() {
            return Err(GitError::CommandFailed {
                operation: "store remote credential".to_string(),
                status: output.status.code(),
                message: sanitize_stderr(
                    &output.stderr,
                    "the configured Git credential helper rejected the credential",
                ),
            });
        }

        let status = self.remote_authentication_status(&remote.name)?;
        if !status.credential_available {
            return Err(GitError::CommandFailed {
                operation: "store remote credential".to_string(),
                status: None,
                message: "the configured Git credential helper did not retain the credential"
                    .to_string(),
            });
        }
        Ok(status)
    }

    pub fn configure_remote_ssh(
        &self,
        remote: &str,
        ssh_url: &str,
    ) -> Result<RemoteAuthenticationStatus, GitError> {
        validate_credential_field("SSH remote URL", ssh_url, 4096)?;
        let remote = self.validated_remote(remote, true)?;
        if parse_remote_endpoint(ssh_url).transport != RemoteTransport::Ssh {
            return Err(GitError::InvalidInput {
                field: "SSH remote URL".to_string(),
                message: "enter an ssh:// URL or an SSH scp-style address such as git@host:owner/repository.git"
                    .to_string(),
            });
        }
        self.run_mutation(
            "configure SSH push URL",
            vec![
                OsString::from("remote"),
                OsString::from("set-url"),
                OsString::from("--push"),
                OsString::from(&remote.name),
                OsString::from(ssh_url),
            ],
        )?;
        self.remote_authentication_status(&remote.name)
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

    pub fn push_current_with_options(
        &self,
        remote: &str,
        mode: PushMode,
        tag_mode: PushTagMode,
        expected_preview_token: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        self.push_current_with_options_internal(
            remote,
            mode,
            tag_mode,
            Some(expected_preview_token),
            cancellation,
            || {},
        )
    }

    pub fn push_preview(
        &self,
        remote: &str,
        offset: usize,
        page_size: usize,
    ) -> Result<PushPreview, GitError> {
        self.push_preview_with_tags(remote, PushTagMode::None, offset, page_size)
    }

    pub fn push_preview_with_tags(
        &self,
        remote: &str,
        tag_mode: PushTagMode,
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
        let tags = self.push_tags(&target, tag_mode)?;
        let (files, files_truncated) = self.push_preview_files(&target)?;
        let ordinary_allowed = match target.comparison_base_oid.as_ref() {
            Some(base) => self.is_ancestor(base, &target.head_oid)?,
            None => true,
        };
        let ordinary_block_reason = (!ordinary_allowed).then(|| {
            "The local branch is not a descendant of the last-fetched remote branch. Fetch and reconcile it, or explicitly choose Force Push with Lease."
                .to_string()
        });
        let force_with_lease_allowed = target.comparison_base_oid.is_some();
        let force_with_lease_block_reason = (!force_with_lease_allowed).then(|| {
            "The destination branch is not present in local remote-tracking refs, so there is no exact lease to protect a force push."
                .to_string()
        });
        let selectors = push_revision_selectors(&target);
        let total_commits = self.count_revisions(&selectors, "count outgoing commits")?;
        let preview_token = push_preview_token_with_tags(&target, tag_mode, &tags);
        let mut commits = if offset == MAX_PUSH_PREVIEW_WINDOW || offset >= total_commits {
            Vec::new()
        } else {
            let page_size = page_size
                .min(MAX_PUSH_PREVIEW_WINDOW - offset)
                .min(total_commits - offset);
            let mut log_selectors = vec![OsString::from(format!("--skip={offset}"))];
            log_selectors.extend(selectors.iter().map(OsString::from));
            self.run_commit_history("read outgoing commits", log_selectors, page_size)?
        };
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
            ordinary_allowed,
            ordinary_block_reason,
            force_with_lease_allowed,
            force_with_lease_block_reason,
            tag_mode,
            tags,
            files,
            files_truncated,
            commits,
            offset,
            total_commits,
            has_more: next_offset < total_commits && next_offset < MAX_PUSH_PREVIEW_WINDOW,
            truncated: total_commits > MAX_PUSH_PREVIEW_WINDOW,
            preview_token,
        })
    }

    pub fn push_file_commit(
        &self,
        remote: &str,
        tag_mode: PushTagMode,
        expected_preview_token: &str,
        path: &str,
    ) -> Result<Option<CommitDetails>, GitError> {
        validate_relative_path(path)?;
        self.ensure_no_repository_operation("read pushed file commit")?;
        let target = self.push_target_context(remote)?;
        let tags = self.push_tags(&target, tag_mode)?;
        if expected_preview_token != push_preview_token_with_tags(&target, tag_mode, &tags) {
            return Err(GitError::UnsafeOperation {
                operation: "read pushed file commit".to_string(),
                message: "the Push review is stale; refresh it before opening Diff".to_string(),
                blockers: Vec::new(),
            });
        }
        let mut args = vec![OsString::from("rev-list"), OsString::from("--max-count=1")];
        args.extend(
            push_revision_selectors(&target)
                .into_iter()
                .map(OsString::from),
        );
        args.extend([OsString::from("--"), OsString::from(path)]);
        let output = self.run_read_owned("find pushed file commit", args)?;
        let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if oid.is_empty() {
            return Ok(None);
        }
        validate_object_id(&oid)?;
        self.commit_details(&oid).map(Some)
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
        self.push_current_with_options_internal(
            remote,
            PushMode::Ordinary,
            PushTagMode::None,
            expected_preview_token,
            cancellation,
            before_execute,
        )
    }

    fn push_current_with_options_internal<F>(
        &self,
        remote: &str,
        mode: PushMode,
        tag_mode: PushTagMode,
        expected_preview_token: Option<&str>,
        cancellation: &CancellationToken,
        before_execute: F,
    ) -> Result<(), GitError>
    where
        F: FnOnce(),
    {
        self.ensure_no_repository_operation("push")?;
        let target = self.push_target_context(remote)?;
        let tags = self.push_tags(&target, tag_mode)?;
        if expected_preview_token.is_some_and(|expected| {
            expected != push_preview_token_with_tags(&target, tag_mode, &tags)
        }) {
            return Err(GitError::UnsafeOperation {
                operation: "push".to_string(),
                message: "the branch, HEAD, upstream, remote-tracking state, or selected tags changed after confirmation; review the push again"
                    .to_string(),
                blockers: Vec::new(),
            });
        }

        let ordinary_allowed = match target.comparison_base_oid.as_ref() {
            Some(base) => self.is_ancestor(base, &target.head_oid)?,
            None => true,
        };
        match mode {
            PushMode::Ordinary if !ordinary_allowed => {
                return Err(GitError::UnsafeOperation {
                    operation: "push".to_string(),
                    message: "ordinary push cannot update the last-fetched destination without rewriting it; review Force Push with Lease explicitly"
                        .to_string(),
                    blockers: Vec::new(),
                });
            }
            PushMode::ForceWithLease if target.comparison_base_oid.is_none() => {
                return Err(GitError::UnsafeOperation {
                    operation: "force push with lease".to_string(),
                    message: "force push is unavailable because no last-fetched destination object exists for an exact lease"
                        .to_string(),
                    blockers: Vec::new(),
                });
            }
            _ => {}
        }

        let mut args = vec![
            OsString::from("-c"),
            OsString::from("push.followTags=false"),
            OsString::from("-c"),
            OsString::from("push.recurseSubmodules=no"),
            OsString::from("push"),
            OsString::from("--porcelain"),
            OsString::from("--no-progress"),
            OsString::from("--no-mirror"),
            OsString::from("--no-follow-tags"),
            OsString::from("--no-signed"),
            OsString::from("--recurse-submodules=no"),
        ];
        if !tags.is_empty() {
            // A branch rejection must not publish only the independent tag refspecs.
            // Unsupported atomic pushes fail closed instead of degrading to partial success.
            args.push(OsString::from("--atomic"));
        }
        match mode {
            PushMode::Ordinary => args.push(OsString::from("--no-force")),
            PushMode::ForceWithLease => args.push(OsString::from(format!(
                "--force-with-lease={}:{}",
                target.destination_ref,
                target
                    .comparison_base_oid
                    .as_deref()
                    .expect("force-with-lease availability was checked")
            ))),
        }
        self.ensure_no_repository_operation("push")?;
        let before_push = self.push_target_context(remote)?;
        let before_tags = self.push_tags(&before_push, tag_mode)?;
        if before_push != target || before_tags != tags {
            return Err(GitError::UnsafeOperation {
                operation: "push".to_string(),
                message: "branch, upstream, or selected tag state changed before push; review the push again"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        before_execute();
        args.extend([OsString::from("--"), OsString::from(&target.remote)]);
        args.push(OsString::from(format!(
            "{}:{}",
            target.head_oid, target.destination_ref
        )));
        args.extend(
            tags.iter()
                .map(|tag| OsString::from(format!("{}:{}", tag.object_oid, tag.full_ref))),
        );
        self.run_remote_operation("push", &target.remote, args, cancellation, true, true)?;
        if target.set_upstream_after_push {
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
        let set_upstream_after_push = context.upstream.is_none();
        let (destination_ref, comparison_base_oid, publish) = match context.upstream.as_ref() {
            Some(upstream) if upstream.remote == configured_remote.name => {
                self.validated_upstream(upstream, true)?;
                let base =
                    self.resolve_commit(&upstream.tracking_ref, "read push comparison base")?;
                (upstream.merge_ref.clone(), Some(base), false)
            }
            _ => {
                // Choosing another remote is an explicit review action. Keep the current
                // upstream unchanged and target the same branch name on that remote.
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
            set_upstream_after_push,
        })
    }

    fn push_preview_files(
        &self,
        target: &PushTargetContext,
    ) -> Result<(Vec<CommitFileChange>, bool), GitError> {
        let (output, output_truncated) = if let Some(base) = &target.comparison_base_oid {
            self.run_read_owned_bounded(
                "read pushed file range",
                vec![
                    OsString::from("diff"),
                    OsString::from("--no-ext-diff"),
                    OsString::from("--name-status"),
                    OsString::from("-z"),
                    OsString::from("-M"),
                    OsString::from("-C"),
                    OsString::from(base),
                    OsString::from(&target.head_oid),
                    OsString::from("--"),
                ],
                MAX_PUSH_PREVIEW_FILE_BYTES,
            )?
        } else {
            self.run_read_owned_bounded(
                "read published branch files",
                vec![
                    OsString::from("ls-tree"),
                    OsString::from("-r"),
                    OsString::from("-z"),
                    OsString::from("--name-only"),
                    OsString::from(&target.head_oid),
                    OsString::from("--"),
                ],
                MAX_PUSH_PREVIEW_FILE_BYTES,
            )?
        };
        if output_truncated {
            return Ok((Vec::new(), true));
        }
        let mut files = if target.comparison_base_oid.is_some() {
            parse_commit_files(&output.stdout)?
        } else {
            output
                .stdout
                .split(|byte| *byte == 0)
                .filter(|path| !path.is_empty())
                .map(|path| CommitFileChange {
                    path: String::from_utf8_lossy(path).into_owned(),
                    original_path: None,
                    status: ChangeKind::Added,
                })
                .collect()
        };
        files.sort_by(|left, right| left.path.cmp(&right.path));
        let files_truncated = files.len() > MAX_PUSH_PREVIEW_FILES;
        files.truncate(MAX_PUSH_PREVIEW_FILES);
        Ok((files, files_truncated))
    }

    fn push_tags(
        &self,
        target: &PushTargetContext,
        mode: PushTagMode,
    ) -> Result<Vec<PushTagSummary>, GitError> {
        if mode == PushTagMode::None {
            return Ok(Vec::new());
        }
        let mut args = vec![
            OsString::from("for-each-ref"),
            OsString::from("--format=%(refname)%00%(objectname)"),
        ];
        if mode == PushTagMode::CurrentBranch {
            args.push(OsString::from(format!("--merged={}", target.head_oid)));
        }
        args.push(OsString::from("refs/tags"));
        let output = self.run_read_owned("read push tags", args)?;
        let mut tags = Vec::new();
        for record in output.stdout.split(|byte| *byte == b'\n') {
            let record = record.strip_suffix(b"\r").unwrap_or(record);
            if record.is_empty() {
                continue;
            }
            let mut fields = record.splitn(2, |byte| *byte == 0);
            let full_ref = String::from_utf8_lossy(fields.next().unwrap_or_default()).into_owned();
            let object_oid =
                String::from_utf8_lossy(fields.next().unwrap_or_default()).into_owned();
            if !full_ref.starts_with("refs/tags/") || object_oid.is_empty() {
                return Err(GitError::Parse {
                    context: "push tags".to_string(),
                    message: "Git returned an incomplete tag record".to_string(),
                });
            }
            tags.push(PushTagSummary {
                name: full_ref.trim_start_matches("refs/tags/").to_string(),
                full_ref,
                object_oid,
            });
            if tags.len() > MAX_PUSH_TAGS {
                return Err(GitError::UnsafeOperation {
                    operation: "push tags".to_string(),
                    message: format!(
                        "the selected tag scope exceeds the review limit of {MAX_PUSH_TAGS} tags"
                    ),
                    blockers: Vec::new(),
                });
            }
        }
        tags.sort_by(|left, right| left.full_ref.cmp(&right.full_ref));
        Ok(tags)
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
                let url = self.remote_configured_url(&name)?;
                let fetch_supported = self.remote_fetch_is_supported(&name)?;
                let push_supported = fetch_supported && !self.remote_is_mirror(&name)?;
                Ok(RemoteSummary {
                    name,
                    url,
                    fetch_supported,
                    push_supported,
                })
            })
            .collect()
    }

    fn remote_configured_url(&self, remote: &str) -> Result<Option<String>, GitError> {
        let key = format!("remote.{remote}.url");
        let output =
            run_git_output(&self.root, ["config", "--local", "--get", &key]).map_err(|error| {
                GitError::Io {
                    operation: "read remote URL".to_string(),
                    message: error.to_string(),
                }
            })?;
        match output.status.code() {
            Some(0) => {
                let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Ok((!url.is_empty()).then_some(url))
            }
            Some(1) => Ok(None),
            _ => Err(GitError::CommandFailed {
                operation: "read remote URL".to_string(),
                status: output.status.code(),
                message: "Git could not read the configured remote URL".to_string(),
            }),
        }
    }

    fn remote_configuration_token(&self, remote: &str) -> Result<String, GitError> {
        let pattern = format!("^remote\\.{}\\.", regex_escape(remote));
        let output = run_git_output(&self.root, ["config", "--local", "--get-regexp", &pattern])
            .map_err(|error| GitError::Io {
                operation: "read remote configuration".to_string(),
                message: error.to_string(),
            })?;
        match output.status.code() {
            Some(0) => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
            Some(1) => Ok(String::new()),
            _ => Err(GitError::CommandFailed {
                operation: "read remote configuration".to_string(),
                status: output.status.code(),
                message: "Git could not read the selected remote configuration".to_string(),
            }),
        }
    }

    fn remote_push_url(&self, remote: &str) -> Result<String, GitError> {
        let output = self.run_read(
            "read remote push URL",
            ["remote", "get-url", "--push", remote],
        )?;
        let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if url.is_empty() {
            return Err(GitError::Parse {
                context: "remote push URL".to_string(),
                message: "Git returned an empty remote URL".to_string(),
            });
        }
        Ok(url)
    }

    fn credential_helper_configured(&self, endpoint: &RemoteEndpoint) -> Result<bool, GitError> {
        let Some(url) = credential_lookup_url(endpoint) else {
            return Ok(false);
        };
        let output = run_git_output(
            &self.root,
            ["config", "--get-urlmatch", "credential.helper", &url],
        )
        .map_err(|error| GitError::Io {
            operation: "read credential helper".to_string(),
            message: error.to_string(),
        })?;
        match output.status.code() {
            Some(0) => Ok(String::from_utf8_lossy(&output.stdout)
                .lines()
                .any(|value| !value.trim().is_empty())),
            Some(1) => Ok(false),
            _ => Err(GitError::CommandFailed {
                operation: "read credential helper".to_string(),
                status: output.status.code(),
                message: sanitize_stderr(&output.stderr, "Git could not read credential helpers"),
            }),
        }
    }

    fn ensure_secure_credential_helper(&self, endpoint: &RemoteEndpoint) -> Result<(), GitError> {
        if self.credential_helper_configured(endpoint)? {
            return Ok(());
        }
        let helper = discover_platform_credential_helper(&self.root)?.ok_or_else(|| {
            GitError::InvalidInput {
                field: "credential helper".to_string(),
                message: "no supported secure Git credential manager is installed; configure one or use SSH"
                    .to_string(),
            }
        })?;
        self.run_mutation(
            "configure credential helper",
            vec![
                OsString::from("config"),
                OsString::from("--local"),
                OsString::from("credential.helper"),
                OsString::from(helper),
            ],
        )?;
        Ok(())
    }

    fn https_credential_available(&self, endpoint: &RemoteEndpoint) -> Result<bool, GitError> {
        let input = credential_input(endpoint, endpoint.username.as_deref(), None);
        let output = self.run_credential_command("read remote credential", "fill", &input)?;
        if !output.status.success() {
            return Ok(false);
        }
        Ok(credential_output_has_secret(&output.stdout))
    }

    fn run_credential_command(
        &self,
        operation: &str,
        action: &str,
        input: &[u8],
    ) -> Result<Output, GitError> {
        let runner = GitRunner::remote(&self.root);
        let mut child = runner
            .spawn(["credential", action], GitStdin::Piped)
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })?;
        let mut stdin = child.stdin.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git credential stdin was unavailable".to_string(),
        })?;
        stdin.write_all(input).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: format!("could not send credential metadata to Git: {error}"),
        })?;
        drop(stdin);
        runner.wait(child).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })
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
        if let Some(active) = self.operation_snapshot()? {
            return Err(GitError::UnsafeOperation {
                operation: operation.to_string(),
                message: format!("finish the active {} operation first", active.kind.label()),
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

    fn validate_remote_name<'a>(&self, name: &'a str) -> Result<&'a str, GitError> {
        let name = name.trim();
        let valid = !name.is_empty()
            && name.len() <= 255
            && !name.starts_with(['-', '.'])
            && name != "."
            && name != ".."
            && name.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            })
            && self.ref_is_valid(&format!("refs/remotes/{name}/asterlyn-probe"))?;
        if !valid {
            return Err(invalid_remote_mutation(
                "enter a simple remote name using letters, numbers, dots, underscores, or hyphens",
            ));
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
        #[cfg(test)]
        self.read_trace.lock().unwrap().push(operation.to_string());
        let output = run_git_output(&self.root, args).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
        ensure_success(operation, output)
    }

    fn run_read_owned(&self, operation: &str, args: Vec<OsString>) -> Result<Output, GitError> {
        #[cfg(test)]
        self.read_trace.lock().unwrap().push(operation.to_string());
        let output = run_git_output(&self.root, args).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
        ensure_success(operation, output)
    }

    // Stop the producer at the entry/byte budget; never allocate the complete catalog first.
    fn read_catalog_records(
        &self,
        args: &[&str],
        limit: usize,
    ) -> Result<(Vec<String>, bool), GitError> {
        let mut child = GitRunner::new(&self.root)
            .spawn(args, GitStdin::Inherit)
            .map_err(|error| GitError::Io {
                operation: "list bounded catalog".into(),
                message: error.to_string(),
            })?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let stderr_reader = thread::spawn(move || read_stream_bounded(stderr));
        let result = read_catalog_stream(stdout, limit);
        if !matches!(&result, Ok((_, false))) {
            let _ = child.kill();
        }
        let status = child.wait().map_err(|error| GitError::Io {
            operation: "wait for catalog".into(),
            message: error.to_string(),
        })?;
        let stderr = join_stream(stderr_reader, "list bounded catalog", "stderr")?;
        let (records, truncated) = result?;
        if !truncated {
            ensure_success(
                "list bounded catalog",
                Output {
                    status,
                    stdout: Vec::new(),
                    stderr,
                },
            )?;
        }
        Ok((records, truncated))
    }

    fn run_read_owned_bounded(
        &self,
        operation: &str,
        args: Vec<OsString>,
        stdout_limit: usize,
    ) -> Result<(Output, bool), GitError> {
        let bounded = GitRunner::new(&self.root)
            .bounded_output(args, GitStdin::Inherit, stdout_limit, 64 * 1024)
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })?;
        if bounded.stdout_truncated {
            Ok((bounded.output, true))
        } else {
            Ok((ensure_success(operation, bounded.output)?, false))
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
        let runner = GitRunner::remote(&self.root);
        let output = runner
            .cancellable_output(args, GitStdin::Inherit, cancellation)
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })?;
        let output = match output {
            CancellableOutput::Completed(output) => output,
            CancellableOutput::Cancelled => {
                return Err(remote_cancelled(
                    operation,
                    repository_state_may_have_changed,
                    remote_state_may_have_changed,
                ));
            }
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
        let runner = GitRunner::new(&self.root);
        match runner
            .cancellable_output(args, GitStdin::Inherit, cancellation)
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })? {
            CancellableOutput::Completed(output) => ensure_success(operation, output),
            CancellableOutput::Cancelled => Err(GitError::Cancelled {
                operation: operation.to_string(),
            }),
        }
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

#[cfg(test)]
fn push_preview_token(target: &PushTargetContext) -> String {
    push_preview_token_with_tags(target, PushTagMode::None, &[])
}

fn push_preview_token_with_tags(
    target: &PushTargetContext,
    tag_mode: PushTagMode,
    tags: &[PushTagSummary],
) -> String {
    let fields = [
        target.remote.as_str(),
        target.source_ref.as_str(),
        target.destination_ref.as_str(),
        target.head_oid.as_str(),
        target.comparison_base_oid.as_deref().unwrap_or("new"),
        if target.publish {
            "publish"
        } else {
            "existing-destination"
        },
        if target.set_upstream_after_push {
            "configure-upstream"
        } else {
            "keep-upstream"
        },
        match tag_mode {
            PushTagMode::None => "no-tags",
            PushTagMode::All => "all-tags",
            PushTagMode::CurrentBranch => "current-branch-tags",
        },
    ];
    let mut token = String::from("v3");
    for field in fields {
        token.push('|');
        token.push_str(&field.len().to_string());
        token.push(':');
        token.push_str(field);
    }
    for tag in tags {
        for field in [&tag.full_ref, &tag.object_oid] {
            token.push('|');
            token.push_str(&field.len().to_string());
            token.push(':');
            token.push_str(field);
        }
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

fn short_tracking_ref(reference: &str) -> String {
    reference
        .strip_prefix("refs/remotes/")
        .or_else(|| reference.strip_prefix("refs/heads/"))
        .unwrap_or(reference)
        .to_string()
}

fn merge_root_histories(
    histories: Vec<Vec<CommitSummary>>,
    commit_limit: usize,
) -> Vec<CommitSummary> {
    let limit = commit_limit.clamp(1, MAX_HISTORY_SESSION + 1);
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
        .chain(
            query
                .start_commit
                .iter()
                .map(|start| start.repository_id.as_str()),
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

fn read_catalog_stream(input: impl Read, limit: usize) -> Result<(Vec<String>, bool), GitError> {
    const BYTE_LIMIT: usize = 16 * 1024 * 1024;
    const PATH_LIMIT: usize = 32 * 1024;
    let mut reader = BufReader::new(input);
    let mut records = std::collections::BTreeSet::new();
    let mut bytes = 0;
    loop {
        let mut record = Vec::new();
        let read = reader
            .by_ref()
            .take((PATH_LIMIT + 1) as u64)
            .read_until(0, &mut record)
            .map_err(|error| GitError::Io {
                operation: "read catalog stream".into(),
                message: error.to_string(),
            })?;
        if read == 0 {
            return Ok((records.into_iter().collect(), false));
        }
        bytes += read;
        if bytes > BYTE_LIMIT || read > PATH_LIMIT || record.last() != Some(&0) {
            return Ok((records.into_iter().collect(), true));
        }
        record.pop();
        if record.is_empty() {
            continue;
        }
        let path = String::from_utf8(record).map_err(|_| GitError::InvalidInput {
            field: "project path".into(),
            message: "non-UTF-8 file paths are unsupported".into(),
        })?;
        if records.contains(&path) {
            continue;
        }
        if records.len() == limit {
            return Ok((records.into_iter().collect(), true));
        }
        records.insert(path);
    }
}

fn run_git_output<I, S>(path: &Path, args: I) -> std::io::Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    GitRunner::new(path).output(args)
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

fn parse_remote_endpoint(url: &str) -> RemoteEndpoint {
    let value = url.trim();
    if value.is_empty() || value.contains(['\0', '\r', '\n']) {
        return remote_endpoint(RemoteTransport::Other, None, None, None, None);
    }
    if let Some(rest) = value.strip_prefix("https://") {
        let (authority, path) = split_remote_authority(rest);
        let (username, host) = split_remote_user(authority);
        let path = clean_remote_path(path);
        let suggested_ssh_url = suggested_ssh_url(host, path.as_deref());
        return remote_endpoint(
            RemoteTransport::Https,
            nonempty(host),
            path,
            username,
            suggested_ssh_url,
        );
    }
    if let Some(rest) = value.strip_prefix("ssh://") {
        let (authority, path) = split_remote_authority(rest);
        let (username, host) = split_remote_user(authority);
        return remote_endpoint(
            RemoteTransport::Ssh,
            nonempty(host),
            clean_remote_path(path),
            username,
            None,
        );
    }
    if value.starts_with("file://")
        || value.starts_with('/')
        || value.starts_with("./")
        || value.starts_with("../")
    {
        return remote_endpoint(RemoteTransport::Local, None, None, None, None);
    }
    if let Some((authority, path)) = value.split_once(':')
        && authority.len() > 1
        && !authority.contains(['/', '\\'])
        && !path.is_empty()
    {
        let (username, host) = split_remote_user(authority);
        return remote_endpoint(
            RemoteTransport::Ssh,
            nonempty(host),
            clean_remote_path(path),
            username,
            None,
        );
    }
    if Path::new(value).is_absolute() || value.contains(['/', '\\']) {
        return remote_endpoint(RemoteTransport::Local, None, None, None, None);
    }
    remote_endpoint(RemoteTransport::Other, None, None, None, None)
}

fn remote_endpoint(
    transport: RemoteTransport,
    host: Option<String>,
    path: Option<String>,
    username: Option<String>,
    suggested_ssh_url: Option<String>,
) -> RemoteEndpoint {
    RemoteEndpoint {
        transport,
        host,
        path,
        username,
        suggested_ssh_url,
    }
}

fn split_remote_authority(value: &str) -> (&str, &str) {
    value
        .find('/')
        .map_or((value, ""), |index| (&value[..index], &value[index + 1..]))
}

fn split_remote_user(authority: &str) -> (Option<String>, &str) {
    let Some((userinfo, host)) = authority.rsplit_once('@') else {
        return (None, authority);
    };
    let username = userinfo.split_once(':').map_or(userinfo, |(name, _)| name);
    (nonempty(username), host)
}

fn clean_remote_path(path: &str) -> Option<String> {
    let path = path
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_start_matches('/');
    nonempty(path)
}

fn nonempty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

fn suggested_ssh_url(host: &str, path: Option<&str>) -> Option<String> {
    let path = path?;
    if host.is_empty() {
        return None;
    }
    if host.contains(':') {
        Some(format!("ssh://git@{host}/{path}"))
    } else {
        Some(format!("git@{host}:{path}"))
    }
}

fn credential_lookup_url(endpoint: &RemoteEndpoint) -> Option<String> {
    if endpoint.transport != RemoteTransport::Https {
        return None;
    }
    let host = endpoint.host.as_deref()?;
    Some(match endpoint.path.as_deref() {
        Some(path) => format!("https://{host}/{path}"),
        None => format!("https://{host}"),
    })
}

fn credential_input(
    endpoint: &RemoteEndpoint,
    username: Option<&str>,
    password: Option<&str>,
) -> Vec<u8> {
    let mut input = Vec::new();
    input.extend_from_slice(b"protocol=https\n");
    if let Some(host) = endpoint.host.as_deref() {
        input.extend_from_slice(b"host=");
        input.extend_from_slice(host.as_bytes());
        input.push(b'\n');
    }
    if let Some(path) = endpoint.path.as_deref() {
        input.extend_from_slice(b"path=");
        input.extend_from_slice(path.as_bytes());
        input.push(b'\n');
    }
    if let Some(username) = username {
        input.extend_from_slice(b"username=");
        input.extend_from_slice(username.as_bytes());
        input.push(b'\n');
    }
    if let Some(password) = password {
        input.extend_from_slice(b"password=");
        input.extend_from_slice(password.as_bytes());
        input.push(b'\n');
    }
    input.push(b'\n');
    input
}

fn credential_output_has_secret(output: &[u8]) -> bool {
    output.split(|byte| *byte == b'\n').any(|line| {
        line.strip_prefix(b"password=")
            .is_some_and(|password| !password.is_empty())
    })
}

fn validate_credential_field(field: &str, value: &str, limit: usize) -> Result<(), GitError> {
    if value.is_empty()
        || value.len() > limit
        || value != value.trim()
        || value.contains(['\0', '\r', '\n'])
    {
        return Err(GitError::InvalidInput {
            field: field.to_string(),
            message: format!("enter a non-empty {field} without surrounding whitespace"),
        });
    }
    Ok(())
}

fn discover_platform_credential_helper(root: &Path) -> Result<Option<&'static str>, GitError> {
    #[cfg(target_os = "macos")]
    const CANDIDATES: &[&str] = &["osxkeychain"];
    #[cfg(target_os = "windows")]
    const CANDIDATES: &[&str] = &["manager", "manager-core"];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    const CANDIDATES: &[&str] = &["libsecret"];

    let output = run_git_output(root, ["--exec-path"]).map_err(|error| GitError::Io {
        operation: "locate Git credential helpers".to_string(),
        message: error.to_string(),
    })?;
    let output = ensure_success("locate Git credential helpers", output)?;
    let exec_path = output_path(&output, "Git executable path")?;
    let path_entries = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    Ok(CANDIDATES.iter().copied().find(|candidate| {
        credential_helper_file_exists(&exec_path, candidate)
            || path_entries
                .iter()
                .any(|entry| credential_helper_file_exists(entry, candidate))
    }))
}

fn credential_helper_file_exists(directory: &Path, helper: &str) -> bool {
    let executable = directory.join(format!("git-credential-{helper}"));
    executable.is_file()
        || cfg!(target_os = "windows") && executable.with_extension("exe").is_file()
}

fn ssh_identity_configured() -> bool {
    if std::env::var_os("SSH_AUTH_SOCK")
        .filter(|value| !value.is_empty())
        .is_some_and(|value| Path::new(&value).exists())
    {
        return true;
    }
    let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) else {
        return false;
    };
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .iter()
        .any(|name| Path::new(&home).join(".ssh").join(name).is_file())
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

fn validate_distinct_commit_ids(before_oid: &str, after_oid: &str) -> Result<(), GitError> {
    validate_object_id(before_oid)?;
    validate_object_id(after_oid)?;
    if before_oid.eq_ignore_ascii_case(after_oid) {
        return Err(GitError::InvalidInput {
            field: "commit comparison".to_string(),
            message: "select two distinct commits".to_string(),
        });
    }
    Ok(())
}

fn parse_bounded_commit_files(
    output: Output,
    truncated: bool,
    field: &str,
    description: &str,
) -> Result<Vec<CommitFileChange>, GitError> {
    if truncated || output.stdout.len() > COMMIT_FILE_LIST_LIMIT_BYTES {
        return Err(commit_file_list_limit_error(
            field,
            &format!("{description} exceeded the 16 MiB read limit"),
        ));
    }
    let files = parse_commit_files(&output.stdout)?;
    if files.len() > MAX_COMMIT_FILE_CHANGES {
        return Err(commit_file_list_limit_error(
            field,
            &format!("{description} contains more than 20,000 files"),
        ));
    }
    Ok(files)
}

fn commit_file_list_limit_error(field: &str, message: &str) -> GitError {
    GitError::InvalidInput {
        field: field.to_string(),
        message: message.to_string(),
    }
}

fn retain_complete_blame_records(output: &mut Vec<u8>) {
    const FILENAME_PREFIX: &[u8] = b"\nfilename ";
    let Some(prefix_index) = output
        .windows(FILENAME_PREFIX.len())
        .rposition(|window| window == FILENAME_PREFIX)
    else {
        output.clear();
        return;
    };
    let filename_start = prefix_index + 1;
    let Some(line_end) = output[filename_start..]
        .iter()
        .position(|byte| *byte == b'\n')
    else {
        output.clear();
        return;
    };
    output.truncate(filename_start + line_end + 1);
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

fn branch_mutation_token(fields: &[&str]) -> String {
    mutation_token("asterlyn-branch-mutation-v1", fields)
}

fn mutation_token(prefix: &str, fields: &[&str]) -> String {
    let mut token = String::from(prefix);
    for field in fields {
        token.push('|');
        token.push_str(&field.len().to_string());
        token.push(':');
        token.push_str(field);
    }
    token
}

fn validate_remote_url(url: &str) -> Result<&str, GitError> {
    if url.is_empty() || url != url.trim() || url.len() > 4096 || url.contains(['\0', '\n', '\r']) {
        return Err(invalid_remote_mutation(
            "enter a non-empty literal remote URL",
        ));
    }
    Ok(url)
}

fn regex_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(
            character,
            '.' | '^' | '$' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn invalid_remote_mutation(message: &str) -> GitError {
    GitError::InvalidInput {
        field: "remote mutation".to_string(),
        message: message.to_string(),
    }
}

fn stale_remote_mutation(message: &str) -> GitError {
    GitError::UnsafeOperation {
        operation: "execute reviewed remote mutation".to_string(),
        message: format!("the reviewed remote plan is stale: {message}; prepare it again"),
        blockers: Vec::new(),
    }
}

fn invalid_git_reset(message: &str) -> GitError {
    GitError::InvalidInput {
        field: "reset target".to_string(),
        message: message.to_string(),
    }
}

fn stale_git_reset(message: &str) -> GitError {
    GitError::UnsafeOperation {
        operation: "execute reviewed reset".to_string(),
        message: format!("the reviewed reset plan is stale: {message}; prepare it again"),
        blockers: Vec::new(),
    }
}

fn stale_branch_plan(message: &str) -> GitError {
    GitError::UnsafeOperation {
        operation: "execute reviewed branch mutation".to_string(),
        message: format!("the reviewed branch plan is stale: {message}; prepare it again"),
        blockers: Vec::new(),
    }
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
    if let Some(start) = &query.start_commit {
        validate_repository_id(&start.repository_id)?;
        validate_object_id(&start.oid)?;
        if !query.refs.is_empty() {
            return Err(GitError::InvalidInput {
                field: "history start commit".to_string(),
                message: "cannot be combined with selected refs".to_string(),
            });
        }
        if !query.repository_ids.is_empty()
            && (query.repository_ids.len() != 1 || query.repository_ids[0] != start.repository_id)
        {
            return Err(GitError::InvalidInput {
                field: "history start commit".to_string(),
                message: "must use the same single repository root as the query".to_string(),
            });
        }
        if query
            .paths
            .iter()
            .any(|path| path.repository_id != start.repository_id)
        {
            return Err(GitError::InvalidInput {
                field: "history start commit".to_string(),
                message: "must use paths from the same repository root".to_string(),
            });
        }
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

    #[test]
    fn repository_slice_reads_do_not_populate_unrequested_model_groups() {
        let directory = fixture();
        fs::write(directory.path().join("tracked.txt"), "base\n").unwrap();
        git(directory.path(), &["add", "tracked.txt"]);
        git(directory.path(), &["commit", "-m", "base"]);
        fs::write(directory.path().join("tracked.txt"), "changed\n").unwrap();
        let repository = GitRepository::open(directory.path()).unwrap();

        let refs = repository
            .read_slices(
                RepositoryReadPlan {
                    refs: true,
                    ..RepositoryReadPlan::default()
                },
                150,
            )
            .unwrap();
        assert!(refs.branches.is_some());
        assert!(refs.remotes.is_some());
        assert!(refs.repository_roots.is_some());
        assert!(refs.branch.is_none());
        assert!(refs.changes.is_none());
        assert!(refs.commits.is_none());
        assert!(refs.operation.is_none());
        assert!(refs.untracked_state.is_none());
        let refs_trace = repository.take_read_trace();
        assert!(refs_trace.contains(&"read branches and tags".to_string()));
        assert!(refs_trace.contains(&"read remotes".to_string()));
        assert!(!refs_trace.iter().any(|operation| {
            operation.contains("working tree status") || operation.contains("commit history")
        }));

        let working = repository
            .read_slices(
                RepositoryReadPlan {
                    working_tree: true,
                    ..RepositoryReadPlan::default()
                },
                150,
            )
            .unwrap();
        assert_eq!(working.changes.unwrap().len(), 1);
        assert_eq!(working.untracked_state, Some(UntrackedState::Pending));
        assert!(working.branch.is_none());
        assert!(working.branches.is_none());
        assert!(working.commits.is_none());
        assert_eq!(
            repository.take_read_trace(),
            vec!["read tracked working tree status".to_string()]
        );

        let expected_branch = repository.tracked_snapshot(150).unwrap().branch;
        repository.take_read_trace();
        let head = repository
            .read_slices(
                RepositoryReadPlan {
                    head: true,
                    ..RepositoryReadPlan::default()
                },
                150,
            )
            .unwrap();
        assert_eq!(head.branch, Some(expected_branch));
        assert!(head.changes.is_none());
        assert!(head.branches.is_none());
        assert!(head.commits.is_none());
        assert!(
            !repository
                .take_read_trace()
                .iter()
                .any(|operation| operation.contains("working tree"))
        );

        let history = repository
            .read_slices(
                RepositoryReadPlan {
                    history: true,
                    ..RepositoryReadPlan::default()
                },
                150,
            )
            .unwrap();
        assert_eq!(history.commits.as_ref().map(Vec::len), Some(1));
        assert!(history.changes.is_none());
        assert!(
            !repository
                .take_read_trace()
                .iter()
                .any(|operation| operation.contains("working tree"))
        );

        let operation = repository
            .read_slices(
                RepositoryReadPlan {
                    operation: true,
                    ..RepositoryReadPlan::default()
                },
                150,
            )
            .unwrap();
        assert_eq!(operation.operation, Some(None));
        assert!(operation.changes.is_none());
        assert!(operation.branches.is_none());
        assert!(operation.commits.is_none());
    }

    #[test]
    fn background_status_does_not_write_the_index() {
        let directory = fixture();
        let path = directory.path().join("readme.md");
        fs::write(&path, "same content\n").unwrap();
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "base"]);
        // A changed inode with identical bytes needs a stat refresh in ordinary `git status`.
        let temporary = directory.path().join("replacement");
        fs::write(&temporary, "same content\n").unwrap();
        fs::rename(temporary, &path).unwrap();
        let index = directory.path().join(".git/index");
        let before = fs::read(&index).unwrap();
        let modified = fs::metadata(&index).unwrap().modified().unwrap();
        let repository = GitRepository::open(directory.path()).unwrap();
        for _ in 0..3 {
            assert!(repository.tracked_changes().unwrap().changes.is_empty());
        }
        assert_eq!(fs::read(&index).unwrap(), before);
        assert_eq!(fs::metadata(&index).unwrap().modified().unwrap(), modified);
    }

    #[test]
    fn stage_and_unstage_treat_pathspec_magic_literally() {
        let directory = fixture();
        let path = ":(glob)a*.txt";
        if cfg!(windows) {
            return;
        } // Windows does not allow this filename.
        fs::write(directory.path().join(path), "selected").unwrap();
        fs::write(directory.path().join("another.txt"), "unselected").unwrap();
        let repository = GitRepository::open(directory.path()).unwrap();
        repository.stage(&[path.into()]).unwrap();
        assert_eq!(git_stdout(directory.path(), &["ls-files"]), path);
        repository.unstage(&[path.into()]).unwrap();
        assert!(git_stdout(directory.path(), &["ls-files"]).is_empty());
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "base"]);
        fs::write(directory.path().join(path), "new selected").unwrap();
        fs::write(directory.path().join("another.txt"), "new unselected").unwrap();
        repository.stage(&[path.into()]).unwrap();
        repository.unstage(&[path.into()]).unwrap();
        assert!(git_stdout(directory.path(), &["diff", "--cached", "--name-only"]).is_empty());
    }

    #[test]
    fn catalog_stream_stops_at_record_and_path_budgets() {
        assert_eq!(
            read_catalog_stream(&b"b\0a\0c\0"[..], 2).unwrap(),
            (vec!["a".into(), "b".into()], true)
        );
        assert_eq!(
            read_catalog_stream(&b"a\0a\0"[..], 1).unwrap(),
            (vec!["a".into()], false)
        );
        assert!(
            read_catalog_stream(&vec![b'x'; 1_000_000][..], 100)
                .unwrap()
                .1
        );
    }

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

    fn git_succeeds(path: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .expect("git should start")
            .status
            .success()
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

        assert_eq!(
            scan.root,
            fs::canonicalize(directory.path())
                .unwrap()
                .to_string_lossy()
        );
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

        let exact_start = repository
            .query_commit_history(
                &HistoryQuery {
                    repository_ids: vec![".".to_string()],
                    start_commit: Some(crate::model::HistoryCommitStart {
                        repository_id: ".".to_string(),
                        oid: main.clone(),
                    }),
                    paths: vec![history_path("base.txt")],
                    ..HistoryQuery::default()
                },
                50,
            )
            .expect("exact-start history loads");
        assert_eq!(
            exact_start.first().map(|commit| commit.oid.as_str()),
            Some(root.as_str())
        );
        assert!(!exact_start.iter().any(|commit| commit.oid == merge_oid));

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
            HistoryQuery {
                refs: vec![history_ref("refs/heads/main")],
                start_commit: Some(crate::model::HistoryCommitStart {
                    repository_id: ".".to_string(),
                    oid: "a".repeat(40),
                }),
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

        assert!(
            repository
                .query_commit_history_page(&query, 3_001, 3)
                .expect("offsets beyond the legacy window remain valid")
                .commits
                .is_empty()
        );

        for (offset, limit) in [(100_001, 3), (0, 0), (0, 100_001)] {
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
                    workspace_path: "ignored-dir/cache.bin".to_string(),
                    kind: ProjectEntryKind::File,
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
        assert_eq!(
            repository
                .authorize_project_file_target(".", "missing.txt")
                .expect("a non-ignored missing target is authorized")
                .workspace_path,
            "missing.txt"
        );
        assert!(matches!(
            repository.authorize_project_file_target(".", "ignored.txt"),
            Err(GitError::InvalidInput { .. })
        ));

        let ignored = complete
            .files
            .iter()
            .find(|file| file.path == "ignored-dir/cache.bin")
            .expect("ignored directory descendant is catalogued")
            .clone();
        assert!(ignored.read_only);
        assert_eq!(
            repository
                .reauthorize_project_file_for_read(&ignored)
                .expect("catalogued ignored file passes read authorization"),
            ignored
        );
        assert!(matches!(
            repository.reauthorize_project_file(&ignored),
            Err(GitError::InvalidInput { .. })
        ));

        let cached_untracked = complete
            .files
            .iter()
            .find(|file| file.path == "untracked.txt")
            .expect("catalogued untracked file")
            .clone();
        assert_eq!(
            repository
                .reauthorize_project_file(&cached_untracked)
                .expect("catalogued file passes targeted authorization"),
            cached_untracked
        );
        fs::write(
            directory.path().join(".gitignore"),
            "ignored.txt\nignored-dir/\nuntracked.txt\n",
        )
        .expect("ignore policy changes");
        assert!(matches!(
            repository.reauthorize_project_file(&cached_untracked),
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
        assert_eq!(
            repository
                .authorize_project_file_target("modules/library", "missing.txt")
                .expect("child target is rooted in the initialized nested repository")
                .workspace_path,
            "modules/library/missing.txt"
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
    fn editable_working_diff_reads_the_exact_head_base() {
        let directory = fixture();
        commit_file(directory.path(), "editable.txt", "before\r\n", "Base");
        fs::write(directory.path().join("editable.txt"), "after\r\n").expect("working edit");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "editable.txt")
            .expect("editable change");

        let base = repository
            .working_diff_base(&selected, 1024)
            .expect("working Diff base");

        assert_eq!(base.path, "editable.txt");
        assert_eq!(base.bytes, b"before\n");
        assert!(base.head_oid.is_some());
        assert!(base.blob_oid.is_some());
    }

    #[test]
    fn editable_working_diff_uses_an_empty_base_for_untracked_files() {
        let directory = fixture();
        commit_file(directory.path(), "tracked.txt", "tracked\n", "Base");
        fs::write(directory.path().join("new.txt"), "new\n").expect("untracked file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let selected = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "new.txt")
            .expect("untracked change");

        let base = repository
            .working_diff_base(&selected, 1024)
            .expect("empty working Diff base");

        assert!(base.bytes.is_empty());
        assert!(base.blob_oid.is_none());
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
        let before_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
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
        let compared = repository
            .repository_commit_comparison_binary_diff(".", &before_oid, &oid, "image.png", None)
            .expect("commit comparison binary diff");
        assert_eq!(compared.before.as_deref(), Some(before.as_slice()));
        assert_eq!(compared.after.as_deref(), Some(after.as_slice()));
        assert!(matches!(
            repository.repository_commit_binary_diff(".", &oid, "other.png", None),
            Err(GitError::InvalidInput { .. })
        ));
    }

    #[test]
    fn revert_selected_restores_tracked_paths_and_staged_additions() {
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

        fs::write(directory.path().join("staged-new.txt"), "staged new\n")
            .expect("staged new file");
        git(directory.path(), &["add", "staged-new.txt"]);
        let staged_new = repository
            .snapshot(50)
            .expect("snapshot")
            .changes
            .into_iter()
            .find(|change| change.path == "staged-new.txt")
            .expect("staged addition");
        assert_eq!(staged_new.index_status, ChangeKind::Added);
        repository
            .revert_selected(&[staged_new])
            .expect("staged addition revert");
        assert!(!directory.path().join("staged-new.txt").exists());
        assert!(
            repository
                .snapshot(50)
                .expect("clean snapshot")
                .changes
                .is_empty()
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
    fn reads_bounded_blame_for_worktree_commits_and_root_parent() {
        let directory = fixture();
        fs::write(directory.path().join("source.txt"), "alpha\nbeta\n").expect("fixture file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        repository
            .stage(&["source.txt".to_string()])
            .expect("source stage");
        let root_oid = repository.commit("Root source").expect("root commit");

        fs::write(directory.path().join("source.txt"), "alpha\nchanged\n").expect("working edit");
        let worktree = repository
            .repository_blame(".", "source.txt", None, false)
            .expect("worktree blame");
        assert_eq!(worktree.repository_id, ".");
        assert!(worktree.revision.is_none());
        assert!(worktree.hunks.iter().any(|hunk| hunk.uncommitted));
        assert!(worktree.hunks.iter().any(|hunk| hunk.oid == root_oid));

        let committed = repository
            .repository_blame(".", "source.txt", Some(&root_oid), false)
            .expect("commit blame");
        assert_eq!(committed.revision.as_deref(), Some(root_oid.as_str()));
        assert_eq!(
            committed
                .hunks
                .iter()
                .map(|hunk| hunk.line_count)
                .sum::<u32>(),
            2
        );
        assert!(
            committed
                .hunks
                .iter()
                .all(|hunk| hunk.author_name == "Asterlyn Test")
        );

        let before_root = repository
            .repository_blame(".", "source.txt", Some(&root_oid), true)
            .expect("root parent blame");
        assert!(before_root.hunks.is_empty());
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
    fn rejects_partial_or_oversized_commit_file_lists() {
        let output = Command::new("git")
            .arg("--version")
            .output()
            .expect("git output fixture");
        assert!(matches!(
            parse_bounded_commit_files(output, true, "commit file list", "the file list"),
            Err(GitError::InvalidInput { .. })
        ));

        let mut output = Command::new("git")
            .arg("--version")
            .output()
            .expect("git output fixture");
        output.stdout = Vec::with_capacity((MAX_COMMIT_FILE_CHANGES + 1) * 18);
        for index in 0..=MAX_COMMIT_FILE_CHANGES {
            output.stdout.extend_from_slice(b"M\0");
            output
                .stdout
                .extend_from_slice(format!("file-{index:05}.txt").as_bytes());
            output.stdout.push(0);
        }
        assert!(matches!(
            parse_bounded_commit_files(output, false, "commit file list", "the file list"),
            Err(GitError::InvalidInput { .. })
        ));
    }

    #[test]
    fn reads_exact_post_commit_and_deleted_pre_commit_file_versions() {
        let directory = fixture();
        fs::write(directory.path().join("kept.txt"), "before\n").expect("kept fixture");
        fs::write(directory.path().join("removed.txt"), "removed\n").expect("removed fixture");
        fs::write(directory.path().join("old.txt"), "renamed\n").expect("rename fixture");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        repository
            .stage(&[
                "kept.txt".to_string(),
                "removed.txt".to_string(),
                "old.txt".to_string(),
            ])
            .expect("root files stage");
        let root_oid = repository.commit("Root").expect("root commit");

        fs::write(directory.path().join("kept.txt"), "after\n").expect("kept edit");
        fs::remove_file(directory.path().join("removed.txt")).expect("remove fixture");
        fs::rename(
            directory.path().join("old.txt"),
            directory.path().join("new.txt"),
        )
        .expect("rename fixture");
        repository
            .stage(&[
                "kept.txt".to_string(),
                "removed.txt".to_string(),
                "old.txt".to_string(),
                "new.txt".to_string(),
            ])
            .expect("changed files stage");
        let commit_oid = repository.commit("Change").expect("change commit");
        let details = repository
            .commit_details(&commit_oid)
            .expect("details load");

        let kept = details
            .files
            .iter()
            .find(|file| file.path == "kept.txt")
            .expect("kept change");
        let kept_version = repository
            .commit_file_version(&commit_oid, kept, MAX_BINARY_PREVIEW_BYTES)
            .expect("post-commit file version");
        assert_eq!(kept_version.commit_oid, commit_oid);
        assert_eq!(kept_version.revision_oid, commit_oid);
        assert_eq!(kept_version.source_path, "kept.txt");
        assert_eq!(kept_version.file_mode, "100644");
        assert_eq!(kept_version.bytes, b"after\n");

        let removed = details
            .files
            .iter()
            .find(|file| file.path == "removed.txt")
            .expect("removed change");
        let removed_version = repository
            .commit_file_version(&commit_oid, removed, MAX_BINARY_PREVIEW_BYTES)
            .expect("pre-commit deleted file version");
        assert_eq!(removed_version.revision_oid, root_oid);
        assert_eq!(removed_version.source_path, "removed.txt");
        assert_eq!(removed_version.bytes, b"removed\n");

        let renamed = details
            .files
            .iter()
            .find(|file| file.path == "new.txt")
            .expect("renamed change");
        let renamed_version = repository
            .commit_file_version(&commit_oid, renamed, MAX_BINARY_PREVIEW_BYTES)
            .expect("renamed post-commit file version");
        assert_eq!(renamed_version.revision_oid, commit_oid);
        assert_eq!(renamed_version.source_path, "new.txt");
        assert_eq!(renamed_version.bytes, b"renamed\n");

        assert!(matches!(
            repository.commit_file_version(&commit_oid, kept, 4),
            Err(GitError::InvalidInput { .. })
        ));
        assert!(matches!(
            repository.commit_file_version(
                &commit_oid,
                &CommitFileChange {
                    path: kept.path.clone(),
                    original_path: kept.original_path.clone(),
                    status: ChangeKind::Added,
                },
                MAX_BINARY_PREVIEW_BYTES,
            ),
            Err(GitError::InvalidInput { .. })
        ));
    }

    #[test]
    fn compares_exact_ancestor_and_divergent_commit_trees() {
        let directory = fixture();
        fs::write(directory.path().join("shared.txt"), "base\n").expect("base file");
        fs::write(directory.path().join("old-name.txt"), "rename me\n").expect("rename base");
        git(directory.path(), &["add", "shared.txt", "old-name.txt"]);
        git(directory.path(), &["commit", "-m", "Base"]);
        let base_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        git(directory.path(), &["branch", "side"]);

        fs::write(directory.path().join("shared.txt"), "main\n").expect("main file");
        fs::rename(
            directory.path().join("old-name.txt"),
            directory.path().join("new-name.txt"),
        )
        .expect("rename file");
        git(
            directory.path(),
            &["add", "shared.txt", "old-name.txt", "new-name.txt"],
        );
        git(directory.path(), &["commit", "-m", "Main"]);
        let main_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);

        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let ancestor = repository
            .commit_comparison_details(&base_oid, &main_oid)
            .expect("ancestor comparison");
        assert_eq!(ancestor.before_oid, base_oid);
        assert_eq!(ancestor.after_oid, main_oid);
        assert_eq!(
            ancestor.relation,
            CommitComparisonRelation::BeforeIsAncestor
        );
        let renamed = ancestor
            .files
            .iter()
            .find(|file| file.path == "new-name.txt")
            .expect("renamed file");
        assert_eq!(renamed.original_path.as_deref(), Some("old-name.txt"));
        let rename_diff = repository
            .commit_comparison_diff(
                &ancestor.before_oid,
                &ancestor.after_oid,
                &renamed.path,
                renamed.original_path.as_deref(),
            )
            .expect("rename comparison diff");
        assert!(rename_diff.patch.contains("rename from old-name.txt"));
        assert!(rename_diff.patch.contains("rename to new-name.txt"));
        assert!(matches!(
            repository.commit_comparison_diff(
                &ancestor.before_oid,
                &ancestor.after_oid,
                "not-selected.txt",
                None,
            ),
            Err(GitError::InvalidInput { .. })
        ));

        git(directory.path(), &["checkout", "side"]);
        fs::write(directory.path().join("shared.txt"), "side\n").expect("side file");
        git(directory.path(), &["add", "shared.txt"]);
        git(directory.path(), &["commit", "-m", "Side"]);
        let side_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        let divergent = repository
            .commit_comparison_details(&main_oid, &side_oid)
            .expect("divergent comparison");
        assert_eq!(divergent.relation, CommitComparisonRelation::Divergent);
        let shared = divergent
            .files
            .iter()
            .find(|file| file.path == "shared.txt")
            .expect("shared divergent file");
        let divergent_diff = repository
            .commit_comparison_diff(&main_oid, &side_oid, &shared.path, None)
            .expect("divergent file diff");
        assert!(divergent_diff.patch.contains("-main"));
        assert!(divergent_diff.patch.contains("+side"));
        assert!(matches!(
            repository.commit_comparison_details(&main_oid, &main_oid),
            Err(GitError::InvalidInput { .. })
        ));
        assert!(matches!(
            repository.commit_comparison_details("HEAD", &side_oid),
            Err(GitError::InvalidInput { .. })
        ));
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
    fn reviewed_branch_creation_uses_the_selected_object_instead_of_head() {
        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        git(directory.path(), &["branch", "source"]);
        commit_file(directory.path(), "main.txt", "main\n", "Main only");
        let source_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/source"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let request = BranchMutationRequest {
            kind: BranchMutationKind::Create,
            source_full_name: "refs/heads/source".to_string(),
            source_oid: source_oid.clone(),
            new_name: Some("feature/from-source".to_string()),
            delete_remote: false,
        };
        let plan = repository
            .prepare_branch_mutation(&request)
            .expect("branch plan");
        assert_eq!(plan.source_kind, BranchMutationSourceKind::Local);
        assert_eq!(plan.start_head_ref, "refs/heads/main");
        repository
            .execute_branch_mutation(&plan)
            .expect("execute branch plan");
        assert_eq!(
            git_stdout(directory.path(), &["branch", "--show-current"]),
            "feature/from-source"
        );
        assert_eq!(
            git_stdout(directory.path(), &["rev-parse", "HEAD"]),
            source_oid
        );
        assert!(
            repository
                .read_references()
                .unwrap()
                .into_iter()
                .find(|branch| branch.full_name == "refs/heads/feature/from-source")
                .is_some_and(|branch| branch.upstream.is_none())
        );
    }

    #[test]
    fn reviewed_remote_checkout_sets_the_exact_upstream() {
        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        let source_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        git(
            directory.path(),
            &[
                "remote",
                "add",
                "origin",
                "https://example.invalid/repository.git",
            ],
        );
        git(
            directory.path(),
            &["update-ref", "refs/remotes/origin/topic", &source_oid],
        );
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let request = BranchMutationRequest {
            kind: BranchMutationKind::CheckoutRemote,
            source_full_name: "refs/remotes/origin/topic".to_string(),
            source_oid,
            new_name: Some("topic".to_string()),
            delete_remote: false,
        };
        let plan = repository
            .prepare_branch_mutation(&request)
            .expect("remote checkout plan");
        repository
            .execute_branch_mutation(&plan)
            .expect("execute remote checkout");
        assert_eq!(
            git_stdout(directory.path(), &["branch", "--show-current"]),
            "topic"
        );
        assert_eq!(
            git_stdout(
                directory.path(),
                &["rev-parse", "--abbrev-ref", "@{upstream}"]
            ),
            "origin/topic"
        );
    }

    #[test]
    fn reviewed_rename_and_delete_revalidate_refs_and_keep_remote_refs() {
        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        let oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        git(directory.path(), &["branch", "old-name"]);
        git(
            directory.path(),
            &["update-ref", "refs/remotes/origin/old-name", &oid],
        );
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let rename = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                kind: BranchMutationKind::Rename,
                source_full_name: "refs/heads/old-name".to_string(),
                source_oid: oid.clone(),
                new_name: Some("new-name".to_string()),
                delete_remote: false,
            })
            .expect("rename plan");
        repository
            .execute_branch_mutation(&rename)
            .expect("rename branch");
        assert_eq!(
            git_stdout(directory.path(), &["rev-parse", "refs/heads/new-name"]),
            oid
        );

        let delete = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                kind: BranchMutationKind::Delete,
                source_full_name: "refs/heads/new-name".to_string(),
                source_oid: oid.clone(),
                new_name: None,
                delete_remote: false,
            })
            .expect("delete plan");
        assert_eq!(delete.merged_into_current, Some(true));
        repository
            .execute_branch_mutation(&delete)
            .expect("delete branch");
        assert!(!repository.reference_exists("refs/heads/new-name").unwrap());
        assert!(
            repository
                .reference_exists("refs/remotes/origin/old-name")
                .unwrap()
        );
    }

    #[test]
    fn reviewed_branch_deletion_can_delete_the_exact_remote_upstream() {
        let directory = fixture();
        let remote = tempfile::tempdir().unwrap();
        git(remote.path(), &["init", "--bare"]);
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        let oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        git(directory.path(), &["branch", "topic"]);
        git(
            directory.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );
        git(directory.path(), &["push", "origin", "main"]);
        git(
            directory.path(),
            &["push", "--set-upstream", "origin", "topic"],
        );

        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let plan = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                kind: BranchMutationKind::Delete,
                source_full_name: "refs/heads/topic".to_string(),
                source_oid: oid,
                new_name: None,
                delete_remote: true,
            })
            .expect("remote deletion plan");
        let target = plan.remote_deletion.as_ref().expect("exact remote target");
        assert_eq!(target.remote, "origin");
        assert_eq!(target.branch_full_name, "refs/heads/topic");
        repository
            .execute_branch_mutation_with_remote(&plan, &CancellationToken::new())
            .expect("delete exact local and remote branches");
        assert!(!repository.reference_exists("refs/heads/topic").unwrap());
        assert!(!git_succeeds(
            remote.path(),
            &["show-ref", "--verify", "--quiet", "refs/heads/topic"]
        ));
    }

    #[test]
    fn reviewed_remote_branch_deletion_lease_rejects_server_movement() {
        let directory = fixture();
        let remote = tempfile::tempdir().unwrap();
        git(remote.path(), &["init", "--bare"]);
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        let topic_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        git(directory.path(), &["branch", "topic"]);
        git(
            directory.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );
        git(directory.path(), &["push", "origin", "main"]);
        git(
            directory.path(),
            &["push", "--set-upstream", "origin", "topic"],
        );
        commit_file(directory.path(), "main.txt", "main\n", "Main moves");
        let moved_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        git(directory.path(), &["push", "origin", "main"]);

        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let plan = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                kind: BranchMutationKind::Delete,
                source_full_name: "refs/heads/topic".to_string(),
                source_oid: topic_oid,
                new_name: None,
                delete_remote: true,
            })
            .expect("remote deletion plan");
        git(
            remote.path(),
            &["update-ref", "refs/heads/topic", &moved_oid],
        );
        assert!(matches!(
            repository.execute_branch_mutation_with_remote(&plan, &CancellationToken::new()),
            Err(GitError::RemoteFailed { .. })
        ));
        assert!(repository.reference_exists("refs/heads/topic").unwrap());
        assert_eq!(
            git_stdout(remote.path(), &["rev-parse", "refs/heads/topic"]),
            moved_oid
        );
    }

    #[test]
    fn reviewed_branch_plans_reject_stale_unmerged_and_linked_worktree_targets() {
        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        git(directory.path(), &["branch", "stale"]);
        let stale_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/stale"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let switch = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                kind: BranchMutationKind::Switch,
                source_full_name: "refs/heads/stale".to_string(),
                source_oid: stale_oid.clone(),
                new_name: None,
                delete_remote: false,
            })
            .expect("switch plan");
        git(
            directory.path(),
            &["update-ref", "refs/heads/stale", "HEAD", &stale_oid],
        );
        commit_file(directory.path(), "later.txt", "later\n", "Later");
        git(
            directory.path(),
            &["update-ref", "refs/heads/stale", "HEAD", &stale_oid],
        );
        assert!(matches!(
            repository.execute_branch_mutation(&switch),
            Err(GitError::UnsafeOperation { .. })
        ));

        git(directory.path(), &["switch", "stale"]);
        commit_file(directory.path(), "side.txt", "side\n", "Side");
        let side_oid = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        git(directory.path(), &["switch", "main"]);
        let unmerged = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                kind: BranchMutationKind::Delete,
                source_full_name: "refs/heads/stale".to_string(),
                source_oid: side_oid,
                new_name: None,
                delete_remote: false,
            })
            .expect_err("unmerged deletion is blocked");
        assert!(unmerged.to_string().contains("already merged"));

        git(directory.path(), &["branch", "linked"]);
        let linked_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/linked"]);
        let linked_root = tempfile::tempdir().unwrap();
        let linked_path = linked_root.path().join("checkout");
        git(
            directory.path(),
            &["worktree", "add", linked_path.to_str().unwrap(), "linked"],
        );
        let linked = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                kind: BranchMutationKind::Delete,
                source_full_name: "refs/heads/linked".to_string(),
                source_oid: linked_oid,
                new_name: None,
                delete_remote: false,
            })
            .expect_err("linked worktree deletion is blocked");
        assert!(linked.to_string().contains("another Git worktree"));
    }

    #[test]
    fn reviewed_remote_mutations_add_edit_rename_and_delete_exact_configuration() {
        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        git(first.path(), &["init", "--bare"]);
        git(second.path(), &["init", "--bare"]);
        let first_url = first.path().to_string_lossy().into_owned();
        let second_url = second.path().to_string_lossy().into_owned();
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        let add = repository
            .prepare_remote_mutation(&RemoteMutationRequest {
                kind: RemoteMutationKind::Add,
                source_name: None,
                name: "origin".to_string(),
                url: Some(first_url.clone()),
            })
            .expect("add plan");
        repository
            .execute_remote_mutation(&add)
            .expect("add reviewed remote");
        assert_eq!(
            repository
                .remote_summaries()
                .unwrap()
                .into_iter()
                .find(|remote| remote.name == "origin")
                .and_then(|remote| remote.url),
            Some(first_url)
        );

        let edit = repository
            .prepare_remote_mutation(&RemoteMutationRequest {
                kind: RemoteMutationKind::Edit,
                source_name: Some("origin".to_string()),
                name: "upstream".to_string(),
                url: Some(second_url.clone()),
            })
            .expect("edit plan");
        repository
            .execute_remote_mutation(&edit)
            .expect("edit reviewed remote");
        let remotes = repository.remote_summaries().unwrap();
        assert!(!remotes.iter().any(|remote| remote.name == "origin"));
        assert_eq!(
            remotes
                .iter()
                .find(|remote| remote.name == "upstream")
                .and_then(|remote| remote.url.as_deref()),
            Some(second_url.as_str())
        );

        let delete = repository
            .prepare_remote_mutation(&RemoteMutationRequest {
                kind: RemoteMutationKind::Delete,
                source_name: Some("upstream".to_string()),
                name: "upstream".to_string(),
                url: None,
            })
            .expect("delete plan");
        repository
            .execute_remote_mutation(&delete)
            .expect("delete reviewed remote");
        assert!(repository.remote_summaries().unwrap().is_empty());
    }

    #[test]
    fn reviewed_remote_mutation_rejects_configuration_changed_after_review() {
        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        git(
            directory.path(),
            &["remote", "add", "origin", "https://example.invalid/one.git"],
        );
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let plan = repository
            .prepare_remote_mutation(&RemoteMutationRequest {
                kind: RemoteMutationKind::Edit,
                source_name: Some("origin".to_string()),
                name: "origin".to_string(),
                url: Some("https://example.invalid/two.git".to_string()),
            })
            .expect("edit plan");
        git(
            directory.path(),
            &[
                "remote",
                "set-url",
                "origin",
                "https://example.invalid/moved.git",
            ],
        );
        assert!(matches!(
            repository.execute_remote_mutation(&plan),
            Err(GitError::UnsafeOperation { .. })
        ));
    }

    #[test]
    fn reviewed_reset_modes_apply_their_distinct_index_and_worktree_semantics() {
        for mode in [GitResetMode::Soft, GitResetMode::Mixed, GitResetMode::Hard] {
            let directory = fixture();
            let base = commit_file(directory.path(), "tracked.txt", "base\n", "Base");
            commit_file(directory.path(), "tracked.txt", "tip\n", "Tip");
            let repository = GitRepository::open(directory.path()).expect("repository opens");
            let plan = repository.prepare_git_reset(&base).expect("reset plan");
            repository
                .execute_git_reset(&plan, mode)
                .expect("execute reviewed reset");
            assert_eq!(git_stdout(directory.path(), &["rev-parse", "HEAD"]), base);
            match mode {
                GitResetMode::Soft => {
                    assert_eq!(
                        fs::read_to_string(directory.path().join("tracked.txt")).unwrap(),
                        "tip\n"
                    );
                    assert!(!git_succeeds(
                        directory.path(),
                        &["diff", "--cached", "--quiet"]
                    ));
                }
                GitResetMode::Mixed => {
                    assert_eq!(
                        fs::read_to_string(directory.path().join("tracked.txt")).unwrap(),
                        "tip\n"
                    );
                    assert!(git_succeeds(
                        directory.path(),
                        &["diff", "--cached", "--quiet"]
                    ));
                    assert!(!git_succeeds(directory.path(), &["diff", "--quiet"]));
                }
                GitResetMode::Hard => {
                    assert_eq!(
                        fs::read_to_string(directory.path().join("tracked.txt")).unwrap(),
                        "base\n"
                    );
                    assert!(git_succeeds(directory.path(), &["diff", "--quiet"]));
                }
                GitResetMode::Keep => unreachable!(),
            }
        }
    }

    #[test]
    fn reviewed_keep_reset_preserves_compatible_local_changes() {
        let directory = fixture();
        fs::write(directory.path().join("stable.txt"), "stable\n").unwrap();
        fs::write(directory.path().join("moving.txt"), "base\n").unwrap();
        git(directory.path(), &["add", "stable.txt", "moving.txt"]);
        git(directory.path(), &["commit", "-m", "Base"]);
        let base = git_stdout(directory.path(), &["rev-parse", "HEAD"]);
        commit_file(directory.path(), "moving.txt", "tip\n", "Tip");
        fs::write(directory.path().join("stable.txt"), "local\n").unwrap();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let plan = repository.prepare_git_reset(&base).expect("reset plan");
        repository
            .execute_git_reset(&plan, GitResetMode::Keep)
            .expect("keep reset");
        assert_eq!(
            fs::read_to_string(directory.path().join("moving.txt")).unwrap(),
            "base\n"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("stable.txt")).unwrap(),
            "local\n"
        );
    }

    #[test]
    fn reset_review_rejects_a_commit_outside_the_current_branch() {
        let directory = fixture();
        commit_file(directory.path(), "base.txt", "base\n", "Base");
        git(directory.path(), &["switch", "-c", "side"]);
        let side = commit_file(directory.path(), "side.txt", "side\n", "Side");
        git(directory.path(), &["switch", "main"]);
        commit_file(directory.path(), "main.txt", "main\n", "Main");
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        assert!(matches!(
            repository.prepare_git_reset(&side),
            Err(GitError::InvalidInput { .. })
        ));
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
    fn snapshots_remote_capabilities_and_configured_urls() {
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
                url: Some(fixture.remote.to_string_lossy().into_owned()),
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
    fn marks_only_commits_ahead_of_the_current_upstream_as_outgoing() {
        let fixture = remote_fixture();
        let local_oid = commit_file(&fixture.local, "local.txt", "local\n", "Local only");
        let repository = GitRepository::open(&fixture.local).expect("repository opens");

        let snapshot = repository
            .tracked_snapshot(10)
            .expect("tracked snapshot loads");
        assert!(
            snapshot
                .commits
                .iter()
                .find(|commit| commit.oid == local_oid)
                .expect("local commit is present")
                .outgoing
        );
        assert!(snapshot.commits.iter().any(|commit| !commit.outgoing));

        git(&fixture.local, &["push", "origin", "main"]);
        let pushed = repository
            .tracked_snapshot(10)
            .expect("pushed snapshot loads");
        assert!(pushed.commits.iter().all(|commit| !commit.outgoing));
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
        assert_eq!(
            first_page
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["first.txt", "second.txt"]
        );
        let file_commit = repository
            .push_file_commit(
                "origin",
                PushTagMode::None,
                &first_page.preview_token,
                "second.txt",
            )
            .expect("pushed file commit lookup succeeds")
            .expect("outgoing file has a commit");
        assert_eq!(file_commit.oid, second_oid);

        let second_page = repository
            .push_preview("origin", 1, 1)
            .expect("second push preview page loads");
        assert_eq!(second_page.preview_token, first_page.preview_token);
        assert_eq!(second_page.commits[0].subject, "First outgoing");
        assert!(!second_page.has_more);

        let backup = fixture._directory.path().join("backup.git");
        let backup_path = backup.to_string_lossy().into_owned();
        git(fixture._directory.path(), &["init", "--bare", &backup_path]);
        git(&fixture.local, &["remote", "add", "backup", &backup_path]);
        let backup_preview = repository
            .push_preview("backup", 0, 1)
            .expect("a tracked branch can explicitly target another remote");
        assert_eq!(backup_preview.remote, "backup");
        assert_eq!(backup_preview.destination_ref, "refs/heads/main");
        assert!(backup_preview.publish);
        assert_ne!(backup_preview.preview_token, first_page.preview_token);
        repository
            .push_current_confirmed(
                "backup",
                &backup_preview.preview_token,
                &CancellationToken::new(),
            )
            .expect("alternate remote push succeeds");
        assert_eq!(
            git_stdout(&backup, &["rev-parse", "refs/heads/main"]),
            second_oid
        );
        assert_eq!(
            git_stdout(
                &fixture.local,
                &["rev-parse", "--abbrev-ref", "@{upstream}"]
            ),
            "origin/main"
        );

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
    fn divergent_push_requires_explicit_force_with_exact_lease() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        let local_oid = commit_file(&fixture.local, "local.txt", "local\n", "Local outgoing");
        commit_file(&fixture.peer, "remote.txt", "remote\n", "Remote outgoing");
        git(&fixture.peer, &["push", "origin", "main"]);
        repository
            .fetch_remote("origin", &CancellationToken::new())
            .expect("fetch observes divergence");

        let preview = repository
            .push_preview("origin", 0, 100)
            .expect("divergent branch can be reviewed");
        assert!(!preview.ordinary_allowed);
        assert!(preview.force_with_lease_allowed);
        assert_eq!(preview.total_commits, 1);
        assert!(preview.files.iter().any(|file| file.path == "local.txt"));
        assert!(preview.files.iter().any(|file| file.path == "remote.txt"));

        let ordinary = repository
            .push_current_with_options(
                "origin",
                PushMode::Ordinary,
                PushTagMode::None,
                &preview.preview_token,
                &CancellationToken::new(),
            )
            .expect_err("ordinary divergent push is blocked before Git writes");
        assert!(matches!(ordinary, GitError::UnsafeOperation { .. }));

        repository
            .push_current_with_options(
                "origin",
                PushMode::ForceWithLease,
                PushTagMode::None,
                &preview.preview_token,
                &CancellationToken::new(),
            )
            .expect("explicit exact-lease force push succeeds");
        assert_eq!(
            git_stdout(&fixture.remote, &["rev-parse", "refs/heads/main"]),
            local_oid
        );
    }

    #[test]
    fn force_lease_rejects_remote_movement_and_tag_scope_is_explicit() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        let base_oid = git_stdout(&fixture.local, &["rev-parse", "HEAD"]);
        let local_oid = commit_file(&fixture.local, "local.txt", "local\n", "Local outgoing");
        git(&fixture.local, &["tag", "base-tag", &base_oid]);
        git(&fixture.local, &["tag", "head-tag", &local_oid]);
        git(&fixture.local, &["checkout", "-b", "side", &base_oid]);
        let side_oid = commit_file(&fixture.local, "side.txt", "side\n", "Side commit");
        git(&fixture.local, &["tag", "side-tag", &side_oid]);
        git(&fixture.local, &["checkout", "main"]);

        let current_tags = repository
            .push_preview_with_tags("origin", PushTagMode::CurrentBranch, 0, 100)
            .expect("current branch tags load");
        assert_eq!(
            current_tags
                .tags
                .iter()
                .map(|tag| tag.name.as_str())
                .collect::<Vec<_>>(),
            ["base-tag", "head-tag"]
        );
        let all_tags = repository
            .push_preview_with_tags("origin", PushTagMode::All, 0, 100)
            .expect("all tags load");
        assert_eq!(all_tags.tags.len(), 3);
        assert_ne!(current_tags.preview_token, all_tags.preview_token);

        let remote_oid = commit_file(&fixture.peer, "remote.txt", "remote\n", "Remote movement");
        git(&fixture.peer, &["push", "origin", "main"]);
        let rejected = repository
            .push_current_with_options(
                "origin",
                PushMode::ForceWithLease,
                PushTagMode::CurrentBranch,
                &current_tags.preview_token,
                &CancellationToken::new(),
            )
            .expect_err("exact lease rejects a remote that moved after review");
        assert!(matches!(rejected, GitError::RemoteFailed { .. }));
        assert_eq!(
            git_stdout(&fixture.remote, &["rev-parse", "refs/heads/main"]),
            remote_oid
        );
        assert!(git_stdout(&fixture.remote, &["tag", "--list"]).is_empty());

        repository
            .fetch_remote("origin", &CancellationToken::new())
            .expect("refresh exact lease after rejection");
        let retry = repository
            .push_preview_with_tags("origin", PushTagMode::CurrentBranch, 0, 100)
            .expect("fresh tagged force review loads");
        repository
            .push_current_with_options(
                "origin",
                PushMode::ForceWithLease,
                PushTagMode::CurrentBranch,
                &retry.preview_token,
                &CancellationToken::new(),
            )
            .expect("atomic branch and current-branch tag push succeeds");
        assert_eq!(
            git_stdout(&fixture.remote, &["tag", "--list"]),
            "base-tag\nhead-tag"
        );
        assert_eq!(
            git_stdout(&fixture.remote, &["rev-parse", "refs/heads/main"]),
            local_oid
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
            set_upstream_after_push: false,
        };
        let first = common("one|refs", "heads/main");
        let second = common("one", "refs|heads/main");
        assert_ne!(push_preview_token(&first), push_preview_token(&second));
    }

    #[test]
    fn remote_authentication_preflight_detects_missing_and_stored_https_credentials() {
        let fixture = remote_fixture();
        let credential_file = fixture._directory.path().join("credentials");
        let helper = format!("store --file={}", credential_file.to_string_lossy());
        git(
            &fixture.local,
            &[
                "remote",
                "set-url",
                "origin",
                "https://example.invalid/owner/repository.git",
            ],
        );
        git(&fixture.local, &["config", "credential.helper", ""]);
        let repository = GitRepository::open(&fixture.local).expect("repository opens");

        let missing = repository
            .remote_authentication_status("origin")
            .expect("credential preflight completes without prompting");
        assert_eq!(missing.transport, RemoteTransport::Https);
        assert_eq!(missing.host.as_deref(), Some("example.invalid"));
        assert!(!missing.credential_available);
        assert!(!missing.credential_helper_configured);
        assert_eq!(
            missing.suggested_ssh_url.as_deref(),
            Some("git@example.invalid:owner/repository.git")
        );

        git(&fixture.local, &["config", "credential.helper", &helper]);
        let stored = repository
            .store_remote_https_credential("origin", "developer", "test-token")
            .expect("configured helper stores the token");
        assert!(stored.credential_available);
        assert!(stored.credential_helper_configured);
    }

    #[test]
    fn remote_authentication_configures_only_an_explicit_ssh_push_url() {
        let fixture = remote_fixture();
        let repository = GitRepository::open(&fixture.local).expect("repository opens");
        let invalid = repository
            .configure_remote_ssh("origin", "https://example.invalid/owner/repository.git")
            .expect_err("HTTPS is not accepted as an SSH route");
        assert!(matches!(invalid, GitError::InvalidInput { .. }));

        let status = repository
            .configure_remote_ssh("origin", "git@example.invalid:owner/repository.git")
            .expect("explicit SSH push URL is configured");
        assert_eq!(status.transport, RemoteTransport::Ssh);
        assert_eq!(status.host.as_deref(), Some("example.invalid"));
        assert_eq!(
            git_stdout(&fixture.local, &["remote", "get-url", "--push", "origin"]),
            "git@example.invalid:owner/repository.git"
        );
    }

    #[test]
    fn remote_endpoint_parsing_never_exposes_https_secrets() {
        let endpoint = parse_remote_endpoint(
            "https://developer:secret@example.invalid:8443/owner/repository.git?query=ignored",
        );
        assert_eq!(endpoint.transport, RemoteTransport::Https);
        assert_eq!(endpoint.username.as_deref(), Some("developer"));
        assert_eq!(endpoint.host.as_deref(), Some("example.invalid:8443"));
        assert_eq!(endpoint.path.as_deref(), Some("owner/repository.git"));
        assert_eq!(
            endpoint.suggested_ssh_url.as_deref(),
            Some("ssh://git@example.invalid:8443/owner/repository.git")
        );
        assert!(!format!("{endpoint:?}").contains("secret"));
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
