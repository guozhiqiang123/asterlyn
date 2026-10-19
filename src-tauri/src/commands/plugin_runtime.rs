use asterlyn_plugin_marketplace::{PluginInstallationSnapshot, PluginRuntimeStatus};
use asterlyn_plugin_package::inspect_extracted_package;
use asterlyn_plugin_runtime::{
    ActivatedPlugin, PluginActivation, PluginDiagnostics, PluginHostSupervisor,
    PluginRuntimeIdentity,
};
use asterlyn_plugin_runtime_protocol::{HostTheme, ShutdownReason};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use tauri::{State, WebviewWindow};

use crate::application::ActiveWorkspaces;
use crate::commands::plugin_marketplace::{
    admission_context, installation_store, installed_package_root,
};

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPluginActivation {
    plugin_id: String,
    plugin_version: String,
    package_digest: String,
    session_id: String,
    contributions: Vec<asterlyn_plugin_runtime_protocol::RuntimeContribution>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn activate_installed_plugin_runtime(
    plugin_id: String,
    workspace_root: String,
    workspace_generation: u64,
    evidence: JsonValue,
    locale: String,
    theme: String,
    window: WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<InstalledPluginActivation, String> {
    if workspace_generation == 0 {
        return Err("workspace generation must be greater than zero".to_owned());
    }
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|error| error.to_string())?;
    let snapshot = installation_store(&app)?
        .snapshot()
        .map_err(|error| error.to_string())?;
    let selection = select_installed_plugin(&snapshot, &plugin_id)?;
    let plugin_root = installed_package_root(
        &app,
        &plugin_id,
        &selection.version,
        &selection.package_digest,
    )?;
    let workspace_id = format!(
        "workspace-{:x}",
        Sha256::digest(format!("{}\0{}", root.display(), workspace_generation).as_bytes())
    );
    let owner = window.label().to_owned();
    let supervisor = supervisor.inner().clone();
    let selected_plugin_id = plugin_id.clone();
    let selected_version = selection.version.clone();
    let selected_digest = selection.package_digest.clone();
    let selected_repository = selection.repository.clone();
    let activated =
        tauri::async_runtime::spawn_blocking(move || -> Result<ActivatedPlugin, String> {
            let context = admission_context(&selected_repository, &selected_version);
            let report = inspect_extracted_package(&plugin_root, &context).map_err(|error| {
                format!("installed plugin failed activation verification: {error}")
            })?;
            if report.plugin_id != selected_plugin_id || report.plugin_version != selected_version {
                return Err("installed plugin identity changed after admission".to_owned());
            }
            supervisor
                .activate(PluginActivation {
                    owner,
                    plugin_root,
                    identity: PluginRuntimeIdentity {
                        plugin_id: selected_plugin_id,
                        plugin_version: selected_version,
                        package_digest: selected_digest,
                        runtime_entry: report.runtime_entry,
                    },
                    capabilities: report.capabilities,
                    permissions: report.permissions,
                    workspace_id,
                    workspace_generation,
                    workspace_root: root.to_string_lossy().into_owned(),
                    evidence,
                    locale,
                    theme: parse_theme(&theme).map_err(|error| error.to_string())?,
                })
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| format!("plugin activation worker could not complete: {error}"))??;
    Ok(project_activation(
        plugin_id,
        selection.version,
        selection.package_digest,
        activated,
    ))
}

#[tauri::command]
pub(crate) async fn invoke_installed_plugin_callback(
    plugin_id: String,
    callback_handle: String,
    operation: String,
    payload: JsonValue,
    window: WebviewWindow,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<JsonValue, String> {
    let owner = window.label().to_owned();
    let supervisor = supervisor.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        supervisor.invoke(&owner, &plugin_id, &callback_handle, &operation, payload)
    })
    .await
    .map_err(|error| format!("plugin callback worker could not complete: {error}"))?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn deactivate_installed_plugin_runtime(
    plugin_id: String,
    window: WebviewWindow,
    supervisor: State<'_, PluginHostSupervisor>,
) {
    supervisor.stop_plugin(
        window.label(),
        &plugin_id,
        ShutdownReason::WorkspaceReplaced,
    );
}

#[tauri::command]
pub(crate) fn read_installed_plugin_runtime_diagnostics(
    plugin_id: String,
    window: WebviewWindow,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<PluginDiagnostics, String> {
    supervisor
        .diagnostics(window.label(), &plugin_id)
        .map_err(|error| error.to_string())
}

#[derive(Debug)]
struct InstalledPluginSelection {
    repository: String,
    version: String,
    package_digest: String,
}

fn select_installed_plugin(
    snapshot: &PluginInstallationSnapshot,
    plugin_id: &str,
) -> Result<InstalledPluginSelection, String> {
    let plugin = snapshot
        .plugins
        .iter()
        .find(|plugin| plugin.plugin_id == plugin_id)
        .ok_or_else(|| "installed plugin was not found".to_owned())?;
    if !plugin.enabled {
        return Err("installed plugin is disabled".to_owned());
    }
    let selected = plugin
        .pending_version
        .as_deref()
        .or(plugin.active_version.as_deref())
        .ok_or_else(|| "installed plugin has no activatable version".to_owned())?;
    let version = plugin
        .versions
        .iter()
        .find(|version| version.version == selected)
        .ok_or_else(|| "installed plugin version metadata is missing".to_owned())?;
    if version.runtime_status == PluginRuntimeStatus::Quarantined {
        return Err("installed plugin version is quarantined".to_owned());
    }
    Ok(InstalledPluginSelection {
        repository: plugin.repository.clone(),
        version: version.version.clone(),
        package_digest: version.package_digest.clone(),
    })
}

fn parse_theme(value: &str) -> Result<HostTheme, asterlyn_plugin_runtime::PluginRuntimeError> {
    match value {
        "light" => Ok(HostTheme::Light),
        "dark" => Ok(HostTheme::Dark),
        "highContrast" => Ok(HostTheme::HighContrast),
        _ => Err(
            asterlyn_plugin_runtime::PluginRuntimeError::InvalidConfiguration(
                "unsupported host theme".to_owned(),
            ),
        ),
    }
}

fn project_activation(
    plugin_id: String,
    plugin_version: String,
    package_digest: String,
    activated: ActivatedPlugin,
) -> InstalledPluginActivation {
    InstalledPluginActivation {
        plugin_id,
        plugin_version,
        package_digest,
        session_id: activated.session_id,
        contributions: activated.contributions,
    }
}

#[cfg(test)]
mod tests {
    use asterlyn_plugin_marketplace::{AdmittedPluginVersion, InstalledPlugin};

    use super::*;

    fn snapshot(enabled: bool, status: PluginRuntimeStatus) -> PluginInstallationSnapshot {
        PluginInstallationSnapshot {
            schema_version: 1,
            generation: 1,
            recovered: false,
            plugins: vec![InstalledPlugin {
                plugin_id: "dev.asterlyn.fixture".to_owned(),
                repository: "asterlyn/fixture".to_owned(),
                enabled,
                bundled_fallback: true,
                active_version: None,
                known_good_version: None,
                pending_version: Some("1.0.0".to_owned()),
                versions: vec![AdmittedPluginVersion {
                    version: "1.0.0".to_owned(),
                    package_digest: format!("sha256:{}", "a".repeat(64)),
                    admitted_at_epoch_ms: 1,
                    runtime_status: status,
                }],
            }],
        }
    }

    #[test]
    fn selects_pending_admitted_version_without_promoting_it() {
        let selected = select_installed_plugin(
            &snapshot(true, PluginRuntimeStatus::PendingRuntime),
            "dev.asterlyn.fixture",
        )
        .expect("pending version can be activation-tested");
        assert_eq!(selected.version, "1.0.0");
    }

    #[test]
    fn rejects_disabled_and_quarantined_installations() {
        assert!(
            select_installed_plugin(
                &snapshot(false, PluginRuntimeStatus::PendingRuntime),
                "dev.asterlyn.fixture",
            )
            .unwrap_err()
            .contains("disabled")
        );
        assert!(
            select_installed_plugin(
                &snapshot(true, PluginRuntimeStatus::Quarantined),
                "dev.asterlyn.fixture",
            )
            .unwrap_err()
            .contains("quarantined")
        );
    }
}
