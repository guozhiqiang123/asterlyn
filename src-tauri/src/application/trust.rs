use asterlyn_task::TrustState;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const VERSION: u8 = 1;
const MAX_ENTRIES: usize = 256;
const MAX_BYTES: u64 = 128 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
struct TrustFile {
    version: u8,
    entries: BTreeMap<String, TrustState>,
}

pub(crate) fn read(path: &Path, root: &Path) -> Result<TrustState, String> {
    let _guard = store_lock().lock().map_err(lock_error)?;
    let file = load(path)?;
    Ok(file
        .entries
        .get(&key(root))
        .cloned()
        .unwrap_or(TrustState::Unknown))
}

pub(crate) fn set(path: &Path, root: &Path, state: TrustState) -> Result<TrustState, String> {
    let _guard = store_lock().lock().map_err(lock_error)?;
    let mut file = load(path)?;
    let root_key = key(root);
    if state == TrustState::Unknown {
        file.entries.remove(&root_key);
    } else {
        file.entries.insert(root_key, state.clone());
    }
    if file.entries.len() > MAX_ENTRIES {
        return Err("workspace trust store is full".into());
    }
    atomic_save(path, &file)?;
    Ok(state)
}

fn key(root: &Path) -> String {
    root.to_string_lossy().into_owned()
}

fn load(path: &Path) -> Result<TrustFile, String> {
    if !path.exists() {
        return Ok(TrustFile {
            version: VERSION,
            entries: BTreeMap::new(),
        });
    }
    let metadata = fs::metadata(path).map_err(|e| format!("inspect trust store: {e}"))?;
    if metadata.len() > MAX_BYTES {
        return Err("trust store is too large".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("read trust store: {e}"))?;
    let file: TrustFile =
        serde_json::from_slice(&bytes).map_err(|_| "trust store is corrupted".to_string())?;
    if file.version != VERSION || file.entries.len() > MAX_ENTRIES {
        return Err("trust store version or size is unsupported".into());
    }
    Ok(file)
}

fn atomic_save(path: &Path, file: &TrustFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create trust store directory: {e}"))?;
    }
    let temp = temp_path(path);
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| format!("encode trust store: {e}"))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| format!("create temporary trust store: {e}"))?;
    output
        .write_all(&bytes)
        .and_then(|()| output.sync_all())
        .map_err(|e| format!("write trust store: {e}"))?;
    replace_file(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("replace trust store: {e}")
    })?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    }
    Ok(())
}

fn temp_path(path: &Path) -> PathBuf {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("json.{}.{time}.{sequence}.tmp", std::process::id()))
}

fn store_lock() -> &'static Mutex<()> {
    STORE_LOCK.get_or_init(|| Mutex::new(()))
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "workspace trust store lock was poisoned".into()
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(temp, path)
}

#[cfg(windows)]
fn replace_file(temp: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
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
    #[test]
    fn corrupt_store_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        fs::write(&path, b"not-json").unwrap();
        assert!(read(&path, Path::new("/tmp/project")).is_err());
    }
    #[test]
    fn trust_round_trip_uses_canonical_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        let root = fs::canonicalize(dir.path()).unwrap();
        set(&path, &root, TrustState::Trusted).unwrap();
        assert_eq!(read(&path, &root).unwrap(), TrustState::Trusted);
        set(&path, &root, TrustState::Denied).unwrap();
        assert_eq!(read(&path, &root).unwrap(), TrustState::Denied);
        set(&path, &root, TrustState::Unknown).unwrap();
        assert_eq!(read(&path, &root).unwrap(), TrustState::Unknown);
    }

    #[test]
    fn oversized_and_unknown_version_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        fs::write(&path, vec![b'x'; 128 * 1024 + 1]).unwrap();
        assert!(read(&path, dir.path()).is_err());
        fs::write(&path, br#"{"version":99,"entries":{}}"#).unwrap();
        assert!(read(&path, dir.path()).is_err());
    }

    #[test]
    fn concurrent_updates_do_not_lose_entries_or_collide_on_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        let roots: Vec<PathBuf> = (0..8)
            .map(|index| dir.path().join(format!("project-{index}")))
            .collect();
        std::thread::scope(|scope| {
            for root in &roots {
                let path = path.clone();
                scope.spawn(move || set(&path, root, TrustState::Trusted).unwrap());
            }
        });
        for root in &roots {
            assert_eq!(read(&path, root).unwrap(), TrustState::Trusted);
        }
        assert!(fs::read_dir(dir.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
    }
}
