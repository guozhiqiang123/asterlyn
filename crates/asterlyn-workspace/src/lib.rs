use std::fmt::{Display, Formatter};
use std::fs::{self, File, Metadata};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

mod replacement;
mod search;

pub use replacement::{
    PreparedWorkspaceReplacement, ReplacementApplyResult, ReplacementFilePreview,
    ReplacementFileState, ReplacementLimits, ReplacementRecoveryStatus, ReplacementRecoverySummary,
    WorkspaceReplacementPreview,
};
pub use search::{
    SearchCancellationToken, SearchCandidate, SearchCoverageReason, SearchLimits, SearchMode,
    SearchOptions, SearchSkipReason, SearchSkippedFile, WorkspaceSearchMatch,
    WorkspaceSearchReport,
};

pub const DEFAULT_TEXT_LIMIT_BYTES: usize = 2 * 1024 * 1024;
const UTF8_BOM: &[u8] = b"\xef\xbb\xbf";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextFileSnapshot {
    pub workspace_path: String,
    pub content: String,
    pub utf8_bom: bool,
    pub revision: String,
    pub byte_length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinaryFileSnapshot {
    pub workspace_path: String,
    pub bytes: Vec<u8>,
    pub revision: String,
    pub byte_length: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileCatalog {
    pub paths: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveTextFileRequest {
    pub workspace_path: String,
    pub expected_revision: String,
    pub content: String,
    pub utf8_bom: bool,
    pub request_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveTextFileResult {
    pub workspace_path: String,
    pub revision: String,
    pub byte_length: usize,
    pub request_id: String,
    pub already_saved: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WorkspaceError {
    NotAuthorized { message: String },
    InvalidPath { message: String },
    OutsideWorkspace { message: String },
    UnsupportedFile { message: String },
    FileTooLarge { limit_bytes: usize },
    BinaryFile { message: String },
    InvalidEncoding { message: String },
    Conflict { current_revision: String },
    Busy { message: String },
    InvalidSearch { message: String },
    Cancelled { message: String },
    InvalidReplacement { message: String },
    Io { operation: String, message: String },
}

impl Display for WorkspaceError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAuthorized { message }
            | Self::InvalidPath { message }
            | Self::OutsideWorkspace { message }
            | Self::UnsupportedFile { message }
            | Self::BinaryFile { message }
            | Self::InvalidEncoding { message }
            | Self::Busy { message }
            | Self::InvalidSearch { message }
            | Self::Cancelled { message } => formatter.write_str(message),
            Self::InvalidReplacement { message } => formatter.write_str(message),
            Self::FileTooLarge { limit_bytes } => {
                write!(
                    formatter,
                    "the file exceeds the {limit_bytes}-byte text limit"
                )
            }
            Self::Conflict { .. } => formatter
                .write_str("the file changed outside Asterlyn; the local buffer was not saved"),
            Self::Io { operation, message } => write!(formatter, "{operation}: {message}"),
        }
    }
}

impl std::error::Error for WorkspaceError {}

#[derive(Debug, Clone)]
pub struct Workspace {
    root: PathBuf,
    text_limit_bytes: usize,
}

impl Workspace {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        Self::with_text_limit(root, DEFAULT_TEXT_LIMIT_BYTES)
    }

    pub fn with_text_limit(
        root: impl AsRef<Path>,
        text_limit_bytes: usize,
    ) -> Result<Self, WorkspaceError> {
        if text_limit_bytes == 0 {
            return Err(WorkspaceError::FileTooLarge { limit_bytes: 0 });
        }
        let root = fs::canonicalize(root.as_ref()).map_err(|error| WorkspaceError::Io {
            operation: "resolve workspace root".to_string(),
            message: error.to_string(),
        })?;
        if !root.is_dir() {
            return Err(WorkspaceError::InvalidPath {
                message: "the workspace root is not a directory".to_string(),
            });
        }
        Ok(Self {
            root,
            text_limit_bytes,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn read_text_file(&self, workspace_path: &str) -> Result<TextFileSnapshot, WorkspaceError> {
        let (path, metadata) = self.resolve_regular_file(workspace_path)?;
        let bytes = read_bounded(&path, self.text_limit_bytes)?;
        decode_snapshot(workspace_path, bytes, &metadata)
    }

    pub fn read_binary_file(
        &self,
        workspace_path: &str,
        limit_bytes: usize,
    ) -> Result<BinaryFileSnapshot, WorkspaceError> {
        if limit_bytes == 0 {
            return Err(WorkspaceError::FileTooLarge { limit_bytes: 0 });
        }
        let (path, metadata) = self.resolve_regular_file(workspace_path)?;
        let bytes = read_bounded(&path, limit_bytes)?;
        Ok(BinaryFileSnapshot {
            workspace_path: workspace_path.to_string(),
            revision: revision(&bytes, &metadata),
            byte_length: bytes.len(),
            bytes,
        })
    }

    pub fn list_files(&self, limit: usize) -> Result<WorkspaceFileCatalog, WorkspaceError> {
        if limit == 0 {
            return Err(WorkspaceError::InvalidPath {
                message: "the project file limit must be greater than zero".to_string(),
            });
        }
        let mut paths = Vec::with_capacity(limit.min(4_096));
        let mut truncated = false;
        collect_workspace_files(&self.root, Path::new(""), limit, &mut paths, &mut truncated)?;
        Ok(WorkspaceFileCatalog { paths, truncated })
    }

    pub fn save_text_file(
        &self,
        request: &SaveTextFileRequest,
    ) -> Result<SaveTextFileResult, WorkspaceError> {
        self.save_text_file_with_precommit(request, |_| Ok(()))
    }

    fn save_text_file_with_precommit<F>(
        &self,
        request: &SaveTextFileRequest,
        before_flush: F,
    ) -> Result<SaveTextFileResult, WorkspaceError>
    where
        F: FnOnce(&Path) -> Result<(), WorkspaceError>,
    {
        validate_request_id(&request.request_id)?;
        let output = encode_text(&request.content, request.utf8_bom, self.text_limit_bytes)?;
        let (path, metadata) = self.resolve_regular_file(&request.workspace_path)?;
        let current_bytes = read_bounded(&path, self.text_limit_bytes)?;
        let current_revision = revision(&current_bytes, &metadata);

        if current_bytes == output {
            return Ok(save_result(request, current_revision, output.len(), true));
        }
        if current_revision != request.expected_revision {
            return Err(WorkspaceError::Conflict { current_revision });
        }

        let parent = path.parent().ok_or_else(|| WorkspaceError::InvalidPath {
            message: "the file has no parent directory".to_string(),
        })?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| WorkspaceError::Io {
                operation: "create same-directory temporary file".to_string(),
                message: error.to_string(),
            })?;
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|error| WorkspaceError::Io {
                operation: "preserve file permissions".to_string(),
                message: error.to_string(),
            })?;
        temporary
            .write_all(&output)
            .map_err(|error| WorkspaceError::Io {
                operation: "write durable temporary file".to_string(),
                message: error.to_string(),
            })?;
        before_flush(temporary.path())?;
        temporary
            .flush()
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| WorkspaceError::Io {
                operation: "write durable temporary file".to_string(),
                message: error.to_string(),
            })?;

        let (_, rechecked_metadata) = self.resolve_regular_file(&request.workspace_path)?;
        let rechecked_bytes = read_bounded(&path, self.text_limit_bytes)?;
        let rechecked_revision = revision(&rechecked_bytes, &rechecked_metadata);
        if rechecked_bytes == output {
            return Ok(save_result(request, rechecked_revision, output.len(), true));
        }
        if rechecked_revision != request.expected_revision {
            return Err(WorkspaceError::Conflict {
                current_revision: rechecked_revision,
            });
        }

        temporary
            .persist(&path)
            .map_err(|error| WorkspaceError::Io {
                operation: "atomically replace text file".to_string(),
                message: error.error.to_string(),
            })?;
        sync_directory(parent)?;

        let (_, saved_metadata) = self.resolve_regular_file(&request.workspace_path)?;
        let saved_bytes = read_bounded(&path, self.text_limit_bytes)?;
        if saved_bytes != output {
            return Err(WorkspaceError::Conflict {
                current_revision: revision(&saved_bytes, &saved_metadata),
            });
        }
        Ok(save_result(
            request,
            revision(&saved_bytes, &saved_metadata),
            saved_bytes.len(),
            false,
        ))
    }

    fn resolve_regular_file(
        &self,
        workspace_path: &str,
    ) -> Result<(PathBuf, Metadata), WorkspaceError> {
        let relative = validate_relative_path(workspace_path)?;
        let mut current = self.root.clone();
        let components: Vec<_> = relative.components().collect();
        for (index, component) in components.iter().enumerate() {
            let Component::Normal(name) = component else {
                return Err(WorkspaceError::InvalidPath {
                    message: "only ordinary relative path components are supported".to_string(),
                });
            };
            current.push(name);
            let metadata = fs::symlink_metadata(&current).map_err(|error| WorkspaceError::Io {
                operation: "inspect workspace path".to_string(),
                message: error.to_string(),
            })?;
            if metadata.file_type().is_symlink() {
                return Err(WorkspaceError::OutsideWorkspace {
                    message: "symbolic links and reparse-point paths are not editable".to_string(),
                });
            }
            let is_final = index + 1 == components.len();
            if !is_final && !metadata.is_dir() {
                return Err(WorkspaceError::InvalidPath {
                    message: "an intermediate path component is not a directory".to_string(),
                });
            }
            if is_final {
                if !metadata.is_file() {
                    return Err(WorkspaceError::UnsupportedFile {
                        message: "only regular text files are editable".to_string(),
                    });
                }
                reject_multiple_links(&metadata)?;
                return Ok((current, metadata));
            }
        }
        Err(WorkspaceError::InvalidPath {
            message: "a file path is required".to_string(),
        })
    }
}

fn collect_workspace_files(
    root: &Path,
    relative_directory: &Path,
    limit: usize,
    paths: &mut Vec<String>,
    truncated: &mut bool,
) -> Result<(), WorkspaceError> {
    if *truncated {
        return Ok(());
    }
    let directory = root.join(relative_directory);
    let mut entries = fs::read_dir(&directory)
        .map_err(|error| WorkspaceError::Io {
            operation: "list workspace directory".to_string(),
            message: error.to_string(),
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| WorkspaceError::Io {
            operation: "list workspace directory".to_string(),
            message: error.to_string(),
        })?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let relative = relative_directory.join(name);
        let file_type = entry.file_type().map_err(|error| WorkspaceError::Io {
            operation: "inspect workspace entry".to_string(),
            message: error.to_string(),
        })?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            if name != ".git" {
                collect_workspace_files(root, &relative, limit, paths, truncated)?;
            }
            if *truncated {
                return Ok(());
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        if paths.len() == limit {
            *truncated = true;
            return Ok(());
        }
        let Some(path) = workspace_path_string(&relative) else {
            continue;
        };
        paths.push(path);
    }
    Ok(())
}

fn workspace_path_string(path: &Path) -> Option<String> {
    let parts = path
        .components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    Some(parts.join("/"))
}

fn validate_relative_path(path: &str) -> Result<&Path, WorkspaceError> {
    if path.is_empty()
        || path.contains(['\0', '\r', '\n', '\\'])
        || Path::new(path).is_absolute()
        || Path::new(path)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(WorkspaceError::InvalidPath {
            message: "select a normalized relative workspace file path".to_string(),
        });
    }
    Ok(Path::new(path))
}

fn validate_request_id(request_id: &str) -> Result<(), WorkspaceError> {
    if request_id.is_empty()
        || request_id.len() > 128
        || request_id.chars().any(char::is_whitespace)
    {
        return Err(WorkspaceError::InvalidPath {
            message: "save request IDs must contain 1 to 128 non-whitespace bytes".to_string(),
        });
    }
    Ok(())
}

fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, WorkspaceError> {
    let file = File::open(path).map_err(|error| WorkspaceError::Io {
        operation: "open text file".to_string(),
        message: error.to_string(),
    })?;
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    file.take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| WorkspaceError::Io {
            operation: "read text file".to_string(),
            message: error.to_string(),
        })?;
    if bytes.len() > limit {
        return Err(WorkspaceError::FileTooLarge { limit_bytes: limit });
    }
    Ok(bytes)
}

fn decode_snapshot(
    workspace_path: &str,
    bytes: Vec<u8>,
    metadata: &Metadata,
) -> Result<TextFileSnapshot, WorkspaceError> {
    if bytes.contains(&0) {
        return Err(WorkspaceError::BinaryFile {
            message: "files containing NUL bytes are treated as binary".to_string(),
        });
    }
    let utf8_bom = bytes.starts_with(UTF8_BOM);
    let text_bytes = if utf8_bom {
        &bytes[UTF8_BOM.len()..]
    } else {
        &bytes
    };
    let content = std::str::from_utf8(text_bytes).map_err(|_| WorkspaceError::InvalidEncoding {
        message: "the first editor slice supports UTF-8 text only".to_string(),
    })?;
    Ok(TextFileSnapshot {
        workspace_path: workspace_path.to_string(),
        content: content.to_string(),
        utf8_bom,
        revision: revision(&bytes, metadata),
        byte_length: bytes.len(),
    })
}

fn encode_text(content: &str, utf8_bom: bool, limit: usize) -> Result<Vec<u8>, WorkspaceError> {
    if content.as_bytes().contains(&0) {
        return Err(WorkspaceError::BinaryFile {
            message: "text buffers cannot contain NUL bytes".to_string(),
        });
    }
    let length = content.len() + usize::from(utf8_bom) * UTF8_BOM.len();
    if length > limit {
        return Err(WorkspaceError::FileTooLarge { limit_bytes: limit });
    }
    let mut bytes = Vec::with_capacity(length);
    if utf8_bom {
        bytes.extend_from_slice(UTF8_BOM);
    }
    bytes.extend_from_slice(content.as_bytes());
    Ok(bytes)
}

fn revision(bytes: &[u8], metadata: &Metadata) -> String {
    let mut digest = Sha256::new();
    digest.update(b"asterlyn-text-v1\0");
    digest.update((bytes.len() as u64).to_le_bytes());
    digest.update(bytes);
    digest.update([u8::from(metadata.permissions().readonly())]);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        digest.update(metadata.permissions().mode().to_le_bytes());
    }
    format!("{:x}", digest.finalize())
}

fn save_result(
    request: &SaveTextFileRequest,
    revision: String,
    byte_length: usize,
    already_saved: bool,
) -> SaveTextFileResult {
    SaveTextFileResult {
        workspace_path: request.workspace_path.clone(),
        revision,
        byte_length,
        request_id: request.request_id.clone(),
        already_saved,
    }
}

#[cfg(unix)]
fn reject_multiple_links(metadata: &Metadata) -> Result<(), WorkspaceError> {
    use std::os::unix::fs::MetadataExt;
    if metadata.nlink() != 1 {
        return Err(WorkspaceError::UnsupportedFile {
            message: "files with multiple hard links are not editable".to_string(),
        });
    }
    Ok(())
}

#[cfg(not(unix))]
fn reject_multiple_links(_metadata: &Metadata) -> Result<(), WorkspaceError> {
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), WorkspaceError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| WorkspaceError::Io {
            operation: "sync containing directory".to_string(),
            message: error.to_string(),
        })
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), WorkspaceError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, SeekFrom};

    fn workspace_with_file(name: &str, bytes: &[u8]) -> (tempfile::TempDir, Workspace) {
        let directory = tempfile::tempdir().expect("temporary workspace");
        fs::write(directory.path().join(name), bytes).expect("fixture file");
        let workspace = Workspace::open(directory.path()).expect("workspace opens");
        (directory, workspace)
    }

    #[test]
    fn reads_and_round_trips_bom_and_mixed_line_endings() {
        let (directory, workspace) =
            workspace_with_file("mixed.txt", b"\xef\xbb\xbffirst\r\nsecond\nlast\r");
        let snapshot = workspace.read_text_file("mixed.txt").expect("text reads");
        assert!(snapshot.utf8_bom);
        assert_eq!(snapshot.content, "first\r\nsecond\nlast\r");

        let result = workspace
            .save_text_file(&SaveTextFileRequest {
                workspace_path: "mixed.txt".to_string(),
                expected_revision: snapshot.revision,
                content: snapshot.content,
                utf8_bom: true,
                request_id: "save-1".to_string(),
            })
            .expect("unchanged retry succeeds");
        assert!(result.already_saved);
        assert_eq!(
            fs::read(directory.path().join("mixed.txt")).expect("file bytes"),
            b"\xef\xbb\xbffirst\r\nsecond\nlast\r"
        );
    }

    #[test]
    fn lists_an_ordinary_workspace_deterministically_without_following_links() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        fs::create_dir_all(directory.path().join("src/nested")).expect("source directories");
        fs::create_dir(directory.path().join(".git")).expect("Git metadata directory");
        fs::write(directory.path().join("z.txt"), b"z").expect("root file");
        fs::write(directory.path().join("src/a.txt"), b"a").expect("source file");
        fs::write(directory.path().join("src/nested/b.txt"), b"b").expect("nested file");
        fs::write(directory.path().join(".git/config"), b"private").expect("metadata file");
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            directory.path().join("src"),
            directory.path().join("linked-src"),
        )
        .expect("directory link");

        let workspace = Workspace::open(directory.path()).expect("workspace opens");
        assert_eq!(
            workspace.list_files(10).expect("catalog loads"),
            WorkspaceFileCatalog {
                paths: vec![
                    "src/a.txt".to_string(),
                    "src/nested/b.txt".to_string(),
                    "z.txt".to_string(),
                ],
                truncated: false,
            }
        );
        assert_eq!(
            workspace.list_files(2).expect("bounded catalog loads"),
            WorkspaceFileCatalog {
                paths: vec!["src/a.txt".to_string(), "src/nested/b.txt".to_string()],
                truncated: true,
            }
        );
    }

    #[test]
    fn reads_a_bounded_binary_snapshot_without_weakening_path_checks() {
        let (directory, workspace) = workspace_with_file("pixel.png", b"\x89PNG\r\n\x1a\nbytes");
        let snapshot = workspace
            .read_binary_file("pixel.png", 32)
            .expect("binary file reads");
        assert_eq!(snapshot.workspace_path, "pixel.png");
        assert_eq!(snapshot.bytes, b"\x89PNG\r\n\x1a\nbytes");
        assert_eq!(snapshot.byte_length, 13);
        assert!(matches!(
            workspace.read_binary_file("pixel.png", 4),
            Err(WorkspaceError::FileTooLarge { limit_bytes: 4 })
        ));
        assert!(matches!(
            workspace.read_binary_file("../pixel.png", 32),
            Err(WorkspaceError::InvalidPath { .. })
        ));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                directory.path().join("pixel.png"),
                directory.path().join("pixel-link.png"),
            )
            .expect("binary symlink fixture");
            assert!(matches!(
                workspace.read_binary_file("pixel-link.png", 32),
                Err(WorkspaceError::OutsideWorkspace { .. })
            ));
        }
        assert!(!snapshot.revision.is_empty());
        assert!(directory.path().join("pixel.png").is_file());
    }

    #[test]
    fn atomically_saves_and_preserves_permissions() {
        let (directory, workspace) = workspace_with_file("source.rs", b"fn old() {}\n");
        let path = directory.path().join("source.rs");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).expect("set mode");
        }
        let snapshot = workspace.read_text_file("source.rs").expect("text reads");
        let result = workspace
            .save_text_file(&SaveTextFileRequest {
                workspace_path: "source.rs".to_string(),
                expected_revision: snapshot.revision,
                content: "fn new() {}\n".to_string(),
                utf8_bom: false,
                request_id: "save-2".to_string(),
            })
            .expect("text saves");
        assert!(!result.already_saved);
        assert_eq!(
            fs::read_to_string(&path).expect("saved text"),
            "fn new() {}\n"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).expect("metadata").permissions().mode() & 0o777,
                0o640
            );
        }
    }

    #[test]
    fn external_change_returns_conflict_without_overwrite() {
        let (directory, workspace) = workspace_with_file("source.rs", b"original\n");
        let path = directory.path().join("source.rs");
        let snapshot = workspace.read_text_file("source.rs").expect("text reads");
        fs::write(&path, "external\n").expect("external edit");

        let error = workspace
            .save_text_file(&SaveTextFileRequest {
                workspace_path: "source.rs".to_string(),
                expected_revision: snapshot.revision,
                content: "local\n".to_string(),
                utf8_bom: false,
                request_id: "save-3".to_string(),
            })
            .expect_err("conflict blocks save");
        assert!(matches!(error, WorkspaceError::Conflict { .. }));
        assert_eq!(
            fs::read_to_string(path).expect("external text"),
            "external\n"
        );
    }

    #[test]
    fn rejects_escape_links_hard_links_binary_encoding_and_size() {
        let directory = tempfile::tempdir().expect("temporary workspace");
        fs::write(directory.path().join("binary"), b"a\0").expect("binary fixture");
        fs::write(directory.path().join("latin"), [0xff, 0xfe]).expect("encoding fixture");
        fs::write(directory.path().join("large"), b"12345").expect("large fixture");
        let workspace = Workspace::with_text_limit(directory.path(), 4).expect("workspace opens");

        assert!(matches!(
            workspace.read_text_file("../outside"),
            Err(WorkspaceError::InvalidPath { .. })
        ));
        assert!(matches!(
            workspace.read_text_file("binary"),
            Err(WorkspaceError::BinaryFile { .. })
        ));
        assert!(matches!(
            workspace.read_text_file("latin"),
            Err(WorkspaceError::InvalidEncoding { .. })
        ));
        assert!(matches!(
            workspace.read_text_file("large"),
            Err(WorkspaceError::FileTooLarge { .. })
        ));

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                directory.path().join("binary"),
                directory.path().join("link"),
            )
            .expect("symlink fixture");
            fs::hard_link(
                directory.path().join("binary"),
                directory.path().join("hard"),
            )
            .expect("hard link fixture");
            assert!(matches!(
                workspace.read_text_file("link"),
                Err(WorkspaceError::OutsideWorkspace { .. })
            ));
            assert!(matches!(
                workspace.read_text_file("hard"),
                Err(WorkspaceError::UnsupportedFile { .. })
            ));
        }
    }

    #[test]
    fn detects_change_between_initial_and_final_revision_checks() {
        let (directory, workspace) = workspace_with_file("source.rs", b"old\n");
        let path = directory.path().join("source.rs");
        let snapshot = workspace.read_text_file("source.rs").expect("text reads");

        let mut file = File::options()
            .read(true)
            .write(true)
            .open(&path)
            .expect("file opens");
        file.seek(SeekFrom::End(0)).expect("seek");
        file.write_all(b"external").expect("external append");
        file.sync_all().expect("external sync");

        let error = workspace
            .save_text_file(&SaveTextFileRequest {
                workspace_path: "source.rs".to_string(),
                expected_revision: snapshot.revision,
                content: "new\n".to_string(),
                utf8_bom: false,
                request_id: "save-4".to_string(),
            })
            .expect_err("changed revision conflicts");
        assert!(matches!(error, WorkspaceError::Conflict { .. }));
    }

    #[test]
    fn injected_precommit_failure_cleans_temporary_file_and_preserves_target() {
        let (directory, workspace) = workspace_with_file("source.rs", b"original\n");
        let snapshot = workspace.read_text_file("source.rs").expect("text reads");
        let mut temporary_path = None;
        let error = workspace
            .save_text_file_with_precommit(
                &SaveTextFileRequest {
                    workspace_path: "source.rs".to_string(),
                    expected_revision: snapshot.revision,
                    content: "replacement\n".to_string(),
                    utf8_bom: false,
                    request_id: "save-failure".to_string(),
                },
                |path| {
                    temporary_path = Some(path.to_path_buf());
                    Err(WorkspaceError::Io {
                        operation: "injected temporary-file flush".to_string(),
                        message: "test failure".to_string(),
                    })
                },
            )
            .expect_err("injected failure is returned");

        assert!(matches!(error, WorkspaceError::Io { .. }));
        assert_eq!(
            fs::read_to_string(directory.path().join("source.rs")).expect("target text"),
            "original\n"
        );
        assert!(!temporary_path.expect("temporary path captured").exists());
    }
}
