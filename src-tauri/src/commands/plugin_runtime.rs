use asterlyn_plugin_marketplace::{PluginInstallationSnapshot, PluginRuntimeStatus};
use asterlyn_plugin_package::inspect_extracted_package;
use asterlyn_plugin_runtime::{
    ActivatedPlugin, PluginActivation, PluginDiagnostics, PluginHostSupervisor,
    PluginRuntimeIdentity,
};
use asterlyn_plugin_runtime_protocol::{HostTheme, ShutdownReason};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, State, WebviewWindow};

use crate::application::{
    ActiveWorkspaces, DiagnosticsLog, PluginMarketplaceCoordinator, PluginProcessQueryManager,
    PluginToolAuthorityIdentity, diagnostics::with_trace,
};
use crate::commands::plugin_marketplace::{
    admission_context, installation_store, installed_package_root, verify_installed_package_archive,
};

const PLUGIN_RUNTIME_EVENT: &str = "asterlyn://plugin-runtime-event";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPluginRuntimeEvent {
    plugin_id: String,
    subscription_handle: String,
    payload: JsonValue,
}

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
    diagnostic_trace_id: Option<String>,
    window: WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    process_queries: State<'_, PluginProcessQueryManager>,
    supervisor: State<'_, PluginHostSupervisor>,
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<InstalledPluginActivation, String> {
    let trace_id = diagnostics.command_trace(diagnostic_trace_id.as_deref(), "plugin-activation");
    let mut operation_log = diagnostics.operation(
        "plugin.runtime",
        "activation",
        trace_id.clone(),
        serde_json::json!({
            "pluginId": &plugin_id,
            "window": window.label(),
            "workspaceGeneration": workspace_generation,
            "workspaceHash": diagnostics.hash_identifier(&workspace_root),
            "evidenceBytes": json_bytes(&evidence),
        }),
    );
    let result = async {
        if workspace_generation == 0 {
            return Err("workspace generation must be greater than zero".to_owned());
        }
        let root = active
            .resolve(window.label(), &workspace_root)
            .map_err(|error| error.to_string())?;
        let (selection, plugin_root) = marketplace.run(|| {
            let store = installation_store(&app)?;
            let snapshot = store.snapshot().map_err(|error| error.to_string())?;
            let selection = select_installed_plugin(&snapshot, &plugin_id)?;
            let plugin_root = installed_package_root(
                &app,
                &plugin_id,
                &selection.version,
                &selection.package_digest,
            )?;
            verify_installed_package_archive(
                &app,
                &plugin_id,
                &selection.version,
                &selection.package_digest,
            )?;
            store
                .begin_activation(&plugin_id, &selection.version, &selection.package_digest)
                .map_err(|error| error.to_string())?;
            Ok((selection, plugin_root))
        })?;
        let workspace_id = format!(
            "workspace-{:x}",
            Sha256::digest(format!("{}\0{}", root.display(), workspace_generation).as_bytes())
        );
        let owner = window.label().to_owned();
        let supervisor = supervisor.inner().clone();
        let process_queries = process_queries.inner().clone();
        let selected_plugin_id = plugin_id.clone();
        let selected_version = selection.version.clone();
        let selected_digest = selection.package_digest.clone();
        let selected_content_digest = selection.content_digest.clone();
        let selected_repository = selection.repository.clone();
        let activation_trace = trace_id.clone();
        let activation_result =
            tauri::async_runtime::spawn_blocking(move || -> Result<ActivatedPlugin, String> {
                with_trace(&activation_trace, || {
                    let context = admission_context(&selected_repository, &selected_version);
                    let report =
                        inspect_extracted_package(&plugin_root, &context).map_err(|error| {
                            format!("installed plugin failed activation verification: {error}")
                        })?;
                    if report.plugin_id != selected_plugin_id
                        || report.plugin_version != selected_version
                    {
                        return Err("installed plugin identity changed after admission".to_owned());
                    }
                    if report.content_digest != selected_content_digest {
                        return Err(
                        "installed plugin content changed after admission; reinstall the plugin"
                            .to_owned(),
                    );
                    }
                    process_queries.admit_authority(
                        &owner,
                        PluginToolAuthorityIdentity {
                            repository: &selected_repository,
                            plugin_id: &selected_plugin_id,
                            plugin_version: &selected_version,
                            package_digest: &selected_digest,
                        },
                        report.management_manifest.schema_version,
                        &report.management_manifest.host_operations,
                        &report.management_manifest.process_queries,
                        &report.management_manifest.tool_operations,
                    )?;
                    let activation = supervisor
                        .activate(PluginActivation {
                            owner: owner.clone(),
                            plugin_root,
                            identity: PluginRuntimeIdentity {
                                plugin_id: selected_plugin_id.clone(),
                                plugin_version: selected_version.clone(),
                                package_digest: selected_digest.clone(),
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
                        .map_err(|error| error.to_string());
                    if activation.is_err() {
                        process_queries.revoke_authority(&owner, &selected_plugin_id);
                    }
                    activation
                })
            })
            .await
            .map_err(|error| format!("plugin activation worker could not complete: {error}"))
            .and_then(|result| result);
        let activated = match activation_result {
            Ok(activated) => activated,
            Err(error) => {
                let _ = marketplace.run(|| {
                    installation_store(&app)?
                        .mark_activation_failed(
                            &plugin_id,
                            &selection.version,
                            &selection.package_digest,
                        )
                        .map(|_| ())
                        .map_err(|failure| failure.to_string())
                });
                return Err(error);
            }
        };
        Ok(project_activation(
            plugin_id,
            selection.version,
            selection.package_digest,
            activated,
        ))
    }
    .await;
    let summary = result
        .as_ref()
        .map(|activated| {
            serde_json::json!({
                "pluginVersion": activated.plugin_version, "sessionId": activated.session_id,
                "contributionCount": activated.contributions.len(),
            })
        })
        .unwrap_or_else(|_| serde_json::json!({}));
    operation_log.finish(result.as_ref().map(|_| ()).map_err(String::as_str), summary);
    result
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn confirm_installed_plugin_runtime_healthy(
    plugin_id: String,
    plugin_version: String,
    package_digest: String,
    session_id: String,
    window: WebviewWindow,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<PluginInstallationSnapshot, String> {
    supervisor
        .assert_active_session(
            window.label(),
            &plugin_id,
            &plugin_version,
            &package_digest,
            &session_id,
        )
        .map_err(|error| error.to_string())?;
    marketplace.run(|| {
        installation_store(&app)?
            .promote_healthy(&plugin_id, &plugin_version, &package_digest)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn fail_installed_plugin_runtime_activation(
    plugin_id: String,
    plugin_version: String,
    package_digest: String,
    session_id: String,
    window: WebviewWindow,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    process_queries: State<'_, PluginProcessQueryManager>,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<PluginInstallationSnapshot, String> {
    if supervisor
        .assert_active_session(
            window.label(),
            &plugin_id,
            &plugin_version,
            &package_digest,
            &session_id,
        )
        .is_ok()
    {
        supervisor.stop_plugin(
            window.label(),
            &plugin_id,
            ShutdownReason::ProtocolViolation,
        );
    } else {
        supervisor
            .consume_termination(
                window.label(),
                &plugin_id,
                &plugin_version,
                &package_digest,
                &session_id,
            )
            .map_err(|error| error.to_string())?;
    }
    process_queries.revoke_authority(window.label(), &plugin_id);
    marketplace.run(|| {
        installation_store(&app)?
            .mark_activation_failed(&plugin_id, &plugin_version, &package_digest)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn abandon_installed_plugin_runtime_activation(
    plugin_id: String,
    plugin_version: String,
    package_digest: String,
    session_id: String,
    window: WebviewWindow,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    process_queries: State<'_, PluginProcessQueryManager>,
    supervisor: State<'_, PluginHostSupervisor>,
) -> Result<PluginInstallationSnapshot, String> {
    supervisor
        .assert_active_session(
            window.label(),
            &plugin_id,
            &plugin_version,
            &package_digest,
            &session_id,
        )
        .map_err(|error| error.to_string())?;
    process_queries.revoke_authority(window.label(), &plugin_id);
    marketplace.run(|| {
        installation_store(&app)?
            .abandon_activation(&plugin_id, &plugin_version, &package_digest)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
// Tauri injects window/runtime state alongside the stable callback arguments.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn invoke_installed_plugin_callback(
    plugin_id: String,
    callback_handle: String,
    operation: String,
    payload: JsonValue,
    diagnostic_trace_id: Option<String>,
    window: WebviewWindow,
    app: tauri::AppHandle,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    supervisor: State<'_, PluginHostSupervisor>,
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<JsonValue, String> {
    let trace_id = diagnostics.command_trace(diagnostic_trace_id.as_deref(), "plugin-callback");
    let mut operation_log = diagnostics.operation(
        "plugin.runtime",
        "callback",
        trace_id.clone(),
        serde_json::json!({
            "pluginId": &plugin_id,
            "callbackHandle": &callback_handle,
            "operation": &operation,
            "window": window.label(),
            "payloadBytes": json_bytes(&payload),
        }),
    );
    let result = async {
        marketplace.run(|| {
            installation_store(&app)?
                .ensure_dependencies_available(&plugin_id)
                .map_err(|error| error.to_string())
        })?;
        let owner = window.label().to_owned();
        let supervisor = supervisor.inner().clone();
        let runtime_plugin_id = plugin_id.clone();
        let callback_trace = trace_id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            with_trace(&callback_trace, || {
                supervisor.invoke_with_events(
                    &owner,
                    &runtime_plugin_id,
                    &callback_handle,
                    &operation,
                    payload,
                )
            })
        })
        .await
        .map_err(|error| format!("plugin callback worker could not complete: {error}"))
        .and_then(|result| result.map_err(|error| error.to_string()));
        let invocation = result?;
        let summary = serde_json::json!({
            "resultBytes": json_bytes(&invocation.payload), "eventCount": invocation.events.len(),
            "result": plugin_callback_summary(&invocation.payload),
        });
        for event in invocation.events {
            window
                .emit(
                    PLUGIN_RUNTIME_EVENT,
                    InstalledPluginRuntimeEvent {
                        plugin_id: plugin_id.clone(),
                        subscription_handle: event.subscription_handle,
                        payload: event.payload,
                    },
                )
                .map_err(|error| format!("publish plugin runtime event: {error}"))?;
        }
        Ok::<_, String>((invocation.payload, summary))
    }
    .await;
    let summary = result
        .as_ref()
        .map(|(_, summary)| summary.clone())
        .unwrap_or_else(|_| serde_json::json!({}));
    operation_log.finish(result.as_ref().map(|_| ()).map_err(String::as_str), summary);
    result.map(|(payload, _)| payload)
}

fn json_bytes(value: &JsonValue) -> usize {
    serde_json::to_vec(value).map_or(0, |encoded| encoded.len())
}

fn plugin_callback_summary(value: &JsonValue) -> JsonValue {
    let Some(object) = value.as_object() else {
        return serde_json::json!({ "kind": value_kind(value) });
    };
    let tasks = object
        .get("tasks")
        .and_then(JsonValue::as_array)
        .map(Vec::len);
    let cache = object.get("cache").and_then(JsonValue::as_object);
    serde_json::json!({
        "kind": "object",
        "status": object.get("status").and_then(JsonValue::as_str),
        "taskCount": tasks,
        "unavailableReason": object.get("unavailableReason").and_then(JsonValue::as_str),
        "error": object.get("error").and_then(JsonValue::as_str),
        "cacheStatus": cache.and_then(|value| value.get("status")).and_then(JsonValue::as_str),
        "cacheStaleReason": cache.and_then(|value| value.get("staleReason")).and_then(JsonValue::as_str),
    })
}

fn value_kind(value: &JsonValue) -> &'static str {
    match value {
        JsonValue::Null => "null",
        JsonValue::Bool(_) => "boolean",
        JsonValue::Number(_) => "number",
        JsonValue::String(_) => "string",
        JsonValue::Array(_) => "array",
        JsonValue::Object(_) => "object",
    }
}

#[tauri::command]
pub(crate) fn deactivate_installed_plugin_runtime(
    plugin_id: String,
    window: WebviewWindow,
    process_queries: State<'_, PluginProcessQueryManager>,
    supervisor: State<'_, PluginHostSupervisor>,
) {
    if plugin_id == "dev.asterlyn.lsp" {
        window
            .state::<crate::application::LanguageServiceManager>()
            .cancel_owner(window.label());
    }
    process_queries.cancel_plugin(&plugin_id);
    process_queries.revoke_authority(window.label(), &plugin_id);
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
pub(crate) struct InstalledPluginSelection {
    pub(crate) repository: String,
    pub(crate) version: String,
    pub(crate) package_digest: String,
    pub(crate) content_digest: String,
}

pub(crate) fn select_installed_plugin(
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
    let content_digest = version.content_digest.clone().ok_or_else(|| {
        "installed plugin predates immutable content binding; reinstall it".to_owned()
    })?;
    asterlyn_plugin_marketplace::ensure_enabled_dependencies(&snapshot.plugins, plugin_id)
        .map_err(|error| error.to_string())?;
    Ok(InstalledPluginSelection {
        repository: plugin.repository.clone(),
        version: version.version.clone(),
        package_digest: version.package_digest.clone(),
        content_digest,
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
                required_dependencies: Vec::new(),
                plugin_id: "dev.asterlyn.fixture".to_owned(),
                repository: "asterlyn/fixture".to_owned(),
                enabled,
                bundled_fallback: true,
                active_version: None,
                known_good_version: None,
                pending_version: Some("1.0.0".to_owned()),
                versions: vec![AdmittedPluginVersion {
                    dependencies: Vec::new(),
                    version: "1.0.0".to_owned(),
                    package_digest: format!("sha256:{}", "a".repeat(64)),
                    content_digest: Some(format!("sha256:{}", "b".repeat(64))),
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

    #[test]
    fn rejects_installation_without_admission_content_binding() {
        let mut legacy = snapshot(true, PluginRuntimeStatus::PendingRuntime);
        legacy.plugins[0].versions[0].content_digest = None;
        assert!(
            select_installed_plugin(&legacy, "dev.asterlyn.fixture")
                .unwrap_err()
                .contains("reinstall")
        );
    }
}
