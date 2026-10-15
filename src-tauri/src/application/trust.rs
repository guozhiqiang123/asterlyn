use asterlyn_task::TrustState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use super::task::TaskAuthorizationScope;

const VERSION: u8 = 2;
const MAX_WORKSPACE_ENTRIES: usize = 512;
const MAX_TASK_GRANTS: usize = 1_024;
const MAX_BYTES: u64 = 256 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
struct TrustFile {
    version: u8,
    #[serde(default)]
    legacy_entries: BTreeMap<String, TrustState>,
    #[serde(default)]
    workspace_entries: BTreeMap<String, TrustState>,
    #[serde(default)]
    task_grants: BTreeMap<String, TaskGrant>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LegacyTrustFile {
    version: u8,
    entries: BTreeMap<String, TrustState>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TaskGrant {
    workspace_key: String,
    fingerprint: String,
}

pub(crate) fn read(path: &Path, root: &Path, plugin_id: &str) -> Result<TrustState, String> {
    validate_identifier(plugin_id, "plugin ID")?;
    let _guard = store_lock().lock().map_err(lock_error)?;
    let file = load(path)?;
    Ok(file
        .workspace_entries
        .get(&workspace_key(root, plugin_id))
        .or_else(|| file.legacy_entries.get(&legacy_key(root)))
        .cloned()
        .unwrap_or(TrustState::Unknown))
}

pub(crate) fn set(
    path: &Path,
    root: &Path,
    plugin_id: &str,
    state: TrustState,
) -> Result<TrustState, String> {
    validate_identifier(plugin_id, "plugin ID")?;
    let _guard = store_lock().lock().map_err(lock_error)?;
    let mut file = load(path)?;
    let scoped_key = workspace_key(root, plugin_id);
    if state == TrustState::Unknown {
        file.workspace_entries.remove(&scoped_key);
    } else {
        file.workspace_entries
            .insert(scoped_key.clone(), state.clone());
    }
    if state != TrustState::Trusted {
        file.task_grants
            .retain(|_, grant| grant.workspace_key != scoped_key);
    }
    if file.workspace_entries.len() > MAX_WORKSPACE_ENTRIES {
        return Err("workspace trust store is full".into());
    }
    atomic_save(path, &file)?;
    Ok(state)
}

pub(crate) fn task_confirmation_matches(
    path: &Path,
    scope: &TaskAuthorizationScope,
) -> Result<bool, String> {
    validate_scope(scope)?;
    let _guard = store_lock().lock().map_err(lock_error)?;
    let file = load(path)?;
    Ok(file.task_grants.get(&task_key(scope)).is_some_and(|grant| {
        grant.workspace_key == workspace_key(&scope.root, &scope.plugin_id)
            && grant.fingerprint == scope.fingerprint
    }))
}

pub(crate) fn remember_task_confirmation(
    path: &Path,
    scope: &TaskAuthorizationScope,
) -> Result<(), String> {
    validate_scope(scope)?;
    let _guard = store_lock().lock().map_err(lock_error)?;
    let mut file = load(path)?;
    let scoped_key = workspace_key(&scope.root, &scope.plugin_id);
    let trusted = file
        .workspace_entries
        .get(&scoped_key)
        .or_else(|| file.legacy_entries.get(&legacy_key(&scope.root)))
        .is_some_and(|state| *state == TrustState::Trusted);
    if !trusted {
        return Err("trusted plugin workspace is required before remembering a task".into());
    }
    file.task_grants.insert(
        task_key(scope),
        TaskGrant {
            workspace_key: scoped_key,
            fingerprint: scope.fingerprint.clone(),
        },
    );
    if file.task_grants.len() > MAX_TASK_GRANTS {
        return Err("task confirmation store is full".into());
    }
    atomic_save(path, &file)
}

fn legacy_key(root: &Path) -> String {
    root.to_string_lossy().into_owned()
}

fn workspace_key(root: &Path, plugin_id: &str) -> String {
    digest_key([root.to_string_lossy().as_bytes(), plugin_id.as_bytes()])
}

fn task_key(scope: &TaskAuthorizationScope) -> String {
    digest_key([
        scope.root.to_string_lossy().as_bytes(),
        scope.plugin_id.as_bytes(),
        scope.provider_id.as_bytes(),
        scope.task_id.as_bytes(),
    ])
}

fn digest_key<'a>(parts: impl IntoIterator<Item = &'a [u8]>) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part);
    }
    format!("{:x}", digest.finalize())
}

fn load(path: &Path) -> Result<TrustFile, String> {
    if !path.exists() {
        return Ok(TrustFile {
            version: VERSION,
            legacy_entries: BTreeMap::new(),
            workspace_entries: BTreeMap::new(),
            task_grants: BTreeMap::new(),
        });
    }
    let metadata = fs::metadata(path).map_err(|e| format!("inspect trust store: {e}"))?;
    if metadata.len() > MAX_BYTES {
        return Err("trust store is too large".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("read trust store: {e}"))?;
    let version = serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|value| value.get("version").and_then(serde_json::Value::as_u64))
        .ok_or_else(|| "trust store is corrupted".to_string())?;
    let file = if version == 1 {
        let legacy: LegacyTrustFile =
            serde_json::from_slice(&bytes).map_err(|_| "trust store is corrupted".to_string())?;
        TrustFile {
            version: VERSION,
            legacy_entries: legacy.entries,
            workspace_entries: BTreeMap::new(),
            task_grants: BTreeMap::new(),
        }
    } else if version == u64::from(VERSION) {
        serde_json::from_slice(&bytes).map_err(|_| "trust store is corrupted".to_string())?
    } else {
        return Err("trust store version or size is unsupported".into());
    };
    if file.version != VERSION
        || file.legacy_entries.len() > MAX_WORKSPACE_ENTRIES
        || file.workspace_entries.len() > MAX_WORKSPACE_ENTRIES
        || file.task_grants.len() > MAX_TASK_GRANTS
    {
        return Err("trust store version or size is unsupported".into());
    }
    Ok(file)
}

fn validate_scope(scope: &TaskAuthorizationScope) -> Result<(), String> {
    validate_identifier(&scope.plugin_id, "plugin ID")?;
    validate_identifier(&scope.provider_id, "provider ID")?;
    if scope.task_id.is_empty()
        || scope.task_id.len() > 1_024
        || scope.task_id.contains('\0')
        || scope.fingerprint.len() != 64
        || !scope
            .fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("task authorization scope is invalid".into());
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 256
        || value.contains('\0')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(format!("{label} is invalid"));
    }
    Ok(())
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
        assert!(read(&path, Path::new("/tmp/project"), "android").is_err());
    }
    #[test]
    fn trust_round_trip_uses_canonical_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        let root = fs::canonicalize(dir.path()).unwrap();
        set(&path, &root, "android", TrustState::Trusted).unwrap();
        assert_eq!(read(&path, &root, "android").unwrap(), TrustState::Trusted);
        assert_eq!(read(&path, &root, "other").unwrap(), TrustState::Unknown);
        set(&path, &root, "android", TrustState::Denied).unwrap();
        assert_eq!(read(&path, &root, "android").unwrap(), TrustState::Denied);
        set(&path, &root, "android", TrustState::Unknown).unwrap();
        assert_eq!(read(&path, &root, "android").unwrap(), TrustState::Unknown);
    }

    #[test]
    fn oversized_and_unknown_version_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        fs::write(&path, vec![b'x'; 256 * 1024 + 1]).unwrap();
        assert!(read(&path, dir.path(), "android").is_err());
        fs::write(&path, br#"{"version":99,"entries":{}}"#).unwrap();
        assert!(read(&path, dir.path(), "android").is_err());
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
                scope.spawn(move || set(&path, root, "android", TrustState::Trusted).unwrap());
            }
        });
        for root in &roots {
            assert_eq!(read(&path, root, "android").unwrap(), TrustState::Trusted);
        }
        assert!(fs::read_dir(dir.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
    }

    #[test]
    fn legacy_workspace_trust_is_a_read_only_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        let root = fs::canonicalize(dir.path()).unwrap();
        fs::write(
            &path,
            serde_json::to_vec(&LegacyTrustFile {
                version: 1,
                entries: BTreeMap::from([(legacy_key(&root), TrustState::Trusted)]),
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(read(&path, &root, "android").unwrap(), TrustState::Trusted);
        assert_eq!(read(&path, &root, "other").unwrap(), TrustState::Trusted);
        set(&path, &root, "android", TrustState::Denied).unwrap();
        assert_eq!(read(&path, &root, "android").unwrap(), TrustState::Denied);
        assert_eq!(read(&path, &root, "other").unwrap(), TrustState::Trusted);
    }

    #[test]
    fn exact_task_grants_require_trust_match_fingerprint_and_are_cleared_on_revoke() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trust.json");
        let root = fs::canonicalize(dir.path()).unwrap();
        let scope = TaskAuthorizationScope {
            root: root.clone(),
            plugin_id: "android".into(),
            provider_id: "gradle".into(),
            task_id: ":app:assembleDebug".into(),
            fingerprint: "a".repeat(64),
        };
        assert!(remember_task_confirmation(&path, &scope).is_err());
        set(&path, &root, "android", TrustState::Trusted).unwrap();
        remember_task_confirmation(&path, &scope).unwrap();
        assert!(task_confirmation_matches(&path, &scope).unwrap());
        assert!(
            !task_confirmation_matches(
                &path,
                &TaskAuthorizationScope {
                    fingerprint: "b".repeat(64),
                    ..scope.clone()
                }
            )
            .unwrap()
        );
        set(&path, &root, "android", TrustState::Denied).unwrap();
        assert!(!task_confirmation_matches(&path, &scope).unwrap());
    }
}
