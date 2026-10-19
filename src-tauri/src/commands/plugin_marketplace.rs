use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use asterlyn_plugin_marketplace::{
    PluginSource, PluginSourceCatalog, PluginSourceCatalogStatus, PluginSourceSnapshot,
    PluginSourceStore, compare_release_versions, parse_github_release,
};
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_RELEASE_METADATA_BYTES: u64 = 1024 * 1024;

use crate::application::PluginMarketplaceCoordinator;

#[tauri::command]
pub(crate) fn list_plugin_sources(
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginSourceSnapshot, String> {
    marketplace.run(|| store(&app)?.snapshot().map_err(|error| error.to_string()))
}

#[tauri::command]
pub(crate) fn upsert_plugin_source(
    repository: String,
    name: String,
    description: String,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginSourceSnapshot, String> {
    marketplace.run(|| {
        store(&app)?
            .upsert_custom(&repository, &name, &description)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub(crate) fn set_plugin_source_enabled(
    repository: String,
    enabled: bool,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginSourceSnapshot, String> {
    marketplace.run(|| {
        store(&app)?
            .set_enabled(&repository, enabled)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub(crate) fn remove_plugin_source(
    repository: String,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginSourceSnapshot, String> {
    marketplace.run(|| {
        store(&app)?
            .remove_custom(&repository)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub(crate) async fn refresh_plugin_source(
    repository: String,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginSourceSnapshot, String> {
    let snapshot =
        marketplace.run(|| store(&app)?.snapshot().map_err(|error| error.to_string()))?;
    let source = snapshot
        .sources
        .iter()
        .find(|source| source.repository == repository)
        .cloned()
        .ok_or_else(|| "plugin source was not found".to_string())?;
    if !source.enabled {
        return Err("Enable the plugin source before refreshing it.".into());
    }
    let expected_generation = snapshot.generation;
    let catalog = tauri::async_runtime::spawn_blocking(move || discover_release(&source))
        .await
        .map_err(|error| format!("plugin Release check failed: {error}"))?;
    marketplace.run(|| {
        store(&app)?
            .update_catalog(&repository, expected_generation, catalog)
            .map_err(|error| error.to_string())
    })
}

fn store(app: &tauri::AppHandle) -> Result<PluginSourceStore, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve plugin marketplace location: {error}"))?
        .join("plugin-marketplace-v1");
    PluginSourceStore::open(root).map_err(|error| error.to_string())
}

fn discover_release(source: &PluginSource) -> PluginSourceCatalog {
    match request_latest_release(source) {
        Ok(HttpReleaseResponse {
            status: 200,
            body,
            etag,
            last_modified,
            ..
        }) => {
            match parse_github_release(&source.repository, &body, now_ms(), etag, last_modified) {
                Ok(catalog) if is_implicit_downgrade(source, &catalog) => stale_or_error(
                    source,
                    PluginSourceCatalogStatus::Error,
                    "GitHub latest Release is older than the last discovered version.",
                    None,
                ),
                Ok(catalog) => catalog,
                Err(error) => stale_or_error(
                    source,
                    PluginSourceCatalogStatus::Error,
                    &error.to_string(),
                    None,
                ),
            }
        }
        Ok(HttpReleaseResponse {
            status: 304,
            etag,
            last_modified,
            ..
        }) => {
            if let Some(mut catalog) = source.catalog.clone().filter(catalog_has_release) {
                catalog.status = PluginSourceCatalogStatus::Available;
                catalog.checked_at_epoch_ms = now_ms();
                catalog.stale = false;
                catalog.error = None;
                catalog.etag = etag.or(catalog.etag);
                catalog.last_modified = last_modified.or(catalog.last_modified);
                catalog.rate_limit_reset_epoch_ms = None;
                catalog
            } else {
                stale_or_error(
                    source,
                    PluginSourceCatalogStatus::Error,
                    "GitHub returned not-modified without a cached Release.",
                    None,
                )
            }
        }
        Ok(HttpReleaseResponse { status: 404, .. }) => stale_or_error(
            source,
            PluginSourceCatalogStatus::NoRelease,
            "No stable GitHub Release has been published for this source.",
            None,
        ),
        Ok(response) if response.status == 403 && response.rate_limit_remaining == Some(0) => {
            stale_or_error(
                source,
                PluginSourceCatalogStatus::RateLimited,
                "GitHub API rate limit reached. The cached result remains available.",
                response.rate_limit_reset_epoch_ms,
            )
        }
        Ok(response) => stale_or_error(
            source,
            PluginSourceCatalogStatus::Error,
            &format!("GitHub returned HTTP {}.", response.status),
            None,
        ),
        Err(error) => stale_or_error(source, PluginSourceCatalogStatus::Error, &error, None),
    }
}

struct HttpReleaseResponse {
    status: u16,
    body: Vec<u8>,
    etag: Option<String>,
    last_modified: Option<String>,
    rate_limit_remaining: Option<u64>,
    rate_limit_reset_epoch_ms: Option<u64>,
}

fn request_latest_release(source: &PluginSource) -> Result<HttpReleaseResponse, String> {
    let temporary = tempfile::tempdir()
        .map_err(|error| format!("could not create Release metadata staging: {error}"))?;
    let headers_path = temporary.path().join("headers");
    let body_path = temporary.path().join("body");
    let api_url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        source.repository
    );
    let mut command = hidden_command("curl");
    command.args([
        "-sS",
        "--http1.1",
        "--connect-timeout",
        "8",
        "--max-time",
        "20",
        "--retry",
        "1",
        "--retry-delay",
        "1",
        "--max-filesize",
        "1048576",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
        "-A",
        concat!("Asterlyn/", env!("CARGO_PKG_VERSION")),
        "--dump-header",
    ]);
    command.arg(&headers_path).arg("--output").arg(&body_path);
    if let Some(etag) = source
        .catalog
        .as_ref()
        .and_then(|catalog| catalog.etag.as_deref())
    {
        command.arg("-H").arg(format!("If-None-Match: {etag}"));
    }
    if let Some(last_modified) = source
        .catalog
        .as_ref()
        .and_then(|catalog| catalog.last_modified.as_deref())
    {
        command
            .arg("-H")
            .arg(format!("If-Modified-Since: {last_modified}"));
    }
    let output = command
        .arg("--write-out")
        .arg("%{http_code}")
        .arg(api_url)
        .output()
        .map_err(|error| format!("could not start GitHub request: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!(
                "GitHub request failed with curl exit code {:?}",
                output.status.code()
            )
        } else {
            format!("GitHub request failed: {detail}")
        });
    }
    let status = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u16>()
        .map_err(|_| "GitHub returned an invalid HTTP status".to_string())?;
    let body = fs::read(&body_path).unwrap_or_default();
    if body.len() as u64 > MAX_RELEASE_METADATA_BYTES {
        return Err("GitHub returned oversized Release metadata".into());
    }
    let headers = fs::read_to_string(&headers_path)
        .map_err(|error| format!("could not read GitHub response headers: {error}"))?;
    Ok(HttpReleaseResponse {
        status,
        body,
        etag: header(&headers, "etag"),
        last_modified: header(&headers, "last-modified"),
        rate_limit_remaining: header(&headers, "x-ratelimit-remaining")
            .and_then(|value| value.parse().ok()),
        rate_limit_reset_epoch_ms: header(&headers, "x-ratelimit-reset")
            .and_then(|value| value.parse::<u64>().ok())
            .and_then(|seconds| seconds.checked_mul(1_000)),
    })
}

fn stale_or_error(
    source: &PluginSource,
    status: PluginSourceCatalogStatus,
    error: &str,
    rate_limit_reset_epoch_ms: Option<u64>,
) -> PluginSourceCatalog {
    if let Some(mut cached) = source.catalog.clone().filter(catalog_has_release) {
        cached.status = status;
        cached.checked_at_epoch_ms = now_ms();
        cached.stale = true;
        cached.error = Some(error.chars().take(2_048).collect());
        cached.rate_limit_reset_epoch_ms = rate_limit_reset_epoch_ms;
        return cached;
    }
    PluginSourceCatalog {
        status,
        checked_at_epoch_ms: now_ms(),
        stale: false,
        version: None,
        release_url: None,
        asset_name: None,
        asset_size_bytes: None,
        digest: None,
        error: Some(error.chars().take(2_048).collect()),
        rate_limit_reset_epoch_ms,
        etag: None,
        last_modified: None,
    }
}

fn catalog_has_release(catalog: &PluginSourceCatalog) -> bool {
    catalog.version.is_some()
        && catalog.release_url.is_some()
        && catalog.asset_name.is_some()
        && catalog.asset_size_bytes.is_some()
        && catalog.digest.is_some()
}

fn is_implicit_downgrade(source: &PluginSource, next: &PluginSourceCatalog) -> bool {
    let Some(previous) = source
        .catalog
        .as_ref()
        .and_then(|catalog| catalog.version.as_deref())
    else {
        return false;
    };
    let Some(next) = next.version.as_deref() else {
        return false;
    };
    compare_release_versions(next, previous).is_ok_and(std::cmp::Ordering::is_lt)
}

fn header(headers: &str, name: &str) -> Option<String> {
    headers
        .lines()
        .rev()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case(name)
                .then(|| value.trim().to_string())
        })
        .filter(|value| {
            !value.is_empty() && !value.contains(['\r', '\n', '\0']) && value.len() <= 2_048
        })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(1)
}

fn hidden_command(program: &str) -> Command {
    let command = Command::new(program);
    #[cfg(target_os = "windows")]
    let mut command = command;
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
