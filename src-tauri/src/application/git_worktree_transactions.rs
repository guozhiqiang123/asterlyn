//! Application-owned recoverable worktree writes. Git owns index/ref semantics; Workspace owns
//! raw, bounded, revision-checked file replacement. Callers hold the shared workspace write lock.
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use asterlyn_git::{FileChange, GitError, GitOperationSnapshot, GitRepository};
use asterlyn_workspace::{FileSnapshot, FileVersion, Workspace, WorkspaceError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const FILE_LIMIT: usize = 16 * 1024 * 1024;
const TRANSACTION_LIMIT: usize = 32 * 1024 * 1024;
const MANIFEST_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreChangesPlan {
    pub(crate) root: String,
    pub(crate) selected: Vec<FileChange>,
    pub(crate) paths: Vec<String>,
    pub(crate) head_oid: String,
    pub(crate) token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitWorktreeRecovery {
    pub(crate) id: String,
    pub(crate) operation: String,
    pub(crate) paths: Vec<String>,
    pub(crate) status: String,
    pub(crate) can_undo: bool,
    pub(crate) backup_path: String,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    version: u32,
    root: String,
    head_oid: String,
    operation: String,
    status: String,
    files: Vec<Backup>,
    index: Backup,
}

#[derive(Serialize, Deserialize)]
struct Backup {
    path: String,
    before: FileVersion,
    after: Option<FileVersion>,
    backup: String,
    digest: String,
}

struct Checkpoint {
    head: String,
    files: Vec<(String, FileSnapshot)>,
    index: FileSnapshot,
}

pub(crate) fn prepare_restore(
    repository: &GitRepository,
    selected: &[FileChange],
) -> Result<RestoreChangesPlan, GitError> {
    let (head_oid, paths) = repository.review_revert_selected(selected)?;
    let checkpoint = checkpoint(repository, &paths)?;
    if checkpoint.head != head_oid {
        return Err(stale("HEAD changed while reading the review"));
    }
    let token = checkpoint_token(&checkpoint)?;
    Ok(RestoreChangesPlan {
        root: canonical_root(repository)?,
        selected: selected.to_vec(),
        paths,
        head_oid,
        token,
    })
}

pub(crate) fn restore_changes(
    repository: &GitRepository,
    recovery_root: &Path,
    plan: &RestoreChangesPlan,
) -> Result<(), GitError> {
    if prepare_restore(repository, &plan.selected)? != *plan {
        return Err(stale(
            "the file, index, or HEAD changed after review; review again",
        ));
    }
    let before = checkpoint(repository, &plan.paths)?;
    if checkpoint_token(&before)? != plan.token {
        return Err(stale("the reviewed content changed"));
    }
    let (directory, mut manifest) = persist_checkpoint(
        recovery_root,
        repository,
        "Restore uncommitted changes",
        &before,
    )?;
    let result = repository.revert_selected_reviewed(&plan.selected, &plan.head_oid, || {
        check_checkpoint(repository, &before)
    });
    finish_transaction(repository, &directory, &mut manifest, result)
}

pub(crate) fn resolve_conflict(
    repository: &GitRepository,
    recovery_root: &Path,
    path: &str,
    expected_token: &str,
    content: Option<&str>,
) -> Result<Option<GitOperationSnapshot>, GitError> {
    let opened = repository.read_conflict_content(path)?;
    if opened.revision_token != expected_token {
        return Err(stale("the conflict changed after it was opened"));
    }
    if content.is_some_and(|content| content.len() > 4 * 1024 * 1024) {
        return Err(stale("the resolution exceeds the four MiB limit"));
    }
    let before = checkpoint(repository, &[path.to_string()])?;
    let (directory, mut manifest) =
        persist_checkpoint(recovery_root, repository, "Resolve conflict", &before)?;
    // Preserve the user's merged result as well as the previous worktree and index before writing.
    if let Some(content) = content {
        persist_bytes(&directory, "resolved-result", content.as_bytes())?;
    }
    let workspace =
        Workspace::with_text_limit(repository.root(), FILE_LIMIT).map_err(workspace_error)?;
    let original = &before.files[0].1.version;
    let result = repository.resolve_conflict_with_write(path, expected_token, content, || {
        check_checkpoint(repository, &before)?;
        workspace
            .replace_file_bytes(path, original, content.map(str::as_bytes), original.mode)
            .map_err(workspace_error)?;
        Ok(())
    });
    finish_transaction(repository, &directory, &mut manifest, result)
}

fn checkpoint(repository: &GitRepository, paths: &[String]) -> Result<Checkpoint, GitError> {
    if paths.is_empty() || paths.len() > 1_000 {
        return Err(stale("a transaction must contain 1 to 1,000 files"));
    }
    let index = index_workspace(repository)?
        .snapshot_file("index")
        .map_err(workspace_error)?;
    let mut total = index.bytes.as_ref().map_or(0, Vec::len);
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        reject_git_path(path)?;
        let remaining = TRANSACTION_LIMIT.saturating_sub(total).clamp(1, FILE_LIMIT);
        let workspace =
            Workspace::with_text_limit(repository.root(), remaining).map_err(workspace_error)?;
        let file = workspace.snapshot_file(path).map_err(workspace_error)?;
        total += file.bytes.as_ref().map_or(0, Vec::len);
        if total > TRANSACTION_LIMIT {
            return Err(stale(
                "recovery material exceeds the 32 MiB transaction limit",
            ));
        }
        files.push((path.clone(), file));
    }
    Ok(Checkpoint {
        head: current_head(repository)?,
        files,
        index,
    })
}

fn check_checkpoint(repository: &GitRepository, expected: &Checkpoint) -> Result<(), GitError> {
    let current = checkpoint(
        repository,
        &expected
            .files
            .iter()
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>(),
    )?;
    if checkpoint_token(&current)? != checkpoint_token(expected)? {
        return Err(stale("the worktree or index changed before writing"));
    }
    Ok(())
}

fn checkpoint_token(checkpoint: &Checkpoint) -> Result<String, GitError> {
    let versions = checkpoint
        .files
        .iter()
        .map(|(path, file)| (path, &file.version))
        .collect::<Vec<_>>();
    Ok(digest(
        &serde_json::to_vec(&(&checkpoint.head, &checkpoint.index.version, versions))
            .map_err(json_error)?,
    ))
}

fn persist_checkpoint(
    recovery_root: &Path,
    repository: &GitRepository,
    operation: &str,
    checkpoint: &Checkpoint,
) -> Result<(PathBuf, Manifest), GitError> {
    fs::create_dir_all(recovery_root).map_err(io)?;
    let directory = tempfile::Builder::new()
        .prefix("change-")
        .tempdir_in(recovery_root)
        .map_err(io)?;
    let mut files = Vec::new();
    for (index, (path, file)) in checkpoint.files.iter().enumerate() {
        files.push(backup_file(
            directory.path(),
            path,
            &format!("file-{index}"),
            file,
        )?);
    }
    let index = backup_file(directory.path(), "index", "index-before", &checkpoint.index)?;
    let manifest = Manifest {
        version: 1,
        root: canonical_root(repository)?,
        head_oid: checkpoint.head.clone(),
        operation: operation.into(),
        status: "prepared".into(),
        files,
        index,
    };
    save_manifest(directory.path(), &manifest)?;
    let path = directory.keep();
    sync_dir(recovery_root)?;
    Ok((path, manifest))
}

fn backup_file(
    directory: &Path,
    path: &str,
    name: &str,
    file: &FileSnapshot,
) -> Result<Backup, GitError> {
    let bytes = file.bytes.as_deref().unwrap_or_default();
    persist_bytes(directory, name, bytes)?;
    Ok(Backup {
        path: path.into(),
        before: file.version.clone(),
        after: None,
        backup: name.into(),
        digest: digest(bytes),
    })
}

fn finish_transaction<T>(
    repository: &GitRepository,
    directory: &Path,
    manifest: &mut Manifest,
    result: Result<T, GitError>,
) -> Result<T, GitError> {
    // A failed/uncertain mutation retains original bytes and the proposed resolution. Automatic
    // undo is enabled only after a successful result has a durable postcondition snapshot.
    match result {
        Ok(value) => {
            let after = checkpoint(
                repository,
                &manifest
                    .files
                    .iter()
                    .map(|file| file.path.clone())
                    .collect::<Vec<_>>(),
            )
            .map_err(|error| recovery_error(error, directory))?;
            for (file, (_, snapshot)) in manifest.files.iter_mut().zip(after.files) {
                file.after = Some(snapshot.version);
            }
            manifest.index.after = Some(after.index.version);
            manifest.status = "applied".into();
            save_manifest(directory, manifest).map_err(|error| recovery_error(error, directory))?;
            Ok(value)
        }
        Err(error) => Err(recovery_error(error, directory)),
    }
}

pub(crate) fn list_recoveries(
    repository: &GitRepository,
    recovery_root: &Path,
) -> Result<Vec<GitWorktreeRecovery>, GitError> {
    let mut result = Vec::new();
    let entries = match fs::read_dir(recovery_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(error) => return Err(io(error)),
    };
    let root = canonical_root(repository)?;
    for entry in entries.take(512) {
        let entry = entry.map_err(io)?;
        if !entry.file_type().map_err(io)?.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_id(&id) {
            continue;
        }
        let Ok(manifest) = load_manifest(&entry.path()) else {
            continue;
        };
        if manifest.root != root || manifest.status == "undone" {
            continue;
        }
        result.push(GitWorktreeRecovery {
            id,
            operation: manifest.operation,
            paths: manifest.files.into_iter().map(|file| file.path).collect(),
            can_undo: matches!(manifest.status.as_str(), "applied" | "restoring"),
            status: manifest.status,
            backup_path: entry.path().to_string_lossy().into_owned(),
        });
    }
    result.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(result)
}

pub(crate) fn undo_recovery(
    repository: &GitRepository,
    recovery_root: &Path,
    id: &str,
) -> Result<(), GitError> {
    if !valid_id(id) {
        return Err(stale("invalid recovery identity"));
    }
    let directory = recovery_root.join(id);
    let mut manifest = load_manifest(&directory)?;
    if manifest.root != canonical_root(repository)?
        || !matches!(manifest.status.as_str(), "applied" | "restoring")
    {
        return Err(stale(
            "this recovery requires inspecting its retained backup files",
        ));
    }
    if current_head(repository)? != manifest.head_oid {
        return Err(stale(
            "HEAD changed since this operation; the recovery was preserved",
        ));
    }
    let workspace =
        Workspace::with_text_limit(repository.root(), FILE_LIMIT).map_err(workspace_error)?;
    let index_workspace = index_workspace(repository)?;
    for file in &manifest.files {
        reject_git_path(&file.path)?;
        check_recovery_version(&workspace, file)?;
        read_backup(&directory, file)?;
    }
    check_recovery_version(&index_workspace, &manifest.index)?;
    read_backup(&directory, &manifest.index)?;
    // Acquire Git's mandatory index lock too; external Git writers must not race rollback.
    let lock_path = repository.git_directory().join("index.lock");
    let lock = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(io)?;
    let lock = IndexLock {
        path: lock_path,
        _file: lock,
    };
    if current_head(repository)? != manifest.head_oid {
        return Err(stale("HEAD changed before undo acquired the index lock"));
    }
    manifest.status = "restoring".into();
    save_manifest(&directory, &manifest)?;
    for file in &manifest.files {
        restore_backup(&workspace, &directory, file)?;
    }
    restore_backup(&index_workspace, &directory, &manifest.index)?;
    manifest.status = "undone".into();
    save_manifest(&directory, &manifest)?;
    drop(lock);
    Ok(())
}

fn check_recovery_version(workspace: &Workspace, file: &Backup) -> Result<FileVersion, GitError> {
    let current = workspace
        .snapshot_file(&file.path)
        .map_err(workspace_error)?
        .version;
    if current != file.before && Some(&current) != file.after.as_ref() {
        return Err(stale(
            "a file or index changed after the operation; undo will not overwrite newer changes",
        ));
    }
    Ok(current)
}

fn restore_backup(workspace: &Workspace, directory: &Path, file: &Backup) -> Result<(), GitError> {
    // Use exactly the version that passed the recovery guard; a second unchecked read could
    // authorize overwriting bytes from an external writer that arrived between the two reads.
    let current = check_recovery_version(workspace, file)?;
    if current == file.before {
        return Ok(());
    }
    let bytes = read_backup(directory, file)?;
    workspace
        .replace_file_bytes(
            &file.path,
            &current,
            file.before.revision.as_ref().map(|_| bytes.as_slice()),
            file.before.mode,
        )
        .map_err(workspace_error)?;
    Ok(())
}

fn read_backup(directory: &Path, file: &Backup) -> Result<Vec<u8>, GitError> {
    if file.backup.contains(['/', '\\']) {
        return Err(stale("invalid recovery backup path"));
    }
    let bytes = Workspace::with_text_limit(directory, TRANSACTION_LIMIT)
        .map_err(workspace_error)?
        .read_binary_file(&file.backup, TRANSACTION_LIMIT)
        .map_err(workspace_error)?
        .bytes;
    if digest(&bytes) != file.digest {
        return Err(stale("recovery bytes failed integrity verification"));
    }
    Ok(bytes)
}

fn persist_bytes(directory: &Path, name: &str, bytes: &[u8]) -> Result<(), GitError> {
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(io)?;
    file.write_all(bytes)
        .and_then(|_| file.flush())
        .and_then(|_| file.as_file().sync_all())
        .map_err(io)?;
    file.persist(directory.join(name))
        .map_err(|error| io(error.error))?;
    sync_dir(directory)
}

fn save_manifest(directory: &Path, manifest: &Manifest) -> Result<(), GitError> {
    persist_bytes(
        directory,
        "manifest.json",
        &serde_json::to_vec(manifest).map_err(json_error)?,
    )
}

fn load_manifest(directory: &Path) -> Result<Manifest, GitError> {
    if fs::symlink_metadata(directory)
        .map_err(io)?
        .file_type()
        .is_symlink()
    {
        return Err(stale("linked recovery directories are unsupported"));
    }
    let bytes = Workspace::with_text_limit(directory, MANIFEST_LIMIT)
        .map_err(workspace_error)?
        .read_binary_file("manifest.json", MANIFEST_LIMIT)
        .map_err(workspace_error)?
        .bytes;
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(json_error)?;
    if manifest.version != 1 || manifest.files.len() > 1_000 || manifest.index.path != "index" {
        return Err(stale("unsupported recovery manifest"));
    }
    Ok(manifest)
}

fn index_workspace(repository: &GitRepository) -> Result<Workspace, GitError> {
    Workspace::with_text_limit(repository.git_directory(), TRANSACTION_LIMIT)
        .map_err(workspace_error)
}

fn current_head(repository: &GitRepository) -> Result<String, GitError> {
    repository
        .head_oid()?
        .ok_or_else(|| stale("an existing HEAD is required"))
}

fn canonical_root(repository: &GitRepository) -> Result<String, GitError> {
    Ok(fs::canonicalize(repository.root())
        .map_err(io)?
        .to_string_lossy()
        .into_owned())
}

fn reject_git_path(path: &str) -> Result<(), GitError> {
    if path
        .split(['/', '\\'])
        .any(|part| part.eq_ignore_ascii_case(".git"))
    {
        return Err(stale("Git metadata is not an editable worktree file"));
    }
    Ok(())
}

fn valid_id(id: &str) -> bool {
    id.starts_with("change-")
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn io(error: std::io::Error) -> GitError {
    GitError::Io {
        operation: "recoverable worktree operation".into(),
        message: error.to_string(),
    }
}
fn json_error(error: serde_json::Error) -> GitError {
    GitError::Io {
        operation: "worktree recovery record".into(),
        message: error.to_string(),
    }
}
fn workspace_error(error: WorkspaceError) -> GitError {
    GitError::Io {
        operation: "safe worktree file operation".into(),
        message: error.to_string(),
    }
}
fn stale(message: &str) -> GitError {
    GitError::UnsafeOperation {
        operation: "recoverable worktree operation".into(),
        message: message.into(),
        blockers: Vec::new(),
    }
}
fn recovery_error(error: GitError, directory: &Path) -> GitError {
    stale(&format!(
        "{error}. Recovery material is retained at {}",
        directory.display()
    ))
}
fn sync_dir(path: &Path) -> Result<(), GitError> {
    #[cfg(unix)]
    {
        fs::File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(io)?;
    }
    let _ = path;
    Ok(())
}
struct IndexLock {
    path: PathBuf,
    _file: fs::File,
}
impl Drop for IndexLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
#[path = "git_worktree_transactions_tests.rs"]
mod tests;
