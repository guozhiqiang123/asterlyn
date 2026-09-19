use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    FileSnapshot, Workspace, WorkspaceError, sync_directory, validate_relative_path,
    validate_request_id,
};

const MANIFEST_VERSION: u8 = 1;
const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_LIMIT_BYTES: usize = 64 * 1024;
const ORIGINAL_BLOB: &str = "original.bin";
const RESTORED_BLOB: &str = "restored.bin";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileRestoreAction {
    Create,
    Overwrite,
    Unchanged,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRestorePreview {
    pub plan_id: String,
    pub workspace_path: String,
    pub action: FileRestoreAction,
    pub expected_revision: Option<String>,
    pub current_mode: u32,
    pub restored_mode: u32,
    pub current_byte_length: Option<usize>,
    pub restored_byte_length: usize,
}

#[derive(Debug, Clone)]
pub struct PreparedFileRestore {
    plan_id: String,
    workspace_path: String,
    original: FileSnapshot,
    restored_bytes: Vec<u8>,
    restored_mode: u32,
    preview: FileRestorePreview,
}

impl PreparedFileRestore {
    pub fn plan_id(&self) -> &str {
        &self.plan_id
    }

    pub fn workspace_path(&self) -> &str {
        &self.workspace_path
    }

    pub fn preview(&self) -> &FileRestorePreview {
        &self.preview
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileRestoreRecoveryStatus {
    Applied,
    Unchanged,
    RolledBack,
    NeedsRecovery,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileRestoreFileState {
    Original,
    Restored,
    Conflict,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRestoreRecoverySummary {
    pub recovery_id: String,
    pub workspace_path: String,
    pub status: FileRestoreRecoveryStatus,
    pub file_state: FileRestoreFileState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRestoreApplyResult {
    pub recovery_id: Option<String>,
    pub workspace_path: String,
    pub status: FileRestoreRecoveryStatus,
    pub file_state: FileRestoreFileState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryManifest {
    version: u8,
    recovery_id: String,
    workspace_root: String,
    workspace_path: String,
    status: ManifestStatus,
    original_blob: Option<String>,
    original_mode: u32,
    restored_blob: String,
    restored_mode: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ManifestStatus {
    Prepared,
    Applying,
    Applied,
    NeedsRecovery,
}

impl Workspace {
    pub fn plan_file_restore(
        &self,
        plan_id: &str,
        workspace_path: &str,
        restored_bytes: Vec<u8>,
        restored_mode: u32,
    ) -> Result<PreparedFileRestore, WorkspaceError> {
        validate_request_id(plan_id)?;
        if plan_id.len() > 96 {
            return Err(invalid(
                "file restore plan IDs must contain at most 96 bytes",
            ));
        }
        validate_relative_path(workspace_path)?;
        if restored_bytes.len() > self.text_limit_bytes {
            return Err(WorkspaceError::FileTooLarge {
                limit_bytes: self.text_limit_bytes,
            });
        }
        let restored_mode = normalize_mode(restored_mode)?;
        let original = self.snapshot_file(workspace_path)?;
        let action = match original.bytes.as_deref() {
            None => FileRestoreAction::Create,
            Some(bytes)
                if bytes == restored_bytes
                    && normalize_existing_mode(original.version.mode) == restored_mode =>
            {
                FileRestoreAction::Unchanged
            }
            Some(_) => FileRestoreAction::Overwrite,
        };
        let preview = FileRestorePreview {
            plan_id: plan_id.to_string(),
            workspace_path: workspace_path.to_string(),
            action,
            expected_revision: original.version.revision.clone(),
            current_mode: original.version.mode,
            restored_mode,
            current_byte_length: original.bytes.as_ref().map(Vec::len),
            restored_byte_length: restored_bytes.len(),
        };
        Ok(PreparedFileRestore {
            plan_id: plan_id.to_string(),
            workspace_path: workspace_path.to_string(),
            original,
            restored_bytes,
            restored_mode,
            preview,
        })
    }

    pub fn apply_file_restore(
        &self,
        recovery_root: &Path,
        plan: &PreparedFileRestore,
    ) -> Result<FileRestoreApplyResult, WorkspaceError> {
        self.apply_file_restore_with_hook(recovery_root, plan, || Ok(()))
    }

    fn apply_file_restore_with_hook(
        &self,
        recovery_root: &Path,
        plan: &PreparedFileRestore,
        before_replace: impl FnOnce() -> Result<(), WorkspaceError>,
    ) -> Result<FileRestoreApplyResult, WorkspaceError> {
        self.check_file_version(&plan.workspace_path, &plan.original.version)?;
        if plan.preview.action == FileRestoreAction::Unchanged {
            return Ok(FileRestoreApplyResult {
                recovery_id: None,
                workspace_path: plan.workspace_path.clone(),
                status: FileRestoreRecoveryStatus::Unchanged,
                file_state: FileRestoreFileState::Restored,
            });
        }

        let store = FileRestoreRecoveryStore::open(recovery_root)?;
        let mut manifest = store.create(self.root(), plan)?;
        manifest.status = ManifestStatus::Applying;
        store.write_manifest(&manifest)?;
        if let Err(error) = before_replace().and_then(|_| {
            self.replace_file_bytes(
                &plan.workspace_path,
                &plan.original.version,
                Some(&plan.restored_bytes),
                plan.restored_mode,
            )
            .map(|_| ())
        }) {
            manifest.status = ManifestStatus::NeedsRecovery;
            store.write_manifest(&manifest)?;
            return Err(error);
        }
        manifest.status = ManifestStatus::Applied;
        store.write_manifest(&manifest)?;
        let summary = self.inspect_file_restore(&store, &manifest)?;
        Ok(FileRestoreApplyResult {
            recovery_id: Some(summary.recovery_id),
            workspace_path: summary.workspace_path,
            status: summary.status,
            file_state: summary.file_state,
        })
    }

    pub fn list_file_restore_recoveries(
        &self,
        recovery_root: &Path,
    ) -> Result<Vec<FileRestoreRecoverySummary>, WorkspaceError> {
        let store = FileRestoreRecoveryStore::open(recovery_root)?;
        let mut summaries = Vec::new();
        for manifest in store.manifests()? {
            if manifest.workspace_root == workspace_root_text(self.root()) {
                summaries.push(self.inspect_file_restore(&store, &manifest)?);
            }
        }
        summaries.sort_by(|left, right| left.recovery_id.cmp(&right.recovery_id));
        Ok(summaries)
    }

    pub fn rollback_file_restore(
        &self,
        recovery_root: &Path,
        recovery_id: &str,
    ) -> Result<FileRestoreApplyResult, WorkspaceError> {
        let store = FileRestoreRecoveryStore::open(recovery_root)?;
        let mut manifest = store.read_manifest(recovery_id)?;
        ensure_workspace_manifest(self.root(), &manifest)?;
        let summary = self.inspect_file_restore(&store, &manifest)?;
        match summary.file_state {
            FileRestoreFileState::Restored => {
                let current = self.snapshot_file(&manifest.workspace_path)?;
                let original = manifest
                    .original_blob
                    .as_deref()
                    .map(|name| store.read_blob(recovery_id, name, self.text_limit_bytes))
                    .transpose()?;
                self.replace_file_bytes(
                    &manifest.workspace_path,
                    &current.version,
                    original.as_deref(),
                    manifest.original_mode,
                )?;
            }
            FileRestoreFileState::Original => {}
            FileRestoreFileState::Conflict | FileRestoreFileState::Unavailable => {
                manifest.status = ManifestStatus::NeedsRecovery;
                store.write_manifest(&manifest)?;
                return Ok(FileRestoreApplyResult {
                    recovery_id: Some(summary.recovery_id),
                    workspace_path: summary.workspace_path,
                    status: FileRestoreRecoveryStatus::NeedsRecovery,
                    file_state: summary.file_state,
                });
            }
        }

        let after = self.inspect_file_restore(&store, &manifest)?;
        if after.file_state != FileRestoreFileState::Original {
            manifest.status = ManifestStatus::NeedsRecovery;
            store.write_manifest(&manifest)?;
            return Ok(FileRestoreApplyResult {
                recovery_id: Some(after.recovery_id),
                workspace_path: after.workspace_path,
                status: FileRestoreRecoveryStatus::NeedsRecovery,
                file_state: after.file_state,
            });
        }
        store.remove(recovery_id)?;
        Ok(FileRestoreApplyResult {
            recovery_id: None,
            workspace_path: after.workspace_path,
            status: FileRestoreRecoveryStatus::RolledBack,
            file_state: FileRestoreFileState::Original,
        })
    }

    pub fn finalize_file_restore(
        &self,
        recovery_root: &Path,
        recovery_id: &str,
    ) -> Result<(), WorkspaceError> {
        let store = FileRestoreRecoveryStore::open(recovery_root)?;
        let manifest = store.read_manifest(recovery_id)?;
        ensure_workspace_manifest(self.root(), &manifest)?;
        let summary = self.inspect_file_restore(&store, &manifest)?;
        if summary.file_state != FileRestoreFileState::Restored {
            return Err(invalid(
                "file restore recovery can be finalized only while the reviewed content remains",
            ));
        }
        store.remove(recovery_id)
    }

    fn inspect_file_restore(
        &self,
        store: &FileRestoreRecoveryStore,
        manifest: &RecoveryManifest,
    ) -> Result<FileRestoreRecoverySummary, WorkspaceError> {
        ensure_workspace_manifest(self.root(), manifest)?;
        let original = manifest
            .original_blob
            .as_deref()
            .map(|name| store.read_blob(&manifest.recovery_id, name, self.text_limit_bytes))
            .transpose()?;
        let restored = store.read_blob(
            &manifest.recovery_id,
            &manifest.restored_blob,
            self.text_limit_bytes,
        )?;
        let file_state = match self.snapshot_file(&manifest.workspace_path) {
            Ok(current)
                if snapshot_matches(&current, original.as_deref(), manifest.original_mode) =>
            {
                FileRestoreFileState::Original
            }
            Ok(current) if snapshot_matches(&current, Some(&restored), manifest.restored_mode) => {
                FileRestoreFileState::Restored
            }
            Ok(_) => FileRestoreFileState::Conflict,
            Err(_) => FileRestoreFileState::Unavailable,
        };
        let status = if file_state == FileRestoreFileState::Restored {
            FileRestoreRecoveryStatus::Applied
        } else {
            FileRestoreRecoveryStatus::NeedsRecovery
        };
        Ok(FileRestoreRecoverySummary {
            recovery_id: manifest.recovery_id.clone(),
            workspace_path: manifest.workspace_path.clone(),
            status,
            file_state,
        })
    }
}

fn snapshot_matches(snapshot: &FileSnapshot, expected: Option<&[u8]>, expected_mode: u32) -> bool {
    snapshot.bytes.as_deref() == expected
        && (expected.is_none()
            || normalize_existing_mode(snapshot.version.mode)
                == normalize_existing_mode(expected_mode))
}

struct FileRestoreRecoveryStore {
    root: PathBuf,
}

impl FileRestoreRecoveryStore {
    fn open(root: &Path) -> Result<Self, WorkspaceError> {
        fs::create_dir_all(root)
            .map_err(|error| recovery_io("create file restore store", error))?;
        let root = fs::canonicalize(root)
            .map_err(|error| recovery_io("resolve file restore store", error))?;
        if !root.is_dir() {
            return Err(invalid("file restore recovery location is not a directory"));
        }
        Ok(Self { root })
    }

    fn create(
        &self,
        workspace_root: &Path,
        plan: &PreparedFileRestore,
    ) -> Result<RecoveryManifest, WorkspaceError> {
        validate_request_id(&plan.plan_id)?;
        let final_directory = self.root.join(&plan.plan_id);
        if final_directory.exists() {
            return Err(WorkspaceError::Busy {
                message: "a file restore recovery with this ID already exists".into(),
            });
        }
        let directory = self.root.join(format!(".{}.preparing", plan.plan_id));
        fs::create_dir(&directory).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                WorkspaceError::Busy {
                    message: "a file restore recovery is still being prepared".into(),
                }
            } else {
                recovery_io("create file restore recovery", error)
            }
        })?;
        sync_directory(&self.root)?;
        let prepared = (|| {
            let original_blob = plan
                .original
                .bytes
                .as_ref()
                .map(|bytes| {
                    write_new_durable(&directory.join(ORIGINAL_BLOB), bytes)?;
                    Ok::<_, WorkspaceError>(ORIGINAL_BLOB.to_string())
                })
                .transpose()?;
            write_new_durable(&directory.join(RESTORED_BLOB), &plan.restored_bytes)?;
            let manifest = RecoveryManifest {
                version: MANIFEST_VERSION,
                recovery_id: plan.plan_id.clone(),
                workspace_root: workspace_root_text(workspace_root),
                workspace_path: plan.workspace_path.clone(),
                status: ManifestStatus::Prepared,
                original_blob,
                original_mode: plan.original.version.mode,
                restored_blob: RESTORED_BLOB.to_string(),
                restored_mode: plan.restored_mode,
            };
            write_manifest_at(&directory, &manifest)?;
            fs::rename(&directory, &final_directory)
                .map_err(|error| recovery_io("publish file restore recovery", error))?;
            sync_directory(&self.root)?;
            Ok(manifest)
        })();
        if prepared.is_err() {
            let _ = fs::remove_dir_all(&directory);
            let _ = sync_directory(&self.root);
        }
        prepared
    }

    fn manifests(&self) -> Result<Vec<RecoveryManifest>, WorkspaceError> {
        let mut manifests = Vec::new();
        for entry in fs::read_dir(&self.root)
            .map_err(|error| recovery_io("list file restore recoveries", error))?
        {
            let entry =
                entry.map_err(|error| recovery_io("list file restore recoveries", error))?;
            if entry
                .file_type()
                .map_err(|error| recovery_io("inspect file restore recovery", error))?
                .is_dir()
            {
                let id = entry.file_name().to_string_lossy().to_string();
                if !id.starts_with('.') {
                    manifests.push(self.read_manifest(&id)?);
                }
            }
        }
        Ok(manifests)
    }

    fn read_manifest(&self, recovery_id: &str) -> Result<RecoveryManifest, WorkspaceError> {
        validate_request_id(recovery_id)?;
        let directory = self.checked_directory(recovery_id)?;
        let bytes = read_limited_file(&directory.join(MANIFEST_FILE), MANIFEST_LIMIT_BYTES)?;
        let manifest: RecoveryManifest = serde_json::from_slice(&bytes).map_err(|error| {
            invalid(format!(
                "file restore recovery manifest is invalid: {error}"
            ))
        })?;
        if manifest.version != MANIFEST_VERSION || manifest.recovery_id != recovery_id {
            return Err(invalid(
                "file restore recovery manifest identity is invalid",
            ));
        }
        validate_relative_path(&manifest.workspace_path)?;
        if manifest
            .original_blob
            .as_deref()
            .is_some_and(|name| name != ORIGINAL_BLOB)
            || manifest.restored_blob != RESTORED_BLOB
        {
            return Err(invalid("file restore recovery blob identity is invalid"));
        }
        Ok(manifest)
    }

    fn write_manifest(&self, manifest: &RecoveryManifest) -> Result<(), WorkspaceError> {
        write_manifest_at(&self.checked_directory(&manifest.recovery_id)?, manifest)
    }

    fn read_blob(
        &self,
        recovery_id: &str,
        name: &str,
        limit: usize,
    ) -> Result<Vec<u8>, WorkspaceError> {
        if name != ORIGINAL_BLOB && name != RESTORED_BLOB {
            return Err(invalid("file restore recovery blob name is invalid"));
        }
        read_limited_file(&self.checked_directory(recovery_id)?.join(name), limit)
    }

    fn remove(&self, recovery_id: &str) -> Result<(), WorkspaceError> {
        fs::remove_dir_all(self.checked_directory(recovery_id)?)
            .map_err(|error| recovery_io("remove file restore recovery", error))?;
        sync_directory(&self.root)
    }

    fn checked_directory(&self, recovery_id: &str) -> Result<PathBuf, WorkspaceError> {
        validate_request_id(recovery_id)?;
        let directory = self.root.join(recovery_id);
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|error| recovery_io("inspect file restore recovery", error))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(invalid("file restore recovery path is unsafe"));
        }
        Ok(directory)
    }
}

fn write_manifest_at(directory: &Path, manifest: &RecoveryManifest) -> Result<(), WorkspaceError> {
    let bytes = serde_json::to_vec(manifest).map_err(|error| WorkspaceError::Io {
        operation: "serialize file restore recovery".into(),
        message: error.to_string(),
    })?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| recovery_io("create recovery manifest temporary file", error))?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.flush())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| recovery_io("write file restore recovery manifest", error))?;
    temporary
        .persist(directory.join(MANIFEST_FILE))
        .map_err(|error| recovery_io("replace file restore recovery manifest", error.error))?;
    sync_directory(directory)
}

fn write_new_durable(path: &Path, bytes: &[u8]) -> Result<(), WorkspaceError> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| recovery_io("create file restore recovery blob", error))?;
    file.write_all(bytes)
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all())
        .map_err(|error| recovery_io("write file restore recovery blob", error))
}

fn read_limited_file(path: &Path, limit: usize) -> Result<Vec<u8>, WorkspaceError> {
    let file =
        File::open(path).map_err(|error| recovery_io("open file restore recovery", error))?;
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    file.take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| recovery_io("read file restore recovery", error))?;
    if bytes.len() > limit {
        return Err(invalid("file restore recovery exceeds its size limit"));
    }
    Ok(bytes)
}

fn normalize_mode(mode: u32) -> Result<u32, WorkspaceError> {
    #[cfg(unix)]
    {
        let normalized = mode & 0o777;
        if normalized != 0o644 && normalized != 0o755 {
            return Err(invalid(
                "historical files must use regular 0644 or executable 0755 mode",
            ));
        }
        Ok(normalized)
    }
    #[cfg(not(unix))]
    {
        let _ = mode;
        Ok(0)
    }
}

fn normalize_existing_mode(mode: u32) -> u32 {
    #[cfg(unix)]
    {
        mode & 0o777
    }
    #[cfg(not(unix))]
    {
        mode
    }
}

fn ensure_workspace_manifest(
    root: &Path,
    manifest: &RecoveryManifest,
) -> Result<(), WorkspaceError> {
    if manifest.workspace_root != workspace_root_text(root) {
        return Err(WorkspaceError::NotAuthorized {
            message: "file restore recovery belongs to another workspace".into(),
        });
    }
    Ok(())
}

fn workspace_root_text(root: &Path) -> String {
    root.to_string_lossy().to_string()
}

fn invalid(message: impl Into<String>) -> WorkspaceError {
    WorkspaceError::InvalidMutation {
        message: message.into(),
    }
}

fn recovery_io(operation: &str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        operation: operation.into(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, tempfile::TempDir, Workspace) {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("file.txt"), b"current").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                root.path().join("file.txt"),
                fs::Permissions::from_mode(0o644),
            )
            .unwrap();
        }
        let recovery = tempfile::tempdir().unwrap();
        let workspace = Workspace::with_text_limit(root.path(), 16 * 1024 * 1024).unwrap();
        (root, recovery, workspace)
    }

    #[test]
    fn overwrites_and_rolls_back_from_a_durable_record() {
        let (root, recovery, workspace) = fixture();
        let plan = workspace
            .plan_file_restore("restore-1", "file.txt", b"historical".to_vec(), 0o644)
            .unwrap();
        assert_eq!(plan.preview().action, FileRestoreAction::Overwrite);
        let applied = workspace
            .apply_file_restore(recovery.path(), &plan)
            .unwrap();
        assert_eq!(applied.status, FileRestoreRecoveryStatus::Applied);
        assert_eq!(
            fs::read(root.path().join("file.txt")).unwrap(),
            b"historical"
        );

        let reopened = Workspace::with_text_limit(root.path(), 16 * 1024 * 1024).unwrap();
        let listed = reopened
            .list_file_restore_recoveries(recovery.path())
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_state, FileRestoreFileState::Restored);
        let rolled_back = reopened
            .rollback_file_restore(recovery.path(), "restore-1")
            .unwrap();
        assert_eq!(rolled_back.status, FileRestoreRecoveryStatus::RolledBack);
        assert_eq!(fs::read(root.path().join("file.txt")).unwrap(), b"current");
        assert!(
            reopened
                .list_file_restore_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn creates_a_missing_file_and_rollback_removes_it() {
        let (root, recovery, workspace) = fixture();
        let plan = workspace
            .plan_file_restore("restore-create", "new.txt", b"historical".to_vec(), 0o644)
            .unwrap();
        assert_eq!(plan.preview().action, FileRestoreAction::Create);
        workspace
            .apply_file_restore(recovery.path(), &plan)
            .unwrap();
        assert_eq!(
            fs::read(root.path().join("new.txt")).unwrap(),
            b"historical"
        );
        workspace
            .rollback_file_restore(recovery.path(), "restore-create")
            .unwrap();
        assert!(!root.path().join("new.txt").exists());
    }

    #[test]
    fn unchanged_restore_has_no_recovery_side_effect() {
        let (_root, recovery, workspace) = fixture();
        let plan = workspace
            .plan_file_restore("restore-noop", "file.txt", b"current".to_vec(), 0o644)
            .unwrap();
        let result = workspace
            .apply_file_restore(recovery.path(), &plan)
            .unwrap();
        assert_eq!(result.status, FileRestoreRecoveryStatus::Unchanged);
        assert_eq!(result.recovery_id, None);
        assert!(
            workspace
                .list_file_restore_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn stale_plan_never_changes_the_target() {
        let (root, recovery, workspace) = fixture();
        let plan = workspace
            .plan_file_restore("restore-stale", "file.txt", b"historical".to_vec(), 0o644)
            .unwrap();
        fs::write(root.path().join("file.txt"), b"external").unwrap();
        assert!(matches!(
            workspace.apply_file_restore(recovery.path(), &plan),
            Err(WorkspaceError::Conflict { .. })
        ));
        assert_eq!(fs::read(root.path().join("file.txt")).unwrap(), b"external");
        assert!(
            workspace
                .list_file_restore_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rollback_preserves_an_external_edit_and_retains_recovery() {
        let (root, recovery, workspace) = fixture();
        let plan = workspace
            .plan_file_restore(
                "restore-conflict",
                "file.txt",
                b"historical".to_vec(),
                0o644,
            )
            .unwrap();
        workspace
            .apply_file_restore(recovery.path(), &plan)
            .unwrap();
        fs::write(root.path().join("file.txt"), b"external").unwrap();
        let outcome = workspace
            .rollback_file_restore(recovery.path(), "restore-conflict")
            .unwrap();
        assert_eq!(outcome.status, FileRestoreRecoveryStatus::NeedsRecovery);
        assert_eq!(outcome.file_state, FileRestoreFileState::Conflict);
        assert_eq!(fs::read(root.path().join("file.txt")).unwrap(), b"external");
        assert_eq!(
            workspace
                .list_file_restore_recoveries(recovery.path())
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn failure_after_recovery_publication_is_discoverable_after_restart() {
        let (root, recovery, workspace) = fixture();
        let plan = workspace
            .plan_file_restore(
                "restore-interrupted",
                "file.txt",
                b"historical".to_vec(),
                0o644,
            )
            .unwrap();
        let result = workspace.apply_file_restore_with_hook(recovery.path(), &plan, || {
            Err(WorkspaceError::Io {
                operation: "injected interruption".into(),
                message: "stop".into(),
            })
        });
        assert!(result.is_err());
        assert_eq!(fs::read(root.path().join("file.txt")).unwrap(), b"current");
        let reopened = Workspace::with_text_limit(root.path(), 16 * 1024 * 1024).unwrap();
        let listed = reopened
            .list_file_restore_recoveries(recovery.path())
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_state, FileRestoreFileState::Original);
        assert_eq!(listed[0].status, FileRestoreRecoveryStatus::NeedsRecovery);
    }

    #[test]
    fn finalization_requires_the_reviewed_content() {
        let (root, recovery, workspace) = fixture();
        let plan = workspace
            .plan_file_restore(
                "restore-finalize",
                "file.txt",
                b"historical".to_vec(),
                0o644,
            )
            .unwrap();
        workspace
            .apply_file_restore(recovery.path(), &plan)
            .unwrap();
        workspace
            .finalize_file_restore(recovery.path(), "restore-finalize")
            .unwrap();
        assert!(
            workspace
                .list_file_restore_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );

        let plan = workspace
            .plan_file_restore(
                "restore-finalize-conflict",
                "file.txt",
                b"second".to_vec(),
                0o644,
            )
            .unwrap();
        workspace
            .apply_file_restore(recovery.path(), &plan)
            .unwrap();
        fs::write(root.path().join("file.txt"), b"external").unwrap();
        assert!(
            workspace
                .finalize_file_restore(recovery.path(), "restore-finalize-conflict")
                .is_err()
        );
    }
}
