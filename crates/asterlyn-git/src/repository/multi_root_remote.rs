use crate::error::GitError;
use crate::model::{CommitDetails, PushMode, PushPreview, PushTagMode, RemoteAuthenticationStatus};
use crate::process::CancellationToken;

use super::{BranchPushTarget, GitRepository, RepositoryPushTarget};

impl GitRepository {
    pub fn repository_push_preview(
        &self,
        target: RepositoryPushTarget<'_>,
        tag_mode: PushTagMode,
        offset: usize,
        page_size: usize,
    ) -> Result<PushPreview, GitError> {
        let RepositoryPushTarget {
            repository_id,
            remote,
            destination_branch,
            source_branch,
        } = target;
        let root = self.resolve_history_root(repository_id)?;
        let preview = match source_branch {
            Some(source_branch) => root.repository.push_preview_for_branch(
                source_branch,
                remote,
                tag_mode,
                offset,
                page_size,
                destination_branch,
            ),
            None => root.repository.push_preview_with_destination(
                remote,
                tag_mode,
                offset,
                page_size,
                destination_branch,
            ),
        }?;
        Ok(scope_push_preview(preview, &root.descriptor.id))
    }

    pub fn repository_push_file_commit(
        &self,
        target: RepositoryPushTarget<'_>,
        tag_mode: PushTagMode,
        preview_token: &str,
        path: &str,
    ) -> Result<Option<CommitDetails>, GitError> {
        let RepositoryPushTarget {
            repository_id,
            remote,
            destination_branch,
            source_branch,
        } = target;
        let root = self.resolve_history_root(repository_id)?;
        let details = match source_branch {
            Some(source_branch) => root.repository.push_branch_file_commit(
                source_branch,
                remote,
                tag_mode,
                preview_token,
                path,
                destination_branch,
            ),
            None => root.repository.push_file_commit_with_destination(
                remote,
                tag_mode,
                preview_token,
                path,
                destination_branch,
            ),
        }?;
        Ok(details.map(|details| scope_commit_details(details, &root.descriptor.id)))
    }

    pub fn repository_remote_authentication_status(
        &self,
        repository_id: &str,
        remote: &str,
    ) -> Result<RemoteAuthenticationStatus, GitError> {
        self.resolve_history_root(repository_id)?
            .repository
            .remote_authentication_status(remote)
    }

    pub fn repository_store_remote_https_credential(
        &self,
        repository_id: &str,
        remote: &str,
        username: &str,
        token: &str,
    ) -> Result<RemoteAuthenticationStatus, GitError> {
        self.resolve_history_root(repository_id)?
            .repository
            .store_remote_https_credential(remote, username, token)
    }

    pub fn repository_configure_remote_ssh(
        &self,
        repository_id: &str,
        remote: &str,
        ssh_url: &str,
    ) -> Result<RemoteAuthenticationStatus, GitError> {
        self.resolve_history_root(repository_id)?
            .repository
            .configure_remote_ssh(remote, ssh_url)
    }

    pub fn push_repository(
        &self,
        target: RepositoryPushTarget<'_>,
        mode: PushMode,
        tag_mode: PushTagMode,
        preview_token: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), GitError> {
        let RepositoryPushTarget {
            repository_id,
            remote,
            destination_branch,
            source_branch,
        } = target;
        let root = self.resolve_history_root(repository_id)?;
        match source_branch {
            Some(source_branch) => root.repository.push_branch_with_destination(
                BranchPushTarget {
                    source_branch,
                    destination_branch,
                },
                remote,
                mode,
                tag_mode,
                preview_token,
                cancellation,
            ),
            None => root.repository.push_current_with_destination(
                remote,
                mode,
                tag_mode,
                preview_token,
                cancellation,
                destination_branch,
            ),
        }
    }
}

fn scope_push_preview(mut preview: PushPreview, repository_id: &str) -> PushPreview {
    preview.repository_id = repository_id.to_string();
    for commit in &mut preview.commits {
        commit.repository_id = repository_id.to_string();
    }
    preview
}

fn scope_commit_details(mut details: CommitDetails, repository_id: &str) -> CommitDetails {
    details.repository_id = repository_id.to_string();
    for branch in &mut details.containing_branches {
        branch.repository_id = repository_id.to_string();
    }
    details
}
