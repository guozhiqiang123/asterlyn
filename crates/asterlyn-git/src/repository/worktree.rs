use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{
    GitRepository, branch_mutation_token, run_from, stale_branch_plan, validate_object_id,
};
use crate::error::GitError;
use crate::model::{
    BranchKind, BranchMutationPlan, WorktreeCreationPlan, WorktreeCreationRequest,
    WorktreeRemovalReview,
};
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
    pub fn prepare_worktree_creation(
        &self,
        request: &WorktreeCreationRequest,
    ) -> Result<WorktreeCreationPlan, GitError> {
        self.ensure_no_repository_operation("prepare linked worktree creation")?;
        validate_object_id(&request.source_oid)?;
        let source = self
            .read_references()?
            .into_iter()
            .find(|candidate| {
                candidate.repository_id == "."
                    && matches!(candidate.kind, BranchKind::Local | BranchKind::Remote)
                    && candidate.full_name == request.source_full_name
            })
            .ok_or_else(|| GitError::InvalidInput {
                field: "source branch".to_string(),
                message: "select an existing local or remote-tracking branch".to_string(),
            })?;
        if source.oid != request.source_oid {
            return Err(stale_worktree_creation(
                "the selected source branch moved to a different commit",
            ));
        }

        let parent = canonical_parent(&request.parent_directory)?;
        let project_name = validate_project_name(&request.project_name)?;
        let destination = parent.join(project_name);
        ensure_destination_absent(&destination)?;
        let worktrees = self.registered_worktrees()?;
        for registered in &worktrees {
            let registered_path = Path::new(&registered.path);
            let comparable =
                fs::canonicalize(registered_path).unwrap_or_else(|_| registered_path.to_path_buf());
            if paths_overlap(&destination, &comparable) {
                return Err(GitError::UnsafeOperation {
                    operation: "prepare linked worktree creation".to_string(),
                    message: "the destination overlaps a registered Git worktree".to_string(),
                    blockers: vec![registered.path.clone()],
                });
            }
        }
        if paths_overlap(&destination, self.git_directory()) {
            return Err(GitError::UnsafeOperation {
                operation: "prepare linked worktree creation".to_string(),
                message: "the destination overlaps repository metadata".to_string(),
                blockers: vec![self.git_directory().to_string_lossy().into_owned()],
            });
        }

        let new_branch = request
            .new_branch
            .as_deref()
            .map(|name| self.validate_branch_name(name))
            .transpose()?
            .map(str::to_string);
        if let Some(name) = new_branch.as_deref()
            && self.reference_exists(&format!("refs/heads/{name}"))?
        {
            return Err(GitError::InvalidInput {
                field: "new branch".to_string(),
                message: format!("'{name}' already exists"),
            });
        }

        let start_head_oid = self.resolve_commit("HEAD", "read worktree creation HEAD")?;
        let start_head_ref = self.current_branch()?.map_or_else(
            || "DETACHED".to_string(),
            |name| format!("refs/heads/{name}"),
        );
        let parent_directory = parent.to_string_lossy().into_owned();
        let destination_path = destination.to_string_lossy().into_owned();
        let worktree_identity = worktrees
            .iter()
            .map(|item| {
                format!(
                    "{}\0{}\0{}\0{}",
                    item.path,
                    item.branch.as_deref().unwrap_or("detached"),
                    item.head_oid.as_deref().unwrap_or(""),
                    item.locked || item.prunable,
                )
            })
            .collect::<Vec<_>>()
            .join("\0");
        let preview_token = branch_mutation_token(&[
            "create-worktree",
            &request.source_full_name,
            &source.oid,
            &parent_directory,
            project_name,
            &destination_path,
            new_branch.as_deref().unwrap_or("detached"),
            &start_head_ref,
            &start_head_oid,
            &worktree_identity,
        ]);
        Ok(WorktreeCreationPlan {
            repository_root: self.root().to_string_lossy().into_owned(),
            source_full_name: request.source_full_name.clone(),
            source_name: source.name,
            source_oid: source.oid,
            parent_directory,
            project_name: project_name.to_string(),
            destination_path,
            new_branch,
            start_head_ref,
            start_head_oid,
            preview_token,
        })
    }

    pub fn execute_worktree_creation(&self, plan: &WorktreeCreationPlan) -> Result<(), GitError> {
        if plan.repository_root != self.root().to_string_lossy() {
            return Err(stale_worktree_creation(
                "the reviewed plan belongs to another repository",
            ));
        }
        let refreshed = self.prepare_worktree_creation(&WorktreeCreationRequest {
            source_full_name: plan.source_full_name.clone(),
            source_oid: plan.source_oid.clone(),
            parent_directory: plan.parent_directory.clone(),
            project_name: plan.project_name.clone(),
            new_branch: plan.new_branch.clone(),
        })?;
        if refreshed.preview_token != plan.preview_token {
            return Err(stale_worktree_creation(
                "HEAD, the source branch, destination, or registered worktrees changed",
            ));
        }
        let mut arguments = vec![OsString::from("worktree"), OsString::from("add")];
        if let Some(branch) = plan.new_branch.as_deref() {
            arguments.extend([
                OsString::from("--no-track"),
                OsString::from("-b"),
                OsString::from(branch),
            ]);
        } else {
            arguments.push(OsString::from("--detach"));
        }
        arguments.extend([
            OsString::from(&plan.destination_path),
            OsString::from(&plan.source_oid),
        ]);
        self.run_mutation("create reviewed linked worktree", arguments)?;
        Ok(())
    }

    pub fn registered_linked_worktree_path_from_primary(
        &self,
        full_name: &str,
        source_oid: &str,
    ) -> Result<PathBuf, GitError> {
        validate_object_id(source_oid)?;
        let source = self.read_references()?.into_iter().find(|candidate| {
            candidate.repository_id == "."
                && candidate.kind == BranchKind::Local
                && candidate.full_name == full_name
        });
        if source.as_ref().map(|branch| branch.oid.as_str()) != Some(source_oid) {
            return Err(stale_worktree_creation("the selected local branch changed"));
        }
        let worktrees = self.registered_worktrees()?;
        let primary = worktrees.first().ok_or_else(|| GitError::Parse {
            context: "Git worktree list".to_string(),
            message: "Git returned no primary worktree".to_string(),
        })?;
        if !same_existing_directory(self.root(), Path::new(&primary.path)) {
            return Err(GitError::UnsafeOperation {
                operation: "reveal linked worktree".to_string(),
                message: "open the primary worktree before revealing a linked worktree".to_string(),
                blockers: Vec::new(),
            });
        }
        let matches = worktrees
            .iter()
            .skip(1)
            .filter(|item| item.branch.as_deref() == Some(full_name))
            .collect::<Vec<_>>();
        let [linked] = matches.as_slice() else {
            return Err(GitError::UnsafeOperation {
                operation: "reveal linked worktree".to_string(),
                message: "the branch is not associated with exactly one linked worktree"
                    .to_string(),
                blockers: matches.into_iter().map(|item| item.path.clone()).collect(),
            });
        };
        let path = PathBuf::from(&linked.path);
        if linked.prunable || !path.is_dir() {
            return Err(GitError::UnsafeOperation {
                operation: "reveal linked worktree".to_string(),
                message: "the registered linked worktree directory is unavailable".to_string(),
                blockers: vec![linked.path.clone()],
            });
        }
        Ok(path)
    }

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

fn canonical_parent(value: &str) -> Result<PathBuf, GitError> {
    let path = Path::new(value);
    if value.trim() != value || value.is_empty() || !path.is_absolute() {
        return Err(GitError::InvalidInput {
            field: "worktree location".to_string(),
            message: "select an existing absolute parent directory".to_string(),
        });
    }
    let canonical = fs::canonicalize(path).map_err(|error| GitError::Io {
        operation: "resolve worktree parent directory".to_string(),
        message: error.to_string(),
    })?;
    if !canonical.is_dir() {
        return Err(GitError::InvalidInput {
            field: "worktree location".to_string(),
            message: "select an existing parent directory".to_string(),
        });
    }
    Ok(canonical)
}

fn ensure_destination_absent(path: &Path) -> Result<(), GitError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(GitError::InvalidInput {
            field: "worktree destination".to_string(),
            message: "the destination already exists".to_string(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(GitError::Io {
            operation: "inspect worktree destination".to_string(),
            message: error.to_string(),
        }),
    }
}

fn validate_project_name(value: &str) -> Result<&str, GitError> {
    let invalid_windows_name = value
        .trim_end_matches([' ', '.'])
        .split('.')
        .next()
        .is_some_and(|stem| {
            matches!(
                stem.to_ascii_uppercase().as_str(),
                "CON"
                    | "PRN"
                    | "AUX"
                    | "NUL"
                    | "COM1"
                    | "COM2"
                    | "COM3"
                    | "COM4"
                    | "COM5"
                    | "COM6"
                    | "COM7"
                    | "COM8"
                    | "COM9"
                    | "LPT1"
                    | "LPT2"
                    | "LPT3"
                    | "LPT4"
                    | "LPT5"
                    | "LPT6"
                    | "LPT7"
                    | "LPT8"
                    | "LPT9"
            )
        });
    let one_component = Path::new(value).components().count() == 1
        && matches!(
            Path::new(value).components().next(),
            Some(Component::Normal(_))
        );
    if value.is_empty()
        || value.trim() != value
        || value.len() > 120
        || value.ends_with('.')
        || !one_component
        || invalid_windows_name
        || value
            .chars()
            .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
    {
        return Err(GitError::InvalidInput {
            field: "project name".to_string(),
            message: "enter one portable folder name".to_string(),
        });
    }
    Ok(value)
}

fn paths_overlap(left: &Path, right: &Path) -> bool {
    left == right || left.starts_with(right) || right.starts_with(left)
}

fn same_existing_directory(left: &Path, right: &Path) -> bool {
    matches!(
        (fs::canonicalize(left), fs::canonicalize(right)),
        (Ok(left), Ok(right)) if left == right
    )
}

fn stale_worktree_creation(message: &str) -> GitError {
    GitError::UnsafeOperation {
        operation: "execute linked worktree creation".to_string(),
        message: message.to_string(),
        blockers: Vec::new(),
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

    #[test]
    fn creates_detached_worktree_from_checked_out_branch_at_exact_object() {
        let directory = repository_fixture();
        let source_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/main"]);
        let parent = tempfile::tempdir().unwrap();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let request = WorktreeCreationRequest {
            source_full_name: "refs/heads/main".to_string(),
            source_oid: source_oid.clone(),
            parent_directory: parent.path().to_string_lossy().into_owned(),
            project_name: "main-review".to_string(),
            new_branch: None,
        };

        let plan = repository
            .prepare_worktree_creation(&request)
            .expect("detached plan");
        repository
            .execute_worktree_creation(&plan)
            .expect("detached worktree creation");

        let destination = parent.path().join("main-review");
        assert_eq!(git_stdout(&destination, &["rev-parse", "HEAD"]), source_oid);
        assert!(git_stdout(&destination, &["branch", "--show-current"]).is_empty());
    }

    #[test]
    fn creates_new_local_branch_from_exact_remote_tracking_object() {
        let directory = repository_fixture();
        let source_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/main"]);
        git(
            directory.path(),
            &["update-ref", "refs/remotes/origin/topic", &source_oid],
        );
        let parent = tempfile::tempdir().unwrap();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let request = WorktreeCreationRequest {
            source_full_name: "refs/remotes/origin/topic".to_string(),
            source_oid: source_oid.clone(),
            parent_directory: parent.path().to_string_lossy().into_owned(),
            project_name: "remote-topic".to_string(),
            new_branch: Some("topic-worktree".to_string()),
        };

        let plan = repository
            .prepare_worktree_creation(&request)
            .expect("remote-tracking source plan");
        repository
            .execute_worktree_creation(&plan)
            .expect("remote-tracking worktree creation");

        let destination = parent.path().join("remote-topic");
        assert_eq!(git_stdout(&destination, &["rev-parse", "HEAD"]), source_oid);
        assert_eq!(
            git_stdout(&destination, &["branch", "--show-current"]),
            "topic-worktree"
        );
    }

    #[test]
    fn creates_new_branch_and_rejects_stale_or_colliding_creation() {
        let directory = repository_fixture();
        let source_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/main"]);
        let parent = tempfile::tempdir().unwrap();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let request = WorktreeCreationRequest {
            source_full_name: "refs/heads/main".to_string(),
            source_oid,
            parent_directory: parent.path().to_string_lossy().into_owned(),
            project_name: "feature-worktree".to_string(),
            new_branch: Some("feature/worktree".to_string()),
        };
        let plan = repository
            .prepare_worktree_creation(&request)
            .expect("new branch plan");
        fs::create_dir(parent.path().join("feature-worktree")).unwrap();
        let stale = repository
            .execute_worktree_creation(&plan)
            .expect_err("late destination collision invalidates plan");
        assert!(stale.to_string().contains("destination already exists"));
        fs::remove_dir(parent.path().join("feature-worktree")).unwrap();

        let refreshed = repository
            .prepare_worktree_creation(&request)
            .expect("refreshed new branch plan");
        repository
            .execute_worktree_creation(&refreshed)
            .expect("new branch worktree creation");
        let destination = parent.path().join("feature-worktree");
        assert_eq!(
            git_stdout(&destination, &["branch", "--show-current"]),
            "feature/worktree"
        );
        assert!(repository.prepare_worktree_creation(&request).is_err());
    }

    #[test]
    fn creation_rejects_invalid_names_and_registered_worktree_overlap() {
        let directory = repository_fixture();
        let source_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/main"]);
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let overlapping = WorktreeCreationRequest {
            source_full_name: "refs/heads/main".to_string(),
            source_oid: source_oid.clone(),
            parent_directory: directory.path().to_string_lossy().into_owned(),
            project_name: "nested".to_string(),
            new_branch: None,
        };
        let overlap = repository
            .prepare_worktree_creation(&overlapping)
            .expect_err("a destination inside the primary worktree is blocked");
        assert!(overlap.to_string().contains("overlaps"));

        let parent = tempfile::tempdir().unwrap();
        let invalid_name = repository
            .prepare_worktree_creation(&WorktreeCreationRequest {
                parent_directory: parent.path().to_string_lossy().into_owned(),
                project_name: "../escape".to_string(),
                ..overlapping
            })
            .expect_err("the project name is one safe path component");
        assert!(invalid_name.to_string().contains("portable folder name"));
    }

    #[test]
    fn resolves_reveal_only_from_primary_for_one_registered_linked_branch() {
        let directory = repository_fixture();
        git(directory.path(), &["branch", "linked"]);
        let source_oid = git_stdout(directory.path(), &["rev-parse", "refs/heads/linked"]);
        let parent = tempfile::tempdir().unwrap();
        let linked_path = parent.path().join("linked");
        git(
            directory.path(),
            &["worktree", "add", linked_path.to_str().unwrap(), "linked"],
        );
        let primary = GitRepository::open(directory.path()).expect("primary repository opens");
        let resolved = primary
            .registered_linked_worktree_path_from_primary("refs/heads/linked", &source_oid)
            .expect("primary resolves registered linked worktree");
        assert_eq!(
            fs::canonicalize(resolved).unwrap(),
            fs::canonicalize(&linked_path).unwrap()
        );

        let linked = GitRepository::open(&linked_path).expect("linked repository opens");
        let error = linked
            .registered_linked_worktree_path_from_primary("refs/heads/linked", &source_oid)
            .expect_err("linked window cannot reveal through primary-only action");
        assert!(error.to_string().contains("primary worktree"));
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
