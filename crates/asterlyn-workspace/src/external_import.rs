use std::fs;
use std::path::Path;

use crate::{
    Workspace, WorkspaceEntryInventory, WorkspaceEntryKind, WorkspaceError,
    WorkspaceMutationLimits,
    entry_mutation::{inventory_blockers, relocated_inventory_matches},
    mutation_execution::{copy_file_noclobber, set_mode, sync_tree_directories},
    sync_directory,
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum WorkspaceExternalImportResult {
    Completed {
        destination: String,
        kind: WorkspaceEntryKind,
        affected_paths: Vec<String>,
    },
    DestinationExists {
        destination: String,
    },
}

impl Workspace {
    /// Imports one external clipboard entry through a verified sibling staging path.
    pub fn import_external_entry(
        &self,
        source: &Path,
        destination: &str,
        limits: WorkspaceMutationLimits,
    ) -> Result<WorkspaceExternalImportResult, WorkspaceError> {
        let reviewed = self.inspect_external_entry(source, limits)?;
        let source = fs::canonicalize(source)
            .map_err(|error| import_io("resolve external workspace import", error))?;
        if let Some(blocker) = inventory_blockers(&reviewed).first() {
            return Err(WorkspaceError::InvalidMutation {
                message: format!("external workspace import is unsafe: {blocker:?}"),
            });
        }
        let destination_absolute = self.resolve_destination(destination)?;
        if reviewed.source.kind == WorkspaceEntryKind::Directory
            && destination_absolute.starts_with(&source)
        {
            return Err(WorkspaceError::InvalidMutation {
                message: "an external directory cannot be imported inside itself".into(),
            });
        }
        match fs::symlink_metadata(&destination_absolute) {
            Ok(_) => {
                return Ok(WorkspaceExternalImportResult::DestinationExists {
                    destination: destination.to_string(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(import_io(
                    "inspect external workspace import destination",
                    error,
                ));
            }
        }
        let destination_parent =
            destination_absolute
                .parent()
                .ok_or_else(|| WorkspaceError::InvalidMutation {
                    message: "external workspace import destination has no parent".into(),
                })?;
        let staging = tempfile::Builder::new()
            .prefix(".asterlyn-import-")
            .tempdir_in(destination_parent)
            .map_err(|error| import_io("create external workspace import staging", error))?;
        let staged_entry = staging.path().join("entry");
        copy_external_inventory_exclusive(&reviewed, &source, &staged_entry)?;
        let staged = self.inspect_external_entry(&staged_entry, limits)?;
        if !relocated_inventory_matches(&reviewed, &staged) {
            return Err(WorkspaceError::Conflict {
                current_revision: "external-import-staging-verification-failed".into(),
            });
        }
        let current = self.inspect_external_entry(&source, limits)?;
        if current.source != reviewed.source || current.fingerprint != reviewed.fingerprint {
            return Err(WorkspaceError::Conflict {
                current_revision: current.fingerprint,
            });
        }
        match rename_noreplace(&staged_entry, &destination_absolute) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Ok(WorkspaceExternalImportResult::DestinationExists {
                    destination: destination.to_string(),
                });
            }
            Err(error) => {
                return Err(import_io(
                    "install external workspace import without replacement",
                    error,
                ));
            }
        }
        sync_directory(destination_parent)?;
        let installed = self.inspect_entry(destination, limits)?;
        if !relocated_inventory_matches(&reviewed, &installed) {
            return Err(WorkspaceError::Conflict {
                current_revision: "external-import-destination-verification-failed".into(),
            });
        }
        let expected_root = Path::new(&reviewed.source.workspace_path);
        let affected_paths = reviewed
            .entries
            .iter()
            .filter_map(|entry| {
                Path::new(&entry.workspace_path)
                    .strip_prefix(expected_root)
                    .ok()
                    .map(|suffix| {
                        if suffix.as_os_str().is_empty() {
                            destination.to_string()
                        } else {
                            format!(
                                "{destination}/{}",
                                suffix.to_string_lossy().replace('\\', "/")
                            )
                        }
                    })
            })
            .collect();
        Ok(WorkspaceExternalImportResult::Completed {
            destination: destination.to_string(),
            kind: reviewed.source.kind,
            affected_paths,
        })
    }
}

fn copy_external_inventory_exclusive(
    inventory: &WorkspaceEntryInventory,
    source_root: &Path,
    destination_root: &Path,
) -> Result<(), WorkspaceError> {
    match inventory.source.kind {
        WorkspaceEntryKind::File => {
            copy_file_noclobber(source_root, destination_root, inventory.source.mode)
        }
        WorkspaceEntryKind::Directory => {
            fs::create_dir(destination_root)
                .map_err(|error| import_io("reserve external workspace import staging", error))?;
            let source_label = Path::new(&inventory.source.workspace_path);
            let mut directory_modes = vec![(destination_root.to_path_buf(), inventory.source.mode)];
            for entry in inventory.entries.iter().skip(1) {
                let suffix = Path::new(&entry.workspace_path)
                    .strip_prefix(source_label)
                    .map_err(|_| WorkspaceError::InvalidMutation {
                        message: "external workspace import inventory escaped its source".into(),
                    })?;
                let source_path = source_root.join(suffix);
                let destination_path = destination_root.join(suffix);
                match entry.kind {
                    WorkspaceEntryKind::Directory => {
                        fs::create_dir(&destination_path).map_err(|error| {
                            import_io("create external workspace import directory", error)
                        })?;
                        directory_modes.push((destination_path, entry.mode));
                    }
                    WorkspaceEntryKind::File => {
                        copy_file_noclobber(&source_path, &destination_path, entry.mode)?;
                    }
                }
            }
            sync_tree_directories(destination_root)?;
            for (directory, mode) in directory_modes.into_iter().rev() {
                set_mode(&directory, mode)?;
            }
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
fn rename_noreplace(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(source.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "source contains NUL")
    })?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "destination contains NUL")
    })?;
    // SAFETY: both pointers are valid NUL-terminated paths for the duration of the call.
    let result =
        unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn rename_noreplace(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(source.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "source contains NUL")
    })?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "destination contains NUL")
    })?;
    // SAFETY: both pointers are valid NUL-terminated paths and AT_FDCWD scopes them normally.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_noreplace(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    // SAFETY: both buffers are valid NUL-terminated UTF-16 paths for the duration of the call.
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    };
    if result != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn rename_noreplace(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    if destination.try_exists()? {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "destination exists",
        ));
    }
    fs::rename(source, destination)
}

fn import_io(operation: &str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        operation: operation.into(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_file_and_directory_imports_are_verified_and_never_overwrite() {
        let workspace_directory = tempfile::tempdir().unwrap();
        let external_directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(workspace_directory.path().join("imports")).unwrap();
        fs::write(external_directory.path().join("photo.jpg"), b"photo").unwrap();
        fs::create_dir_all(external_directory.path().join("album/nested")).unwrap();
        fs::write(
            external_directory.path().join("album/nested/item.txt"),
            b"item",
        )
        .unwrap();
        let workspace = Workspace::open(workspace_directory.path()).unwrap();

        let file = workspace
            .import_external_entry(
                &external_directory.path().join("photo.jpg"),
                "imports/photo.jpg",
                WorkspaceMutationLimits::default_transfer(),
            )
            .unwrap();
        assert!(matches!(
            file,
            WorkspaceExternalImportResult::Completed { .. }
        ));
        assert_eq!(
            fs::read(workspace_directory.path().join("imports/photo.jpg")).unwrap(),
            b"photo"
        );
        assert_eq!(
            fs::read(external_directory.path().join("photo.jpg")).unwrap(),
            b"photo"
        );

        let directory = workspace
            .import_external_entry(
                &external_directory.path().join("album"),
                "imports/album",
                WorkspaceMutationLimits::default_transfer(),
            )
            .unwrap();
        let WorkspaceExternalImportResult::Completed { affected_paths, .. } = directory else {
            panic!("directory import should complete")
        };
        assert_eq!(
            fs::read(
                workspace_directory
                    .path()
                    .join("imports/album/nested/item.txt")
            )
            .unwrap(),
            b"item"
        );
        assert!(affected_paths.contains(&"imports/album/nested/item.txt".to_string()));

        fs::write(
            workspace_directory.path().join("imports/taken.txt"),
            b"keep",
        )
        .unwrap();
        let collision = workspace
            .import_external_entry(
                &external_directory.path().join("photo.jpg"),
                "imports/taken.txt",
                WorkspaceMutationLimits::default_transfer(),
            )
            .unwrap();
        assert_eq!(
            collision,
            WorkspaceExternalImportResult::DestinationExists {
                destination: "imports/taken.txt".into()
            }
        );
        assert_eq!(
            fs::read(workspace_directory.path().join("imports/taken.txt")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn external_import_rejects_nested_repositories() {
        let workspace_directory = tempfile::tempdir().unwrap();
        let external_directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(workspace_directory.path().join("imports")).unwrap();
        fs::create_dir_all(external_directory.path().join("project/.git")).unwrap();
        fs::write(external_directory.path().join("project/file.txt"), b"file").unwrap();
        let workspace = Workspace::open(workspace_directory.path()).unwrap();

        let result = workspace.import_external_entry(
            &external_directory.path().join("project"),
            "imports/project",
            WorkspaceMutationLimits::default_transfer(),
        );

        assert!(matches!(
            result,
            Err(WorkspaceError::InvalidMutation { .. })
        ));
        assert!(!workspace_directory.path().join("imports/project").exists());
    }

    #[cfg(unix)]
    #[test]
    fn external_import_rejects_symbolic_links_without_following_them() {
        use std::os::unix::fs::symlink;

        let workspace_directory = tempfile::tempdir().unwrap();
        let external_directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(workspace_directory.path().join("imports")).unwrap();
        fs::write(external_directory.path().join("target.txt"), b"target").unwrap();
        symlink(
            external_directory.path().join("target.txt"),
            external_directory.path().join("link.txt"),
        )
        .unwrap();
        let workspace = Workspace::open(workspace_directory.path()).unwrap();

        let result = workspace.import_external_entry(
            &external_directory.path().join("link.txt"),
            "imports/link.txt",
            WorkspaceMutationLimits::default_transfer(),
        );

        assert!(matches!(
            result,
            Err(WorkspaceError::OutsideWorkspace { .. })
        ));
        assert!(!workspace_directory.path().join("imports/link.txt").exists());
    }
}
