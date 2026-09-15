use std::path::Path;

use asterlyn_workspace::WorkspaceError;

/// Moves one already-authorized workspace entry into the platform trash.
///
/// Authorization, recursive inventory, and source revalidation belong to
/// `asterlyn-workspace`; this adapter only translates the platform operation.
pub(crate) fn move_to_system_trash(path: &Path) -> Result<(), WorkspaceError> {
    trash::delete(path).map_err(|error| WorkspaceError::Io {
        operation: "move workspace entry to system trash".to_string(),
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
}
