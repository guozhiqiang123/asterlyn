use std::ffi::OsString;
use std::path::Path;

use super::{
    GitRepository, branch_mutation_token, run_from, stale_branch_plan, validate_object_id,
};
use crate::error::GitError;
use crate::model::{BranchMutationPlan, WorktreeRemovalReview};
use crate::parser::parse_status;

const REVIEWED_CHANGE_LIMIT: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RegisteredWorktree {
    pub(super) path: String,
    pub(super) head_oid: Option<String>,
    pub(super) branch: Option<String>,
    pub(super) locked: bool,
    pub(super) prunable: bool,
}

pub(super) fn primary_path(worktrees: &[RegisteredWorktree], full_name: &str) -> Option<String> {
    worktrees
        .first()
        .filter(|worktree| worktree.branch.as_deref() == Some(full_name))
        .map(|worktree| worktree.path.clone())
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

    pub(super) fn worktree_removal_review(
        &self,
        full_name: &str,
        source_oid: &str,
        force_requested: bool,
        reviewed_token: Option<&str>,
    ) -> Result<WorktreeRemovalReview, GitError> {
        let worktrees = self.registered_worktrees()?;
        let matches: Vec<_> = worktrees
            .iter()
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
                blockers: matches.into_iter().map(|item| item.path.clone()).collect(),
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
        let all_changed_paths = changes
            .into_iter()
            .map(|change| change.path)
            .collect::<Vec<_>>();
        let total_changed_paths = u32::try_from(all_changed_paths.len()).unwrap_or(u32::MAX);
        let changed_paths = all_changed_paths
            .iter()
            .take(REVIEWED_CHANGE_LIMIT)
            .cloned()
            .collect::<Vec<_>>();
        let primary = worktrees.first().ok_or_else(|| GitError::Parse {
            context: "Git worktree list".to_string(),
            message: "Git returned no primary worktree".to_string(),
        })?;
        let primary_head_oid = primary.head_oid.clone().ok_or_else(|| GitError::Parse {
            context: "Git worktree list".to_string(),
            message: "the primary worktree has no HEAD object".to_string(),
        })?;
        validate_object_id(&primary_head_oid)?;
        let unmerged_commit_count = self.commits_not_in_primary(source_oid, &primary_head_oid)?;
        let force_required = total_changed_paths > 0 || unmerged_commit_count > 0;
        // Bind every dirty path into the review token, including paths omitted from the bounded UI
        // preview. A change outside the displayed sample must still invalidate force authorization.
        let changes_identity = all_changed_paths.join("\0");
        let total_identity = total_changed_paths.to_string();
        let unmerged_identity = unmerged_commit_count.to_string();
        let review_token = branch_mutation_token(&[
            "worktree-review",
            full_name,
            source_oid,
            &worktree.path,
            &primary.path,
            primary.branch.as_deref().unwrap_or("detached"),
            &primary_head_oid,
            &total_identity,
            &changes_identity,
            &unmerged_identity,
        ]);
        if force_requested && reviewed_token != Some(review_token.as_str()) {
            return Err(GitError::UnsafeOperation {
                operation: "authorize forced linked worktree removal".to_string(),
                message: "the worktree warnings changed after review; inspect them again"
                    .to_string(),
                blockers: vec![worktree.path.clone()],
            });
        }
        if force_requested && !force_required {
            return Err(GitError::InvalidInput {
                field: "force worktree removal".to_string(),
                message: "force is available only when the reviewed worktree has warnings"
                    .to_string(),
            });
        }
        Ok(WorktreeRemovalReview {
            path: worktree.path.clone(),
            changed_paths,
            total_changed_paths,
            changes_truncated: usize::try_from(total_changed_paths)
                .map_or(true, |total| total > REVIEWED_CHANGE_LIMIT),
            primary_head_ref: primary.branch.clone(),
            primary_head_oid,
            unmerged_commit_count,
            force_required,
            force_authorized: force_requested,
            review_token,
        })
    }

    pub(super) fn remove_worktree_from_plan(
        &self,
        plan: &BranchMutationPlan,
    ) -> Result<(), GitError> {
        let review = plan
            .worktree_review
            .as_ref()
            .ok_or_else(|| stale_branch_plan("the reviewed worktree evidence is missing"))?;
        if review.force_required && !review.force_authorized {
            return Err(stale_branch_plan(
                "the worktree has warnings that require explicit force authorization",
            ));
        }
        let mut arguments = vec![OsString::from("worktree"), OsString::from("remove")];
        if review.force_authorized {
            arguments.push(OsString::from("--force"));
        }
        arguments.push(OsString::from(&review.path));
        self.run_mutation("remove reviewed linked worktree", arguments)?;
        Ok(())
    }

    fn commits_not_in_primary(&self, source_oid: &str, primary_oid: &str) -> Result<u32, GitError> {
        let range = format!("{primary_oid}..{source_oid}");
        let output = self.run_read_owned(
            "count commits outside primary worktree HEAD",
            vec![
                OsString::from("rev-list"),
                OsString::from("--count"),
                OsString::from(range),
            ],
        )?;
        let count = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u64>()
            .map_err(|error| GitError::Parse {
                context: "worktree commit comparison".to_string(),
                message: error.to_string(),
            })?;
        Ok(u32::try_from(count).unwrap_or(u32::MAX))
    }
}

fn parse_registered_worktrees(input: &[u8]) -> Result<Vec<RegisteredWorktree>, GitError> {
    #[derive(Default)]
    struct PendingWorktree {
        path: Option<String>,
        head_oid: Option<String>,
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
            head_oid: value.head_oid,
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
            if let Some(head_oid) = value.strip_prefix("HEAD ") {
                current.head_oid = Some(head_oid.to_string());
            } else if let Some(branch) = value.strip_prefix("branch ") {
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
        assert_eq!(
            primary_path(&worktrees, "refs/heads/main").as_deref(),
            Some("/repo")
        );
        assert_eq!(primary_path(&worktrees, "refs/heads/topic"), None);
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
        let primary_path = fs::canonicalize(directory.path())
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(references.iter().any(|branch| {
            branch.full_name == "refs/heads/main"
                && branch.primary_worktree_path.as_deref() == Some(primary_path.as_str())
                && branch.linked_worktree_path.is_none()
        }));
        assert!(references.iter().any(|branch| {
            branch.full_name == "refs/heads/linked"
                && branch.primary_worktree_path.is_none()
                && branch.linked_worktree_path.as_deref() == Some(registered_path.as_str())
        }));

        let plan = repository
            .prepare_branch_mutation(&worktree_request(linked_oid.clone()))
            .expect("worktree removal plan");
        assert_eq!(
            plan.worktree_review
                .as_ref()
                .map(|review| review.path.as_str()),
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
    fn removal_reviews_dirty_state_and_blocks_locked_current_and_stale_targets() {
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
        assert!(stale.to_string().contains("changed"));
        assert!(linked_path.exists());
        let dirty = repository
            .prepare_branch_mutation(&request)
            .expect("dirty worktree is reviewed before force authorization");
        let review = dirty.worktree_review.as_ref().unwrap();
        assert!(review.force_required);
        assert!(!review.force_authorized);
        assert_eq!(review.changed_paths, ["untracked.txt"]);
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

    #[test]
    fn dirty_unmerged_worktree_requires_reviewed_force_and_retains_its_branch() {
        let directory = repository_fixture();
        git(directory.path(), &["branch", "linked"]);
        let linked_parent = tempfile::tempdir().unwrap();
        let linked_path = linked_parent.path().join("forced");
        git(
            directory.path(),
            &["worktree", "add", linked_path.to_str().unwrap(), "linked"],
        );
        fs::write(linked_path.join("committed.txt"), "committed\n").unwrap();
        git(&linked_path, &["add", "committed.txt"]);
        git(&linked_path, &["commit", "-m", "Linked only"]);
        fs::write(linked_path.join("draft.txt"), "draft\n").unwrap();
        let linked_oid = git_stdout(&linked_path, &["rev-parse", "HEAD"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let request = worktree_request(linked_oid.clone());
        let plan = repository
            .prepare_branch_mutation(&request)
            .expect("warning review is prepared");
        let review = plan.worktree_review.as_ref().unwrap();
        assert_eq!(review.changed_paths, ["draft.txt"]);
        assert_eq!(review.unmerged_commit_count, 1);
        assert!(review.force_required);
        assert!(!review.force_authorized);
        let ordinary = repository
            .execute_branch_mutation(&plan)
            .expect_err("warning review cannot execute without force authorization");
        assert!(ordinary.to_string().contains("force authorization"));

        fs::write(linked_path.join("late.txt"), "late\n").unwrap();
        let stale_force = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                force_worktree_removal: true,
                reviewed_worktree_token: Some(review.review_token.clone()),
                ..request.clone()
            })
            .expect_err("changed warnings invalidate force authorization");
        assert!(stale_force.to_string().contains("warnings changed"));

        let refreshed = repository
            .prepare_branch_mutation(&request)
            .expect("changed warnings are reviewed again");
        let refreshed_review = refreshed.worktree_review.as_ref().unwrap();
        assert_eq!(refreshed_review.total_changed_paths, 2);
        let forced = repository
            .prepare_branch_mutation(&BranchMutationRequest {
                force_worktree_removal: true,
                reviewed_worktree_token: Some(refreshed_review.review_token.clone()),
                ..request
            })
            .expect("exact warnings authorize force");
        assert!(
            forced
                .worktree_review
                .as_ref()
                .is_some_and(|review| review.force_authorized)
        );
        repository
            .execute_branch_mutation(&forced)
            .expect("reviewed forced removal succeeds");
        assert!(!linked_path.exists());
        assert_eq!(
            git_stdout(directory.path(), &["rev-parse", "refs/heads/linked"]),
            linked_oid
        );
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
            force_worktree_removal: false,
            reviewed_worktree_token: None,
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
