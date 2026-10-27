use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use asterlyn_plugin_marketplace::{
    AdmittedPluginIdentity, BUILT_IN_ANDROID_REPOSITORY, PluginInstallationSnapshot,
    PluginInstallationStore, PluginRuntimeStatus, PluginSource, PluginSourceCatalog,
    PluginSourceCatalogStatus, PluginSourceSnapshot, PluginSourceStore, compare_release_versions,
    parse_github_release,
};
use asterlyn_plugin_package::{
    AdmissionContext, AdmittedPluginManifest, SUPPORTED_CAPABILITIES, SUPPORTED_PERMISSIONS,
    extract_admitted_package, inspect_extracted_package, inspect_package,
};
use asterlyn_plugin_runtime::PluginHostSupervisor;
use asterlyn_plugin_runtime_protocol::ShutdownReason;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_RELEASE_METADATA_BYTES: u64 = 1024 * 1024;
use self::bundled::*;

use crate::application::{
    PendingPluginAdmission, PluginMarketplaceCoordinator, PluginProcessQueryManager,
    PluginToolAuthorityIdentity, TaskManager, validate_external_tool_authority,
};

use super::plugin_marketplace_cleanup::{cleanup_marketplace_storage, remove_marketplace_entry};
use super::plugin_marketplace_verification::{
    inspect_verified_installed_package, verify_installed_package_archive_path,
};

mod bundled;
pub(crate) const INSTALLATIONS_CHANGED: &str = "asterlyn://plugin-installations-changed";
fn publish_installations(app: &tauri::AppHandle, snapshot: &PluginInstallationSnapshot) {
    let _ = app.emit(INSTALLATIONS_CHANGED, snapshot.generation);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginPackageAdmissionReview {
    review_token: String,
    repository: String,
    source_generation: u64,
    asset_name: String,
    asset_size_bytes: u64,
    digest: String,
    plugin_id: String,
    version: String,
    license_expression: String,
    capabilities: Vec<String>,
    permissions: Vec<String>,
    host_operations: Vec<String>,
    enabled_after_install: bool,
    expanded_bytes: u64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPluginManifestSnapshot {
    schema_version: u32,
    generation: u64,
    manifests: Vec<InstalledPluginManifestEntry>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPluginManifestEntry {
    plugin_id: String,
    plugin_version: String,
    package_digest: String,
    manifest: Option<AdmittedPluginManifest>,
    error: Option<String>,
}

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

#[tauri::command]
pub(crate) fn list_plugin_installations(
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginInstallationSnapshot, String> {
    marketplace.run(|| {
        installation_store(&app)?
            .snapshot()
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub(crate) fn list_installed_plugin_manifests(
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<InstalledPluginManifestSnapshot, String> {
    marketplace.run(|| {
        let snapshot = installation_store(&app)?
            .snapshot()
            .map_err(|error| error.to_string())?;
        let manifests = snapshot
            .plugins
            .iter()
            .filter_map(|plugin| {
                let selected = plugin
                    .pending_version
                    .as_deref()
                    .or(plugin.active_version.as_deref())
                    .or(plugin.known_good_version.as_deref())?;
                let version = plugin
                    .versions
                    .iter()
                    .find(|candidate| candidate.version == selected)?;
                let inspected = inspect_verified_installed_package(
                    &app,
                    &plugin.plugin_id,
                    &plugin.repository,
                    &version.version,
                    &version.package_digest,
                    version.content_digest.as_deref(),
                );
                let (manifest, error) = match inspected {
                    Ok(report) => (Some(report.management_manifest), None),
                    Err(error) => (None, Some(bounded_manifest_error(error))),
                };
                Some(InstalledPluginManifestEntry {
                    plugin_id: plugin.plugin_id.clone(),
                    plugin_version: version.version.clone(),
                    package_digest: version.package_digest.clone(),
                    manifest,
                    error,
                })
            })
            .collect();
        Ok(InstalledPluginManifestSnapshot {
            schema_version: 1,
            generation: snapshot.generation,
            manifests,
        })
    })
}

fn bounded_manifest_error(error: String) -> String {
    error.chars().take(512).collect()
}

#[tauri::command]
pub(crate) async fn prepare_plugin_install(
    repository: String,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginPackageAdmissionReview, String> {
    let snapshot =
        marketplace.run(|| store(&app)?.snapshot().map_err(|error| error.to_string()))?;
    let source = snapshot
        .sources
        .iter()
        .find(|source| source.repository == repository)
        .cloned()
        .ok_or_else(|| "plugin source was not found".to_string())?;
    if !source.enabled {
        return Err("Enable the plugin source before installing from it.".into());
    }
    let catalog = source
        .catalog
        .as_ref()
        .filter(|catalog| catalog.status == PluginSourceCatalogStatus::Available && !catalog.stale)
        .ok_or_else(|| "Refresh this source before installing its package.".to_string())?;
    let binding = ReleaseBinding::from_catalog(&source.repository, snapshot.generation, catalog)?;
    let staging_root = marketplace_root(&app)?.join("staging");
    fs::create_dir_all(&staging_root).map_err(|error| format!("create plugin staging: {error}"))?;
    let prepared =
        tauri::async_runtime::spawn_blocking(move || download_and_inspect(binding, staging_root))
            .await
            .map_err(|error| format!("plugin package inspection failed: {error}"))??;
    let review = review_from(&prepared);
    let cleanup = prepared.staging_path.clone();
    if let Err(error) = marketplace.insert_admission(prepared) {
        let _ = fs::remove_file(cleanup);
        return Err(error);
    }
    Ok(review)
}

#[tauri::command]
pub(crate) fn cancel_plugin_install(
    review_token: String,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<(), String> {
    if let Some(admission) = marketplace.cancel_admission(&review_token)? {
        let _ = fs::remove_file(admission.staging_path);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn confirm_plugin_install(
    review_token: String,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginInstallationSnapshot, String> {
    let admission = marketplace.take_admission(&review_token)?;
    let result = marketplace.run(|| commit_admission(&app, &admission));
    let _ = fs::remove_file(&admission.staging_path);
    if let Ok(snapshot) = &result {
        publish_installations(&app, snapshot);
    }
    result
}

#[tauri::command]
pub(crate) fn restart_for_plugin_changes(
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    tasks: State<'_, TaskManager>,
    process_queries: State<'_, PluginProcessQueryManager>,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<(), String> {
    installation_store(&app)?
        .snapshot()
        .map_err(|error| error.to_string())?;
    marketplace.begin_restart()?;
    tasks.cancel_all();
    process_queries.cancel_all();
    supervisor.cancel_all(ShutdownReason::Restart);
    let _ = abandon_plugin_activations(&app);
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub(crate) fn set_installed_plugin_enabled(
    plugin_id: String,
    enabled: bool,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    tasks: State<'_, TaskManager>,
    process_queries: State<'_, PluginProcessQueryManager>,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<PluginInstallationSnapshot, String> {
    marketplace.run(|| {
        let snapshot = installation_store(&app)?
            .set_plugin_enabled(&plugin_id, enabled)
            .map_err(|error| error.to_string())?;
        if !enabled {
            tasks.cancel_plugin(&plugin_id);
            process_queries.cancel_plugin(&plugin_id);
            supervisor.stop_plugin_all(&plugin_id, ShutdownReason::Disabled);
            if plugin_id == "dev.asterlyn.lsp" {
                app.state::<crate::application::LanguageServiceManager>()
                    .stop_sessions();
            }
        }
        publish_installations(&app, &snapshot);
        Ok(snapshot)
    })
}

#[tauri::command]
pub(crate) fn select_installed_plugin_rollback(
    plugin_id: String,
    version: String,
    package_digest: String,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginInstallationSnapshot, String> {
    marketplace.run(|| {
        let snapshot = installation_store(&app)?
            .select_rollback(&plugin_id, &version, &package_digest)
            .map_err(|error| error.to_string())?;
        publish_installations(&app, &snapshot);
        Ok(snapshot)
    })
}

#[tauri::command]
pub(crate) fn repair_installed_plugin_version(
    plugin_id: String,
    version: String,
    package_digest: String,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
) -> Result<PluginInstallationSnapshot, String> {
    marketplace.run(|| {
        let installation = installation_store(&app)?;
        let snapshot = installation.snapshot().map_err(|error| error.to_string())?;
        let plugin = snapshot
            .plugins
            .iter()
            .find(|candidate| candidate.plugin_id == plugin_id)
            .ok_or_else(|| "installed plugin was not found".to_owned())?;
        let candidate = plugin
            .versions
            .iter()
            .find(|candidate| candidate.version == version)
            .ok_or_else(|| "installed plugin version was not found".to_owned())?;
        if candidate.package_digest != package_digest {
            return Err("plugin package digest does not match the installed version".to_owned());
        }
        if candidate.runtime_status != PluginRuntimeStatus::Quarantined {
            return Err("only a quarantined plugin version can be repaired".to_owned());
        }
        inspect_verified_installed_package(
            &app,
            &plugin_id,
            &plugin.repository,
            &version,
            &package_digest,
            candidate.content_digest.as_deref(),
        )?;
        let snapshot = installation
            .repair_quarantined_version(&plugin_id, &version, &package_digest)
            .map_err(|error| error.to_string())?;
        publish_installations(&app, &snapshot);
        Ok(snapshot)
    })
}

#[tauri::command]
pub(crate) fn uninstall_installed_plugin(
    plugin_id: String,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    tasks: State<'_, TaskManager>,
    process_queries: State<'_, PluginProcessQueryManager>,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<PluginInstallationSnapshot, String> {
    marketplace.run(|| {
        let installation = installation_store(&app)?;
        installation
            .ensure_can_remove(&plugin_id)
            .map_err(|error| error.to_string())?;
        let snapshot = installation.snapshot().map_err(|error| error.to_string())?;
        let plugin = snapshot
            .plugins
            .iter()
            .find(|plugin| plugin.plugin_id == plugin_id)
            .ok_or_else(|| "installed plugin was not found".to_string())?;
        if plugin.bundled_fallback {
            return Err("Host-bundled plugins can be disabled but not uninstalled.".into());
        }
        tasks.cancel_plugin(&plugin_id);
        process_queries.cancel_plugin(&plugin_id);
        supervisor.stop_plugin_all(&plugin_id, ShutdownReason::Disabled);
        if plugin_id == "dev.asterlyn.lsp" {
            app.state::<crate::application::LanguageServiceManager>()
                .stop_sessions();
        }

        let packages = marketplace_root(&app)?.join("packages");
        let plugin_root = packages.join(&plugin_id);
        let tombstone = packages.join(format!(".removing-{}-{}", plugin_id, now_ms()));
        if plugin_root.exists() {
            fs::rename(&plugin_root, &tombstone)
                .map_err(|error| format!("prepare plugin package removal: {error}"))?;
        }
        match installation.remove_plugin(&plugin_id) {
            Ok(snapshot) => {
                if tombstone.exists() {
                    let _ = remove_marketplace_entry(&tombstone);
                }
                publish_installations(&app, &snapshot);
                Ok(snapshot)
            }
            Err(error) => {
                if tombstone.exists() {
                    let _ = fs::rename(&tombstone, &plugin_root);
                }
                Err(error.to_string())
            }
        }
    })
}

#[derive(Clone)]
struct ReleaseBinding {
    repository: String,
    source_generation: u64,
    version: String,
    asset_name: String,
    download_url: String,
    asset_size_bytes: u64,
    digest: String,
}

impl ReleaseBinding {
    fn from_catalog(
        repository: &str,
        source_generation: u64,
        catalog: &PluginSourceCatalog,
    ) -> Result<Self, String> {
        Ok(Self {
            repository: repository.into(),
            source_generation,
            version: catalog
                .version
                .clone()
                .ok_or("Release version is missing")?,
            asset_name: catalog
                .asset_name
                .clone()
                .ok_or("Release asset is missing")?,
            download_url: catalog
                .asset_download_url
                .clone()
                .ok_or("Release download URL is missing")?,
            asset_size_bytes: catalog
                .asset_size_bytes
                .ok_or("Release asset size is missing")?,
            digest: catalog.digest.clone().ok_or("Release digest is missing")?,
        })
    }
}

fn download_and_inspect(
    binding: ReleaseBinding,
    staging_root: std::path::PathBuf,
) -> Result<PendingPluginAdmission, String> {
    let token = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{}\0{}\0{}\0{}\0{}",
                binding.repository,
                binding.source_generation,
                binding.version,
                binding.digest,
                now_ms()
            )
            .as_bytes()
        )
    );
    let staging_path = staging_root.join(format!("{token}.tgz"));
    let output = hidden_command("curl")
        .args([
            "-sS",
            "--fail",
            "--location",
            "--max-redirs",
            "5",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--connect-timeout",
            "10",
            "--max-time",
            "120",
            "--max-filesize",
            "67108864",
            "-A",
            concat!("Asterlyn/", env!("CARGO_PKG_VERSION")),
            "--output",
        ])
        .arg(&staging_path)
        .arg(&binding.download_url)
        .output()
        .map_err(|error| format!("could not start plugin download: {error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&staging_path);
        return Err(format!(
            "plugin download failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let bytes = fs::read(&staging_path)
        .map_err(|error| format!("read downloaded plugin package: {error}"))?;
    if bytes.len() as u64 != binding.asset_size_bytes {
        let _ = fs::remove_file(&staging_path);
        return Err("downloaded plugin size does not match the admitted Release".into());
    }
    let actual = format!("sha256:{:x}", Sha256::digest(&bytes));
    if actual != binding.digest {
        let _ = fs::remove_file(&staging_path);
        return Err("downloaded plugin digest does not match the admitted Release".into());
    }
    let context = admission_context(&binding.repository, &binding.version);
    let report = inspect_package(&bytes, &context).map_err(|error| {
        let _ = fs::remove_file(&staging_path);
        error.to_string()
    })?;
    validate_external_tool_authority(
        PluginToolAuthorityIdentity {
            repository: &binding.repository,
            plugin_id: &report.plugin_id,
            plugin_version: &report.plugin_version,
            package_digest: &binding.digest,
        },
        report.management_manifest.schema_version,
        &report.management_manifest.host_operations,
        &report.management_manifest.process_queries,
        &report.management_manifest.tool_operations,
    )
    .inspect_err(|_| {
        let _ = fs::remove_file(&staging_path);
    })?;
    Ok(PendingPluginAdmission {
        token,
        repository: binding.repository,
        source_generation: binding.source_generation,
        version: binding.version,
        asset_name: binding.asset_name,
        asset_size_bytes: binding.asset_size_bytes,
        digest: binding.digest,
        staging_path,
        report,
    })
}

fn commit_admission(
    app: &tauri::AppHandle,
    admission: &PendingPluginAdmission,
) -> Result<PluginInstallationSnapshot, String> {
    let sources = store(app)?.snapshot().map_err(|error| error.to_string())?;
    if sources.generation != admission.source_generation {
        return Err("Plugin source changed after review; inspect it again.".into());
    }
    let source = sources
        .sources
        .iter()
        .find(|source| source.repository == admission.repository)
        .ok_or("plugin source was removed")?;
    let catalog = source
        .catalog
        .as_ref()
        .ok_or("plugin Release is unavailable")?;
    let binding = ReleaseBinding::from_catalog(&admission.repository, sources.generation, catalog)?;
    if binding.version != admission.version
        || binding.asset_name != admission.asset_name
        || binding.asset_size_bytes != admission.asset_size_bytes
        || binding.digest != admission.digest
    {
        return Err("Plugin Release changed after review; inspect it again.".into());
    }
    let bytes = fs::read(&admission.staging_path)
        .map_err(|error| format!("read staged plugin package: {error}"))?;
    if format!("sha256:{:x}", Sha256::digest(&bytes)) != admission.digest {
        return Err("staged plugin package changed after review".into());
    }
    let digest_key = admission
        .digest
        .strip_prefix("sha256:")
        .ok_or("invalid admitted digest")?;
    let root = marketplace_root(app)?.join("packages");
    let final_dir = root
        .join(&admission.report.plugin_id)
        .join(&admission.version)
        .join(digest_key);
    if !final_dir.exists() {
        fs::create_dir_all(final_dir.parent().ok_or("invalid plugin storage path")?)
            .map_err(|error| format!("create immutable plugin storage: {error}"))?;
        let temporary = final_dir.with_extension(format!("staging-{}", admission.token));
        let context = admission_context(&admission.repository, &admission.version);
        extract_admitted_package(&bytes, &context, &temporary)
            .map_err(|error| error.to_string())?;
        publish_sealed_package_tree(&temporary, &final_dir, "immutable plugin package")?;
    }
    let archive = installed_package_archive(
        app,
        &admission.report.plugin_id,
        &admission.version,
        &admission.digest,
    )?;
    retain_package_archive(&archive, &bytes, &admission.digest)?;
    installation_store(app)?
        .record_admitted_with_dependencies(
            AdmittedPluginIdentity {
                plugin_id: &admission.report.plugin_id,
                repository: &admission.repository,
                version: &admission.version,
                package_digest: &admission.digest,
                content_digest: &admission.report.content_digest,
            },
            now_ms(),
            source.built_in,
            admission.report.management_manifest.dependencies.clone(),
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn ensure_bundled_plugins(
    app: &tauri::AppHandle,
) -> Result<PluginInstallationSnapshot, String> {
    let root = marketplace_root(app)?;
    match bundled::ensure_bundled_packages(&root, BUNDLED_ANDROID_PACKAGE, BUNDLED_LSP_PACKAGE) {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => {
            let snapshot = PluginInstallationStore::open(root.join("installation-state"))
                .map_err(|error| error.to_string())?
                .snapshot()
                .map_err(|error| error.to_string())?;
            for plugin in snapshot.plugins.iter().filter(|plugin| plugin.enabled) {
                asterlyn_plugin_marketplace::ensure_enabled_dependencies(
                    &snapshot.plugins,
                    &plugin.plugin_id,
                )
                .map_err(|error| error.to_string())?;
            }
            app.state::<crate::application::DiagnosticsLog>().record(
                "warn",
                "plugins",
                "bundle.upgrade.deferred",
                None,
                serde_json::json!({"reason":error.chars().take(512).collect::<String>()}),
            );
            Ok(snapshot)
        }
    }
}

#[cfg(test)]
fn ensure_bundled_android_package(
    marketplace_root: &std::path::Path,
    bytes: &[u8],
) -> Result<PluginInstallationSnapshot, String> {
    bundled::ensure_bundled_android_package(marketplace_root, bytes)
}

#[cfg(test)]
fn ensure_bundled_lsp_package(
    marketplace_root: &std::path::Path,
    bytes: &[u8],
) -> Result<PluginInstallationSnapshot, String> {
    bundled::ensure_bundled_lsp_package(marketplace_root, bytes)
}

fn review_from(admission: &PendingPluginAdmission) -> PluginPackageAdmissionReview {
    PluginPackageAdmissionReview {
        review_token: admission.token.clone(),
        repository: admission.repository.clone(),
        source_generation: admission.source_generation,
        asset_name: admission.asset_name.clone(),
        asset_size_bytes: admission.asset_size_bytes,
        digest: admission.digest.clone(),
        plugin_id: admission.report.plugin_id.clone(),
        version: admission.version.clone(),
        license_expression: admission.report.license_expression.clone(),
        capabilities: admission.report.capabilities.clone(),
        permissions: admission.report.permissions.clone(),
        host_operations: admission
            .report
            .management_manifest
            .host_operations
            .iter()
            .map(|operation| operation.id.clone())
            .collect(),
        enabled_after_install: false,
        expanded_bytes: admission.report.expanded_bytes,
    }
}

pub(crate) fn admission_context<'a>(repository: &'a str, version: &'a str) -> AdmissionContext<'a> {
    AdmissionContext {
        repository,
        release_version: version,
        host_version: env!("CARGO_PKG_VERSION"),
        sdk_major: 1,
        runtime_protocol: 1,
        supported_capabilities: SUPPORTED_CAPABILITIES,
        supported_permissions: SUPPORTED_PERMISSIONS,
    }
}

fn store(app: &tauri::AppHandle) -> Result<PluginSourceStore, String> {
    PluginSourceStore::open(marketplace_root(app)?).map_err(|error| error.to_string())
}

pub(crate) fn installation_store(
    app: &tauri::AppHandle,
) -> Result<PluginInstallationStore, String> {
    PluginInstallationStore::open(marketplace_root(app)?.join("installation-state"))
        .map_err(|error| error.to_string())
}

pub(crate) fn marketplace_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("resolve plugin marketplace location: {error}"))?
        .join("plugin-marketplace-v1"))
}

pub(crate) fn installed_package_root(
    app: &tauri::AppHandle,
    plugin_id: &str,
    version: &str,
    package_digest: &str,
) -> Result<std::path::PathBuf, String> {
    let digest = package_digest
        .strip_prefix("sha256:")
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "installed plugin digest is invalid".to_owned())?;
    Ok(marketplace_root(app)?
        .join("packages")
        .join(plugin_id)
        .join(version)
        .join(digest))
}

pub(crate) fn installed_package_archive(
    app: &tauri::AppHandle,
    plugin_id: &str,
    version: &str,
    package_digest: &str,
) -> Result<std::path::PathBuf, String> {
    let root = installed_package_root(app, plugin_id, version, package_digest)?;
    let digest = root
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "installed plugin digest is invalid".to_owned())?;
    Ok(root.with_file_name(format!("{digest}.asterlyn-plugin.tgz")))
}

pub(crate) fn verify_installed_package_archive(
    app: &tauri::AppHandle,
    plugin_id: &str,
    version: &str,
    package_digest: &str,
) -> Result<(), String> {
    let archive = installed_package_archive(app, plugin_id, version, package_digest)?;
    verify_installed_package_archive_path(&archive, package_digest)
}

fn retain_package_archive(
    path: &std::path::Path,
    bytes: &[u8],
    digest: &str,
) -> Result<(), String> {
    if path.exists() {
        let retained =
            fs::read(path).map_err(|error| format!("read retained plugin archive: {error}"))?;
        if format!("sha256:{:x}", Sha256::digest(&retained)) != digest {
            return Err("retained plugin archive does not match its admitted digest".into());
        }
        return Ok(());
    }
    let temporary = path.with_extension(format!("tgz.staging-{}", now_ms()));
    fs::write(&temporary, bytes).map_err(|error| format!("retain plugin archive: {error}"))?;
    set_read_only(&temporary)?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("publish retained plugin archive: {error}")
    })
}

fn seal_package_tree(root: &std::path::Path) -> Result<(), String> {
    seal_package_tree_contents(root)?;
    set_read_only(root)
}

fn seal_package_tree_contents(root: &std::path::Path) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(|error| format!("seal plugin package: {error}"))? {
        let path = entry
            .map_err(|error| format!("seal plugin package: {error}"))?
            .path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|error| format!("seal plugin package: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("plugin package sealing rejected a symbolic link".into());
        }
        if metadata.is_dir() {
            seal_package_tree(&path)?;
        } else if metadata.is_file() {
            set_read_only(&path)?;
        } else {
            return Err("plugin package sealing rejected an unsupported entry".into());
        }
    }
    Ok(())
}

fn publish_sealed_package_tree(
    temporary: &std::path::Path,
    destination: &std::path::Path,
    label: &str,
) -> Result<(), String> {
    seal_package_tree_contents(temporary)?;
    fs::rename(temporary, destination).map_err(|error| {
        let _ = remove_marketplace_entry(temporary);
        format!("publish {label}: {error}")
    })?;
    if let Err(error) = set_read_only(destination) {
        let _ = remove_marketplace_entry(destination);
        return Err(error);
    }
    Ok(())
}

fn set_read_only(path: &std::path::Path) -> Result<(), String> {
    let mut permissions = fs::metadata(path)
        .map_err(|error| format!("inspect plugin package permissions: {error}"))?
        .permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("seal plugin package permissions: {error}"))
}

pub(crate) fn recover_interrupted_plugin_activations(
    app: &tauri::AppHandle,
) -> Result<PluginInstallationSnapshot, String> {
    let store = installation_store(app)?;
    store
        .recover_interrupted_activations()
        .map_err(|error| error.to_string())?;
    let pruned = store
        .prune_retained_versions(now_ms())
        .map_err(|error| error.to_string())?;
    cleanup_marketplace_storage(&marketplace_root(app)?, &pruned)?;
    Ok(pruned)
}

pub(crate) fn abandon_plugin_activations(
    app: &tauri::AppHandle,
) -> Result<PluginInstallationSnapshot, String> {
    installation_store(app)?
        .abandon_all_activations()
        .map_err(|error| error.to_string())
}

fn discover_release(source: &PluginSource) -> PluginSourceCatalog {
    resolve_release_result(source, request_latest_release(source))
}

fn resolve_release_result(
    source: &PluginSource,
    response: Result<HttpReleaseResponse, String>,
) -> PluginSourceCatalog {
    match response {
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
        asset_download_url: None,
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
        && catalog.asset_download_url.is_some()
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

#[cfg(test)]
#[path = "plugin_marketplace_repair_tests.rs"]
mod repair_tests;

#[cfg(test)]
#[path = "plugin_marketplace/tests.rs"]
mod tests;

#[cfg(test)]
#[path = "plugin_marketplace/startup_upgrade_tests.rs"]
mod startup_upgrade_tests;
