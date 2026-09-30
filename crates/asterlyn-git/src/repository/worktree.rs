use std::ffi::OsString;
use std::path::Path;

use super::{GitRepository, run_from, stale_branch_plan};
use crate::error::GitError;
use crate::model::BranchMutationPlan;
use crate::parser::parse_status;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RegisteredWorktree {
    pub(super) path: String,
    pub(super) branch: Option<String>,
    pub(super) locked: bool,
    pub(super) prunable: bool,
}

pub(super) fn linked_path(worktrees: &[RegisteredWorktree], full_name: &str) -> Option<String> {
    let mut matches = worktrees
        .iter()
        .skip(1)
        .filter(|worktree| worktree.branch.as_deref() == Some(full_name));
    let path = matches.next()?.path.clone();
    matches.next().is_none().then_some(path)
}

impl GitRepository {
    pub(super) fn branch_worktree_checkout_count(
        &self,
        full_name: &str,
    ) -> Result<usize, GitError> {
        Ok(self
            .registered_worktrees()?
            .into_iter()
            .filter(|worktree| worktree.branch.as_deref() == Some(full_name))
            .count())
    }

    pub(super) fn registered_worktrees(&self) -> Result<Vec<RegisteredWorktree>, GitError> {
        let output = self.run_read(
            "read registered Git worktrees",
            ["worktree", "list", "--porcelain", "-z"],
        )?;
        parse_registered_worktrees(&output.stdout)
    }

    pub(super) fn removable_linked_worktree(
        &self,
        full_name: &str,
    ) -> Result<RegisteredWorktree, GitError> {
        let matches: Vec<_> = self
            .registered_worktrees()?
            .into_iter()
            .skip(1)
            .filter(|worktree| worktree.branch.as_deref() == Some(full_name))
            .collect();
        let [worktree] = matches.as_slice() else {
            return Err(GitError::UnsafeOperation {
                operation: "prepare linked worktree removal".to_string(),
                message: if matches.is_empty() {
                    "the selected branch is no longer checked out in a linked Git worktree"
                        .to_string()
                } else {
                    "the selected branch is associated with multiple linked Git worktrees"
                        .to_string()
                },
                blockers: matches.into_iter().map(|item| item.path).collect(),
            });
        };
        if worktree.locked || worktree.prunable {
            return Err(GitError::UnsafeOperation {
                operation: "prepare linked worktree removal".to_string(),
                message: if worktree.locked {
                    "the linked Git worktree is locked".to_string()
                } else {
                    "the linked Git worktree path is missing or prunable".to_string()
                },
                blockers: vec![worktree.path.clone()],
            });
        }
        let path = Path::new(&worktree.path);
        if !path.is_dir() {
            return Err(GitError::UnsafeOperation {
                operation: "prepare linked worktree removal".to_string(),
                message: "the linked Git worktree directory is unavailable".to_string(),
                blockers: vec![worktree.path.clone()],
            });
        }
        let status = run_from(
            path,
            "inspect linked worktree",
            [
                "status",
                "--porcelain=v2",
                "-z",
                "--untracked-files=normal",
                "--ignore-submodules=none",
            ],
        )?;
        let (_, changes) = parse_status(&status.stdout)?;
        if !changes.is_empty() {
            return Err(GitError::UnsafeOperation {
                operation: "prepare linked worktree removal".to_string(),
                message:
                    "commit, stash, or remove changes in the linked worktree before deleting it"
                        .to_string(),
                blockers: changes.into_iter().map(|change| change.path).collect(),
            });
        }
        Ok(worktree.clone())
    }

    pub(super) fn remove_worktree_from_plan(
        &self,
        plan: &BranchMutationPlan,
    ) -> Result<(), GitError> {
        let path = plan
            .worktree_path
            .as_deref()
            .ok_or_else(|| stale_branch_plan("the reviewed worktree path is missing"))?;
        self.run_mutation(
            "remove reviewed linked worktree",
            vec![
                OsString::from("worktree"),
                OsString::from("remove"),
                OsString::from(path),
            ],
        )?;
        Ok(())
    }
}

fn parse_registered_worktrees(input: &[u8]) -> Result<Vec<RegisteredWorktree>, GitError> {
    #[derive(Default)]
    struct PendingWorktree {
        path: Option<String>,
        branch: Option<String>,
        locked: bool,
        prunable: bool,
    }

    fn finish(value: PendingWorktree) -> Result<RegisteredWorktree, GitError> {
        let path = value.path.ok_or_else(|| GitError::Parse {
            context: "Git worktree list".to_string(),
            message: "a worktree record has no path".to_string(),
        })?;
        Ok(RegisteredWorktree {
            path,
            branch: value.branch,
            locked: value.locked,
            prunable: value.prunable,
        })
    }

    let mut worktrees = Vec::new();
    let mut pending: Option<PendingWorktree> = None;
    for field in input.split(|byte| *byte == 0) {
        if field.is_empty() {
            if let Some(value) = pending.take() {
                worktrees.push(finish(value)?);
            }
            continue;
        }
        let value = std::str::from_utf8(field).map_err(|_| GitError::Parse {
            context: "Git worktree list".to_string(),
            message: "non-UTF-8 worktree paths are unsupported".to_string(),
        })?;
        if let Some(path) = value.strip_prefix("worktree ") {
            if pending.is_some() {
                return Err(GitError::Parse {
                    context: "Git worktree list".to_string(),
                    message: "a worktree record is missing its separator".to_string(),
                });
            }
            pending = Some(PendingWorktree {
                path: Some(path.to_string()),
                ..PendingWorktree::default()
            });
        } else if let Some(current) = pending.as_mut() {
            if let Some(branch) = value.strip_prefix("branch ") {
                current.branch = Some(branch.to_string());
            } else if value == "locked" || value.starts_with("locked ") {
                current.locked = true;
            } else if value == "prunable" || value.starts_with("prunable ") {
                current.prunable = true;
            }
        }
    }
    if let Some(value) = pending {
        worktrees.push(finish(value)?);
    }
    if worktrees.is_empty() {
        return Err(GitError::Parse {
            context: "Git worktree list".to_string(),
            message: "Git returned no worktree records".to_string(),
        });
    }
    Ok(worktrees)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use super::*;
    use crate::model::{BranchMutationKind, BranchMutationRequest};

    #[test]
    fn parses_paths_with_spaces_and_worktree_states() {
        let worktrees = parse_registered_worktrees(
            b"worktree /repo\0HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0branch refs/heads/main\0\0worktree /repo linked\0HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\0branch refs/heads/topic\0locked reason\0prunable gitdir file points to non-existent location\0\0",
        )
        .expect("porcelain worktrees parse");

        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].path, "/repo");
        assert_eq!(worktrees[0].branch.as_deref(), Some("refs/heads/main"));
        assert_eq!(worktrees[1].path, "/repo linked");
        assert_eq!(worktrees[1].branch.as_deref(), Some("refs/heads/topic"));
        assert!(worktrees[1].locked);
        assert!(worktrees[1].prunable);
        assert_eq!(linked_path(&worktrees, "refs/heads/main"), None);
        assert_eq!(
            linked_path(&worktrees, "refs/heads/topic").as_deref(),
            Some("/repo linked")
        );
    }

    #[test]
    fn detached_and_duplicate_associations_do_not_annotate_a_branch() {
        let detached = parse_registered_worktrees(
            b"worktree /repo\0branch refs/heads/main\0\0worktree /detached\0detached\0\0",
        )
        .unwrap();
        assert_eq!(linked_path(&detached, "refs/heads/main"), None);

        let duplicate = parse_registered_worktrees(
            b"worktree /repo\0branch refs/heads/main\0\0worktree /one\0branch refs/heads/topic\0\0worktree /two\0branch refs/heads/topic\0\0",
        )
        .unwrap();
        assert_eq!(linked_path(&duplicate, "refs/heads/topic"), None);
    }

    #[test]
    fn rejects_non_utf8_worktree_records() {
        let error = parse_registered_worktrees(b"worktree /repo/\xff\0\0")
            .expect_err("non-UTF-8 paths fail closed");
        assert!(matches!(error, GitError::Parse { .. }));
    }

    #[test]
    fn linked_worktree_is_annotated_and_reviewed_removal_retains_its_branch() {
        let directory = repository_fixture();
        git(directory.path(), &["branch", "linked"]);
        let linked_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/linked"]);
        let linked_parent = tempfile::tempdir().unwrap();
        let linked_path = linked_parent.path().join("linked checkout");
        git(
            directory.path(),
            &["worktree", "add", linked_path.to_str().unwrap(), "linked"],
        );
        let registered_path = fs::canonicalize(&linked_path)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let references = repository.read_references().expect("references");
        assert!(references.iter().any(|branch| {
            branch.full_name == "refs/heads/main" && branch.linked_worktree_path.is_none()
        }));
        assert!(references.iter().any(|branch| {
            branch.full_name == "refs/heads/linked"
                && branch.linked_worktree_path.as_deref() == Some(registered_path.as_str())
        }));

        let plan = repository
            .prepare_branch_mutation(&worktree_request(linked_oid.clone()))
            .expect("worktree removal plan");
        assert_eq!(
            plan.worktree_path.as_deref(),
            Some(registered_path.as_str())
        );
        repository
            .execute_branch_mutation(&plan)
            .expect("remove reviewed linked worktree");
        assert!(!linked_path.exists());
        assert_eq!(
            git_stdout(directory.path(), &["rev-parse", "refs/heads/linked"]),
            linked_oid
        );
        assert!(
            repository
                .read_references()
                .unwrap()
                .into_iter()
                .find(|branch| branch.full_name == "refs/heads/linked")
                .is_some_and(|branch| branch.linked_worktree_path.is_none())
        );
    }

    #[test]
    fn removal_fails_closed_for_dirty_locked_current_and_stale_targets() {
        let directory = repository_fixture();
        git(directory.path(), &["branch", "linked"]);
        let linked_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/linked"]);
        let linked_parent = tempfile::tempdir().unwrap();
        let linked_path = linked_parent.path().join("checkout");
        git(
            directory.path(),
            &["worktree", "add", linked_path.to_str().unwrap(), "linked"],
        );
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let request = worktree_request(linked_oid);
        let plan = repository
            .prepare_branch_mutation(&request)
            .expect("clean worktree removal plan");
        fs::write(linked_path.join("untracked.txt"), "local\n").unwrap();
        let stale = repository
            .execute_branch_mutation(&plan)
            .expect_err("a dirty worktree invalidates the plan");
        assert!(stale.to_string().contains("before deleting it"));
        assert!(linked_path.exists());
        let dirty = repository
            .prepare_branch_mutation(&request)
            .expect_err("dirty worktree is blocked during review");
        assert!(dirty.to_string().contains("before deleting it"));
        fs::remove_file(linked_path.join("untracked.txt")).unwrap();

        git(
            directory.path(),
            &["worktree", "lock", linked_path.to_str().unwrap()],
        );
        let locked = repository
            .prepare_branch_mutation(&request)
            .expect_err("locked worktree is blocked");
        assert!(locked.to_string().contains("locked"));
        git(
            directory.path(),
            &["worktree", "unlock", linked_path.to_str().unwrap()],
        );

        let linked_repository = GitRepository::open(&linked_path).expect("linked repository opens");
        let current = linked_repository
            .prepare_branch_mutation(&request)
            .expect_err("the current worktree cannot remove itself");
        assert!(current.to_string().contains("cannot delete itself"));

        fs::remove_dir_all(&linked_path).unwrap();
        let missing = repository
            .prepare_branch_mutation(&request)
            .expect_err("a missing worktree path is blocked");
        assert!(
            missing.to_string().contains("prunable") || missing.to_string().contains("unavailable")
        );
    }

    #[test]
    fn duplicate_branch_associations_fail_closed() {
        let directory = repository_fixture();
        git(directory.path(), &["branch", "linked"]);
        let linked_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/linked"]);
        let linked_parent = tempfile::tempdir().unwrap();
        let first = linked_parent.path().join("first");
        let second = linked_parent.path().join("second");
        git(
            directory.path(),
            &["worktree", "add", first.to_str().unwrap(), "linked"],
        );
        git(
            directory.path(),
            &[
                "worktree",
                "add",
                "--force",
                second.to_str().unwrap(),
                "linked",
            ],
        );

        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let error = repository
            .prepare_branch_mutation(&worktree_request(linked_oid))
            .expect_err("multiple linked worktrees are ambiguous");
        assert!(error.to_string().contains("multiple"));
    }

    fn repository_fixture() -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        git(directory.path(), &["init", "--initial-branch=main"]);
        git(directory.path(), &["config", "user.name", "Asterlyn Test"]);
        git(
            directory.path(),
            &["config", "user.email", "asterlyn@example.invalid"],
        );
        fs::write(directory.path().join("base.txt"), "base\n").unwrap();
        git(directory.path(), &["add", "base.txt"]);
        git(directory.path(), &["commit", "-m", "Base"]);
        directory
    }

    fn worktree_request(source_oid: String) -> BranchMutationRequest {
        BranchMutationRequest {
            kind: BranchMutationKind::RemoveWorktree,
            source_full_name: "refs/heads/linked".to_string(),
            source_oid,
            new_name: None,
            delete_remote: false,
        }
    }

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .expect("Git starts");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .output()
            .expect("Git starts");
        assert!(output.status.success(), "git {args:?} failed");
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    }
}
