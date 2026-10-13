use super::*;
use crate::model::HeadCommitMutationKind;

impl GitRepository {
    pub fn prepare_head_commit_mutation(
        &self,
        selected_head_oid: &str,
        kind: HeadCommitMutationKind,
    ) -> Result<GitResetPlan, GitError> {
        self.ensure_no_repository_operation("prepare latest commit mutation")?;
        self.ensure_clean_worktree("prepare latest commit mutation")?;
        validate_object_id(selected_head_oid)?;
        let current = self.current_branch_context("prepare latest commit mutation")?;
        if current.oid != selected_head_oid {
            return Err(invalid_head_commit_mutation(
                "the selected commit is no longer the current HEAD",
            ));
        }
        let parents = self.head_commit_parents(&current.oid)?;
        if parents.len() != 1 {
            return Err(invalid_head_commit_mutation(
                "the latest commit must have exactly one parent",
            ));
        }
        let publication_basis = self.unpublished_head_basis(&current)?;
        let target_oid = parents[0].clone();
        let preview_token = mutation_token(
            "asterlyn-head-commit-mutation-v1",
            &[
                kind.label(),
                &current.full_ref,
                &current.oid,
                &target_oid,
                &publication_basis,
            ],
        );
        Ok(GitResetPlan {
            repository_root: self.root.to_string_lossy().into_owned(),
            start_head_ref: current.full_ref,
            start_head_oid: current.oid,
            target_oid,
            preview_token,
        })
    }

    pub fn execute_head_commit_mutation(
        &self,
        plan: &GitResetPlan,
        kind: HeadCommitMutationKind,
    ) -> Result<(), GitError> {
        if plan.repository_root != self.root.to_string_lossy() {
            return Err(stale_head_commit_mutation(
                "the reviewed plan belongs to another repository",
            ));
        }
        let refreshed = self.prepare_head_commit_mutation(&plan.start_head_oid, kind)?;
        if &refreshed != plan {
            return Err(stale_head_commit_mutation(
                "the branch, latest commit, parent, publication state, or worktree changed after review",
            ));
        }
        self.run_mutation(
            kind.label(),
            vec![
                OsString::from("reset"),
                OsString::from(kind.reset_mode().argument()),
                OsString::from("--no-recurse-submodules"),
                OsString::from(&plan.target_oid),
            ],
        )?;
        let after = self.current_branch_context("verify latest commit mutation")?;
        if after.full_ref != plan.start_head_ref || after.oid != plan.target_oid {
            return Err(GitError::UnsafeOperation {
                operation: "verify latest commit mutation".to_string(),
                message: "Git returned success, but the reviewed branch was not observed at the latest commit's parent; refresh and inspect the repository before another operation".to_string(),
                blockers: Vec::new(),
            });
        }
        Ok(())
    }

    fn unpublished_head_basis(&self, current: &CurrentBranchContext) -> Result<String, GitError> {
        if let Some(upstream) = current.upstream.as_ref() {
            if !self.reference_exists(&upstream.tracking_ref)? {
                return Err(invalid_head_commit_mutation(
                    "the configured upstream has not been fetched",
                ));
            }
            let upstream_oid = self.resolve_commit(
                &upstream.tracking_ref,
                "read latest commit publication state",
            )?;
            if self.is_ancestor(&current.oid, &upstream_oid)? {
                return Err(invalid_head_commit_mutation(
                    "the latest commit is already reachable from the current upstream",
                ));
            }
            return Ok(format!("upstream:{}:{upstream_oid}", upstream.tracking_ref));
        }
        let output = self.run_read_owned(
            "read latest commit remote containment",
            vec![
                OsString::from("for-each-ref"),
                OsString::from("--format=%(refname)"),
                OsString::from(format!("--contains={}", current.oid)),
                OsString::from("refs/remotes"),
            ],
        )?;
        if String::from_utf8_lossy(&output.stdout)
            .lines()
            .any(|reference| !reference.trim().is_empty())
        {
            return Err(invalid_head_commit_mutation(
                "the latest commit is already reachable from a remote-tracking branch",
            ));
        }
        Ok("all-remotes:no-containing-ref".to_string())
    }

    fn head_commit_parents(&self, oid: &str) -> Result<Vec<String>, GitError> {
        let output = self.run_read_owned(
            "read latest commit parents",
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
                context: "latest commit parents".to_string(),
                message: "Git returned no commit".to_string(),
            });
        };
        if !resolved_oid.eq_ignore_ascii_case(oid) {
            return Err(GitError::Parse {
                context: "latest commit parents".to_string(),
                message: "Git returned an unexpected commit id".to_string(),
            });
        }
        let parents = objects.map(str::to_string).collect::<Vec<_>>();
        for parent in &parents {
            validate_object_id(parent)?;
        }
        Ok(parents)
    }
}

fn invalid_head_commit_mutation(message: &str) -> GitError {
    GitError::InvalidInput {
        field: "latest commit action".to_string(),
        message: message.to_string(),
    }
}

fn stale_head_commit_mutation(message: &str) -> GitError {
    GitError::UnsafeOperation {
        operation: "execute reviewed latest commit action".to_string(),
        message: format!("the reviewed latest commit plan is stale: {message}; prepare it again"),
        blockers: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
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
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn fixture() -> TempDir {
        let directory = tempfile::tempdir().unwrap();
        git(directory.path(), &["init", "-b", "main"]);
        git(directory.path(), &["config", "core.autocrlf", "false"]);
        git(directory.path(), &["config", "user.name", "Asterlyn Test"]);
        git(
            directory.path(),
            &["config", "user.email", "test@asterlyn.invalid"],
        );
        directory
    }

    struct RemoteFixture {
        _directory: TempDir,
        local: PathBuf,
    }

    fn remote_fixture() -> RemoteFixture {
        let directory = tempfile::tempdir().unwrap();
        let remote = directory.path().join("remote.git");
        let seed = directory.path().join("seed");
        let local = directory.path().join("local");
        git(
            directory.path(),
            &["init", "--bare", remote.to_str().unwrap()],
        );
        git(
            directory.path(),
            &["init", "-b", "main", seed.to_str().unwrap()],
        );
        git(&seed, &["config", "user.name", "Asterlyn Test"]);
        git(&seed, &["config", "user.email", "test@asterlyn.invalid"]);
        commit_file(&seed, "base.txt", "base\n", "Root");
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
        git(&local, &["config", "user.name", "Asterlyn Test"]);
        git(&local, &["config", "user.email", "test@asterlyn.invalid"]);
        RemoteFixture {
            _directory: directory,
            local,
        }
    }

    fn commit_file(repository: &Path, path: &str, contents: &str, message: &str) -> String {
        fs::write(repository.join(path), contents).unwrap();
        git(repository, &["add", path]);
        git(repository, &["commit", "-m", message]);
        git_stdout(repository, &["rev-parse", "HEAD"])
    }

    #[test]
    fn undo_latest_unpublished_commit_preserves_its_changes_unstaged() {
        let fixture = remote_fixture();
        let base = git_stdout(&fixture.local, &["rev-parse", "HEAD"]);
        let tip = commit_file(&fixture.local, "latest.txt", "latest\n", "Latest");
        let repository = GitRepository::open(&fixture.local).unwrap();
        let plan = repository
            .prepare_head_commit_mutation(&tip, HeadCommitMutationKind::UndoCommit)
            .unwrap();
        repository
            .execute_head_commit_mutation(&plan, HeadCommitMutationKind::UndoCommit)
            .unwrap();
        assert_eq!(git_stdout(&fixture.local, &["rev-parse", "HEAD"]), base);
        assert_eq!(
            fs::read_to_string(fixture.local.join("latest.txt")).unwrap(),
            "latest\n"
        );
        assert!(git_stdout(&fixture.local, &["diff", "--cached", "--name-only"]).is_empty());
        assert_eq!(
            git_stdout(&fixture.local, &["status", "--porcelain"]),
            "?? latest.txt"
        );
    }

    #[test]
    fn drop_latest_unpublished_commit_discards_its_changes() {
        let fixture = remote_fixture();
        let base = git_stdout(&fixture.local, &["rev-parse", "HEAD"]);
        let tip = commit_file(&fixture.local, "latest.txt", "latest\n", "Latest");
        let repository = GitRepository::open(&fixture.local).unwrap();
        let plan = repository
            .prepare_head_commit_mutation(&tip, HeadCommitMutationKind::DropCommit)
            .unwrap();
        repository
            .execute_head_commit_mutation(&plan, HeadCommitMutationKind::DropCommit)
            .unwrap();
        assert_eq!(git_stdout(&fixture.local, &["rev-parse", "HEAD"]), base);
        assert!(!fixture.local.join("latest.txt").exists());
        assert!(git_stdout(&fixture.local, &["status", "--porcelain"]).is_empty());
    }

    #[test]
    fn latest_commit_actions_reject_ineligible_and_stale_heads() {
        let remote = remote_fixture();
        let published = commit_file(&remote.local, "published.txt", "published\n", "Published");
        git(&remote.local, &["push", "origin", "main"]);
        let repository = GitRepository::open(&remote.local).unwrap();
        assert!(
            repository
                .prepare_head_commit_mutation(&published, HeadCommitMutationKind::UndoCommit)
                .is_err()
        );
        let outgoing = commit_file(&remote.local, "outgoing.txt", "outgoing\n", "Outgoing");
        fs::write(remote.local.join("dirty.txt"), "dirty\n").unwrap();
        assert!(
            repository
                .prepare_head_commit_mutation(&outgoing, HeadCommitMutationKind::UndoCommit)
                .is_err()
        );
        fs::remove_file(remote.local.join("dirty.txt")).unwrap();
        let plan = repository
            .prepare_head_commit_mutation(&outgoing, HeadCommitMutationKind::UndoCommit)
            .unwrap();
        commit_file(&remote.local, "new-head.txt", "new\n", "New head");
        assert!(
            repository
                .execute_head_commit_mutation(&plan, HeadCommitMutationKind::UndoCommit)
                .is_err()
        );

        let root = fixture();
        let root_oid = commit_file(root.path(), "root.txt", "root\n", "Root");
        assert!(
            GitRepository::open(root.path())
                .unwrap()
                .prepare_head_commit_mutation(&root_oid, HeadCommitMutationKind::DropCommit)
                .is_err()
        );
        let local = fixture();
        commit_file(local.path(), "base.txt", "base\n", "Base");
        let tip = commit_file(local.path(), "tip.txt", "tip\n", "Tip");
        GitRepository::open(local.path())
            .unwrap()
            .prepare_head_commit_mutation(&tip, HeadCommitMutationKind::UndoCommit)
            .unwrap();

        let merge = remote_fixture();
        git(&merge.local, &["switch", "-c", "side"]);
        commit_file(&merge.local, "side.txt", "side\n", "Side");
        git(&merge.local, &["switch", "main"]);
        commit_file(&merge.local, "main.txt", "main\n", "Main");
        git(
            &merge.local,
            &["merge", "--no-ff", "side", "-m", "Merge side"],
        );
        let merge_oid = git_stdout(&merge.local, &["rev-parse", "HEAD"]);
        assert!(
            GitRepository::open(&merge.local)
                .unwrap()
                .prepare_head_commit_mutation(&merge_oid, HeadCommitMutationKind::DropCommit)
                .is_err()
        );
    }
}
