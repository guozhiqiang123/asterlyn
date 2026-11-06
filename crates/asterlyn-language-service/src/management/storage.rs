use super::{MAX_SAFE_INTEGER, ManagedInstallError, ManagedInstallationIndex};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

const INDEX_FILE_NAME: &str = "installation-index-v1.json";
const LOCK_FILE_NAME: &str = "installation-index-v1.lock";
const MAX_INDEX_BYTES: u64 = 256 * 1024;
static INDEX_STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct IndexStoreGuard<'a> {
    _file: File,
    _process: MutexGuard<'a, ()>,
}

/// Durable, host-private storage for the authoritative managed-language index.
///
/// This type intentionally does not implement `ManagedInstallationStorage`: publishing and
/// isolating immutable artifact content must be composed with this index boundary by the native
/// installer. It does provide the compare-and-swap primitive that that adapter will use.
#[derive(Debug, Clone)]
pub struct ManagedInstallationIndexStore {
    root: PathBuf,
}

impl ManagedInstallationIndexStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn index_path(&self) -> PathBuf {
        self.root.join(INDEX_FILE_NAME)
    }

    pub fn load(&self) -> Result<ManagedInstallationIndex, ManagedInstallError> {
        self.with_locked_index(|index| Ok(index.clone()))
    }

    /// Replace the current index only when its durable revision is still `expected_revision`.
    /// The next revision must advance exactly once, preventing replay and skipped states.
    pub fn compare_and_swap(
        &self,
        expected_revision: u64,
        next: &ManagedInstallationIndex,
    ) -> Result<(), ManagedInstallError> {
        self.compare_and_swap_transaction(expected_revision, next, || Ok(()), || Ok(()))
    }

    /// Serialize a content mutation with the durable index compare-and-swap.
    /// `before_save` must publish or isolate content; `rollback` restores the
    /// prior content view only when a failed save can be confirmed to have
    /// retained the expected index. An uncertain save is left for startup
    /// recovery instead of risking an index/content mismatch.
    pub(super) fn compare_and_swap_transaction(
        &self,
        expected_revision: u64,
        next: &ManagedInstallationIndex,
        before_save: impl FnOnce() -> Result<(), ManagedInstallError>,
        rollback: impl FnOnce() -> Result<(), ManagedInstallError>,
    ) -> Result<(), ManagedInstallError> {
        if expected_revision > MAX_SAFE_INTEGER
            || next.revision != expected_revision.saturating_add(1)
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        next.validate()?;
        let _guard = self.exclusive_lock()?;
        let current = self.load_unlocked()?;
        if current.revision != expected_revision {
            return Err(ManagedInstallError::StateChanged);
        }
        before_save()?;
        if let Err(error) = self.save_unlocked(next) {
            if self
                .load_unlocked()
                .is_ok_and(|observed| observed.revision == expected_revision)
            {
                rollback()?;
            }
            return Err(error);
        }
        Ok(())
    }

    /// Hold the same process and OS lock across index observation plus content
    /// recovery so another app process cannot publish while recovery reconciles.
    pub(super) fn with_locked_index<T>(
        &self,
        operation: impl FnOnce(&ManagedInstallationIndex) -> Result<T, ManagedInstallError>,
    ) -> Result<T, ManagedInstallError> {
        let _guard = self.exclusive_lock()?;
        let index = self.load_unlocked()?;
        operation(&index)
    }

    fn exclusive_lock(&self) -> Result<IndexStoreGuard<'_>, ManagedInstallError> {
        let process = store_lock()
            .lock()
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        ensure_private_root(&self.root)?;
        let file = open_lock_file(&self.root.join(LOCK_FILE_NAME))?;
        lock_file(&file).map_err(|_| ManagedInstallError::StorageFailed)?;
        Ok(IndexStoreGuard {
            _file: file,
            _process: process,
        })
    }

    fn load_unlocked(&self) -> Result<ManagedInstallationIndex, ManagedInstallError> {
        ensure_private_root(&self.root)?;
        let path = self.index_path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ManagedInstallationIndex::default());
            }
            Err(_) => return Err(ManagedInstallError::StorageFailed),
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > MAX_INDEX_BYTES
        {
            return Err(ManagedInstallError::StorageFailed);
        }
        let file = open_index_for_read(&path)?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_INDEX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        if bytes.len() as u64 > MAX_INDEX_BYTES {
            return Err(ManagedInstallError::StorageFailed);
        }
        let index: ManagedInstallationIndex =
            serde_json::from_slice(&bytes).map_err(|_| ManagedInstallError::StorageFailed)?;
        index.validate()?;
        Ok(index)
    }

    fn save_unlocked(&self, index: &ManagedInstallationIndex) -> Result<(), ManagedInstallError> {
        ensure_private_root(&self.root)?;
        let bytes = serde_json::to_vec(index).map_err(|_| ManagedInstallError::StorageFailed)?;
        if bytes.len() as u64 > MAX_INDEX_BYTES {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let path = self.index_path();
        if fs::symlink_metadata(&path)
            .is_ok_and(|metadata| metadata.file_type().is_symlink() || !metadata.is_file())
        {
            return Err(ManagedInstallError::StorageFailed);
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        temporary
            .write_all(&bytes)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        let staged = temporary
            .into_temp_path()
            .keep()
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        if let Err(_error) = replace_file(&staged, &path) {
            let _ = fs::remove_file(&staged);
            return Err(ManagedInstallError::StorageFailed);
        }
        #[cfg(unix)]
        File::open(&self.root)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        Ok(())
    }
}

pub(super) fn ensure_private_root(root: &Path) -> Result<(), ManagedInstallError> {
    fs::create_dir_all(root).map_err(|_| ManagedInstallError::StorageFailed)?;
    let metadata = fs::symlink_metadata(root).map_err(|_| ManagedInstallError::StorageFailed)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ManagedInstallError::StorageFailed);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))
            .map_err(|_| ManagedInstallError::StorageFailed)?;
    }
    Ok(())
}

fn store_lock() -> &'static Mutex<()> {
    INDEX_STORE_LOCK.get_or_init(|| Mutex::new(()))
}

fn open_index_for_read(path: &Path) -> Result<File, ManagedInstallError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options
        .open(path)
        .map_err(|_| ManagedInstallError::StorageFailed)
}

fn open_lock_file(path: &Path) -> Result<File, ManagedInstallError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    let metadata = file
        .metadata()
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    if !metadata.is_file()
        || fs::symlink_metadata(path)
            .map_err(|_| ManagedInstallError::StorageFailed)?
            .file_type()
            .is_symlink()
    {
        return Err(ManagedInstallError::StorageFailed);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| ManagedInstallError::StorageFailed)?;
    }
    Ok(file)
}

#[cfg(unix)]
fn lock_file(file: &File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn lock_file(file: &File) -> std::io::Result<()> {
    lock_file_windows(file, false)
}

#[cfg(windows)]
fn lock_file_windows(file: &File, nonblocking: bool) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{
        Foundation::HANDLE,
        Storage::FileSystem::{LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, LockFileEx},
        System::IO::OVERLAPPED,
    };
    let mut overlapped = unsafe { std::mem::zeroed::<OVERLAPPED>() };
    let flags = LOCKFILE_EXCLUSIVE_LOCK
        | if nonblocking {
            LOCKFILE_FAIL_IMMEDIATELY
        } else {
            0
        };
    if unsafe {
        LockFileEx(
            file.as_raw_handle() as HANDLE,
            flags,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    } != 0
    {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(all(test, unix))]
fn try_lock_file(file: &File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(all(test, windows))]
fn try_lock_file(file: &File) -> std::io::Result<()> {
    lock_file_windows(file, true)
}

#[cfg(not(windows))]
fn replace_file(staged: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(staged, destination)
}

#[cfg(windows)]
fn replace_file(staged: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let from: Vec<u16> = staged.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn advanced(revision: u64) -> ManagedInstallationIndex {
        ManagedInstallationIndex {
            revision,
            ..ManagedInstallationIndex::default()
        }
    }

    #[test]
    fn missing_store_is_empty_and_compare_and_swap_persists() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("managed-language");
        let store = ManagedInstallationIndexStore::new(root);
        assert_eq!(store.load().unwrap(), ManagedInstallationIndex::default());
        store.compare_and_swap(0, &advanced(1)).unwrap();
        assert_eq!(store.load().unwrap(), advanced(1));
        assert_eq!(
            store.compare_and_swap(0, &advanced(1)),
            Err(ManagedInstallError::StateChanged)
        );
    }

    #[test]
    fn operating_system_lock_excludes_an_independent_process() {
        const CHILD_ROOT: &str = "ASTERLYN_TEST_MANAGED_INDEX_LOCK_ROOT";
        const EXPECT_LOCKED: &str = "ASTERLYN_TEST_MANAGED_INDEX_EXPECT_LOCKED";
        const TEST_NAME: &str =
            "management::storage::tests::operating_system_lock_excludes_an_independent_process";
        if let Some(root) = std::env::var_os(CHILD_ROOT) {
            let contender = open_lock_file(&PathBuf::from(root).join(LOCK_FILE_NAME)).unwrap();
            assert_eq!(
                try_lock_file(&contender).is_err(),
                std::env::var_os(EXPECT_LOCKED).as_deref() == Some(std::ffi::OsStr::new("1"))
            );
            return;
        }

        let directory = tempfile::tempdir().unwrap();
        let store = ManagedInstallationIndexStore::new(directory.path().join("managed-language"));
        let guard = store.exclusive_lock().unwrap();
        run_lock_child(TEST_NAME, CHILD_ROOT, EXPECT_LOCKED, &store.root, true);
        drop(guard);
        run_lock_child(TEST_NAME, CHILD_ROOT, EXPECT_LOCKED, &store.root, false);
    }

    fn run_lock_child(
        test_name: &str,
        child_root: &str,
        expect_locked: &str,
        root: &Path,
        locked: bool,
    ) {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", test_name, "--nocapture"])
            .env(child_root, root)
            .env(expect_locked, if locked { "1" } else { "0" })
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success() && stdout.contains("1 passed"),
            "child lock check failed\nstdout: {stdout}\nstderr: {stderr}"
        );
    }

    #[test]
    fn rejects_skipped_revision_and_corrupt_or_oversized_state() {
        let directory = tempfile::tempdir().unwrap();
        let store = ManagedInstallationIndexStore::new(directory.path().join("managed-language"));
        assert_eq!(
            store.compare_and_swap(0, &advanced(2)),
            Err(ManagedInstallError::InvalidRequest)
        );
        fs::create_dir_all(&store.root).unwrap();
        fs::write(store.index_path(), b"not-json").unwrap();
        assert_eq!(store.load(), Err(ManagedInstallError::StorageFailed));
        fs::write(store.index_path(), vec![b'x'; MAX_INDEX_BYTES as usize + 1]).unwrap();
        assert_eq!(store.load(), Err(ManagedInstallError::StorageFailed));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_root_and_index() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root_link = directory.path().join("root-link");
        symlink(outside.path(), &root_link).unwrap();
        assert_eq!(
            ManagedInstallationIndexStore::new(root_link).load(),
            Err(ManagedInstallError::StorageFailed)
        );

        let root = directory.path().join("managed-language");
        fs::create_dir_all(&root).unwrap();
        let outside_index = outside.path().join("index.json");
        fs::write(&outside_index, b"{}").unwrap();
        symlink(&outside_index, root.join(INDEX_FILE_NAME)).unwrap();
        assert_eq!(
            ManagedInstallationIndexStore::new(root).load(),
            Err(ManagedInstallError::StorageFailed)
        );

        let lock_root = directory.path().join("lock-root");
        fs::create_dir(&lock_root).unwrap();
        symlink(
            outside.path().join("lock-target"),
            lock_root.join(LOCK_FILE_NAME),
        )
        .unwrap();
        assert_eq!(
            ManagedInstallationIndexStore::new(lock_root).load(),
            Err(ManagedInstallError::StorageFailed)
        );
    }

    #[test]
    fn uncertain_index_save_does_not_rollback_published_content() {
        let directory = tempfile::tempdir().unwrap();
        let store = ManagedInstallationIndexStore::new(directory.path().join("managed-language"));
        store.compare_and_swap(0, &advanced(1)).unwrap();
        let published = Cell::new(false);

        let result = store.compare_and_swap_transaction(
            1,
            &advanced(2),
            || {
                published.set(true);
                fs::remove_file(store.index_path()).unwrap();
                fs::create_dir(store.index_path()).unwrap();
                Ok(())
            },
            || {
                published.set(false);
                Ok(())
            },
        );

        assert_eq!(result, Err(ManagedInstallError::StorageFailed));
        assert!(published.get());
    }
}
