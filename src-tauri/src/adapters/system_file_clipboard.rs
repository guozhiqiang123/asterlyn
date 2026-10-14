use std::fs;
use std::path::{Path, PathBuf};

use asterlyn_workspace::{WorkspaceEntryKind, WorkspaceError};
use clipboard_rs::{Clipboard, ClipboardContext, ContentFormat};
use sha2::{Digest, Sha256};
use url::Url;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemFileClipboardEntry {
    pub(crate) token: String,
    pub(crate) name: String,
    pub(crate) kind: WorkspaceEntryKind,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedSystemFileClipboardEntry {
    pub(crate) summary: SystemFileClipboardEntry,
    pub(crate) path: PathBuf,
}

pub(crate) fn write_system_file_clipboard(
    path: &Path,
    expected_kind: WorkspaceEntryKind,
) -> Result<SystemFileClipboardEntry, WorkspaceError> {
    let resolved = resolve_entry(path, Some(expected_kind))?;
    let path_text = resolved
        .path
        .to_str()
        .ok_or_else(|| WorkspaceError::UnsupportedFile {
            message: "the system file clipboard requires a UTF-8 path".into(),
        })?;
    clipboard_context()?
        .set_files(vec![path_text.to_string()])
        .map_err(clipboard_error("write system file clipboard"))?;
    Ok(resolved.summary)
}

pub(crate) fn read_system_file_clipboard()
-> Result<Option<ResolvedSystemFileClipboardEntry>, WorkspaceError> {
    let clipboard = clipboard_context()?;
    if !clipboard.has(ContentFormat::Files) {
        return Ok(None);
    }
    let files = clipboard
        .get_files()
        .map_err(clipboard_error("read system file clipboard"))?;
    if files.is_empty() {
        return Ok(None);
    }
    if files.len() != 1 {
        return Err(WorkspaceError::UnsupportedFile {
            message: "paste supports one copied file or folder at a time".into(),
        });
    }
    let path = clipboard_path(&files[0])?;
    resolve_entry(&path, None).map(Some)
}

fn clipboard_context() -> Result<ClipboardContext, WorkspaceError> {
    ClipboardContext::new().map_err(clipboard_error("open system file clipboard"))
}

fn resolve_entry(
    path: &Path,
    expected_kind: Option<WorkspaceEntryKind>,
) -> Result<ResolvedSystemFileClipboardEntry, WorkspaceError> {
    if !path.is_absolute() {
        return Err(WorkspaceError::InvalidPath {
            message: "the system file clipboard did not contain an absolute path".into(),
        });
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| WorkspaceError::Io {
        operation: "inspect system file clipboard entry".into(),
        message: error.to_string(),
    })?;
    if metadata.file_type().is_symlink() {
        return Err(WorkspaceError::UnsupportedFile {
            message: "symbolic links cannot be pasted from the system file clipboard".into(),
        });
    }
    let kind = if metadata.is_file() {
        WorkspaceEntryKind::File
    } else if metadata.is_dir() {
        WorkspaceEntryKind::Directory
    } else {
        return Err(WorkspaceError::UnsupportedFile {
            message: "the system file clipboard entry is not a regular file or folder".into(),
        });
    };
    if expected_kind.is_some_and(|expected| expected != kind) {
        return Err(WorkspaceError::Conflict {
            current_revision: "system-file-clipboard-kind-changed".into(),
        });
    }
    let path = fs::canonicalize(path).map_err(|error| WorkspaceError::Io {
        operation: "resolve system file clipboard entry".into(),
        message: error.to_string(),
    })?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| WorkspaceError::UnsupportedFile {
            message: "the system file clipboard entry requires a UTF-8 file name".into(),
        })?
        .to_string();
    let path_text = path
        .to_str()
        .ok_or_else(|| WorkspaceError::UnsupportedFile {
            message: "the system file clipboard entry requires a UTF-8 path".into(),
        })?;
    let mut digest = Sha256::new();
    digest.update(path_text.as_bytes());
    digest.update([match kind {
        WorkspaceEntryKind::File => 0,
        WorkspaceEntryKind::Directory => 1,
    }]);
    Ok(ResolvedSystemFileClipboardEntry {
        summary: SystemFileClipboardEntry {
            token: format!("{:x}", digest.finalize()),
            name,
            kind,
        },
        path,
    })
}

fn clipboard_path(raw: &str) -> Result<PathBuf, WorkspaceError> {
    if raw.starts_with("file:") {
        return Url::parse(raw)
            .ok()
            .and_then(|url| url.to_file_path().ok())
            .ok_or_else(|| WorkspaceError::InvalidPath {
                message: "the system file clipboard contained an invalid file URL".into(),
            });
    }
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return Ok(path);
    }
    if Url::parse(raw).is_ok() {
        return Err(WorkspaceError::InvalidPath {
            message: "the system file clipboard contained an unsupported URL".into(),
        });
    }
    Ok(path)
}

fn clipboard_error(
    operation: &'static str,
) -> impl FnOnce(Box<dyn std::error::Error + Send + Sync>) -> WorkspaceError {
    move |error| WorkspaceError::Io {
        operation: operation.into(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_urls_are_decoded_and_non_file_urls_are_rejected() {
        assert_eq!(
            clipboard_path("file:///tmp/a%20file.txt").unwrap(),
            PathBuf::from("/tmp/a file.txt")
        );
        assert_eq!(
            clipboard_path("/tmp/plain.txt").unwrap(),
            PathBuf::from("/tmp/plain.txt")
        );
        assert!(clipboard_path("https://example.com/file").is_err());
    }

    #[test]
    fn resolved_entries_are_typed_and_tokens_are_stable() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("sample.txt");
        fs::write(&file, "sample").unwrap();
        let first = resolve_entry(&file, Some(WorkspaceEntryKind::File)).unwrap();
        let second = resolve_entry(&file, None).unwrap();
        assert_eq!(first.summary, second.summary);
        assert_eq!(first.summary.name, "sample.txt");
        assert_eq!(first.summary.kind, WorkspaceEntryKind::File);
        assert!(resolve_entry(&file, Some(WorkspaceEntryKind::Directory)).is_err());
    }
}
