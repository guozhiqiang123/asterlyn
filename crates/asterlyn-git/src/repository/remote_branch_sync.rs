use std::ffi::OsString;

use crate::error::GitError;
use crate::model::{CommitDetails, PushMode, PushPreview, PushTagMode};
use crate::process::CancellationToken;

use super::{
    CurrentBranchContext, GitRepository, PushExecutionOptions, PushTargetContext, remote_cancelled,
    validate_object_id,
};

impl GitRepository {
    pub(super) fn push_target_context(
        &self,
        remote: &str,
        destination_branch: Option<&str>,
        source_branch: Option<&str>,
    ) -> Result<PushTargetContext, GitError> {
        let context = match source_branch {
            Some(source_branch) => self.local_branch_context(source_branch, "push")?,
            None => self.current_branch_context("push")?,
        };
        let configured_remote = self.validated_remote(remote, true)?;
        let branch = context
            .full_ref
            .strip_prefix("refs/heads/")
            .expect("current branch refs are validated")
            .to_string();
        let target_branch = match destination_branch.map(str::trim).filter(|s| !s.is_empty()) {
            Some(custom) => self.validate_branch_name(custom)?,
            None => &branch,
        };
        let is_same_as_local = target_branch == branch;
        let set_upstream_after_push = is_same_as_local && context.upstream.is_none();
        let (destination_ref, comparison_base_oid, publish) = match context.upstream.as_ref() {
            Some(upstream) if is_same_as_local && upstream.remote == configured_remote.name => {
                self.validated_upstream(upstream, true)?;
                let base =
                    self.resolve_commit(&upstream.tracking_ref, "read push comparison base")?;
                (upstream.merge_ref.clone(), Some(base), false)
            }
            _ => {
                // Choosing another remote or explicit destination is an explicit review action.
                let tracking_ref =
                    format!("refs/remotes/{}/{}", configured_remote.name, target_branch);
                let base =
                    if self.reference_exists(&tracking_ref)? {
                        Some(self.resolve_commit(
                            &tracking_ref,
                            "read destination branch comparison base",
                        )?)
                    } else {
                        None
                    };
                let publish = base.is_none();
                (format!("refs/heads/{}", target_branch), base, publish)
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

    pub fn update_branch_ff_only(
        &self,
        source_branch: &str,
        expected_oid: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        const OPERATION: &str = "update local branch";
        validate_object_id(expected_oid)?;
        self.ensure_no_repository_operation(OPERATION)?;
        let before = self.local_branch_context(source_branch, OPERATION)?;
        if before.oid != expected_oid {
            return Err(GitError::UnsafeOperation {
                operation: OPERATION.to_string(),
                message: "the selected local branch moved; refresh before updating it".to_string(),
                blockers: Vec::new(),
            });
        }
        self.ensure_branch_not_checked_out(&before.full_ref, OPERATION)?;
        let upstream = before
            .upstream
            .as_ref()
            .ok_or_else(|| GitError::InvalidInput {
                field: "upstream".to_string(),
                message: "the selected local branch has no supported remote upstream".to_string(),
            })?;
        self.validated_upstream(upstream, false)?;

        let refspec = format!("+{}:{}", upstream.merge_ref, upstream.tracking_ref);
        self.run_remote_operation(
            "update local branch fetch",
            &upstream.remote,
            vec![
                OsString::from("fetch"),
                OsString::from("--atomic"),
                OsString::from("--no-prune"),
                OsString::from("--no-prune-tags"),
                OsString::from("--tags"),
                OsString::from("--no-recurse-submodules"),
                OsString::from("--"),
                OsString::from(&upstream.remote),
                OsString::from(refspec),
            ],
            cancellation,
            true,
            false,
        )?;

        if cancellation.is_cancelled() {
            return Err(remote_cancelled(OPERATION, true, false));
        }
        self.ensure_no_repository_operation(OPERATION)?;
        let after = self.local_branch_context(source_branch, OPERATION)?;
        if before != after {
            return Err(GitError::UnsafeOperation {
                operation: OPERATION.to_string(),
                message: "the selected local branch or its upstream changed while fetching; refresh before retrying"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        self.ensure_branch_not_checked_out(&after.full_ref, OPERATION)?;
        let upstream = after.upstream.as_ref().expect("upstream equality checked");
        self.validated_upstream(upstream, false)?;
        let target_oid =
            self.resolve_commit(&upstream.tracking_ref, "read fetched branch upstream")?;

        if self.is_ancestor(&target_oid, &after.oid)? {
            return Ok(());
        }
        if !self.is_ancestor(&after.oid, &target_oid)? {
            return Err(GitError::UnsafeOperation {
                operation: OPERATION.to_string(),
                message: "the selected local branch and upstream have diverged; check out the branch and merge or rebase explicitly"
                    .to_string(),
                blockers: Vec::new(),
            });
        }

        self.ensure_no_repository_operation(OPERATION)?;
        let before_update = self.local_branch_context(source_branch, OPERATION)?;
        let current_target =
            before_update
                .upstream
                .as_ref()
                .ok_or_else(|| GitError::InvalidInput {
                    field: "upstream".to_string(),
                    message: "the selected local branch no longer has a supported upstream"
                        .to_string(),
                })?;
        let current_target_oid = self.resolve_commit(
            &current_target.tracking_ref,
            "recheck fetched branch upstream",
        )?;
        if before_update != after || current_target_oid != target_oid {
            return Err(GitError::UnsafeOperation {
                operation: OPERATION.to_string(),
                message: "the selected local branch or upstream changed before fast-forward; refresh before retrying"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        self.ensure_branch_not_checked_out(&after.full_ref, OPERATION)?;
        self.run_mutation(
            "fast-forward local branch",
            vec![
                OsString::from("update-ref"),
                OsString::from("-m"),
                OsString::from("update: fast-forward non-current branch"),
                OsString::from(&after.full_ref),
                OsString::from(&target_oid),
                OsString::from(&after.oid),
            ],
        )?;
        if self.resolve_commit(&after.full_ref, "verify updated local branch")? != target_oid {
            return Err(GitError::UnsafeOperation {
                operation: OPERATION.to_string(),
                message: "the local branch update could not be verified; refresh before any retry"
                    .to_string(),
                blockers: Vec::new(),
            });
        }
        Ok(())
    }

    pub fn push_branch_with_destination(
        &self,
        source_branch: &str,
        remote: &str,
        mode: PushMode,
        tag_mode: PushTagMode,
        expected_preview_token: &str,
        cancellation: &CancellationToken,
        destination_branch: Option<&str>,
    ) -> Result<(), GitError> {
        self.push_current_with_options_internal(
            remote,
            Some(expected_preview_token),
            cancellation,
            || {},
            PushExecutionOptions {
                mode,
                tag_mode,
                destination_branch,
                source_branch: Some(source_branch),
            },
        )
    }

    pub fn push_preview_for_branch(
        &self,
        source_branch: &str,
        remote: &str,
        tag_mode: PushTagMode,
        offset: usize,
        page_size: usize,
        destination_branch: Option<&str>,
    ) -> Result<PushPreview, GitError> {
        self.push_preview_with_source(
            remote,
            tag_mode,
            offset,
            page_size,
            destination_branch,
            Some(source_branch),
        )
    }

    pub fn push_branch_file_commit(
        &self,
        source_branch: &str,
        remote: &str,
        tag_mode: PushTagMode,
        expected_preview_token: &str,
        path: &str,
        destination_branch: Option<&str>,
    ) -> Result<Option<CommitDetails>, GitError> {
        self.push_file_commit_with_source(
            remote,
            tag_mode,
            expected_preview_token,
            path,
            destination_branch,
            Some(source_branch),
        )
    }

    pub(super) fn local_branch_context(
        &self,
        source_branch: &str,
        operation: &str,
    ) -> Result<CurrentBranchContext, GitError> {
        let name =
            source_branch
                .strip_prefix("refs/heads/")
                .ok_or_else(|| GitError::InvalidInput {
                    field: "source branch".to_string(),
                    message: "select an exact local branch reference".to_string(),
                })?;
        let validated = self.validate_branch_name(name)?;
        if source_branch != format!("refs/heads/{validated}")
            || !self.reference_exists(source_branch)?
        {
            return Err(GitError::InvalidInput {
                field: "source branch".to_string(),
                message: "the selected local branch no longer exists".to_string(),
            });
        }
        let oid = self.resolve_commit(source_branch, operation)?;
        Ok(CurrentBranchContext {
            full_ref: source_branch.to_string(),
            oid,
            upstream: self.read_upstream_target(validated)?,
            behind: 0,
        })
    }

    fn ensure_branch_not_checked_out(
        &self,
        full_name: &str,
        operation: &str,
    ) -> Result<(), GitError> {
        if self.branch_worktree_checkout_count(full_name)? == 0 {
            return Ok(());
        }
        Err(GitError::UnsafeOperation {
            operation: operation.to_string(),
            message: "the selected branch is checked out in a registered worktree; update it from that worktree"
                .to_string(),
            blockers: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use tempfile::TempDir;

    use super::*;

    struct RemoteFixture {
        _directory: TempDir,
        remote: PathBuf,
        local: PathBuf,
        peer: PathBuf,
    }

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .unwrap();
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
            .unwrap();
        assert!(output.status.success(), "git {:?} failed", args);
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn commit_file(repository: &Path, path: &str, contents: &str, message: &str) -> String {
        fs::write(repository.join(path), contents).unwrap();
        git(repository, &["add", path]);
        git(repository, &["commit", "-m", message]);
        git_stdout(repository, &["rev-parse", "HEAD"])
    }

    fn remote_fixture() -> RemoteFixture {
        let directory = tempfile::tempdir().unwrap();
        let remote = directory.path().join("remote.git");
        let seed = directory.path().join("seed");
        let local = directory.path().join("local");
        let peer = directory.path().join("peer");
        git(
            directory.path(),
            &["init", "--bare", remote.to_str().unwrap()],
        );
        git(
            directory.path(),
            &["init", "-b", "main", seed.to_str().unwrap()],
        );
        for repository in [&seed, &local, &peer] {
            if repository.exists() {
                git(repository, &["config", "user.name", "Asterlyn Test"]);
                git(
                    repository,
                    &["config", "user.email", "test@asterlyn.invalid"],
                );
            }
        }
        fs::write(seed.join("base.txt"), "base\n").unwrap();
        git(&seed, &["add", "base.txt"]);
        git(&seed, &["commit", "-m", "Root"]);
        git(
            &seed,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        );
        git(&seed, &["push", "--set-upstream", "origin", "main"]);
        git(&remote, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        git(
            directory.path(),
            &["clone", remote.to_str().unwrap(), local.to_str().unwrap()],
        );
        git(
            directory.path(),
            &["clone", remote.to_str().unwrap(), peer.to_str().unwrap()],
        );
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

    fn prepare_tracked_topic(fixture: &RemoteFixture) -> String {
        git(&fixture.peer, &["switch", "-c", "topic"]);
        git(
            &fixture.peer,
            &["push", "--set-upstream", "origin", "topic"],
        );
        git(&fixture.local, &["fetch", "origin"]);
        git(
            &fixture.local,
            &["branch", "--track", "topic", "origin/topic"],
        );
        git_stdout(&fixture.local, &["rev-parse", "refs/heads/topic"])
    }

    #[test]
    fn updates_a_non_current_branch_by_exact_fast_forward_without_checkout() {
        let fixture = remote_fixture();
        let first = prepare_tracked_topic(&fixture);
        let second = commit_file(&fixture.peer, "topic.txt", "two\n", "Topic two");
        git(&fixture.peer, &["push", "origin", "topic"]);
        let repository = GitRepository::open(&fixture.local).unwrap();
        repository
            .update_branch_ff_only("refs/heads/topic", &first, &CancellationToken::new())
            .unwrap();
        assert_eq!(
            git_stdout(&fixture.local, &["branch", "--show-current"]),
            "main"
        );
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "refs/heads/topic"]),
            second
        );
    }

    #[test]
    fn reports_divergence_for_each_non_current_local_branch() {
        let fixture = remote_fixture();
        prepare_tracked_topic(&fixture);
        git(&fixture.local, &["switch", "topic"]);
        commit_file(&fixture.local, "local-topic.txt", "local\n", "Local topic");
        git(&fixture.local, &["switch", "main"]);
        commit_file(
            &fixture.peer,
            "remote-topic.txt",
            "remote\n",
            "Remote topic",
        );
        git(&fixture.peer, &["push", "origin", "topic"]);
        git(&fixture.local, &["fetch", "origin"]);
        let repository = GitRepository::open(&fixture.local).unwrap();
        let branches = repository.read_references().unwrap();
        let topic = branches
            .iter()
            .find(|branch| branch.full_name == "refs/heads/topic")
            .unwrap();
        assert!(!topic.current);
        assert_eq!(topic.upstream_remote.as_deref(), Some("origin"));
        assert_eq!(topic.upstream_ref.as_deref(), Some("refs/heads/topic"));
        assert_eq!((topic.ahead, topic.behind), (1, 1));
    }

    #[test]
    fn non_current_branch_update_rejects_divergence_and_registered_worktrees() {
        let fixture = remote_fixture();
        let base = prepare_tracked_topic(&fixture);
        git(&fixture.local, &["switch", "topic"]);
        let local = commit_file(&fixture.local, "local-topic.txt", "local\n", "Local topic");
        git(&fixture.local, &["switch", "main"]);
        commit_file(
            &fixture.peer,
            "remote-topic.txt",
            "remote\n",
            "Remote topic",
        );
        git(&fixture.peer, &["push", "origin", "topic"]);
        let repository = GitRepository::open(&fixture.local).unwrap();
        assert!(matches!(
            repository.update_branch_ff_only("refs/heads/topic", &local, &CancellationToken::new()),
            Err(GitError::UnsafeOperation { .. })
        ));
        assert_eq!(
            git_stdout(&fixture.local, &["rev-parse", "refs/heads/topic"]),
            local
        );

        git(
            &fixture.local,
            &["update-ref", "refs/heads/topic", &base, &local],
        );
        let worktree_root = tempfile::tempdir().unwrap();
        let checkout = worktree_root.path().join("topic");
        git(
            &fixture.local,
            &["worktree", "add", checkout.to_str().unwrap(), "topic"],
        );
        assert!(matches!(
            repository.update_branch_ff_only("refs/heads/topic", &base, &CancellationToken::new()),
            Err(GitError::UnsafeOperation { .. })
        ));
    }

    #[test]
    fn previews_and_pushes_a_non_current_branch_without_switching_head() {
        let fixture = remote_fixture();
        git(&fixture.local, &["switch", "-c", "topic"]);
        let topic = commit_file(&fixture.local, "topic.txt", "topic\n", "Topic");
        git(&fixture.local, &["switch", "main"]);
        let repository = GitRepository::open(&fixture.local).unwrap();
        let preview = repository
            .push_preview_for_branch(
                "refs/heads/topic",
                "origin",
                PushTagMode::None,
                0,
                100,
                None,
            )
            .unwrap();
        assert_eq!(preview.source_ref, "refs/heads/topic");
        assert_eq!(preview.head_oid, topic);
        repository
            .push_branch_with_destination(
                "refs/heads/topic",
                "origin",
                PushMode::Ordinary,
                PushTagMode::None,
                &preview.preview_token,
                &CancellationToken::new(),
                None,
            )
            .unwrap();
        assert_eq!(
            git_stdout(&fixture.local, &["branch", "--show-current"]),
            "main"
        );
        assert_eq!(
            git_stdout(&fixture.remote, &["rev-parse", "refs/heads/topic"]),
            topic
        );
        assert_eq!(
            git_stdout(
                &fixture.local,
                &[
                    "for-each-ref",
                    "--format=%(upstream:short)",
                    "refs/heads/topic"
                ]
            ),
            "origin/topic"
        );
    }
}
