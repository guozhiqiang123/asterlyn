use super::{storage::ensure_private_root, *};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const CONTENT_DIRECTORY: &str = "content-v1";
const STAGING_DIRECTORY: &str = "content-staging-v1";
const TOMBSTONE_DIRECTORY: &str = "content-tombstones-v1";
const MAX_CONTENT_FILES: u32 = 65_536;
const MAX_CONTENT_DEPTH: usize = 64;
const MAX_CONTENT_PATH_BYTES: usize = 16_384;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedContentInventory {
    pub digest: String,
    pub expanded_bytes: u64,
    pub file_count: u32,
}

#[derive(Debug)]
struct StagedManagedContent {
    identity: ManagedArtifact,
    path: PathBuf,
    inventory: ManagedContentInventory,
}

/// Composes verified immutable content with the durable installation index.
/// Network acquisition and archive extraction remain separate native boundaries.
#[derive(Debug)]
pub struct ManagedInstallationContentStore {
    root: PathBuf,
    index: ManagedInstallationIndexStore,
    staged: BTreeMap<String, StagedManagedContent>,
}

impl ManagedInstallationContentStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            index: ManagedInstallationIndexStore::new(root.clone()),
            root,
            staged: BTreeMap::new(),
        }
    }

    /// Restore interrupted content moves before the index is exposed to a coordinator.
    pub fn load_and_recover(&mut self) -> Result<ManagedInstallationIndex, ManagedInstallError> {
        let index = self.index.load()?;
        self.recover_content(&index)?;
        Ok(index)
    }

    /// Import an already safely extracted directory into a private same-filesystem stage.
    /// The exact tree digest is checked again by `ManagedArtifactVerifier` before commit.
    pub fn stage_directory(
        &mut self,
        artifact: &ManagedArtifact,
        source: &Path,
        expanded_limit: u64,
    ) -> Result<ManagedContentInventory, ManagedInstallError> {
        artifact.validate()?;
        if expanded_limit == 0 || expanded_limit > MAX_EXPANDED_BYTES {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let id = artifact.id();
        if self.staged.contains_key(&id) {
            return Err(ManagedInstallError::Busy);
        }
        self.ensure_layout()?;
        let source_metadata =
            fs::symlink_metadata(source).map_err(|_| ManagedInstallError::StorageFailed)?;
        if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        let temporary = tempfile::Builder::new()
            .prefix("stage-")
            .tempdir_in(self.staging_root())
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        let staged_path = temporary.keep();
        let result = (|| {
            copy_tree(source, &staged_path, expanded_limit)?;
            let inventory = inventory_tree(&staged_path, expanded_limit)?;
            if inventory.expanded_bytes == 0 || inventory.digest != artifact.content_digest {
                return Err(ManagedInstallError::IntegrityMismatch);
            }
            self.staged.insert(
                id,
                StagedManagedContent {
                    identity: artifact.clone(),
                    path: staged_path.clone(),
                    inventory: inventory.clone(),
                },
            );
            Ok(inventory)
        })();
        if result.is_err() {
            let _ = remove_owned_directory(&staged_path);
        }
        result
    }

    pub fn artifact_path(&self, artifact_id: &str) -> Result<PathBuf, ManagedInstallError> {
        Ok(self.content_root().join(artifact_hex(artifact_id)?))
    }

    fn ensure_layout(&self) -> Result<(), ManagedInstallError> {
        ensure_private_root(&self.root)?;
        for directory in [
            self.content_root(),
            self.staging_root(),
            self.tombstone_root(),
        ] {
            ensure_private_root(&directory)?;
        }
        Ok(())
    }

    fn recover_content(&self, index: &ManagedInstallationIndex) -> Result<(), ManagedInstallError> {
        self.ensure_layout()?;
        for path in owned_directories(&self.staging_root())? {
            remove_owned_directory(&path)?;
        }
        let expected: BTreeSet<String> = index
            .artifacts
            .iter()
            .filter(|artifact| artifact.ownership == ManagedArtifactOwnership::Managed)
            .map(|artifact| artifact.id.clone())
            .collect();
        for tombstone in owned_directories(&self.tombstone_root())? {
            let id = tombstone_artifact_id(&tombstone)?;
            let destination = self.artifact_path(&id)?;
            if expected.contains(&id) && !destination.exists() {
                fs::rename(&tombstone, &destination)
                    .map_err(|_| ManagedInstallError::StorageFailed)?;
                sync_directory(&self.content_root())?;
            } else {
                remove_owned_directory(&tombstone)?;
            }
        }
        for content in owned_directories(&self.content_root())? {
            let name = content
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or(ManagedInstallError::StorageFailed)?;
            let id = format!("sha256:{name}");
            artifact_hex(&id)?;
            if !expected.contains(&id) {
                let tombstone = unique_tombstone(&self.tombstone_root(), name)?;
                fs::rename(&content, &tombstone).map_err(|_| ManagedInstallError::StorageFailed)?;
                remove_owned_directory(&tombstone)?;
            }
        }
        sync_directory(&self.content_root())?;
        sync_directory(&self.staging_root())?;
        sync_directory(&self.tombstone_root())?;
        Ok(())
    }

    fn content_root(&self) -> PathBuf {
        self.root.join(CONTENT_DIRECTORY)
    }

    fn staging_root(&self) -> PathBuf {
        self.root.join(STAGING_DIRECTORY)
    }

    fn tombstone_root(&self) -> PathBuf {
        self.root.join(TOMBSTONE_DIRECTORY)
    }
}

impl ManagedArtifactVerifier for ManagedInstallationContentStore {
    fn verify(&mut self, artifact: &ManagedArtifact) -> Result<(), ManagedInstallError> {
        let staged = self
            .staged
            .get(&artifact.id())
            .ok_or(ManagedInstallError::NotFound)?;
        if staged.identity != *artifact {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        let current = inventory_tree(&staged.path, MAX_EXPANDED_BYTES)?;
        if current != staged.inventory || current.digest != artifact.content_digest {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        Ok(())
    }
}

impl ManagedInstallationStorage for ManagedInstallationContentStore {
    fn commit_install(
        &mut self,
        expected_revision: u64,
        next: &ManagedInstallationIndex,
        artifact: &ManagedArtifact,
    ) -> Result<(), ManagedInstallError> {
        self.ensure_layout()?;
        let id = artifact.id();
        let staged = self.staged.get(&id).ok_or(ManagedInstallError::NotFound)?;
        if staged.identity != *artifact
            || !next.artifacts.iter().any(|candidate| {
                candidate.id == id
                    && candidate.identity == *artifact
                    && candidate.ownership == ManagedArtifactOwnership::Managed
            })
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        let staged_path = staged.path.clone();
        let destination = self.artifact_path(&id)?;
        if fs::symlink_metadata(&destination).is_ok() {
            return Err(ManagedInstallError::StorageFailed);
        }
        let content_root = self.content_root();
        let transaction = self.index.compare_and_swap_transaction(
            expected_revision,
            next,
            || {
                fs::rename(&staged_path, &destination)
                    .map_err(|_| ManagedInstallError::StorageFailed)?;
                if let Err(error) = sync_directory(&content_root) {
                    let _ = fs::rename(&destination, &staged_path);
                    let _ = sync_directory(&content_root);
                    return Err(error);
                }
                Ok(())
            },
            || {
                fs::rename(&destination, &staged_path)
                    .map_err(|_| ManagedInstallError::StorageFailed)?;
                sync_directory(&content_root)
            },
        );
        self.staged.remove(&id);
        if transaction.is_err() && staged_path.exists() {
            remove_owned_directory(&staged_path)?;
        }
        transaction
    }

    fn commit_removal(
        &mut self,
        expected_revision: u64,
        next: &ManagedInstallationIndex,
        artifact: &ManagedInstalledArtifact,
    ) -> Result<(), ManagedInstallError> {
        self.ensure_layout()?;
        if artifact.ownership != ManagedArtifactOwnership::Managed
            || next
                .artifacts
                .iter()
                .any(|candidate| candidate.id == artifact.id)
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        let destination = self.artifact_path(&artifact.id)?;
        require_owned_directory(&destination)?;
        let artifact_hex = artifact_hex(&artifact.id)?;
        let tombstone = unique_tombstone(&self.tombstone_root(), artifact_hex)?;
        let content_root = self.content_root();
        let tombstone_root = self.tombstone_root();
        let transaction = self.index.compare_and_swap_transaction(
            expected_revision,
            next,
            || {
                fs::rename(&destination, &tombstone)
                    .map_err(|_| ManagedInstallError::StorageFailed)?;
                if let Err(error) =
                    sync_directory(&content_root).and_then(|()| sync_directory(&tombstone_root))
                {
                    let _ = fs::rename(&tombstone, &destination);
                    let _ = sync_directory(&content_root);
                    let _ = sync_directory(&tombstone_root);
                    return Err(error);
                }
                Ok(())
            },
            || {
                fs::rename(&tombstone, &destination)
                    .map_err(|_| ManagedInstallError::StorageFailed)?;
                sync_directory(&content_root)?;
                sync_directory(&tombstone_root)
            },
        );
        if transaction.is_ok() && tombstone.exists() {
            let _ = remove_owned_directory(&tombstone);
            let _ = sync_directory(&tombstone_root);
        }
        transaction
    }
}

impl Drop for ManagedInstallationContentStore {
    fn drop(&mut self) {
        for staged in self.staged.values() {
            let _ = remove_owned_directory(&staged.path);
        }
    }
}

pub fn inventory_managed_content(
    root: &Path,
    expanded_limit: u64,
) -> Result<ManagedContentInventory, ManagedInstallError> {
    if expanded_limit == 0 || expanded_limit > MAX_EXPANDED_BYTES {
        return Err(ManagedInstallError::ResourceLimit);
    }
    inventory_tree(root, expanded_limit)
}

fn copy_tree(
    source: &Path,
    destination: &Path,
    expanded_limit: u64,
) -> Result<(), ManagedInstallError> {
    let mut state = TreeState::default();
    copy_directory(
        source,
        destination,
        Path::new(""),
        expanded_limit,
        0,
        &mut state,
    )
}

fn copy_directory(
    source: &Path,
    destination: &Path,
    relative: &Path,
    expanded_limit: u64,
    depth: usize,
    state: &mut TreeState,
) -> Result<(), ManagedInstallError> {
    if depth > MAX_CONTENT_DEPTH {
        return Err(ManagedInstallError::ResourceLimit);
    }
    require_owned_directory(source).map_err(|_| ManagedInstallError::IntegrityMismatch)?;
    ensure_relative_path(relative)?;
    let mut entries = directory_entries(source)?;
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    for (name, path) in entries {
        let next_relative = relative.join(&name);
        ensure_relative_path(&next_relative)?;
        let metadata =
            fs::symlink_metadata(&path).map_err(|_| ManagedInstallError::StorageFailed)?;
        if metadata.file_type().is_symlink() {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        let target = destination.join(&name);
        if metadata.is_dir() {
            fs::create_dir(&target).map_err(|_| ManagedInstallError::StorageFailed)?;
            set_private_directory_permissions(&target)?;
            copy_directory(
                &path,
                &target,
                &next_relative,
                expanded_limit,
                depth + 1,
                state,
            )?;
        } else if metadata.is_file() {
            state.files = state
                .files
                .checked_add(1)
                .filter(|count| *count <= MAX_CONTENT_FILES)
                .ok_or(ManagedInstallError::ResourceLimit)?;
            let input =
                open_file_no_follow(&path).map_err(|_| ManagedInstallError::IntegrityMismatch)?;
            if !input
                .metadata()
                .map_err(|_| ManagedInstallError::StorageFailed)?
                .is_file()
            {
                return Err(ManagedInstallError::IntegrityMismatch);
            }
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|_| ManagedInstallError::StorageFailed)?;
            let remaining = expanded_limit.saturating_sub(state.bytes);
            let copied = std::io::copy(&mut input.take(remaining.saturating_add(1)), &mut output)
                .map_err(|_| ManagedInstallError::StorageFailed)?;
            state.bytes = state
                .bytes
                .checked_add(copied)
                .filter(|bytes| *bytes <= expanded_limit)
                .ok_or(ManagedInstallError::ResourceLimit)?;
            output
                .flush()
                .and_then(|()| output.sync_all())
                .map_err(|_| ManagedInstallError::StorageFailed)?;
            set_private_file_permissions(&target, executable(&metadata))?;
        } else {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
    }
    Ok(())
}

fn inventory_tree(
    root: &Path,
    expanded_limit: u64,
) -> Result<ManagedContentInventory, ManagedInstallError> {
    require_owned_directory(root)?;
    let mut state = TreeState::default();
    let mut hash = Sha256::new();
    hash.update(b"managed-language-content-v1\0");
    inventory_directory(
        root,
        Path::new(""),
        expanded_limit,
        0,
        &mut state,
        &mut hash,
    )?;
    Ok(ManagedContentInventory {
        digest: format!("sha256:{:x}", hash.finalize()),
        expanded_bytes: state.bytes,
        file_count: state.files,
    })
}

fn inventory_directory(
    root: &Path,
    relative: &Path,
    expanded_limit: u64,
    depth: usize,
    state: &mut TreeState,
    hash: &mut Sha256,
) -> Result<(), ManagedInstallError> {
    if depth > MAX_CONTENT_DEPTH {
        return Err(ManagedInstallError::ResourceLimit);
    }
    let directory = root.join(relative);
    require_owned_directory(&directory)?;
    let mut entries = directory_entries(&directory)?;
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    for (name, path) in entries {
        let next_relative = relative.join(&name);
        ensure_relative_path(&next_relative)?;
        let metadata =
            fs::symlink_metadata(&path).map_err(|_| ManagedInstallError::StorageFailed)?;
        if metadata.file_type().is_symlink() {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        let relative_name = path_string(&next_relative)?;
        hash.update((relative_name.len() as u64).to_be_bytes());
        hash.update(relative_name.as_bytes());
        if metadata.is_dir() {
            hash.update(b"d");
            inventory_directory(root, &next_relative, expanded_limit, depth + 1, state, hash)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        state.files = state
            .files
            .checked_add(1)
            .filter(|count| *count <= MAX_CONTENT_FILES)
            .ok_or(ManagedInstallError::ResourceLimit)?;
        state.bytes = state
            .bytes
            .checked_add(metadata.len())
            .filter(|bytes| *bytes <= expanded_limit)
            .ok_or(ManagedInstallError::ResourceLimit)?;
        hash.update(b"f");
        hash.update([u8::from(executable(&metadata))]);
        hash.update(metadata.len().to_be_bytes());
        let mut file =
            open_file_no_follow(&path).map_err(|_| ManagedInstallError::IntegrityMismatch)?;
        let opened = file
            .metadata()
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        if !opened.is_file() || opened.len() != metadata.len() {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        let mut remaining = metadata.len();
        let mut buffer = [0_u8; 64 * 1024];
        while remaining > 0 {
            let count_limit = buffer.len().min(remaining as usize);
            let count = file
                .read(&mut buffer[..count_limit])
                .map_err(|_| ManagedInstallError::StorageFailed)?;
            if count == 0 {
                return Err(ManagedInstallError::IntegrityMismatch);
            }
            hash.update(&buffer[..count]);
            remaining -= count as u64;
        }
        if file
            .read(&mut buffer[..1])
            .map_err(|_| ManagedInstallError::StorageFailed)?
            != 0
        {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
    }
    Ok(())
}

#[derive(Default)]
struct TreeState {
    bytes: u64,
    files: u32,
}

fn directory_entries(directory: &Path) -> Result<Vec<(String, PathBuf)>, ManagedInstallError> {
    fs::read_dir(directory)
        .map_err(|_| ManagedInstallError::StorageFailed)?
        .map(|entry| {
            let entry = entry.map_err(|_| ManagedInstallError::StorageFailed)?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| ManagedInstallError::IntegrityMismatch)?;
            valid_component(&name)?;
            Ok((name, entry.path()))
        })
        .collect()
}

fn owned_directories(directory: &Path) -> Result<Vec<PathBuf>, ManagedInstallError> {
    let mut entries = directory_entries(directory)?;
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    entries
        .into_iter()
        .map(|(_, path)| {
            require_owned_directory(&path)?;
            Ok(path)
        })
        .collect()
}

fn valid_component(value: &str) -> Result<(), ManagedInstallError> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.len() > 255
        || value.chars().any(|character| character.is_control())
        || value.contains(['/', '\\'])
    {
        return Err(ManagedInstallError::IntegrityMismatch);
    }
    Ok(())
}

fn ensure_relative_path(path: &Path) -> Result<(), ManagedInstallError> {
    let value = path_string(path)?;
    if value.len() > MAX_CONTENT_PATH_BYTES {
        return Err(ManagedInstallError::ResourceLimit);
    }
    Ok(())
}

fn path_string(path: &Path) -> Result<String, ManagedInstallError> {
    let parts: Result<Vec<_>, _> = path
        .components()
        .map(|component| {
            let value = component
                .as_os_str()
                .to_str()
                .ok_or(ManagedInstallError::IntegrityMismatch)?;
            valid_component(value)?;
            Ok(value)
        })
        .collect();
    Ok(parts?.join("/"))
}

fn require_owned_directory(path: &Path) -> Result<(), ManagedInstallError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ManagedInstallError::StorageFailed)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ManagedInstallError::StorageFailed);
    }
    Ok(())
}

fn remove_owned_directory(path: &Path) -> Result<(), ManagedInstallError> {
    require_owned_directory(path)?;
    fs::remove_dir_all(path).map_err(|_| ManagedInstallError::StorageFailed)
}

fn unique_tombstone(directory: &Path, artifact_hex: &str) -> Result<PathBuf, ManagedInstallError> {
    let temporary = tempfile::Builder::new()
        .prefix(&format!("{artifact_hex}-"))
        .tempdir_in(directory)
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    let path = temporary.keep();
    fs::remove_dir(&path).map_err(|_| ManagedInstallError::StorageFailed)?;
    Ok(path)
}

fn tombstone_artifact_id(path: &Path) -> Result<String, ManagedInstallError> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(ManagedInstallError::StorageFailed)?;
    let (digest, suffix) = name
        .split_once('-')
        .ok_or(ManagedInstallError::StorageFailed)?;
    if suffix.is_empty() {
        return Err(ManagedInstallError::StorageFailed);
    }
    let id = format!("sha256:{digest}");
    artifact_hex(&id)?;
    Ok(id)
}

fn artifact_hex(artifact_id: &str) -> Result<&str, ManagedInstallError> {
    let Some(value) = artifact_id.strip_prefix("sha256:") else {
        return Err(ManagedInstallError::InvalidRequest);
    };
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ManagedInstallError::InvalidRequest);
    }
    Ok(value)
}

fn open_file_no_follow(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

fn set_private_directory_permissions(path: &Path) -> Result<(), ManagedInstallError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| ManagedInstallError::StorageFailed)?;
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path, executable: bool) -> Result<(), ManagedInstallError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if executable { 0o700 } else { 0o600 };
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|_| ManagedInstallError::StorageFailed)?;
    }
    Ok(())
}

#[cfg(unix)]
fn executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), ManagedInstallError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| ManagedInstallError::StorageFailed)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), ManagedInstallError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(value: &str) -> String {
        format!("sha256:{:x}", Sha256::digest(value.as_bytes()))
    }

    fn fixture_source() -> tempfile::TempDir {
        let source = tempfile::tempdir().unwrap();
        fs::create_dir(source.path().join("bin")).unwrap();
        fs::write(source.path().join("bin/server"), b"server-bytes").unwrap();
        fs::write(source.path().join("NOTICE"), b"license").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                source.path().join("bin/server"),
                fs::Permissions::from_mode(0o755),
            )
            .unwrap();
        }
        source
    }

    fn artifact(source: &Path) -> ManagedArtifact {
        ManagedArtifact {
            server: ManagedServerId {
                plugin_id: "dev.asterlyn.lsp".into(),
                server_id: "fixture".into(),
            },
            version: "1.0.0".into(),
            target: "aarch64-apple-darwin".into(),
            recipe_digest: digest("recipe"),
            archive_digest: digest("archive"),
            content_digest: inventory_managed_content(source, MAX_EXPANDED_BYTES)
                .unwrap()
                .digest,
        }
    }

    fn installed(artifact: &ManagedArtifact) -> ManagedInstalledArtifact {
        ManagedInstalledArtifact {
            id: artifact.id(),
            identity: artifact.clone(),
            ownership: ManagedArtifactOwnership::Managed,
        }
    }

    fn index(revision: u64, artifacts: Vec<ManagedInstalledArtifact>) -> ManagedInstallationIndex {
        ManagedInstallationIndex {
            revision,
            artifacts,
            ..ManagedInstallationIndex::default()
        }
    }

    #[test]
    fn verified_stage_is_published_before_the_index_and_removed_transactionally() {
        let directory = tempfile::tempdir().unwrap();
        let source = fixture_source();
        let artifact = artifact(source.path());
        let mut store = ManagedInstallationContentStore::new(directory.path().join("managed"));
        let expected = inventory_managed_content(source.path(), MAX_EXPANDED_BYTES).unwrap();
        assert_eq!(
            store
                .stage_directory(&artifact, source.path(), expected.expanded_bytes)
                .unwrap(),
            expected
        );
        verify_managed_artifact(&artifact, &mut store).unwrap();
        let installed = installed(&artifact);
        let next = index(1, vec![installed.clone()]);
        store.commit_install(0, &next, &artifact).unwrap();
        let path = store.artifact_path(&artifact.id()).unwrap();
        assert!(path.join("bin/server").is_file());
        assert_eq!(
            inventory_managed_content(&path, MAX_EXPANDED_BYTES).unwrap(),
            expected
        );
        assert_eq!(store.load_and_recover().unwrap(), next);

        let removed = index(2, vec![]);
        store.commit_removal(1, &removed, &installed).unwrap();
        assert!(!path.exists());
        assert_eq!(store.load_and_recover().unwrap(), removed);
    }

    #[test]
    fn staging_rejects_changed_content_symlinks_and_expansion_overflow() {
        let directory = tempfile::tempdir().unwrap();
        let source = fixture_source();
        let artifact = artifact(source.path());
        let inventory = inventory_managed_content(source.path(), MAX_EXPANDED_BYTES).unwrap();
        let mut store = ManagedInstallationContentStore::new(directory.path().join("managed"));
        store
            .stage_directory(&artifact, source.path(), inventory.expanded_bytes)
            .unwrap();
        let staged = store.staged.get(&artifact.id()).unwrap().path.clone();
        fs::write(staged.join("NOTICE"), b"changed").unwrap();
        assert_eq!(
            verify_managed_artifact(&artifact, &mut store)
                .err()
                .unwrap(),
            ManagedInstallError::IntegrityMismatch
        );

        let overflow_store = directory.path().join("overflow");
        let mut overflow = ManagedInstallationContentStore::new(overflow_store);
        assert_eq!(
            overflow
                .stage_directory(&artifact, source.path(), 1)
                .unwrap_err(),
            ManagedInstallError::ResourceLimit
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let unsafe_source = fixture_source();
            symlink(
                unsafe_source.path().join("NOTICE"),
                unsafe_source.path().join("linked"),
            )
            .unwrap();
            let mut unsafe_store =
                ManagedInstallationContentStore::new(directory.path().join("unsafe"));
            assert_eq!(
                unsafe_store
                    .stage_directory(&artifact, unsafe_source.path(), MAX_EXPANDED_BYTES)
                    .unwrap_err(),
                ManagedInstallError::IntegrityMismatch
            );
        }
    }

    #[test]
    fn inventory_binds_empty_directories_and_executable_state() {
        let source = fixture_source();
        let initial = inventory_managed_content(source.path(), MAX_EXPANDED_BYTES).unwrap();
        fs::create_dir(source.path().join("empty")).unwrap();
        let with_empty_directory =
            inventory_managed_content(source.path(), MAX_EXPANDED_BYTES).unwrap();
        assert_ne!(initial.digest, with_empty_directory.digest);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                source.path().join("bin/server"),
                fs::Permissions::from_mode(0o600),
            )
            .unwrap();
            let without_executable =
                inventory_managed_content(source.path(), MAX_EXPANDED_BYTES).unwrap();
            assert_ne!(with_empty_directory.digest, without_executable.digest);
        }
    }

    #[test]
    fn stale_index_never_publishes_content_and_discards_the_private_stage() {
        let directory = tempfile::tempdir().unwrap();
        let source = fixture_source();
        let artifact = artifact(source.path());
        let mut store = ManagedInstallationContentStore::new(directory.path().join("managed"));
        store.index.compare_and_swap(0, &index(1, vec![])).unwrap();
        store
            .stage_directory(&artifact, source.path(), MAX_EXPANDED_BYTES)
            .unwrap();
        let result = store.commit_install(0, &index(1, vec![installed(&artifact)]), &artifact);
        assert_eq!(result, Err(ManagedInstallError::StateChanged));
        assert!(!store.artifact_path(&artifact.id()).unwrap().exists());
        assert!(store.staged.is_empty());
        assert!(owned_directories(&store.staging_root()).unwrap().is_empty());
    }

    #[test]
    fn restart_restores_indexed_tombstones_and_cleans_orphans_and_stages() {
        let directory = tempfile::tempdir().unwrap();
        let source = fixture_source();
        let artifact = artifact(source.path());
        let installed = installed(&artifact);
        let mut store = ManagedInstallationContentStore::new(directory.path().join("managed"));
        store
            .stage_directory(&artifact, source.path(), MAX_EXPANDED_BYTES)
            .unwrap();
        store
            .commit_install(0, &index(1, vec![installed.clone()]), &artifact)
            .unwrap();
        let destination = store.artifact_path(&artifact.id()).unwrap();
        let tombstone = unique_tombstone(
            &store.tombstone_root(),
            artifact_hex(&artifact.id()).unwrap(),
        )
        .unwrap();
        fs::rename(&destination, &tombstone).unwrap();

        let orphan_id = format!("sha256:{}", "f".repeat(64));
        let orphan = store.artifact_path(&orphan_id).unwrap();
        fs::create_dir(&orphan).unwrap();
        fs::write(orphan.join("orphan"), b"orphan").unwrap();
        let abandoned_stage = store.staging_root().join("stage-abandoned");
        fs::create_dir(&abandoned_stage).unwrap();
        fs::write(abandoned_stage.join("partial"), b"partial").unwrap();

        drop(store);
        let mut restarted = ManagedInstallationContentStore::new(directory.path().join("managed"));
        assert_eq!(
            restarted.load_and_recover().unwrap(),
            index(1, vec![installed])
        );
        assert!(destination.join("bin/server").is_file());
        assert!(!orphan.exists());
        assert!(!abandoned_stage.exists());
        assert!(
            owned_directories(&restarted.tombstone_root())
                .unwrap()
                .is_empty()
        );
    }
}
