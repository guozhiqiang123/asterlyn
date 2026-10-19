use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SCHEMA_VERSION: u32 = 1;
const MAX_KEYS: usize = 128;
const MAX_KEY_BYTES: usize = 128;
const MAX_VALUE_BYTES: usize = 16 * 1024;
const MAX_FILE_BYTES: u64 = 256 * 1024;
static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceStateFile {
    schema_version: u32,
    canonical_root: String,
    plugin_id: String,
    values: BTreeMap<String, String>,
}

pub(crate) fn read(
    store_root: &Path,
    workspace_root: &Path,
    plugin_id: &str,
    key: &str,
) -> Result<Option<String>, String> {
    validate_key(key)?;
    let canonical_root = canonical_workspace_root(workspace_root)?;
    let _guard = store_lock()
        .lock()
        .map_err(|_| "plugin workspace-state lock was poisoned".to_owned())?;
    let path = state_path(store_root, &canonical_root, plugin_id);
    let state = load(&path, &canonical_root, plugin_id)?;
    Ok(state.values.get(key).cloned())
}

pub(crate) fn write(
    store_root: &Path,
    workspace_root: &Path,
    plugin_id: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    validate_key(key)?;
    if value.len() > MAX_VALUE_BYTES || value.contains('\0') {
        return Err("plugin workspace-state value is invalid or too large".to_owned());
    }
    let canonical_root = canonical_workspace_root(workspace_root)?;
    let _guard = store_lock()
        .lock()
        .map_err(|_| "plugin workspace-state lock was poisoned".to_owned())?;
    let path = state_path(store_root, &canonical_root, plugin_id);
    let mut state = load(&path, &canonical_root, plugin_id)?;
    if !state.values.contains_key(key) && state.values.len() >= MAX_KEYS {
        return Err("plugin workspace-state key limit exceeded".to_owned());
    }
    state.values.insert(key.to_owned(), value.to_owned());
    atomic_save(&path, &state)
}

fn canonical_workspace_root(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize()
        .map_err(|error| format!("resolve plugin workspace-state root: {error}"))
}

fn state_path(store_root: &Path, canonical_root: &Path, plugin_id: &str) -> PathBuf {
    let mut digest = Sha256::new();
    digest.update(b"asterlyn.plugin-workspace-state.v1\0");
    digest.update(plugin_id.as_bytes());
    digest.update([0]);
    digest.update(canonical_root.to_string_lossy().as_bytes());
    store_root.join(format!("{:x}.json", digest.finalize()))
}

fn load(path: &Path, canonical_root: &Path, plugin_id: &str) -> Result<WorkspaceStateFile, String> {
    if !path.exists() {
        return Ok(WorkspaceStateFile {
            schema_version: SCHEMA_VERSION,
            canonical_root: canonical_root.to_string_lossy().into_owned(),
            plugin_id: plugin_id.to_owned(),
            values: BTreeMap::new(),
        });
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("inspect plugin workspace-state: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_FILE_BYTES {
        return Err("plugin workspace-state file is invalid".to_owned());
    }
    let bytes = fs::read(path).map_err(|error| format!("read plugin workspace-state: {error}"))?;
    let state: WorkspaceStateFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("decode plugin workspace-state: {error}"))?;
    if state.schema_version != SCHEMA_VERSION
        || state.canonical_root != canonical_root.to_string_lossy()
        || state.plugin_id != plugin_id
        || state.values.len() > MAX_KEYS
        || state
            .values
            .iter()
            .any(|(key, value)| validate_key(key).is_err() || value.len() > MAX_VALUE_BYTES)
    {
        return Err("plugin workspace-state identity or limits are invalid".to_owned());
    }
    Ok(state)
}

fn validate_key(key: &str) -> Result<(), String> {
    let mut characters = key.chars();
    if key.is_empty()
        || key.len() > MAX_KEY_BYTES
        || !characters
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        || !characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
    {
        return Err("plugin workspace-state key is invalid".to_owned());
    }
    Ok(())
}

fn atomic_save(path: &Path, state: &WorkspaceStateFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create plugin workspace-state directory: {error}"))?;
    }
    let bytes = serde_json::to_vec(state)
        .map_err(|error| format!("encode plugin workspace-state: {error}"))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("plugin workspace-state file limit exceeded".to_owned());
    }
    let temporary = temporary_path(path);
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("create temporary plugin workspace-state: {error}"))?;
    output
        .write_all(&bytes)
        .and_then(|()| output.sync_all())
        .map_err(|error| format!("write plugin workspace-state: {error}"))?;
    replace_file(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("replace plugin workspace-state: {error}")
    })?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    }
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
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

#[cfg(not(windows))]
fn replace_file(temporary: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(temporary, path)
}

#[cfg(windows)]
fn replace_file(temporary: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let from = temporary
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let to = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
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
    fn persists_values_without_using_plugin_input_as_a_path() {
        let directory = tempfile::tempdir().expect("workspace-state directory");
        let workspace = tempfile::tempdir().expect("workspace");
        write(
            directory.path(),
            workspace.path(),
            "dev.asterlyn.fixture",
            "selectedDevice",
            "emulator-5554",
        )
        .expect("write state");
        assert_eq!(
            read(
                directory.path(),
                workspace.path(),
                "dev.asterlyn.fixture",
                "selectedDevice",
            )
            .expect("read state"),
            Some("emulator-5554".to_owned())
        );
        let files = fs::read_dir(directory.path())
            .expect("read store")
            .collect::<Result<Vec<_>, _>>()
            .expect("store entries");
        assert_eq!(files.len(), 1);
        assert!(!files[0].file_name().to_string_lossy().contains("fixture"));
    }

    #[test]
    fn rejects_invalid_keys_and_oversized_values() {
        let directory = tempfile::tempdir().expect("workspace-state directory");
        let workspace = tempfile::tempdir().expect("workspace");
        assert!(
            write(
                directory.path(),
                workspace.path(),
                "plugin",
                "../escape",
                "x"
            )
            .is_err()
        );
        assert!(
            write(
                directory.path(),
                workspace.path(),
                "plugin",
                "selected",
                &"x".repeat(MAX_VALUE_BYTES + 1),
            )
            .is_err()
        );
    }
}
