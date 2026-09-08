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
    ChangeKind, CommitDetails, CommitDiffResult, CommitFileChange, DiffResult, FileChange,
    RemoteSummary, RepositorySnapshot, UntrackedScan, UntrackedState,
};
use crate::parser::{parse_branches, parse_commits, parse_status};

const DIFF_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const REMOTE_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(2);

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

#[derive(Debug, Clone)]
pub struct GitRepository {
    root: PathBuf,
    git_dir: PathBuf,
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

        let commits = if branch.unborn {
            Vec::new()
        } else {
            let limit = commit_limit.clamp(1, 500).to_string();
            let output = self.run_read_owned(
                "read commit history",
                vec![
                    OsString::from("log"),
                    OsString::from("--all"),
                    OsString::from("--decorate=short"),
                    OsString::from(format!("--max-count={limit}")),
                    OsString::from("--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e"),
                ],
            )?;
            parse_commits(&output.stdout)?
        };

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
        let remotes = self.remote_summaries()?;

        Ok(RepositorySnapshot {
            root: self.root.to_string_lossy().into_owned(),
            git_dir: self.git_dir.to_string_lossy().into_owned(),
            branch,
            operation: self.detect_operation(),
            changes,
            commits,
            branches: parse_branches(&refs.stdout)?,
            remotes,
            untracked_state: UntrackedState::Pending,
        })
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
            oid: oid.to_string(),
            parent_oid,
            files: parse_commit_files(&output.stdout)?,
        })
    }

    pub fn commit_diff(
        &self,
        oid: &str,
        path: &str,
        original_path: Option<&str>,
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
                OsString::from("--unified=3"),
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
                OsString::from("--unified=3"),
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

        let output = self.run_read_owned("read commit file diff", args)?;
        let mut patch = output.stdout;
        let binary = patch.windows(15).any(|window| window == b"Binary files ");
        let truncated = patch.len() > DIFF_LIMIT_BYTES;
        if truncated {
            patch.truncate(DIFF_LIMIT_BYTES);
            patch.extend_from_slice(b"\n\n[Diff truncated at 4 MiB]\n");
        }

        Ok(CommitDiffResult {
            oid: oid.to_string(),
            path: path.to_string(),
            patch: String::from_utf8_lossy(&patch).into_owned(),
            binary,
            truncated,
        })
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

    pub fn push_current(
        &self,
        remote: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        self.ensure_no_repository_operation("push")?;
        let context = self.current_branch_context("push")?;
        let configured_remote = self.validated_remote(remote, true)?;
        let (destination, publish) = match context.upstream.as_ref() {
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
                (upstream.merge_ref.clone(), false)
            }
            None => (context.full_ref.clone(), true),
        };

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
        let before_push = self.current_branch_context("push")?;
        if before_push != context {
            return Err(GitError::UnsafeOperation {
                operation: "push".to_string(),
                message: "branch or upstream state changed before push; refresh before retrying"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        self.validated_remote(&configured_remote.name, true)?;
        if publish {
            args.push(OsString::from("--set-upstream"));
        }
        args.extend([
            OsString::from("--"),
            OsString::from(&configured_remote.name),
            OsString::from(format!("{}:{destination}", context.full_ref)),
        ]);
        self.run_remote_operation(
            "push",
            &configured_remote.name,
            args,
            cancellation,
            true,
            true,
        )?;
        Ok(())
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
        let output = run_git_output(&self.root, ["show-ref", "--verify", "--quiet", full_name])
            .map_err(|error| GitError::Io {
                operation: "verify local branch".to_string(),
                message: error.to_string(),
            })?;
        match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => Err(GitError::CommandFailed {
                operation: "verify local branch".to_string(),
                status: output.status.code(),
                message: sanitize_stderr(&output.stderr, "could not verify local branch"),
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

fn read_stream(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn read_stream_bounded(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    let mut retained = Vec::new();
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let remaining = REMOTE_OUTPUT_LIMIT_BYTES.saturating_sub(retained.len());
        retained.extend_from_slice(&buffer[..count.min(remaining)]);
    }
    Ok(retained)
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

fn validate_relative_path(path: &str) -> Result<(), GitError> {
    let candidate = Path::new(path);
    if path.is_empty() || path.contains('\0') || candidate.is_absolute() {
        return Err(GitError::InvalidInput {
            field: "path".to_string(),
            message: "the path must be repository-relative".to_string(),
        });
    }
    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(GitError::InvalidInput {
            field: "path".to_string(),
            message: "parent-directory traversal is not allowed".to_string(),
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
        repository
            .push_current("origin", &CancellationToken::new())
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
        repository
            .push_current("origin", &CancellationToken::new())
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
            .push_current("origin", &CancellationToken::new())
            .expect_err("mirror remote is rejected");
        assert!(matches!(mirror, GitError::InvalidInput { .. }));
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
            .push_current("origin", &CancellationToken::new())
            .expect_err("detached HEAD cannot be pushed implicitly");
        assert!(matches!(detached, GitError::UnsafeOperation { .. }));
    }
}
