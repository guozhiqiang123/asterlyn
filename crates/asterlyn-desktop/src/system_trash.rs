use std::path::{Path, PathBuf};

use asterlyn_workspace::WorkspaceError;

#[cfg(target_os = "macos")]
use trash::macos::{DeleteMethod, TrashContextExtMacos};

/// Moves one already-authorized workspace entry into the platform trash.
///
/// Authorization, recursive inventory, and source revalidation belong to
/// `asterlyn-workspace`; this adapter only translates the platform operation.
pub fn move_to_system_trash(path: &Path) -> Result<(), WorkspaceError> {
    move_all_to_system_trash(std::slice::from_ref(&path.to_path_buf()))
}

/// Moves an already-authorized set of workspace entries into the platform trash in one adapter
/// call. This reuses the platform context and lets callers classify partial completion as a single
/// reviewed operation.
pub fn move_all_to_system_trash(paths: &[PathBuf]) -> Result<(), WorkspaceError> {
    let mut context = trash::TrashContext::new();
    #[cfg(target_os = "macos")]
    context.set_delete_method(DeleteMethod::NsFileManager);
    context
        .delete_all(paths)
        .map_err(|error| WorkspaceError::Io {
            operation: "move workspace entries to system trash".to_string(),
            message: error.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_targets_fail_without_a_permanent_delete_fallback() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("missing");
        let error = move_to_system_trash(&target).unwrap_err();
        assert!(matches!(error, WorkspaceError::Io { .. }));
        assert!(!target.exists());
    }

    #[test]
    fn trash_multiple_folders_succeeds_without_error() {
        let parent = tempfile::tempdir().unwrap();
        let children = (0..6)
            .map(|i| parent.path().join(format!("folder_{i}")))
            .collect::<Vec<_>>();
        for child in &children {
            std::fs::create_dir(&child).unwrap();
        }
        move_all_to_system_trash(&children).unwrap();
        for child in children {
            assert!(!child.exists());
        }
    }
}
