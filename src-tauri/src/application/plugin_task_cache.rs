use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const MAX_FINGERPRINT_FILES: usize = 4096;
pub(crate) const MAX_FINGERPRINT_BYTES: u64 = 64 * 1024 * 1024;
pub(crate) const MAX_CACHE_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_CACHE_ENTRIES: usize = 32;
pub(crate) const MAX_CACHE_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
pub(crate) const CACHE_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const SCHEMA_VERSION: u32 = 1;
const HEX_DIGEST_LENGTH: usize = 64;
static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FingerprintFile {
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) byte_length: u64,
    pub(crate) digest: Option<String>,
    pub(crate) modified_at_epoch_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FingerprintResult {
    pub(crate) protocol_version: u8,
    pub(crate) status: String,
    pub(crate) workspace_root: String,
    pub(crate) algorithm: String,
    pub(crate) digest: Option<String>,
    pub(crate) files: Vec<FingerprintFile>,
    pub(crate) truncated: bool,
    pub(crate) reason: Option<String>,
    pub(crate) os: String,
    pub(crate) arch: String,
    pub(crate) java_home_digest: Option<String>,
}

pub(crate) type FingerprintMetadata = FingerprintResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CacheReadStatus {
    Miss,
    Fresh,
    Stale,
    Dirty,
    Corrupt,
    Unavailable,
}

#[derive(Debug, Clone)]
pub(crate) struct CacheRead {
    pub(crate) status: CacheReadStatus,
    pub(crate) plugin_id: String,
    pub(crate) provider_id: String,
    pub(crate) fingerprint: Option<FingerprintMetadata>,
    pub(crate) payload_base64: Option<String>,
    pub(crate) updated_at_epoch_ms: Option<u64>,
    pub(crate) last_access_epoch_ms: Option<u64>,
    pub(crate) stale_reason: Option<&'static str>,
    pub(crate) dirty_reason: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CacheMutationStatus {
    Stored,
    Rejected,
    LimitExceeded,
    Dirty,
    Unavailable,
}

#[derive(Debug, Clone)]
pub(crate) struct CacheMutation {
    pub(crate) status: CacheMutationStatus,
    pub(crate) plugin_id: Option<String>,
    pub(crate) provider_id: Option<String>,
    pub(crate) fingerprint: Option<FingerprintMetadata>,
    pub(crate) updated_at_epoch_ms: Option<u64>,
    pub(crate) last_access_epoch_ms: Option<u64>,
    pub(crate) dirty_reason: Option<&'static str>,
}

#[derive(Debug, Clone)]
pub(crate) struct CacheCleanup {
    pub(crate) entries: usize,
    pub(crate) total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheRecord {
    schema_version: u32,
    canonical_root: String,
    plugin_id: String,
    provider_id: String,
    fingerprint: FingerprintMetadata,
    payload_base64: String,
    payload_bytes: u64,
    updated_at_epoch_ms: u64,
    last_access_epoch_ms: u64,
    dirty: bool,
    dirty_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CacheIndex {
    schema_version: u32,
    entries: BTreeMap<String, CacheIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheIndexEntry {
    payload_bytes: u64,
    last_access_epoch_ms: u64,
}

pub(crate) fn compute_fingerprint(root: &Path, paths: &[String]) -> FingerprintResult {
    let canonical_root = match canonical_root(root) {
        Ok(root) => root,
        Err(error) => return fingerprint_failure(root, "unavailable", error),
    };
    if paths.len() > MAX_FINGERPRINT_FILES {
        return fingerprint_failure(
            &canonical_root,
            "limitExceeded",
            format!("at most {MAX_FINGERPRINT_FILES} fingerprint paths are allowed"),
        );
    }
    let mut normalized = match paths
        .iter()
        .map(|path| validate_relative_path(path))
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(paths) => paths,
        Err(error) => return fingerprint_failure(&canonical_root, "rejected", error),
    };
    normalized.sort();
    normalized.dedup();
    let mut files = Vec::with_capacity(normalized.len());
    let mut total_bytes = 0_u64;
    for path in normalized {
        let full = canonical_root.join(&path);
        if path_has_symlink_component(&canonical_root, &path) {
            return fingerprint_failure(
                &canonical_root,
                "rejected",
                format!("fingerprint path contains a symlink: {path}"),
            );
        }
        let metadata = match fs::symlink_metadata(&full) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                files.push(FingerprintFile {
                    path,
                    status: "missing".into(),
                    byte_length: 0,
                    digest: None,
                    modified_at_epoch_ms: None,
                });
                continue;
            }
            Err(error) => {
                return fingerprint_failure(
                    &canonical_root,
                    "unavailable",
                    format!("inspect fingerprint path {path}: {error}"),
                );
            }
        };
        if metadata.file_type().is_symlink() {
            return fingerprint_failure(
                &canonical_root,
                "rejected",
                format!("fingerprint path is a symlink: {path}"),
            );
        }
        if !metadata.is_file() {
            files.push(FingerprintFile {
                path,
                status: "missing".into(),
                byte_length: 0,
                digest: None,
                modified_at_epoch_ms: None,
            });
            continue;
        }
        let byte_length = metadata.len();
        if byte_length > MAX_FINGERPRINT_BYTES.saturating_sub(total_bytes) {
            return fingerprint_failure(
                &canonical_root,
                "limitExceeded",
                format!("fingerprint exceeds the {MAX_FINGERPRINT_BYTES}-byte limit"),
            );
        }
        total_bytes += byte_length;
        let Some(modified_at_epoch_ms) = metadata.modified().ok().and_then(epoch_ms) else {
            return fingerprint_failure(
                &canonical_root,
                "unavailable",
                format!("read modification time for fingerprint path: {path}"),
            );
        };
        let digest = match digest_file(&full, byte_length) {
            Ok(digest) => digest,
            Err(error) => return fingerprint_failure(&canonical_root, "unavailable", error),
        };
        files.push(FingerprintFile {
            path,
            status: "present".into(),
            byte_length,
            digest: Some(digest),
            modified_at_epoch_ms: Some(modified_at_epoch_ms),
        });
    }
    let mut aggregate = Sha256::new();
    aggregate.update(b"asterlyn.workspace-fingerprint.v1\0");
    aggregate.update(canonical_root.to_string_lossy().as_bytes());
    aggregate.update([0]);
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let java_home_digest = std::env::var("JAVA_HOME")
        .ok()
        .map(|value| hex_digest(&Sha256::digest(value.as_bytes())));
    aggregate.update(os.as_bytes());
    aggregate.update([0]);
    aggregate.update(arch.as_bytes());
    aggregate.update([0]);
    if let Some(digest) = &java_home_digest {
        aggregate.update(digest.as_bytes());
    }
    aggregate.update([0]);
    for file in &files {
        aggregate.update(file.path.as_bytes());
        aggregate.update([0]);
        aggregate.update(file.status.as_bytes());
        aggregate.update([0]);
        aggregate.update(file.byte_length.to_be_bytes());
        aggregate.update([0]);
        aggregate.update(file.modified_at_epoch_ms.unwrap_or(0).to_be_bytes());
        aggregate.update([0]);
        if let Some(digest) = &file.digest {
            aggregate.update(digest.as_bytes());
        }
        aggregate.update([0]);
    }
    FingerprintResult {
        protocol_version: 1,
        status: "ready".into(),
        workspace_root: canonical_root.to_string_lossy().into_owned(),
        algorithm: "sha256".into(),
        digest: Some(hex_digest(&aggregate.finalize())),
        files,
        truncated: false,
        reason: None,
        os: os.into(),
        arch: arch.into(),
        java_home_digest,
    }
}

fn fingerprint_failure(root: &Path, status: &'static str, reason: String) -> FingerprintResult {
    FingerprintResult {
        protocol_version: 1,
        status: status.into(),
        workspace_root: root.to_string_lossy().into_owned(),
        algorithm: "sha256".into(),
        digest: None,
        files: Vec::new(),
        truncated: status == "limitExceeded",
        reason: Some(reason),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        java_home_digest: std::env::var("JAVA_HOME")
            .ok()
            .map(|value| hex_digest(&Sha256::digest(value.as_bytes()))),
    }
}

pub(crate) fn read_cache(
    cache_root: &Path,
    root: &Path,
    plugin_id: &str,
    provider_id: &str,
) -> CacheRead {
    let unavailable = || CacheRead {
        status: CacheReadStatus::Unavailable,
        plugin_id: plugin_id.into(),
        provider_id: provider_id.into(),
        fingerprint: None,
        payload_base64: None,
        updated_at_epoch_ms: None,
        last_access_epoch_ms: None,
        stale_reason: None,
        dirty_reason: None,
    };
    let Ok(_guard) = store_lock().lock() else {
        return unavailable();
    };
    let Ok(canonical_root) = canonical_root(root) else {
        return unavailable();
    };
    if validate_identifier(plugin_id).is_err() || validate_identifier(provider_id).is_err() {
        return unavailable();
    }
    let path = entry_path(cache_root, &canonical_root, plugin_id, provider_id);
    let Some(mut record) = load_record(&path) else {
        if path.exists() {
            quarantine(&path);
            return CacheRead {
                status: CacheReadStatus::Corrupt,
                plugin_id: plugin_id.into(),
                provider_id: provider_id.into(),
                fingerprint: None,
                payload_base64: None,
                updated_at_epoch_ms: None,
                last_access_epoch_ms: None,
                stale_reason: None,
                dirty_reason: None,
            };
        }
        return CacheRead {
            status: CacheReadStatus::Miss,
            plugin_id: plugin_id.into(),
            provider_id: provider_id.into(),
            fingerprint: None,
            payload_base64: None,
            updated_at_epoch_ms: None,
            last_access_epoch_ms: None,
            stale_reason: None,
            dirty_reason: None,
        };
    };
    let now = now_ms();
    if record.schema_version != SCHEMA_VERSION
        || record.canonical_root != canonical_root.to_string_lossy()
        || record.plugin_id != plugin_id
        || record.provider_id != provider_id
        || record.payload_bytes as usize > MAX_CACHE_PAYLOAD_BYTES
        || !valid_fingerprint(&record.fingerprint)
        || BASE64
            .decode(&record.payload_base64)
            .map(|bytes| bytes.len() as u64 != record.payload_bytes)
            .unwrap_or(true)
    {
        quarantine(&path);
        return CacheRead {
            status: CacheReadStatus::Corrupt,
            plugin_id: plugin_id.into(),
            provider_id: provider_id.into(),
            fingerprint: None,
            payload_base64: None,
            updated_at_epoch_ms: None,
            last_access_epoch_ms: None,
            stale_reason: None,
            dirty_reason: None,
        };
    }
    let future = record.updated_at_epoch_ms > now;
    let status = if record.dirty {
        CacheReadStatus::Dirty
    } else if future || now.saturating_sub(record.updated_at_epoch_ms) > CACHE_TTL_MS {
        CacheReadStatus::Stale
    } else {
        CacheReadStatus::Fresh
    };
    record.last_access_epoch_ms = now;
    if save_record(&path, &record).is_err() {
        return unavailable();
    }
    CacheRead {
        status,
        plugin_id: record.plugin_id,
        provider_id: record.provider_id,
        fingerprint: Some(record.fingerprint),
        payload_base64: Some(record.payload_base64),
        updated_at_epoch_ms: Some(record.updated_at_epoch_ms),
        last_access_epoch_ms: Some(record.last_access_epoch_ms),
        stale_reason: (status == CacheReadStatus::Stale).then_some(if future {
            "future-timestamp"
        } else {
            "expired"
        }),
        dirty_reason: record.dirty_reason.as_deref().map(dirty_reason),
    }
}

pub(crate) fn write_cache(
    cache_root: &Path,
    root: &Path,
    plugin_id: &str,
    provider_id: &str,
    fingerprint: FingerprintMetadata,
    payload_base64: &str,
) -> CacheMutation {
    let rejected = || CacheMutation {
        status: CacheMutationStatus::Rejected,
        plugin_id: valid_identifier(plugin_id),
        provider_id: valid_identifier(provider_id),
        fingerprint: None,
        updated_at_epoch_ms: None,
        last_access_epoch_ms: None,
        dirty_reason: None,
    };
    if validate_identifier(plugin_id).is_err()
        || validate_identifier(provider_id).is_err()
        || !valid_fingerprint(&fingerprint)
    {
        return rejected();
    }
    let Ok(payload) = BASE64.decode(payload_base64) else {
        return rejected();
    };
    if payload.len() > MAX_CACHE_PAYLOAD_BYTES {
        return CacheMutation {
            status: CacheMutationStatus::LimitExceeded,
            ..rejected()
        };
    }
    let Ok(_guard) = store_lock().lock() else {
        return CacheMutation {
            status: CacheMutationStatus::Unavailable,
            ..rejected()
        };
    };
    let Ok(canonical_root) = canonical_root(root) else {
        return CacheMutation {
            status: CacheMutationStatus::Unavailable,
            ..rejected()
        };
    };
    if fingerprint.workspace_root != canonical_root.to_string_lossy() {
        return rejected();
    }
    let now = now_ms();
    let path = entry_path(cache_root, &canonical_root, plugin_id, provider_id);
    let previous = fs::read(&path).ok();
    let record = CacheRecord {
        schema_version: SCHEMA_VERSION,
        canonical_root: canonical_root.to_string_lossy().into_owned(),
        plugin_id: plugin_id.into(),
        provider_id: provider_id.into(),
        fingerprint: fingerprint.clone(),
        payload_base64: payload_base64.into(),
        payload_bytes: payload.len() as u64,
        updated_at_epoch_ms: now,
        last_access_epoch_ms: now,
        dirty: false,
        dirty_reason: None,
    };
    if save_record(&path, &record).is_err() {
        return CacheMutation {
            status: CacheMutationStatus::Unavailable,
            ..rejected()
        };
    }
    if cleanup_locked(cache_root).is_err() {
        match previous {
            Some(bytes) => {
                let _ = fs::write(&path, bytes);
            }
            None => {
                let _ = fs::remove_file(&path);
            }
        }
        return CacheMutation {
            status: CacheMutationStatus::Unavailable,
            ..rejected()
        };
    }
    CacheMutation {
        status: CacheMutationStatus::Stored,
        plugin_id: Some(plugin_id.into()),
        provider_id: Some(provider_id.into()),
        fingerprint: Some(fingerprint),
        updated_at_epoch_ms: Some(now),
        last_access_epoch_ms: Some(now),
        dirty_reason: None,
    }
}

pub(crate) fn mark_dirty(
    cache_root: &Path,
    root: &Path,
    plugin_id: &str,
    provider_id: &str,
    reason: &str,
) -> CacheMutation {
    let Ok(_guard) = store_lock().lock() else {
        return unavailable_mutation(plugin_id, provider_id);
    };
    if validate_identifier(plugin_id).is_err()
        || validate_identifier(provider_id).is_err()
        || !valid_dirty_reason(reason)
    {
        return unavailable_mutation(plugin_id, provider_id);
    }
    let Ok(canonical_root) = canonical_root(root) else {
        return unavailable_mutation(plugin_id, provider_id);
    };
    let path = entry_path(cache_root, &canonical_root, plugin_id, provider_id);
    let Some(mut record) = load_record(&path) else {
        return CacheMutation {
            status: CacheMutationStatus::Dirty,
            plugin_id: Some(plugin_id.into()),
            provider_id: Some(provider_id.into()),
            fingerprint: None,
            updated_at_epoch_ms: None,
            last_access_epoch_ms: None,
            dirty_reason: Some(dirty_reason(reason)),
        };
    };
    record.dirty = true;
    record.dirty_reason = Some(reason.into());
    if save_record(&path, &record).is_err() {
        return unavailable_mutation(plugin_id, provider_id);
    }
    CacheMutation {
        status: CacheMutationStatus::Dirty,
        plugin_id: Some(plugin_id.into()),
        provider_id: Some(provider_id.into()),
        fingerprint: Some(record.fingerprint),
        updated_at_epoch_ms: Some(record.updated_at_epoch_ms),
        last_access_epoch_ms: Some(record.last_access_epoch_ms),
        dirty_reason: Some(dirty_reason(reason)),
    }
}

pub(crate) fn cleanup(cache_root: &Path) -> Result<CacheCleanup, String> {
    let _guard = store_lock()
        .lock()
        .map_err(|_| "plugin task cache lock was poisoned".to_string())?;
    let (entries, total_bytes) = cleanup_locked(cache_root)?;
    Ok(CacheCleanup {
        entries,
        total_bytes,
    })
}

fn cleanup_locked(cache_root: &Path) -> Result<(usize, u64), String> {
    fs::create_dir_all(cache_root).map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    let entries_root = cache_root.join("entries");
    if entries_root.exists() {
        for root_entry in fs::read_dir(&entries_root).map_err(|error| error.to_string())? {
            let root_entry = root_entry.map_err(|error| error.to_string())?;
            if !root_entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                continue;
            }
            for entry in fs::read_dir(root_entry.path()).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                if !entry
                    .file_type()
                    .map_err(|error| error.to_string())?
                    .is_file()
                {
                    continue;
                }
                let entry_path = entry.path();
                if entry_path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    != Some("json")
                {
                    fs::remove_file(&entry_path).map_err(|error| error.to_string())?;
                    continue;
                }
                if let Some(record) = load_record(&entry_path) {
                    let valid = record.schema_version == SCHEMA_VERSION
                        && validate_identifier(&record.plugin_id).is_ok()
                        && validate_identifier(&record.provider_id).is_ok()
                        && valid_fingerprint(&record.fingerprint)
                        && record.payload_bytes as usize <= MAX_CACHE_PAYLOAD_BYTES
                        && BASE64
                            .decode(&record.payload_base64)
                            .map(|bytes| bytes.len() as u64 == record.payload_bytes)
                            .unwrap_or(false);
                    if valid {
                        records.push((entry_path, record));
                    } else {
                        fs::remove_file(&entry_path).map_err(|error| error.to_string())?;
                    }
                } else {
                    fs::remove_file(&entry_path).map_err(|error| error.to_string())?;
                }
            }
        }
    }
    records.sort_by(|(left_path, left), (right_path, right)| {
        left.last_access_epoch_ms
            .cmp(&right.last_access_epoch_ms)
            .then_with(|| left_path.cmp(right_path))
    });
    while records.len() > MAX_CACHE_ENTRIES
        || records
            .iter()
            .map(|(_, record)| record.payload_bytes)
            .sum::<u64>()
            > MAX_CACHE_TOTAL_BYTES
    {
        let Some((path, _)) = records.first() else {
            break;
        };
        let path = path.clone();
        fs::remove_file(path).map_err(|error| error.to_string())?;
        records.remove(0);
    }
    let index = CacheIndex {
        schema_version: SCHEMA_VERSION,
        entries: records
            .iter()
            .map(|(path, record)| {
                (
                    path.to_string_lossy().into_owned(),
                    CacheIndexEntry {
                        payload_bytes: record.payload_bytes,
                        last_access_epoch_ms: record.last_access_epoch_ms,
                    },
                )
            })
            .collect(),
    };
    save_json_atomic(&cache_root.join("index.json"), &index)?;
    Ok((
        records.len(),
        records.iter().map(|(_, record)| record.payload_bytes).sum(),
    ))
}

fn load_record(path: &Path) -> Option<CacheRecord> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > (MAX_CACHE_PAYLOAD_BYTES as u64 * 4) {
        return None;
    }
    serde_json::from_reader(BufReader::new(File::open(path).ok()?)).ok()
}

fn quarantine(path: &Path) {
    let suffix = format!(".corrupt.{}.{}", now_ms(), std::process::id());
    let target = path.with_extension(format!("json{suffix}"));
    let _ = fs::rename(path, target);
}

fn save_record(path: &Path, record: &CacheRecord) -> Result<(), String> {
    save_json_atomic(path, record)
}

fn save_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "cache path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        serde_json::to_writer(&mut writer, value).map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

fn entry_path(cache_root: &Path, root: &Path, plugin_id: &str, provider_id: &str) -> PathBuf {
    let mut digest = Sha256::new();
    digest.update(b"asterlyn.plugin-task-cache-slot.v1\0");
    digest.update(root.to_string_lossy().as_bytes());
    digest.update([0]);
    digest.update(plugin_id.as_bytes());
    digest.update([0]);
    digest.update(provider_id.as_bytes());
    let root_digest = hex_digest(&Sha256::digest(root.to_string_lossy().as_bytes()));
    cache_root
        .join("entries")
        .join(root_digest)
        .join(format!("{}.json", hex_digest(&digest.finalize())))
}

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(root).map_err(|error| format!("resolve workspace root: {error}"))
}

fn validate_relative_path(path: &str) -> Result<String, String> {
    if path.is_empty()
        || path.contains('\0')
        || path.contains('\\')
        || path.starts_with('/')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || Path::new(path).components().any(|component| {
            matches!(
                component,
                Component::Prefix(_)
                    | Component::RootDir
                    | Component::ParentDir
                    | Component::CurDir
            )
        })
    {
        return Err(format!(
            "invalid workspace-relative fingerprint path: {path}"
        ));
    }
    Ok(path.to_string())
}

fn validate_identifier(value: &str) -> Result<(), ()> {
    if value.is_empty()
        || value.len() > 128
        || value.split(['.', '-']).any(|part| {
            part.is_empty()
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                || !part.as_bytes()[0].is_ascii_lowercase()
        })
    {
        Err(())
    } else {
        Ok(())
    }
}
fn valid_identifier(value: &str) -> Option<String> {
    validate_identifier(value).ok().map(|_| value.to_owned())
}
fn valid_fingerprint(value: &FingerprintMetadata) -> bool {
    if value.protocol_version != 1
        || value.status != "ready"
        || value.algorithm != "sha256"
        || !value
            .digest
            .as_ref()
            .is_some_and(|digest| valid_digest(digest))
        || value.truncated
        || value.reason.is_some()
        || value.files.len() > MAX_FINGERPRINT_FILES
        || value.os.is_empty()
        || value.arch.is_empty()
    {
        return false;
    }
    let mut total = 0_u64;
    let mut previous = None;
    value.files.iter().all(|file| {
        if validate_relative_path(&file.path).is_err()
            || previous.as_deref() == Some(file.path.as_str())
            || previous
                .as_deref()
                .is_some_and(|path| path > file.path.as_str())
            || (file.status != "present" && file.status != "missing")
            || file.byte_length > MAX_FINGERPRINT_BYTES.saturating_sub(total)
        {
            return false;
        }
        previous = Some(file.path.clone());
        if file.status == "missing" {
            return file.byte_length == 0
                && file.digest.is_none()
                && file.modified_at_epoch_ms.is_none();
        }
        if file.modified_at_epoch_ms.is_none()
            || file
                .digest
                .as_ref()
                .is_none_or(|digest| !valid_digest(digest))
        {
            return false;
        }
        total += file.byte_length;
        true
    })
}
fn valid_digest(value: &str) -> bool {
    value.len() == HEX_DIGEST_LENGTH
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        && value.bytes().all(|byte| !byte.is_ascii_uppercase())
}
fn valid_dirty_reason(value: &str) -> bool {
    matches!(
        value,
        "workspace-change" | "watcher-ambiguous" | "manual" | "unknown"
    )
}
fn dirty_reason(value: &str) -> &'static str {
    if value == "workspace-change" {
        "workspace-change"
    } else if value == "watcher-ambiguous" {
        "watcher-ambiguous"
    } else if value == "manual" {
        "manual"
    } else {
        "unknown"
    }
}
fn path_has_symlink_component(root: &Path, relative: &str) -> bool {
    let mut current = root.to_path_buf();
    for component in relative.split('/') {
        current.push(component);
        if fs::symlink_metadata(&current)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}
fn digest_file(path: &Path, length: u64) -> Result<String, String> {
    let mut file = open_nofollow(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut read = 0_u64;
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        read += count as u64;
        hasher.update(&buffer[..count]);
    }
    if read != length {
        return Err("fingerprint file changed while it was read".into());
    }
    Ok(hex_digest(&hasher.finalize()))
}
#[cfg(unix)]
fn open_nofollow(path: &Path) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}
#[cfg(not(unix))]
fn open_nofollow(path: &Path) -> std::io::Result<File> {
    File::open(path)
}
fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}
fn epoch_ms(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
}
fn store_lock() -> &'static Mutex<()> {
    STORE_LOCK.get_or_init(|| Mutex::new(()))
}
fn unavailable_mutation(plugin_id: &str, provider_id: &str) -> CacheMutation {
    CacheMutation {
        status: CacheMutationStatus::Unavailable,
        plugin_id: valid_identifier(plugin_id),
        provider_id: valid_identifier(provider_id),
        fingerprint: None,
        updated_at_epoch_ms: None,
        last_access_epoch_ms: None,
        dirty_reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn ready_fingerprint(root: &Path) -> FingerprintMetadata {
        compute_fingerprint(root, &["build.gradle".into()])
    }

    #[test]
    fn fingerprint_is_stable_and_includes_missing_files() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("build.gradle"), b"plugins {}").unwrap();
        let first = compute_fingerprint(
            directory.path(),
            &["missing.gradle".into(), "build.gradle".into()],
        );
        let second = compute_fingerprint(
            directory.path(),
            &["build.gradle".into(), "missing.gradle".into()],
        );
        assert_eq!(first.status, "ready");
        assert_eq!(first.digest, second.digest);
        assert_eq!(first.files[0].status, "present");
        assert_eq!(first.files[1].status, "missing");
        fs::write(directory.path().join("build.gradle"), b"plugins { id 'x' }").unwrap();
        assert_ne!(
            first.digest,
            compute_fingerprint(
                directory.path(),
                &["build.gradle".into(), "missing.gradle".into()]
            )
            .digest
        );
    }

    #[test]
    fn fingerprint_rejects_unsafe_and_bounded_inputs() {
        let directory = tempfile::tempdir().unwrap();
        for path in ["/tmp/x", "../x", "a\\b", "a//b", "a/./b", "a\0b"] {
            assert_eq!(
                compute_fingerprint(directory.path(), &[path.into()]).status,
                "rejected",
                "{path}"
            );
        }
        let paths = (0..=MAX_FINGERPRINT_FILES)
            .map(|index| format!("file-{index}"))
            .collect::<Vec<_>>();
        assert_eq!(
            compute_fingerprint(directory.path(), &paths).status,
            "limitExceeded"
        );
    }

    #[test]
    fn cache_round_trip_dirty_corrupt_and_global_entry_bound() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        let cache = directory.path().join("cache");
        fs::write(workspace.join("build.gradle"), b"plugins {}").unwrap();
        let payload = BASE64.encode(b"snapshot");
        let fingerprint = ready_fingerprint(&workspace);
        let result = write_cache(
            &cache,
            &workspace,
            "dev.plugin",
            "tasks",
            fingerprint.clone(),
            &payload,
        );
        assert_eq!(result.status, CacheMutationStatus::Stored);
        assert_eq!(
            read_cache(&cache, &workspace, "dev.plugin", "tasks").status,
            CacheReadStatus::Fresh
        );
        assert_eq!(
            mark_dirty(
                &cache,
                &workspace,
                "dev.plugin",
                "tasks",
                "workspace-change"
            )
            .status,
            CacheMutationStatus::Dirty
        );
        assert_eq!(
            read_cache(&cache, &workspace, "dev.plugin", "tasks").status,
            CacheReadStatus::Dirty
        );
        let path = entry_path(
            &cache,
            &workspace.canonicalize().unwrap(),
            "dev.plugin",
            "tasks",
        );
        fs::write(path, b"not-json").unwrap();
        assert_eq!(
            read_cache(&cache, &workspace, "dev.plugin", "tasks").status,
            CacheReadStatus::Corrupt
        );
        for index in 0..(MAX_CACHE_ENTRIES + 1) {
            let _ = write_cache(
                &cache,
                &workspace,
                "dev.plugin",
                &format!("provider-{index}"),
                fingerprint.clone(),
                &payload,
            );
        }
        let cleanup_result = cleanup(&cache).unwrap();
        assert!(cleanup_result.entries <= MAX_CACHE_ENTRIES);
    }

    #[test]
    fn oversized_payload_is_rejected_without_a_cache_file() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        fs::write(workspace.join("build.gradle"), b"plugins {}").unwrap();
        let result = write_cache(
            &directory.path().join("cache"),
            &workspace,
            "dev.plugin",
            "tasks",
            ready_fingerprint(&workspace),
            &BASE64.encode(vec![0_u8; MAX_CACHE_PAYLOAD_BYTES + 1]),
        );
        assert_eq!(result.status, CacheMutationStatus::LimitExceeded);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_intermediate_symlink_and_quarantines_corrupt_records() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("build.gradle"), b"plugins {}").unwrap();
        let root = directory.path().join("workspace");
        fs::create_dir(&root).unwrap();
        symlink(outside.path(), root.join("linked")).unwrap();
        assert_eq!(
            compute_fingerprint(&root, &["linked/build.gradle".into()]).status,
            "rejected"
        );

        let cache = directory.path().join("cache");
        let workspace = directory.path().join("other");
        fs::create_dir(&workspace).unwrap();
        fs::write(workspace.join("build.gradle"), b"plugins {}").unwrap();
        let path = entry_path(
            &cache,
            &workspace.canonicalize().unwrap(),
            "dev.plugin",
            "tasks",
        );
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not-json").unwrap();
        assert_eq!(
            read_cache(&cache, &workspace, "dev.plugin", "tasks").status,
            CacheReadStatus::Corrupt
        );
        assert!(!path.exists());
        assert_eq!(
            read_cache(&cache, &workspace, "dev.plugin", "tasks").status,
            CacheReadStatus::Miss
        );
    }

    #[test]
    fn read_promotes_lru_and_fingerprint_contains_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        fs::write(workspace.join("build.gradle"), b"plugins {}").unwrap();
        let fingerprint = ready_fingerprint(&workspace);
        assert!(fingerprint.files[0].modified_at_epoch_ms.is_some());
        let cache = directory.path().join("cache");
        let payload = BASE64.encode(b"snapshot");
        write_cache(
            &cache,
            &workspace,
            "dev.plugin",
            "first",
            fingerprint.clone(),
            &payload,
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
        write_cache(
            &cache,
            &workspace,
            "dev.plugin",
            "second",
            fingerprint,
            &payload,
        );
        let first_before = read_cache(&cache, &workspace, "dev.plugin", "first")
            .last_access_epoch_ms
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let first_after = read_cache(&cache, &workspace, "dev.plugin", "first")
            .last_access_epoch_ms
            .unwrap();
        assert!(first_after >= first_before);
    }

    #[test]
    fn future_timestamp_is_typed_stale_and_not_reused_as_fresh() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        fs::write(workspace.join("build.gradle"), b"plugins {}").unwrap();
        let cache = directory.path().join("cache");
        let fingerprint = ready_fingerprint(&workspace);
        let path = entry_path(
            &cache,
            &workspace.canonicalize().unwrap(),
            "dev.plugin",
            "tasks",
        );
        let record = CacheRecord {
            schema_version: SCHEMA_VERSION,
            canonical_root: workspace
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            plugin_id: "dev.plugin".into(),
            provider_id: "tasks".into(),
            fingerprint,
            payload_base64: BASE64.encode(b"snapshot"),
            payload_bytes: 8,
            updated_at_epoch_ms: now_ms().saturating_add(60_000),
            last_access_epoch_ms: now_ms(),
            dirty: false,
            dirty_reason: None,
        };
        save_record(&path, &record).unwrap();
        let result = read_cache(&cache, &workspace, "dev.plugin", "tasks");
        assert_eq!(result.status, CacheReadStatus::Stale);
        assert_eq!(result.stale_reason, Some("future-timestamp"));
    }

    #[test]
    fn cleanup_quarantines_invalid_records_before_counting_limits() {
        let directory = tempfile::tempdir().unwrap();
        let cache = directory.path().join("cache");
        let workspace = directory.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        let path = entry_path(
            &cache,
            &workspace.canonicalize().unwrap(),
            "dev.plugin",
            "tasks",
        );
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"invalid").unwrap();
        let result = cleanup(&cache).unwrap();
        assert_eq!(result.entries, 0);
        assert!(!path.exists());
    }
}
