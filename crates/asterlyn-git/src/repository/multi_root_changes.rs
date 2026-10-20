use std::path::PathBuf;

use crate::error::GitError;
use crate::model::{
    BinaryDiffResult, DiffResult, FileChange, GitOperationSnapshot, GitRootDescriptor,
    SelectedCommitResult, WorkingDiffBaseVersion,
};

use super::{DiscoveredGitRoot, GitRepository};

impl GitRepository {
    fn resolve_selected_change(
        &self,
        selected: &FileChange,
    ) -> Result<(DiscoveredGitRoot, FileChange), GitError> {
        let root = self.resolve_history_root(&selected.repository_id)?;
        validate_change_owner(selected, &root.descriptor)?;
        Ok((root, localized_change(selected)))
    }

    fn resolve_selected_changes(
        &self,
        selected: &[FileChange],
    ) -> Result<(DiscoveredGitRoot, Vec<FileChange>), GitError> {
        let Some(first) = selected.first() else {
            return Err(GitError::InvalidInput {
                field: "selected changes".to_string(),
                message: "select at least one changed file".to_string(),
            });
        };
        if selected
            .iter()
            .any(|change| change.repository_id != first.repository_id)
        {
            return Err(GitError::InvalidInput {
                field: "selected changes".to_string(),
                message: "select changes from exactly one repository root".to_string(),
            });
        }
        let root = self.resolve_history_root(&first.repository_id)?;
        let localized = selected
            .iter()
            .map(|change| {
                validate_change_owner(change, &root.descriptor)?;
                Ok(localized_change(change))
            })
            .collect::<Result<Vec<_>, GitError>>()?;
        Ok((root, localized))
    }

    pub fn repository_local_diff_with_unchanged(
        &self,
        selected: &FileChange,
        expanded_unchanged: bool,
    ) -> Result<DiffResult, GitError> {
        let (root, selected) = self.resolve_selected_change(selected)?;
        root.repository
            .local_diff_with_unchanged(&selected, expanded_unchanged)
    }

    pub fn repository_working_diff_base(
        &self,
        selected: &FileChange,
        limit_bytes: usize,
    ) -> Result<WorkingDiffBaseVersion, GitError> {
        let (root, selected) = self.resolve_selected_change(selected)?;
        root.repository.working_diff_base(&selected, limit_bytes)
    }

    pub fn repository_local_binary_diff(
        &self,
        selected: &FileChange,
    ) -> Result<BinaryDiffResult, GitError> {
        let (root, selected) = self.resolve_selected_change(selected)?;
        root.repository.local_binary_diff(&selected)
    }

    pub fn commit_repository_selected(
        &self,
        message: &str,
        selected: &[FileChange],
    ) -> Result<SelectedCommitResult, GitError> {
        let (root, selected) = self.resolve_selected_changes(selected)?;
        root.repository.commit_selected(message, &selected)
    }

    pub fn stage_repository_paths(
        &self,
        repository_id: &str,
        paths: &[String],
    ) -> Result<(), GitError> {
        self.resolve_history_root(repository_id)?
            .repository
            .stage(paths)
    }

    pub fn unstage_repository_paths(
        &self,
        repository_id: &str,
        paths: &[String],
    ) -> Result<(), GitError> {
        self.resolve_history_root(repository_id)?
            .repository
            .unstage(paths)
    }

    pub fn resolve_repository_untracked_paths_for_trash(
        &self,
        repository_id: &str,
        paths: &[String],
    ) -> Result<Vec<PathBuf>, GitError> {
        self.resolve_history_root(repository_id)?
            .repository
            .resolve_untracked_paths_for_trash(paths)
    }
}

pub(super) fn scope_changes(changes: &mut [FileChange], descriptor: &GitRootDescriptor) {
    for change in changes {
        change.repository_id = descriptor.id.clone();
        change.workspace_path = workspace_change_path(descriptor, &change.path);
    }
}

pub(super) fn sort_changes(changes: &mut [FileChange]) {
    changes.sort_by(|left, right| {
        left.repository_id
            .cmp(&right.repository_id)
            .then_with(|| left.path.cmp(&right.path))
    });
}

pub(super) fn operation_snapshot_for_roots(
    roots: &[DiscoveredGitRoot],
) -> Result<Option<GitOperationSnapshot>, GitError> {
    for root in roots {
        if let Some(mut operation) = root.repository.operation_snapshot()? {
            operation.repository_id = root.descriptor.id.clone();
            return Ok(Some(operation));
        }
    }
    Ok(None)
}

fn validate_change_owner(
    selected: &FileChange,
    descriptor: &GitRootDescriptor,
) -> Result<(), GitError> {
    if selected.workspace_path == workspace_change_path(descriptor, &selected.path) {
        return Ok(());
    }
    Err(GitError::InvalidInput {
        field: "selected change".to_string(),
        message: "the selected file does not belong to its declared repository root".to_string(),
    })
}

fn localized_change(selected: &FileChange) -> FileChange {
    let mut localized = selected.clone();
    localized.repository_id = ".".to_string();
    localized.workspace_path = localized.path.clone();
    localized
}

fn workspace_change_path(descriptor: &GitRootDescriptor, path: &str) -> String {
    if descriptor.relative_path == "." {
        path.to_string()
    } else {
        format!("{}/{path}", descriptor.relative_path)
    }
}
