use std::fs::{self, Metadata, Permissions};
use std::io::Write;
use std::path::{Component, PathBuf};

use crate::{
    Workspace, WorkspaceError, read_bounded, reject_multiple_links, revision, sync_directory,
    validate_relative_path,
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub revision: Option<String>,
    pub mode: u32,
}

pub struct FileSnapshot {
    pub version: FileVersion,
    pub bytes: Option<Vec<u8>>,
}

impl Workspace {
    /// Bounded raw snapshot for an authorized transaction, including an absent regular file.
    pub fn snapshot_file(&self, path: &str) -> Result<FileSnapshot, WorkspaceError> {
        let (target, metadata) = self.resolve_optional_file(path)?;
        let Some(metadata) = metadata else {
            return Ok(FileSnapshot {
                version: FileVersion {
                    revision: None,
                    mode: if cfg!(unix) { 0o644 } else { 0 },
                },
                bytes: None,
            });
        };
        let bytes = read_bounded(&target, self.text_limit_bytes)?;
        Ok(FileSnapshot {
            version: FileVersion {
                revision: Some(revision(&bytes, &metadata)),
                mode: mode(&metadata),
            },
            bytes: Some(bytes),
        })
    }

    /// Compare-and-replace for an application-owned recoverable transaction. The caller must
    /// durably record recovery material and serialize writes before invoking this primitive.
    pub fn replace_file_bytes(
        &self,
        path: &str,
        expected: &FileVersion,
        bytes: Option<&[u8]>,
        output_mode: u32,
    ) -> Result<FileVersion, WorkspaceError> {
        self.replace_file_bytes_with_precommit(path, expected, bytes, output_mode, || Ok(()))
    }

    fn replace_file_bytes_with_precommit(
        &self,
        path: &str,
        expected: &FileVersion,
        bytes: Option<&[u8]>,
        output_mode: u32,
        before_commit: impl FnOnce() -> Result<(), WorkspaceError>,
    ) -> Result<FileVersion, WorkspaceError> {
        if bytes.is_some_and(|bytes| bytes.len() > self.text_limit_bytes) {
            return Err(WorkspaceError::FileTooLarge {
                limit_bytes: self.text_limit_bytes,
            });
        }
        self.check_file_version(path, expected)?;
        let (target, _) = self.resolve_optional_file(path)?;
        let parent = target.parent().ok_or_else(|| WorkspaceError::InvalidPath {
            message: "file parent is required".into(),
        })?;
        let mut temporary = bytes
            .map(|bytes| {
                let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(io)?;
                temporary
                    .as_file()
                    .set_permissions(permissions(
                        output_mode,
                        temporary.as_file().metadata().map_err(io)?.permissions(),
                    ))
                    .map_err(io)?;
                temporary.write_all(bytes).map_err(io)?;
                temporary
                    .flush()
                    .and_then(|_| temporary.as_file().sync_all())
                    .map_err(io)?;
                Ok::<_, WorkspaceError>(temporary)
            })
            .transpose()?;
        before_commit()?;
        self.check_file_version(path, expected)?;
        // Resolve every component again immediately before the final filesystem mutation.
        self.resolve_optional_file(path)?;
        if let Some(temporary) = temporary.take() {
            if expected.revision.is_none() {
                temporary
                    .persist_noclobber(&target)
                    .map_err(|error| io(error.error))?;
            } else {
                temporary
                    .persist(&target)
                    .map_err(|error| io(error.error))?;
            }
        } else if expected.revision.is_some() {
            fs::remove_file(&target).map_err(io)?;
        }
        sync_directory(parent)?;
        let saved = self.snapshot_file(path)?;
        if saved.bytes.as_deref() != bytes {
            return Err(WorkspaceError::Conflict {
                current_revision: saved.version.revision.unwrap_or_else(|| "missing".into()),
            });
        }
        Ok(saved.version)
    }

    pub fn check_file_version(
        &self,
        path: &str,
        expected: &FileVersion,
    ) -> Result<(), WorkspaceError> {
        let current = self.snapshot_file(path)?.version;
        if current != *expected {
            return Err(WorkspaceError::Conflict {
                current_revision: current.revision.unwrap_or_else(|| "missing".into()),
            });
        }
        Ok(())
    }

    fn resolve_optional_file(
        &self,
        path: &str,
    ) -> Result<(PathBuf, Option<Metadata>), WorkspaceError> {
        let relative = validate_relative_path(path)?;
        let mut current = self.root.clone();
        let count = relative.components().count();
        for (index, component) in relative.components().enumerate() {
            let Component::Normal(name) = component else {
                unreachable!("validated relative path")
            };
            current.push(name);
            let metadata = match fs::symlink_metadata(&current) {
                Ok(metadata) => metadata,
                Err(error)
                    if error.kind() == std::io::ErrorKind::NotFound && index + 1 == count =>
                {
                    return Ok((current, None));
                }
                Err(error) => return Err(io(error)),
            };
            if metadata.file_type().is_symlink() {
                return Err(WorkspaceError::OutsideWorkspace {
                    message: "transaction paths cannot traverse symbolic links".into(),
                });
            }
            if index + 1 == count {
                if !metadata.is_file() {
                    return Err(WorkspaceError::UnsupportedFile {
                        message: "transactions support regular files only".into(),
                    });
                }
                reject_multiple_links(&metadata)?;
                return Ok((current, Some(metadata)));
            }
            if !metadata.is_dir() {
                return Err(WorkspaceError::InvalidPath {
                    message: "transaction parent must be a directory".into(),
                });
            }
        }
        Err(WorkspaceError::InvalidPath {
            message: "a file path is required".into(),
        })
    }
}

fn io(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        operation: "durable file transaction".into(),
        message: error.to_string(),
    }
}

fn mode(metadata: &Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o777
    }
    #[cfg(not(unix))]
    {
        u32::from(metadata.permissions().readonly())
    }
}

fn permissions(mode: u32, mut current: Permissions) -> Permissions {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        current.set_mode(mode & 0o777);
    }
    #[cfg(not(unix))]
    {
        current.set_readonly(mode != 0);
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_transaction_preserves_bytes_and_rejects_a_late_writer() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("file"), b"original\r\n").unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let before = workspace.snapshot_file("file").unwrap();
        let result = workspace.replace_file_bytes_with_precommit(
            "file",
            &before.version,
            Some(b"replacement"),
            before.version.mode,
            || {
                fs::write(dir.path().join("file"), b"external").unwrap();
                Ok(())
            },
        );
        assert!(matches!(result, Err(WorkspaceError::Conflict { .. })));
        assert_eq!(fs::read(dir.path().join("file")).unwrap(), b"external");
        let current = workspace.snapshot_file("file").unwrap();
        workspace
            .replace_file_bytes(
                "file",
                &current.version,
                before.bytes.as_deref(),
                before.version.mode,
            )
            .unwrap();
        assert_eq!(fs::read(dir.path().join("file")).unwrap(), b"original\r\n");
    }

    #[test]
    fn absent_file_creation_and_deletion_are_revision_checked() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let absent = workspace.snapshot_file("new").unwrap();
        let saved = workspace
            .replace_file_bytes("new", &absent.version, Some(b"new"), 0o644)
            .unwrap();
        assert!(
            workspace
                .replace_file_bytes("new", &absent.version, Some(b"other"), 0o644)
                .is_err()
        );
        workspace
            .replace_file_bytes("new", &saved, None, 0o644)
            .unwrap();
        assert!(!dir.path().join("new").exists());
    }

    #[test]
    fn a_precommit_io_failure_preserves_the_original_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("file"), b"original").unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        let before = workspace.snapshot_file("file").unwrap();
        let result = workspace.replace_file_bytes_with_precommit(
            "file",
            &before.version,
            Some(b"replacement"),
            before.version.mode,
            || Err(io(std::io::Error::other("injected disk failure"))),
        );
        assert!(result.is_err());
        assert_eq!(fs::read(dir.path().join("file")).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn links_are_rejected_before_mutation() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("original"), b"original").unwrap();
        fs::hard_link(dir.path().join("original"), dir.path().join("hard")).unwrap();
        std::os::unix::fs::symlink("original", dir.path().join("symbolic")).unwrap();
        let workspace = Workspace::open(dir.path()).unwrap();
        assert!(workspace.snapshot_file("hard").is_err());
        assert!(workspace.snapshot_file("symbolic").is_err());
    }
}
