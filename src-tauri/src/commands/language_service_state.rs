use super::*;
use crate::application::{ActiveWorkspaces, DiagnosticsLog, LanguageServiceManager};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageWorkspaceState {
    startup_profiles: Vec<LanguageStartupProfile>,
    debug_tracing: bool,
    resources: asterlyn_language_service::application::resources::ResourcePolicy,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LanguageStartupProfile {
    plugin_id: String,
    server_id: String,
}

#[tauri::command]
pub(crate) async fn language_service_workspace_state(
    workspace_root: String,
    app: AppHandle,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
) -> Result<LanguageWorkspaceState, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|_| "workspace is no longer active")?;
    tauri::async_runtime::spawn_blocking(move || {
        let startup_profiles = packaged_analysis::startup_profiles(&app)?
            .into_iter()
            .map(|server_id| LanguageStartupProfile {
                plugin_id: "dev.asterlyn.lsp".into(),
                server_id,
            })
            .collect();
        Ok(LanguageWorkspaceState {
            startup_profiles,
            resources: app.state::<LanguageServiceManager>().resource_policy(
                asterlyn_language_service::application::resources::preference(
                    &resource_store(&app)?,
                    &root,
                )?,
            )?,
            debug_tracing: app.state::<LanguageServiceManager>().debug_enabled(),
        })
    })
    .await
    .map_err(|_| "language workspace inspection failed")?
}
#[tauri::command]
pub(crate) fn set_language_service_debug(
    enabled: bool,
    app: AppHandle,
    manager: State<'_, LanguageServiceManager>,
    diagnostics: State<'_, DiagnosticsLog>,
) -> Result<(), String> {
    manager.set_debug(enabled);
    diagnostics.info(
        "language.debug",
        "trace.changed",
        None,
        serde_json::json!({"enabled":enabled,"scope":"application-session"}),
    );
    app.emit(
        "asterlyn://language-service-debug",
        serde_json::json!({"enabled":enabled}),
    )
    .map_err(|_| "language trace change could not be broadcast".into())
}

pub(super) fn resource_store(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(crate::application::language_consent::app_store_path(app)?
        .with_file_name("language-resource-settings-v1.json"))
}
#[tauri::command]
pub(crate) async fn set_language_service_resources(
    workspace_root: String,
    compiler_max_mib: Option<u32>,
    app: AppHandle,
    window: WebviewWindow,
    active: State<'_, ActiveWorkspaces>,
) -> Result<asterlyn_language_service::application::resources::ResourcePolicy, String> {
    let root = active
        .resolve(window.label(), &workspace_root)
        .map_err(|_| "workspace is no longer active")?;
    tauri::async_runtime::spawn_blocking(move || {
        let policy = app
            .state::<LanguageServiceManager>()
            .resource_policy(compiler_max_mib)?;
        asterlyn_language_service::application::resources::remember(
            &resource_store(&app)?,
            &root,
            compiler_max_mib,
        )?;
        Ok(policy)
    })
    .await
    .map_err(|_| "analysis resource settings failed")?
}
