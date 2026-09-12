use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};

use crate::CancellationToken;
use crate::GitRepository;
use crate::error::GitError;
use crate::model::{
    GitConflictContent, GitConflictFile, GitOperationAction, GitOperationKind, GitOperationPhase,
    GitOperationPlan, GitOperationProgress, GitOperationSnapshot,
};

const MAX_OPERATION_TARGETS: usize = 100;
const MAX_OPERATION_MESSAGE_BYTES: usize = 64 * 1024;
const MAX_CONFLICT_TEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SQUASH_COMMITS: usize = 1_000;

impl GitRepository {
    /// Reconstructs the active multi-step operation from Git-owned metadata and index stages.
    pub fn operation_snapshot(&self) -> Result<Option<GitOperationSnapshot>, GitError> {
        let Some(kind) = detect_operation_kind(self.git_directory()) else {
            return Ok(None);
        };
        let conflicts = self.operation_conflicts()?;
        let original_head_oid = operation_original_head(self.git_directory(), kind)
            .or_else(|| read_oid_file(&self.git_directory().join("ORIG_HEAD")));
        let current_head_oid = self.resolve_optional_commit("HEAD")?;
        let head_ref = self.symbolic_head_optional()?;
        let target_oids = operation_targets(self.git_directory(), kind);
        let progress = operation_progress(self.git_directory(), kind);
        let allowed_actions = allowed_actions(kind, conflicts.is_empty());
        Ok(Some(GitOperationSnapshot {
            kind,
            phase: if conflicts.is_empty() {
                GitOperationPhase::Paused
            } else {
                GitOperationPhase::Conflicted
            },
            original_head_oid,
            current_head_oid,
            head_ref,
            target_oids,
            conflicts,
            progress,
            allowed_actions,
        }))
    }

    pub fn prepare_merge(&self, target_ref: &str) -> Result<GitOperationPlan, GitError> {
        self.prepare_operation(GitOperationKind::Merge, &[target_ref.to_string()], None)
    }

    pub fn prepare_cherry_pick(
        &self,
        target_refs: &[String],
    ) -> Result<GitOperationPlan, GitError> {
        self.prepare_operation(GitOperationKind::CherryPick, target_refs, None)
    }

    pub fn prepare_rebase(&self, upstream_ref: &str) -> Result<GitOperationPlan, GitError> {
        self.prepare_operation(GitOperationKind::Rebase, &[upstream_ref.to_string()], None)
    }

    pub fn prepare_squash(
        &self,
        base_ref: &str,
        message: &str,
    ) -> Result<GitOperationPlan, GitError> {
        self.prepare_operation(
            GitOperationKind::Squash,
            &[base_ref.to_string()],
            Some(message.to_string()),
        )
    }

    pub fn execute_operation_plan(
        &self,
        plan: &GitOperationPlan,
    ) -> Result<Option<GitOperationSnapshot>, GitError> {
        self.execute_operation_plan_with_cancellation(plan, &CancellationToken::new())
    }

    /// Executes a reviewed plan only if cancellation has not been requested before mutation.
    ///
    /// Cancellation is deliberately checked before, and again after, read-only revalidation. Once
    /// system Git starts mutating repository state, callers must reconcile instead of interrupting
    /// or retrying the command.
    pub fn execute_operation_plan_with_cancellation(
        &self,
        plan: &GitOperationPlan,
        cancellation: &CancellationToken,
    ) -> Result<Option<GitOperationSnapshot>, GitError> {
        reject_prestart_cancellation(plan.kind, cancellation)?;
        if plan.repository_root != self.root().to_string_lossy() {
            return Err(stale_plan(
                "the reviewed plan belongs to another repository",
            ));
        }
        let refreshed = match plan.kind {
            GitOperationKind::Merge => self.prepare_merge(single_target(plan)?)?,
            GitOperationKind::CherryPick => self.prepare_cherry_pick(&plan.target_refs)?,
            GitOperationKind::Rebase => self.prepare_rebase(single_target(plan)?)?,
            GitOperationKind::Squash => self.prepare_squash(
                single_target(plan)?,
                plan.message.as_deref().unwrap_or_default(),
            )?,
            GitOperationKind::Revert | GitOperationKind::Bisect => {
                return Err(GitError::InvalidInput {
                    field: "operation plan".to_string(),
                    message: "this operation kind cannot be started by Asterlyn".to_string(),
                });
            }
        };
        if refreshed.preview_token != plan.preview_token {
            return Err(stale_plan(
                "HEAD, the selected target, or another reviewed precondition changed",
            ));
        }
        reject_prestart_cancellation(plan.kind, cancellation)?;

        match plan.kind {
            GitOperationKind::Merge => self.start_git_operation(
                GitOperationKind::Merge,
                "merge",
                operation_arguments("merge", &plan.target_oids),
            ),
            GitOperationKind::CherryPick => self.start_git_operation(
                GitOperationKind::CherryPick,
                "cherry-pick",
                operation_arguments("cherry-pick", &plan.target_oids),
            ),
            GitOperationKind::Rebase => self.start_git_operation(
                GitOperationKind::Rebase,
                "rebase",
                operation_arguments("rebase", &plan.target_oids),
            ),
            GitOperationKind::Squash => {
                self.execute_squash(plan)?;
                self.operation_snapshot()
            }
            GitOperationKind::Revert | GitOperationKind::Bisect => unreachable!(),
        }
    }

    pub fn run_operation_action(
        &self,
        action: GitOperationAction,
    ) -> Result<Option<GitOperationSnapshot>, GitError> {
        let active = self
            .operation_snapshot()?
            .ok_or_else(|| GitError::UnsafeOperation {
                operation: "resume Git operation".to_string(),
                message: "Git reports no active operation".to_string(),
                blockers: Vec::new(),
            })?;
        if !active.allowed_actions.contains(&action) {
            return Err(GitError::UnsafeOperation {
                operation: format!("{} {}", action.label(), active.kind.label()),
                message: "the action is not permitted by the current Git state".to_string(),
                blockers: active
                    .conflicts
                    .iter()
                    .map(|conflict| conflict.path.clone())
                    .collect(),
            });
        }
        let arguments = action_arguments(active.kind, action)?;
        let operation = format!("{} {}", action.label(), active.kind.label());
        let output = run_operation_command(self.root(), &arguments, None)?;
        let observed = self.operation_snapshot()?;
        if output.status.success() {
            if action == GitOperationAction::Abort && observed.is_some() {
                return Err(GitError::UnsafeOperation {
                    operation,
                    message: "Git reported success but the operation is still active".to_string(),
                    blockers: Vec::new(),
                });
            }
            return Ok(observed);
        }
        if observed
            .as_ref()
            .is_some_and(|snapshot| snapshot.kind == active.kind)
        {
            return Ok(observed);
        }
        Err(command_failed(&operation, output))
    }

    pub fn read_conflict_content(&self, path: &str) -> Result<GitConflictContent, GitError> {
        let relative = validate_operation_path(path)?;
        let active = self
            .operation_snapshot()?
            .ok_or_else(|| GitError::UnsafeOperation {
                operation: "read conflict".to_string(),
                message: "Git reports no active operation".to_string(),
                blockers: Vec::new(),
            })?;
        let conflict = active
            .conflicts
            .iter()
            .find(|candidate| candidate.path == path)
            .ok_or_else(|| GitError::InvalidInput {
                field: "conflict path".to_string(),
                message: "the selected path is no longer conflicted".to_string(),
            })?;
        let base = self.read_conflict_blob(conflict.base_oid.as_deref())?;
        let ours = self.read_conflict_blob(conflict.ours_oid.as_deref())?;
        let theirs = self.read_conflict_blob(conflict.theirs_oid.as_deref())?;
        let worktree_bytes = read_bounded_optional(&self.safe_worktree_path(&relative)?)?;
        let binary = [&base, &ours, &theirs, &worktree_bytes]
            .into_iter()
            .flatten()
            .any(|bytes| std::str::from_utf8(bytes).is_err() || bytes.contains(&0));
        let revision_token = self.conflict_revision_token(conflict, worktree_bytes.as_deref())?;
        Ok(GitConflictContent {
            path: path.to_string(),
            base: text_side(base.as_deref(), binary),
            ours: text_side(ours.as_deref(), binary),
            theirs: text_side(theirs.as_deref(), binary),
            worktree: text_side(worktree_bytes.as_deref(), binary),
            binary,
            revision_token,
        })
    }

    pub fn resolve_conflict(
        &self,
        path: &str,
        expected_revision_token: &str,
        content: Option<&str>,
    ) -> Result<Option<GitOperationSnapshot>, GitError> {
        if content.is_some_and(|value| value.len() > MAX_CONFLICT_TEXT_BYTES) {
            return Err(GitError::InvalidInput {
                field: "resolved content".to_string(),
                message: format!(
                    "resolved text exceeds the {} byte safety limit",
                    MAX_CONFLICT_TEXT_BYTES
                ),
            });
        }
        let current = self.read_conflict_content(path)?;
        if current.revision_token != expected_revision_token {
            return Err(GitError::UnsafeOperation {
                operation: "resolve conflict".to_string(),
                message: "the conflict or worktree file changed after it was opened".to_string(),
                blockers: vec![path.to_string()],
            });
        }
        if current.binary && content.is_some() {
            return Err(GitError::UnsafeOperation {
                operation: "resolve conflict".to_string(),
                message: "binary conflicts cannot be replaced through the text editor".to_string(),
                blockers: vec![path.to_string()],
            });
        }
        let relative = validate_operation_path(path)?;
        let worktree = self.safe_worktree_path(&relative)?;
        match content {
            Some(value) => {
                if let Some(parent) = worktree.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| io_error("resolve conflict", error))?;
                }
                fs::write(&worktree, value.as_bytes())
                    .map_err(|error| io_error("resolve conflict", error))?;
                run_checked(
                    self.root(),
                    "stage conflict resolution",
                    &[
                        OsString::from("--literal-pathspecs"),
                        OsString::from("add"),
                        OsString::from("--"),
                        relative.as_os_str().to_os_string(),
                    ],
                    None,
                )?;
                let expected_oid = hash_bytes(self.root(), value.as_bytes())?;
                let staged_oid = self.stage_zero_oid(path)?;
                if staged_oid.as_deref() != Some(expected_oid.as_str()) {
                    return Err(GitError::UnsafeOperation {
                        operation: "verify conflict resolution".to_string(),
                        message: "the file changed while its resolution was being staged"
                            .to_string(),
                        blockers: vec![path.to_string()],
                    });
                }
            }
            None => {
                if worktree.exists() {
                    fs::remove_file(&worktree)
                        .map_err(|error| io_error("delete conflict", error))?;
                }
                run_checked(
                    self.root(),
                    "stage conflict deletion",
                    &[
                        OsString::from("--literal-pathspecs"),
                        OsString::from("add"),
                        OsString::from("-u"),
                        OsString::from("--"),
                        relative.as_os_str().to_os_string(),
                    ],
                    None,
                )?;
                if self.stage_zero_oid(path)?.is_some() {
                    return Err(GitError::UnsafeOperation {
                        operation: "verify conflict deletion".to_string(),
                        message: "Git still reports a staged file after the deletion".to_string(),
                        blockers: vec![path.to_string()],
                    });
                }
            }
        }
        self.operation_snapshot()
    }

    fn prepare_operation(
        &self,
        kind: GitOperationKind,
        target_refs: &[String],
        message: Option<String>,
    ) -> Result<GitOperationPlan, GitError> {
        if self.operation_snapshot()?.is_some() {
            return Err(GitError::UnsafeOperation {
                operation: format!("prepare {}", kind.label()),
                message: "finish the active Git operation first".to_string(),
                blockers: Vec::new(),
            });
        }
        if target_refs.is_empty() || target_refs.len() > MAX_OPERATION_TARGETS {
            return Err(GitError::InvalidInput {
                field: "operation targets".to_string(),
                message: format!("select between 1 and {MAX_OPERATION_TARGETS} targets"),
            });
        }
        self.ensure_operation_worktree_clean(kind)?;
        let start_head_ref = self.symbolic_head_required(kind)?;
        let start_head_oid = self.resolve_required_commit("HEAD", "read operation HEAD")?;
        let mut target_oids = Vec::with_capacity(target_refs.len());
        for target in target_refs {
            validate_revision_label(target)?;
            target_oids.push(self.resolve_required_commit(target, "resolve operation target")?);
        }
        let commit_count = match kind {
            GitOperationKind::Merge => {
                if self.is_ancestor_oid(&target_oids[0], &start_head_oid)? {
                    return Err(no_effect(
                        kind,
                        "the selected target is already contained in the current branch",
                    ));
                }
                1
            }
            GitOperationKind::CherryPick => target_oids.len(),
            GitOperationKind::Rebase => {
                let count = self.revision_count(&format!("{}..HEAD", target_oids[0]))?;
                if count == 0 {
                    return Err(no_effect(
                        kind,
                        "the current branch has no commits to replay",
                    ));
                }
                count
            }
            GitOperationKind::Squash => {
                let message = validate_operation_message(message.as_deref().unwrap_or_default())?;
                let count = self.first_parent_distance(&target_oids[0], &start_head_oid)?;
                if count < 2 {
                    return Err(no_effect(
                        kind,
                        "select a base with at least two commits after it",
                    ));
                }
                if message.len() > MAX_OPERATION_MESSAGE_BYTES {
                    return Err(GitError::InvalidInput {
                        field: "squash message".to_string(),
                        message: "the message is too large".to_string(),
                    });
                }
                count
            }
            GitOperationKind::Revert | GitOperationKind::Bisect => unreachable!(),
        };
        let summary = operation_summary(kind, target_refs, commit_count);
        let normalized_message = message.map(|value| value.trim().to_string());
        let preview_token = operation_plan_token(&OperationPlanIdentity {
            root: self.root(),
            kind,
            start_head_ref: &start_head_ref,
            start_head_oid: &start_head_oid,
            target_refs,
            target_oids: &target_oids,
            commit_count,
            message: normalized_message.as_deref(),
        })?;
        Ok(GitOperationPlan {
            kind,
            repository_root: self.root().to_string_lossy().into_owned(),
            start_head_oid,
            start_head_ref,
            target_refs: target_refs.to_vec(),
            target_oids,
            commit_count,
            summary,
            message: normalized_message,
            preview_token,
        })
    }

    fn start_git_operation(
        &self,
        kind: GitOperationKind,
        operation: &str,
        arguments: Vec<OsString>,
    ) -> Result<Option<GitOperationSnapshot>, GitError> {
        let output = run_operation_command(self.root(), &arguments, None)?;
        let observed = self.operation_snapshot()?;
        if output.status.success()
            || observed
                .as_ref()
                .is_some_and(|snapshot| snapshot.kind == kind)
        {
            Ok(observed)
        } else {
            Err(command_failed(operation, output))
        }
    }

    fn execute_squash(&self, plan: &GitOperationPlan) -> Result<(), GitError> {
        let message = validate_operation_message(plan.message.as_deref().unwrap_or_default())?;
        let tree = self.resolve_required_object("HEAD^{tree}", "read squash tree")?;
        let base = single_target_oid(plan)?;
        let output = run_checked(
            self.root(),
            "create squashed commit",
            &[
                OsString::from("commit-tree"),
                OsString::from(tree),
                OsString::from("-p"),
                OsString::from(base),
            ],
            Some(message.as_bytes()),
        )?;
        let new_oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        validate_oid(&new_oid)?;
        run_checked(
            self.root(),
            "install squashed commit",
            &[
                OsString::from("update-ref"),
                OsString::from("-m"),
                OsString::from("Asterlyn squash"),
                OsString::from(&plan.start_head_ref),
                OsString::from(&new_oid),
                OsString::from(&plan.start_head_oid),
            ],
            None,
        )?;
        Ok(())
    }

    fn ensure_operation_worktree_clean(&self, kind: GitOperationKind) -> Result<(), GitError> {
        let output = run_checked(
            self.root(),
            "inspect operation worktree",
            &[
                OsString::from("status"),
                OsString::from("--porcelain=v2"),
                OsString::from("-z"),
                OsString::from("--untracked-files=normal"),
            ],
            None,
        )?;
        if output.stdout.is_empty() {
            return Ok(());
        }
        Err(GitError::UnsafeOperation {
            operation: format!("prepare {}", kind.label()),
            message: "commit, stash, or remove working-tree changes before continuing".to_string(),
            blockers: Vec::new(),
        })
    }

    fn symbolic_head_required(&self, kind: GitOperationKind) -> Result<String, GitError> {
        self.symbolic_head_optional()?
            .ok_or_else(|| GitError::UnsafeOperation {
                operation: format!("prepare {}", kind.label()),
                message: "a checked-out local branch with an existing HEAD is required".to_string(),
                blockers: Vec::new(),
            })
    }

    fn symbolic_head_optional(&self) -> Result<Option<String>, GitError> {
        let output = run_operation_command(
            self.root(),
            &[
                OsString::from("symbolic-ref"),
                OsString::from("--quiet"),
                OsString::from("HEAD"),
            ],
            None,
        )?;
        match output.status.code() {
            Some(0) => Ok(Some(
                String::from_utf8_lossy(&output.stdout).trim().to_string(),
            )),
            Some(1) => Ok(None),
            _ => Err(command_failed("read symbolic HEAD", output)),
        }
    }

    fn resolve_optional_commit(&self, reference: &str) -> Result<Option<String>, GitError> {
        let expression = format!("{reference}^{{commit}}");
        let output = run_operation_command(
            self.root(),
            &[
                OsString::from("rev-parse"),
                OsString::from("--verify"),
                OsString::from("--end-of-options"),
                OsString::from(expression),
            ],
            None,
        )?;
        if !output.status.success() {
            return Ok(None);
        }
        let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        validate_oid(&oid)?;
        Ok(Some(oid))
    }

    fn resolve_required_commit(
        &self,
        reference: &str,
        operation: &str,
    ) -> Result<String, GitError> {
        self.resolve_optional_commit(reference)?
            .ok_or_else(|| GitError::InvalidInput {
                field: "operation target".to_string(),
                message: format!(
                    "{operation}: the selected revision no longer resolves to a commit"
                ),
            })
    }

    fn resolve_required_object(
        &self,
        expression: &str,
        operation: &str,
    ) -> Result<String, GitError> {
        let output = run_checked(
            self.root(),
            operation,
            &[
                OsString::from("rev-parse"),
                OsString::from("--verify"),
                OsString::from("--end-of-options"),
                OsString::from(expression),
            ],
            None,
        )?;
        let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        validate_oid(&oid)?;
        Ok(oid)
    }

    fn revision_count(&self, range: &str) -> Result<usize, GitError> {
        let output = run_checked(
            self.root(),
            "count operation commits",
            &[
                OsString::from("rev-list"),
                OsString::from("--count"),
                OsString::from("--end-of-options"),
                OsString::from(range),
            ],
            None,
        )?;
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<usize>()
            .map_err(|error| GitError::Parse {
                context: "operation commit count".to_string(),
                message: error.to_string(),
            })
    }

    fn is_ancestor_oid(&self, ancestor: &str, descendant: &str) -> Result<bool, GitError> {
        let output = run_operation_command(
            self.root(),
            &[
                OsString::from("merge-base"),
                OsString::from("--is-ancestor"),
                OsString::from(ancestor),
                OsString::from(descendant),
            ],
            None,
        )?;
        match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => Err(command_failed("verify operation ancestry", output)),
        }
    }

    fn first_parent_distance(&self, ancestor: &str, head: &str) -> Result<usize, GitError> {
        let output = run_checked(
            self.root(),
            "inspect squash first-parent range",
            &[
                OsString::from("rev-list"),
                OsString::from("--first-parent"),
                OsString::from(format!("--max-count={}", MAX_SQUASH_COMMITS + 1)),
                OsString::from("--end-of-options"),
                OsString::from(head),
            ],
            None,
        )?;
        let distance = String::from_utf8_lossy(&output.stdout)
            .lines()
            .position(|oid| oid == ancestor)
            .ok_or_else(|| GitError::UnsafeOperation {
                operation: "prepare squash".to_string(),
                message: format!(
                    "the selected base must be within {MAX_SQUASH_COMMITS} commits on the first-parent chain"
                ),
                blockers: Vec::new(),
            })?;
        Ok(distance)
    }

    fn operation_conflicts(&self) -> Result<Vec<GitConflictFile>, GitError> {
        let output = run_checked(
            self.root(),
            "read conflict index",
            &[
                OsString::from("ls-files"),
                OsString::from("-u"),
                OsString::from("-z"),
            ],
            None,
        )?;
        parse_conflicts(&output.stdout)
    }

    fn read_conflict_blob(&self, oid: Option<&str>) -> Result<Option<Vec<u8>>, GitError> {
        let Some(oid) = oid else { return Ok(None) };
        validate_oid(oid)?;
        let size = run_checked(
            self.root(),
            "read conflict blob size",
            &[
                OsString::from("cat-file"),
                OsString::from("-s"),
                OsString::from(oid),
            ],
            None,
        )?;
        let size = String::from_utf8_lossy(&size.stdout)
            .trim()
            .parse::<usize>()
            .map_err(|error| GitError::Parse {
                context: "conflict blob size".to_string(),
                message: error.to_string(),
            })?;
        if size > MAX_CONFLICT_TEXT_BYTES {
            return Err(GitError::UnsafeOperation {
                operation: "read conflict".to_string(),
                message: format!(
                    "a conflict side exceeds the {MAX_CONFLICT_TEXT_BYTES} byte limit"
                ),
                blockers: Vec::new(),
            });
        }
        let output = run_checked(
            self.root(),
            "read conflict blob",
            &[
                OsString::from("cat-file"),
                OsString::from("blob"),
                OsString::from(oid),
            ],
            None,
        )?;
        Ok(Some(output.stdout))
    }

    fn safe_worktree_path(&self, relative: &Path) -> Result<PathBuf, GitError> {
        let root =
            fs::canonicalize(self.root()).map_err(|error| io_error("resolve repository", error))?;
        let candidate = root.join(relative);
        let mut current = root.clone();
        for component in relative.components() {
            current.push(component.as_os_str());
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(GitError::UnsafeOperation {
                        operation: "resolve conflict".to_string(),
                        message: "symbolic-link conflicts require an external Git tool".to_string(),
                        blockers: vec![relative.to_string_lossy().into_owned()],
                    });
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                Err(error) => return Err(io_error("inspect conflict path", error)),
            }
        }
        Ok(candidate)
    }

    fn conflict_revision_token(
        &self,
        conflict: &GitConflictFile,
        worktree: Option<&[u8]>,
    ) -> Result<String, GitError> {
        let worktree_oid = hash_bytes(self.root(), worktree.unwrap_or_default())?;
        let value = format!(
            "conflict\0{}\0{}\0{}\0{}\0{}",
            conflict.path,
            conflict.base_oid.as_deref().unwrap_or("-"),
            conflict.ours_oid.as_deref().unwrap_or("-"),
            conflict.theirs_oid.as_deref().unwrap_or("-"),
            worktree_oid,
        );
        hash_bytes(self.root(), value.as_bytes())
    }

    fn stage_zero_oid(&self, path: &str) -> Result<Option<String>, GitError> {
        let output = run_checked(
            self.root(),
            "verify staged conflict resolution",
            &[
                OsString::from("ls-files"),
                OsString::from("--stage"),
                OsString::from("-z"),
                OsString::from("--"),
                OsString::from(path),
            ],
            None,
        )?;
        let record = output
            .stdout
            .split(|byte| *byte == 0)
            .find(|record| !record.is_empty());
        let Some(record) = record else {
            return Ok(None);
        };
        let header = record
            .split(|byte| *byte == b'\t')
            .next()
            .unwrap_or_default();
        let fields = String::from_utf8_lossy(header);
        let mut fields = fields.split_ascii_whitespace();
        let _mode = fields.next();
        let oid = fields.next().unwrap_or_default();
        let stage = fields.next().unwrap_or_default();
        if stage != "0" || oid.is_empty() {
            return Ok(None);
        }
        validate_oid(oid)?;
        Ok(Some(oid.to_string()))
    }
}

impl GitOperationAction {
    fn label(self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::Skip => "skip",
            Self::Abort => "abort",
        }
    }
}

fn detect_operation_kind(git_dir: &Path) -> Option<GitOperationKind> {
    [
        ("rebase-merge", GitOperationKind::Rebase),
        ("rebase-apply", GitOperationKind::Rebase),
        ("MERGE_HEAD", GitOperationKind::Merge),
        ("CHERRY_PICK_HEAD", GitOperationKind::CherryPick),
        ("REVERT_HEAD", GitOperationKind::Revert),
        ("BISECT_LOG", GitOperationKind::Bisect),
    ]
    .into_iter()
    .find(|(marker, _)| git_dir.join(marker).exists())
    .map(|(_, kind)| kind)
}

fn allowed_actions(kind: GitOperationKind, conflicts_resolved: bool) -> Vec<GitOperationAction> {
    let mut actions = Vec::new();
    if matches!(
        kind,
        GitOperationKind::Merge | GitOperationKind::CherryPick | GitOperationKind::Rebase
    ) && conflicts_resolved
    {
        actions.push(GitOperationAction::Continue);
    }
    if matches!(
        kind,
        GitOperationKind::CherryPick | GitOperationKind::Rebase
    ) {
        actions.push(GitOperationAction::Skip);
    }
    if matches!(
        kind,
        GitOperationKind::Merge | GitOperationKind::CherryPick | GitOperationKind::Rebase
    ) {
        actions.push(GitOperationAction::Abort);
    }
    actions
}

fn operation_arguments(command: &str, target_oids: &[String]) -> Vec<OsString> {
    let mut arguments = vec![OsString::from(command)];
    if command == "merge" {
        arguments.push(OsString::from("--no-edit"));
    }
    arguments.extend(target_oids.iter().map(OsString::from));
    arguments
}

fn action_arguments(
    kind: GitOperationKind,
    action: GitOperationAction,
) -> Result<Vec<OsString>, GitError> {
    let command = match kind {
        GitOperationKind::Merge => "merge",
        GitOperationKind::CherryPick => "cherry-pick",
        GitOperationKind::Rebase => "rebase",
        GitOperationKind::Squash | GitOperationKind::Revert | GitOperationKind::Bisect => {
            return Err(GitError::UnsafeOperation {
                operation: "resume Git operation".to_string(),
                message: "Asterlyn cannot control this external operation".to_string(),
                blockers: Vec::new(),
            });
        }
    };
    Ok(vec![
        OsString::from(command),
        OsString::from(match action {
            GitOperationAction::Continue => "--continue",
            GitOperationAction::Skip => "--skip",
            GitOperationAction::Abort => "--abort",
        }),
    ])
}

fn operation_original_head(git_dir: &Path, kind: GitOperationKind) -> Option<String> {
    if kind == GitOperationKind::Rebase {
        for relative in ["rebase-merge/orig-head", "rebase-apply/orig-head"] {
            if let Some(oid) = read_oid_file(&git_dir.join(relative)) {
                return Some(oid);
            }
        }
    }
    if matches!(
        kind,
        GitOperationKind::CherryPick | GitOperationKind::Revert
    ) {
        if let Some(oid) = read_oid_file(&git_dir.join("sequencer/head")) {
            return Some(oid);
        }
    }
    read_oid_file(&git_dir.join("ORIG_HEAD"))
}

fn operation_targets(git_dir: &Path, kind: GitOperationKind) -> Vec<String> {
    let paths: &[&str] = match kind {
        GitOperationKind::Merge => &["MERGE_HEAD"],
        GitOperationKind::CherryPick => &["CHERRY_PICK_HEAD"],
        GitOperationKind::Rebase => &["rebase-merge/onto", "rebase-apply/onto"],
        GitOperationKind::Revert => &["REVERT_HEAD"],
        GitOperationKind::Squash | GitOperationKind::Bisect => &[],
    };
    for relative in paths {
        let values = read_oid_lines(&git_dir.join(relative));
        if !values.is_empty() {
            return values;
        }
    }
    Vec::new()
}

fn operation_progress(git_dir: &Path, kind: GitOperationKind) -> GitOperationProgress {
    if kind == GitOperationKind::Rebase {
        for directory in ["rebase-merge", "rebase-apply"] {
            let root = git_dir.join(directory);
            if root.exists() {
                let current = read_u32_file(&root.join("msgnum"))
                    .or_else(|| read_u32_file(&root.join("next")));
                let total =
                    read_u32_file(&root.join("end")).or_else(|| read_u32_file(&root.join("last")));
                return GitOperationProgress {
                    current,
                    total,
                    detail: read_trimmed_file(&root.join("head-name")),
                };
            }
        }
    }
    if kind == GitOperationKind::CherryPick {
        let done = count_todo_lines(&git_dir.join("sequencer/done"));
        let remaining = count_todo_lines(&git_dir.join("sequencer/todo"));
        let total = done + remaining;
        return GitOperationProgress {
            current: (total > 0).then_some((done + 1).min(total) as u32),
            total: (total > 0).then_some(total as u32),
            detail: None,
        };
    }
    GitOperationProgress {
        current: None,
        total: None,
        detail: None,
    }
}

fn parse_conflicts(bytes: &[u8]) -> Result<Vec<GitConflictFile>, GitError> {
    let mut conflicts: BTreeMap<String, GitConflictFile> = BTreeMap::new();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
            return Err(parse_error("conflict index record has no path separator"));
        };
        let header = String::from_utf8_lossy(&record[..tab]);
        let path = String::from_utf8_lossy(&record[tab + 1..]).into_owned();
        let mut fields = header.split_ascii_whitespace();
        let _mode = fields.next();
        let oid = fields.next().unwrap_or_default();
        let stage = fields.next().unwrap_or_default();
        validate_oid(oid)?;
        let conflict = conflicts.entry(path.clone()).or_insert(GitConflictFile {
            path,
            base_oid: None,
            ours_oid: None,
            theirs_oid: None,
        });
        match stage {
            "1" => conflict.base_oid = Some(oid.to_string()),
            "2" => conflict.ours_oid = Some(oid.to_string()),
            "3" => conflict.theirs_oid = Some(oid.to_string()),
            _ => return Err(parse_error("conflict index contains an unknown stage")),
        }
    }
    Ok(conflicts.into_values().collect())
}

struct OperationPlanIdentity<'a> {
    root: &'a Path,
    kind: GitOperationKind,
    start_head_ref: &'a str,
    start_head_oid: &'a str,
    target_refs: &'a [String],
    target_oids: &'a [String],
    commit_count: usize,
    message: Option<&'a str>,
}

fn operation_plan_token(identity: &OperationPlanIdentity<'_>) -> Result<String, GitError> {
    let canonical = format!(
        "asterlyn-operation-v1\0{}\0{}\0{}\0{}\0{}\0{}\0{}\0{}",
        identity.root.to_string_lossy(),
        identity.kind.label(),
        identity.start_head_ref,
        identity.start_head_oid,
        identity.target_refs.join("\n"),
        identity.target_oids.join("\n"),
        identity.commit_count,
        identity.message.unwrap_or(""),
    );
    hash_bytes(identity.root, canonical.as_bytes())
}

fn hash_bytes(root: &Path, bytes: &[u8]) -> Result<String, GitError> {
    let output = run_checked(
        root,
        "hash reviewed Git state",
        &[OsString::from("hash-object"), OsString::from("--stdin")],
        Some(bytes),
    )?;
    let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    validate_oid(&oid)?;
    Ok(oid)
}

fn run_checked(
    root: &Path,
    operation: &str,
    arguments: &[OsString],
    stdin: Option<&[u8]>,
) -> Result<Output, GitError> {
    let output = run_operation_command(root, arguments, stdin)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(command_failed(operation, output))
    }
}

fn run_operation_command(
    root: &Path,
    arguments: &[OsString],
    stdin: Option<&[u8]>,
) -> Result<Output, GitError> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .arg("--no-pager")
        .args(arguments)
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| io_error("run Git operation", error))?;
    if let Some(bytes) = stdin {
        child
            .stdin
            .take()
            .ok_or_else(|| GitError::Io {
                operation: "run Git operation".to_string(),
                message: "Git stdin was unavailable".to_string(),
            })?
            .write_all(bytes)
            .map_err(|error| io_error("write Git operation input", error))?;
    }
    child
        .wait_with_output()
        .map_err(|error| io_error("wait for Git operation", error))
}

fn read_bounded_optional(path: &Path) -> Result<Option<Vec<u8>>, GitError> {
    match fs::read(path) {
        Ok(bytes) if bytes.len() <= MAX_CONFLICT_TEXT_BYTES => Ok(Some(bytes)),
        Ok(_) => Err(GitError::UnsafeOperation {
            operation: "read conflict".to_string(),
            message: format!("the worktree file exceeds the {MAX_CONFLICT_TEXT_BYTES} byte limit"),
            blockers: vec![path.to_string_lossy().into_owned()],
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error("read conflict worktree file", error)),
    }
}

fn text_side(bytes: Option<&[u8]>, binary: bool) -> Option<String> {
    if binary {
        None
    } else {
        bytes.map(|value| String::from_utf8_lossy(value).into_owned())
    }
}

fn read_oid_file(path: &Path) -> Option<String> {
    read_oid_lines(path).into_iter().next()
}

fn read_oid_lines(path: &Path) -> Vec<String> {
    read_trimmed_file(path)
        .into_iter()
        .flat_map(|content| {
            content
                .lines()
                .map(str::trim)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|value| validate_oid(value).is_ok())
        .collect()
}

fn read_trimmed_file(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_u32_file(path: &Path) -> Option<u32> {
    read_trimmed_file(path)?.parse().ok()
}

fn count_todo_lines(path: &Path) -> usize {
    fs::read_to_string(path)
        .map(|value| {
            value
                .lines()
                .filter(|line| {
                    let line = line.trim();
                    !line.is_empty() && !line.starts_with('#')
                })
                .count()
        })
        .unwrap_or(0)
}

fn validate_revision_label(value: &str) -> Result<(), GitError> {
    if value.is_empty()
        || value != value.trim()
        || value.contains(['\0', '\n', '\r'])
        || value.starts_with('-')
    {
        return Err(GitError::InvalidInput {
            field: "operation target".to_string(),
            message: "select a literal branch, tag, or commit".to_string(),
        });
    }
    Ok(())
}

fn validate_operation_message(message: &str) -> Result<&str, GitError> {
    let message = message.trim();
    if message.is_empty() {
        return Err(GitError::InvalidInput {
            field: "squash message".to_string(),
            message: "enter a commit message".to_string(),
        });
    }
    Ok(message)
}

fn validate_operation_path(path: &str) -> Result<PathBuf, GitError> {
    let candidate = Path::new(path);
    if path.is_empty()
        || path.contains('\0')
        || candidate.is_absolute()
        || candidate
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(GitError::InvalidInput {
            field: "conflict path".to_string(),
            message: "the path must be an unambiguous repository-relative file".to_string(),
        });
    }
    Ok(candidate.to_path_buf())
}

fn validate_oid(oid: &str) -> Result<(), GitError> {
    if matches!(oid.len(), 40 | 64) && oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(GitError::Parse {
            context: "Git object id".to_string(),
            message: "Git returned an invalid full object id".to_string(),
        })
    }
}

fn single_target(plan: &GitOperationPlan) -> Result<&str, GitError> {
    if plan.target_refs.len() == 1 {
        Ok(&plan.target_refs[0])
    } else {
        Err(GitError::InvalidInput {
            field: "operation plan".to_string(),
            message: "the operation requires exactly one target".to_string(),
        })
    }
}

fn single_target_oid(plan: &GitOperationPlan) -> Result<&str, GitError> {
    if plan.target_oids.len() == 1 {
        Ok(&plan.target_oids[0])
    } else {
        Err(GitError::InvalidInput {
            field: "operation plan".to_string(),
            message: "the operation requires exactly one resolved target".to_string(),
        })
    }
}

fn operation_summary(kind: GitOperationKind, targets: &[String], count: usize) -> String {
    match kind {
        GitOperationKind::Merge => format!("Merge {} into the current branch", targets[0]),
        GitOperationKind::CherryPick => format!("Cherry-pick {count} reviewed commit(s)"),
        GitOperationKind::Rebase => {
            format!(
                "Rebase {count} current-branch commit(s) onto {}",
                targets[0]
            )
        }
        GitOperationKind::Squash => format!("Squash {count} commits after {}", targets[0]),
        GitOperationKind::Revert | GitOperationKind::Bisect => kind.label().to_string(),
    }
}

fn no_effect(kind: GitOperationKind, message: &str) -> GitError {
    GitError::UnsafeOperation {
        operation: format!("prepare {}", kind.label()),
        message: message.to_string(),
        blockers: Vec::new(),
    }
}

fn reject_prestart_cancellation(
    kind: GitOperationKind,
    cancellation: &CancellationToken,
) -> Result<(), GitError> {
    if cancellation.is_cancelled() {
        Err(GitError::Cancelled {
            operation: format!("start {}", kind.label()),
        })
    } else {
        Ok(())
    }
}

fn stale_plan(message: &str) -> GitError {
    GitError::UnsafeOperation {
        operation: "execute reviewed Git plan".to_string(),
        message: format!("the reviewed plan is stale: {message}; prepare and confirm it again"),
        blockers: Vec::new(),
    }
}

fn parse_error(message: &str) -> GitError {
    GitError::Parse {
        context: "conflict index".to_string(),
        message: message.to_string(),
    }
}

fn io_error(operation: &str, error: std::io::Error) -> GitError {
    GitError::Io {
        operation: operation.to_string(),
        message: error.to_string(),
    }
}

fn command_failed(operation: &str, output: Output) -> GitError {
    let mut message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if message.is_empty() {
        message = String::from_utf8_lossy(&output.stdout).trim().to_string();
    }
    if message.is_empty() {
        message = "Git did not provide diagnostic output".to_string();
    }
    if message.len() > 4_096 {
        message.truncate(4_096);
    }
    GitError::CommandFailed {
        operation: operation.to_string(),
        status: output.status.code(),
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn merge_conflict_is_reconstructed_resolved_and_continued() {
        let fixture = divergent_fixture();
        git(&fixture, &["switch", "main"]);
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let plan = repository
            .prepare_merge("refs/heads/feature")
            .expect("prepare merge");
        let active = repository
            .execute_operation_plan(&plan)
            .expect("execute merge")
            .expect("merge should pause");
        assert_eq!(active.kind, GitOperationKind::Merge);
        assert_eq!(active.phase, GitOperationPhase::Conflicted);
        assert_eq!(active.conflicts[0].path, "shared.txt");

        let reopened = GitRepository::open(fixture.path()).expect("reopen repository");
        let conflict = reopened
            .read_conflict_content("shared.txt")
            .expect("read conflict");
        assert!(
            conflict
                .ours
                .as_deref()
                .is_some_and(|text| text.contains("main"))
        );
        assert!(
            conflict
                .theirs
                .as_deref()
                .is_some_and(|text| text.contains("feature"))
        );
        let active = reopened
            .resolve_conflict("shared.txt", &conflict.revision_token, Some("resolved\n"))
            .expect("resolve conflict")
            .expect("merge remains active");
        assert!(active.conflicts.is_empty());
        assert!(
            active
                .allowed_actions
                .contains(&GitOperationAction::Continue)
        );
        assert!(
            reopened
                .run_operation_action(GitOperationAction::Continue)
                .expect("continue merge")
                .is_none()
        );
        assert_eq!(
            fs::read_to_string(fixture.path().join("shared.txt")).unwrap(),
            "resolved\n"
        );
    }

    #[test]
    fn merge_abort_restores_original_head_and_clean_tree() {
        let fixture = divergent_fixture();
        git(&fixture, &["switch", "main"]);
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let original = oid(&fixture, "HEAD");
        let plan = repository.prepare_merge("feature").expect("prepare merge");
        repository
            .execute_operation_plan(&plan)
            .expect("execute merge");
        assert!(
            repository
                .run_operation_action(GitOperationAction::Abort)
                .expect("abort merge")
                .is_none()
        );
        assert_eq!(oid(&fixture, "HEAD"), original);
        assert!(git_stdout(&fixture, &["status", "--porcelain"]).is_empty());
    }

    #[test]
    fn stale_plan_is_rejected_after_head_moves() {
        let fixture = divergent_fixture();
        git(&fixture, &["switch", "main"]);
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let plan = repository.prepare_merge("feature").expect("prepare merge");
        fs::write(fixture.path().join("later.txt"), "later\n").unwrap();
        git(&fixture, &["add", "later.txt"]);
        git(&fixture, &["commit", "-m", "later"]);
        let error = repository
            .execute_operation_plan(&plan)
            .expect_err("plan must be stale");
        assert!(error.to_string().contains("stale"));
        assert!(repository.operation_snapshot().unwrap().is_none());
    }

    #[test]
    fn cherry_pick_conflict_can_skip_and_continue_sequence() {
        let fixture = cherry_fixture();
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let first = oid(&fixture, "feature~1");
        let second = oid(&fixture, "feature");
        let plan = repository
            .prepare_cherry_pick(&[first, second])
            .expect("prepare cherry-pick");
        let active = repository
            .execute_operation_plan(&plan)
            .expect("execute cherry-pick")
            .expect("cherry-pick should pause");
        assert_eq!(active.kind, GitOperationKind::CherryPick);
        assert!(active.allowed_actions.contains(&GitOperationAction::Skip));
        let observed = repository
            .run_operation_action(GitOperationAction::Skip)
            .expect("skip conflicted commit");
        if let Some(active) = observed {
            assert_eq!(active.kind, GitOperationKind::CherryPick);
            if !active.conflicts.is_empty() {
                let conflict = repository.read_conflict_content("shared.txt").unwrap();
                repository
                    .resolve_conflict("shared.txt", &conflict.revision_token, Some("picked\n"))
                    .unwrap();
                repository
                    .run_operation_action(GitOperationAction::Continue)
                    .expect("continue cherry-pick");
            }
        }
        assert!(repository.operation_snapshot().unwrap().is_none());
    }

    #[test]
    fn rebase_conflict_is_restart_safe_and_abortable() {
        let fixture = divergent_fixture();
        git(&fixture, &["switch", "main"]);
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let original = oid(&fixture, "HEAD");
        let plan = repository
            .prepare_rebase("feature")
            .expect("prepare rebase");
        let active = repository
            .execute_operation_plan(&plan)
            .expect("execute rebase")
            .expect("rebase should pause");
        assert_eq!(active.kind, GitOperationKind::Rebase);
        let reopened = GitRepository::open(fixture.path()).expect("reopen repository");
        assert_eq!(
            reopened.operation_snapshot().unwrap().unwrap().kind,
            GitOperationKind::Rebase
        );
        assert!(
            reopened
                .run_operation_action(GitOperationAction::Abort)
                .expect("abort rebase")
                .is_none()
        );
        assert_eq!(oid(&fixture, "HEAD"), original);
    }

    #[test]
    fn rebase_conflict_can_be_resolved_and_continued() {
        let fixture = divergent_fixture();
        git(&fixture, &["switch", "main"]);
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let plan = repository
            .prepare_rebase("feature")
            .expect("prepare rebase");
        repository
            .execute_operation_plan(&plan)
            .expect("execute rebase")
            .expect("rebase should pause");
        let conflict = repository
            .read_conflict_content("shared.txt")
            .expect("read conflict");
        repository
            .resolve_conflict("shared.txt", &conflict.revision_token, Some("rebased\n"))
            .expect("resolve conflict");
        assert!(
            repository
                .run_operation_action(GitOperationAction::Continue)
                .expect("continue rebase")
                .is_none()
        );
        assert_eq!(
            fs::read_to_string(fixture.path().join("shared.txt")).unwrap(),
            "rebased\n"
        );
        assert_eq!(git_stdout(&fixture, &["branch", "--show-current"]), "main");
    }

    #[test]
    fn cherry_pick_applies_multiple_exact_commits_in_reviewed_order() {
        let fixture = initialized_fixture();
        fs::write(fixture.path().join("base.txt"), "base\n").unwrap();
        commit_all(&fixture, "base");
        git(&fixture, &["switch", "-c", "feature"]);
        fs::write(fixture.path().join("first.txt"), "first\n").unwrap();
        commit_all(&fixture, "first picked");
        let first = oid(&fixture, "HEAD");
        fs::write(fixture.path().join("second.txt"), "second\n").unwrap();
        commit_all(&fixture, "second picked");
        let second = oid(&fixture, "HEAD");
        git(&fixture, &["switch", "main"]);

        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let plan = repository
            .prepare_cherry_pick(&[first, second])
            .expect("prepare cherry-pick");
        assert!(
            repository
                .execute_operation_plan(&plan)
                .expect("execute cherry-pick")
                .is_none()
        );
        assert_eq!(
            git_stdout(&fixture, &["log", "-2", "--format=%s"]),
            "second picked\nfirst picked"
        );
    }

    #[test]
    fn conflict_resolution_rejects_a_changed_worktree_revision() {
        let fixture = divergent_fixture();
        git(&fixture, &["switch", "main"]);
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let plan = repository.prepare_merge("feature").expect("prepare merge");
        repository
            .execute_operation_plan(&plan)
            .expect("execute merge");
        let conflict = repository
            .read_conflict_content("shared.txt")
            .expect("read conflict");
        fs::write(fixture.path().join("shared.txt"), "changed elsewhere\n").unwrap();
        let error = repository
            .resolve_conflict("shared.txt", &conflict.revision_token, Some("stale\n"))
            .expect_err("stale conflict must be rejected");
        assert!(error.to_string().contains("changed after it was opened"));
    }

    #[test]
    fn merge_rejects_a_target_already_contained_in_head() {
        let fixture = linear_fixture();
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let error = repository
            .prepare_merge("HEAD~1")
            .expect_err("contained merge target has no effect");
        assert!(error.to_string().contains("already contained"));
    }

    #[test]
    fn squash_installs_one_commit_with_an_exact_old_head_lease() {
        let fixture = linear_fixture();
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let base = oid(&fixture, "HEAD~2");
        let plan = repository
            .prepare_squash(&base, "squashed change")
            .expect("prepare squash");
        let old_head = plan.start_head_oid.clone();
        repository
            .execute_operation_plan(&plan)
            .expect("execute squash");
        assert_ne!(oid(&fixture, "HEAD"), old_head);
        assert_eq!(oid(&fixture, "HEAD^"), base);
        assert_eq!(
            git_stdout(&fixture, &["log", "-1", "--format=%s"]),
            "squashed change"
        );
        assert!(git_stdout(&fixture, &["status", "--porcelain"]).is_empty());
    }

    #[test]
    fn squash_rejects_a_base_reachable_only_through_a_merge_parent() {
        let fixture = initialized_fixture();
        fs::write(fixture.path().join("base.txt"), "base\n").unwrap();
        commit_all(&fixture, "base");
        git(&fixture, &["switch", "-c", "side"]);
        fs::write(fixture.path().join("side.txt"), "side\n").unwrap();
        commit_all(&fixture, "side");
        let side = oid(&fixture, "HEAD");
        git(&fixture, &["switch", "main"]);
        fs::write(fixture.path().join("main.txt"), "main\n").unwrap();
        commit_all(&fixture, "main");
        git(&fixture, &["merge", "--no-ff", "-m", "merge side", "side"]);

        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let error = repository
            .prepare_squash(&side, "unsafe squash")
            .expect_err("second-parent base must be rejected");
        assert!(error.to_string().contains("first-parent chain"));
    }

    #[test]
    fn every_reviewed_operation_rejects_a_dirty_worktree_before_planning() {
        let fixture = linear_fixture();
        fs::write(fixture.path().join("dirty.txt"), "dirty\n").unwrap();
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let target = vec!["HEAD~1".to_string()];
        let errors = [
            repository.prepare_merge("HEAD~1").unwrap_err(),
            repository.prepare_cherry_pick(&target).unwrap_err(),
            repository.prepare_rebase("HEAD~2").unwrap_err(),
            repository.prepare_squash("HEAD~2", "squashed").unwrap_err(),
        ];
        assert!(
            errors
                .iter()
                .all(|error| error.to_string().contains("commit, stash, or remove"))
        );
        assert!(repository.operation_snapshot().unwrap().is_none());
    }

    #[test]
    fn reviewed_operations_reject_detached_and_unborn_head_states() {
        let detached = linear_fixture();
        git(&detached, &["switch", "--detach"]);
        let detached_repository =
            GitRepository::open(detached.path()).expect("open detached repository");
        let error = detached_repository
            .prepare_rebase("HEAD~2")
            .expect_err("detached HEAD must be rejected");
        assert!(error.to_string().contains("checked-out local branch"));

        let unborn = initialized_fixture();
        let unborn_repository = GitRepository::open(unborn.path()).expect("open unborn repository");
        let error = unborn_repository
            .prepare_merge("refs/heads/missing")
            .expect_err("unborn HEAD must be rejected");
        assert!(error.to_string().contains("no longer resolves to a commit"));
        assert!(unborn_repository.operation_snapshot().unwrap().is_none());
    }

    #[test]
    fn cancellation_before_execution_preserves_the_reviewed_head() {
        let fixture = linear_fixture();
        let repository = GitRepository::open(fixture.path()).expect("open repository");
        let original = oid(&fixture, "HEAD");
        let plan = repository
            .prepare_squash("HEAD~2", "cancelled squash")
            .expect("prepare squash");
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let error = repository
            .execute_operation_plan_with_cancellation(&plan, &cancellation)
            .expect_err("cancelled plan must not start");
        assert!(matches!(error, GitError::Cancelled { .. }));
        assert_eq!(oid(&fixture, "HEAD"), original);
        assert!(git_stdout(&fixture, &["status", "--porcelain"]).is_empty());
    }

    #[test]
    fn initialized_submodule_uses_its_own_operation_identity_and_git_directory() {
        let child = initialized_fixture();
        fs::write(child.path().join("base.txt"), "base\n").unwrap();
        commit_all(&child, "base");
        git(&child, &["switch", "-c", "feature"]);
        fs::write(child.path().join("feature.txt"), "feature\n").unwrap();
        commit_all(&child, "feature");
        git(&child, &["switch", "main"]);

        let parent = initialized_fixture();
        let child_path = child.path().to_string_lossy().into_owned();
        git(
            &parent,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                &child_path,
                "modules/child",
            ],
        );
        commit_all(&parent, "add child");

        let nested_root = parent.path().join("modules/child");
        let repository = GitRepository::open(&nested_root).expect("open submodule repository");
        assert_eq!(repository.root(), fs::canonicalize(&nested_root).unwrap());
        let plan = repository
            .prepare_merge("refs/remotes/origin/feature")
            .expect("prepare submodule merge");
        assert!(
            repository
                .execute_operation_plan(&plan)
                .expect("merge submodule branch")
                .is_none()
        );
        assert!(nested_root.join("feature.txt").exists());
        assert_eq!(
            git_stdout(&parent, &["status", "--porcelain"]),
            "M modules/child"
        );
    }

    fn divergent_fixture() -> TempDir {
        let fixture = initialized_fixture();
        fs::write(fixture.path().join("shared.txt"), "base\n").unwrap();
        commit_all(&fixture, "base");
        git(&fixture, &["branch", "feature"]);
        fs::write(fixture.path().join("shared.txt"), "main\n").unwrap();
        commit_all(&fixture, "main change");
        git(&fixture, &["switch", "feature"]);
        fs::write(fixture.path().join("shared.txt"), "feature\n").unwrap();
        commit_all(&fixture, "feature change");
        fixture
    }

    fn cherry_fixture() -> TempDir {
        let fixture = initialized_fixture();
        fs::write(fixture.path().join("shared.txt"), "base\n").unwrap();
        commit_all(&fixture, "base");
        git(&fixture, &["branch", "feature"]);
        fs::write(fixture.path().join("shared.txt"), "main\n").unwrap();
        commit_all(&fixture, "main change");
        git(&fixture, &["switch", "feature"]);
        fs::write(fixture.path().join("shared.txt"), "feature one\n").unwrap();
        commit_all(&fixture, "feature one");
        fs::write(fixture.path().join("second.txt"), "second\n").unwrap();
        commit_all(&fixture, "feature two");
        git(&fixture, &["switch", "main"]);
        fixture
    }

    fn linear_fixture() -> TempDir {
        let fixture = initialized_fixture();
        for index in 0..3 {
            fs::write(
                fixture.path().join(format!("file-{index}.txt")),
                format!("{index}\n"),
            )
            .unwrap();
            commit_all(&fixture, &format!("commit {index}"));
        }
        fixture
    }

    fn initialized_fixture() -> TempDir {
        let fixture = tempfile::tempdir().unwrap();
        git(&fixture, &["init", "-b", "main"]);
        git(&fixture, &["config", "user.name", "Asterlyn Test"]);
        git(&fixture, &["config", "user.email", "test@asterlyn.invalid"]);
        fixture
    }

    fn commit_all(fixture: &TempDir, message: &str) {
        git(fixture, &["add", "."]);
        git(fixture, &["commit", "-m", message]);
    }

    fn oid(fixture: &TempDir, revision: &str) -> String {
        git_stdout(fixture, &["rev-parse", revision])
    }

    fn git_stdout(fixture: &TempDir, arguments: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(fixture.path())
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?}: {}",
            arguments,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn git(fixture: &TempDir, arguments: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(fixture.path())
            .args(arguments)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {:?}: {}",
            arguments,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
