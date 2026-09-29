use super::*;

const REFERENCE_FORMAT: &str = "%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)%00%(subject)";

impl GitRepository {
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
            containing_branches: self.branches_containing(oid)?,
        })
    }

    pub fn repository_stash_details(
        &self,
        repository_id: &str,
        oid: &str,
    ) -> Result<CommitDetails, GitError> {
        validate_object_id(oid)?;
        let root = self.resolve_history_root(repository_id)?;
        root.repository.require_visible_stash_oid(oid)?;
        let (output, truncated) = root.repository.run_read_owned_bounded(
            "read stash file list",
            vec![
                OsString::from("stash"),
                OsString::from("show"),
                OsString::from("--include-untracked"),
                OsString::from("--name-status"),
                OsString::from("-z"),
                OsString::from("-M"),
                OsString::from("-C"),
                OsString::from(oid),
            ],
            COMMIT_FILE_LIST_LIMIT_BYTES + 1,
        )?;
        let files = parse_bounded_commit_files(
            output,
            truncated,
            "stash file list",
            "the stash changed-file list",
        )?;
        Ok(CommitDetails {
            repository_id: root.descriptor.id,
            oid: oid.to_string(),
            parent_oid: root.repository.first_parent(oid)?,
            files,
            containing_branches: Vec::new(),
        })
    }

    pub fn repository_commit_details(
        &self,
        repository_id: &str,
        oid: &str,
    ) -> Result<CommitDetails, GitError> {
        let root = self.resolve_history_root(repository_id)?;
        let mut details = root.repository.commit_details(oid)?;
        for branch in &mut details.containing_branches {
            branch.repository_id.clone_from(&root.descriptor.id);
        }
        details.repository_id = root.descriptor.id;
        Ok(details)
    }

    fn branches_containing(&self, oid: &str) -> Result<Vec<crate::model::BranchSummary>, GitError> {
        validate_object_id(oid)?;
        let refs = self.run_read_owned(
            "read branches containing commit",
            vec![
                OsString::from("for-each-ref"),
                OsString::from(format!("--contains={oid}")),
                OsString::from("--sort=refname"),
                OsString::from(format!("--format={REFERENCE_FORMAT}")),
                OsString::from("refs/heads"),
                OsString::from("refs/remotes"),
            ],
        )?;
        let mut branches = parse_branches(&refs.stdout)?;
        branches.retain(|branch| {
            !branch.full_name.starts_with("refs/remotes/") || !branch.full_name.ends_with("/HEAD")
        });
        Ok(branches)
    }
}
