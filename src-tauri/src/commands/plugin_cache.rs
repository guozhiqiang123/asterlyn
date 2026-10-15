use crate::application::ActiveWorkspaces;
use crate::application::plugin_task_cache::{self, CacheMutationStatus, CacheReadStatus};
use tauri::{Manager, State};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginTaskCacheReadResult {
    protocol_version: u8,
    status: &'static str,
    plugin_id: String,
    provider_id: String,
    fingerprint: Option<plugin_task_cache::FingerprintMetadata>,
    payload_base64: Option<String>,
    updated_at_epoch_ms: Option<u64>,
    last_access_epoch_ms: Option<u64>,
    stale_reason: Option<&'static str>,
    dirty_reason: Option<&'static str>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginTaskCacheMutationResult {
    protocol_version: u8,
    status: &'static str,
    plugin_id: Option<String>,
    provider_id: Option<String>,
    fingerprint: Option<plugin_task_cache::FingerprintMetadata>,
    updated_at_epoch_ms: Option<u64>,
    last_access_epoch_ms: Option<u64>,
    dirty_reason: Option<&'static str>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginTaskCacheCleanupResult {
    protocol_version: u8,
    status: &'static str,
    entries: usize,
    total_bytes: u64,
}

#[tauri::command]
pub(crate) fn compute_workspace_fingerprint(
    workspace_root: String,
    paths: Vec<String>,
    window: tauri::WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
) -> Result<plugin_task_cache::FingerprintResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    Ok(plugin_task_cache::compute_fingerprint(&root, &paths))
}

#[tauri::command]
pub(crate) fn read_plugin_task_cache(
    workspace_root: String,
    plugin_id: String,
    provider_id: String,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
) -> Result<PluginTaskCacheReadResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    let value = plugin_task_cache::read_cache(&cache_root(&app)?, &root, &plugin_id, &provider_id);
    Ok(PluginTaskCacheReadResult {
        protocol_version: 1,
        status: match value.status {
            CacheReadStatus::Miss => "miss",
            CacheReadStatus::Fresh => "fresh",
            CacheReadStatus::Stale => "stale",
            CacheReadStatus::Dirty => "dirty",
            CacheReadStatus::Corrupt => "corrupt",
            CacheReadStatus::Unavailable => "unavailable",
        },
        plugin_id: value.plugin_id,
        provider_id: value.provider_id,
        fingerprint: value.fingerprint,
        payload_base64: value.payload_base64,
        updated_at_epoch_ms: value.updated_at_epoch_ms,
        last_access_epoch_ms: value.last_access_epoch_ms,
        stale_reason: value.stale_reason,
        dirty_reason: value.dirty_reason,
    })
}

#[tauri::command]
pub(crate) fn write_plugin_task_cache(
    workspace_root: String,
    plugin_id: String,
    provider_id: String,
    fingerprint: plugin_task_cache::FingerprintMetadata,
    payload_base64: String,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
) -> Result<PluginTaskCacheMutationResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    Ok(mutation_result(plugin_task_cache::write_cache(
        &cache_root(&app)?,
        &root,
        &plugin_id,
        &provider_id,
        fingerprint,
        &payload_base64,
    )))
}

#[tauri::command]
pub(crate) fn mark_plugin_task_cache_dirty(
    workspace_root: String,
    plugin_id: String,
    provider_id: String,
    reason: String,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
) -> Result<PluginTaskCacheMutationResult, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    Ok(mutation_result(plugin_task_cache::mark_dirty(
        &cache_root(&app)?,
        &root,
        &plugin_id,
        &provider_id,
        &reason,
    )))
}

#[tauri::command]
pub(crate) fn cleanup_plugin_task_cache(app: tauri::AppHandle) -> PluginTaskCacheCleanupResult {
    match cache_root(&app).and_then(|root| plugin_task_cache::cleanup(&root)) {
        Ok(value) => PluginTaskCacheCleanupResult {
            protocol_version: 1,
            status: "cleaned",
            entries: value.entries,
            total_bytes: value.total_bytes,
        },
        Err(_) => PluginTaskCacheCleanupResult {
            protocol_version: 1,
            status: "unavailable",
            entries: 0,
            total_bytes: 0,
        },
    }
}

fn cache_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("plugin-task-cache-v1"))
        .map_err(|error| format!("resolve plugin task cache location: {error}"))
}
fn mutation_result(value: plugin_task_cache::CacheMutation) -> PluginTaskCacheMutationResult {
    PluginTaskCacheMutationResult {
        protocol_version: 1,
        status: match value.status {
            CacheMutationStatus::Stored => "stored",
            CacheMutationStatus::Rejected => "rejected",
            CacheMutationStatus::LimitExceeded => "limitExceeded",
            CacheMutationStatus::Dirty => "dirty",
            CacheMutationStatus::Unavailable => "unavailable",
        },
        plugin_id: value.plugin_id,
        provider_id: value.provider_id,
        fingerprint: value.fingerprint,
        updated_at_epoch_ms: value.updated_at_epoch_ms,
        last_access_epoch_ms: value.last_access_epoch_ms,
        dirty_reason: value.dirty_reason,
    }
}
