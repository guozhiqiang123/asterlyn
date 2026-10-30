use super::*;
use crate::application::{ActiveWorkspaces, DiagnosticsLog, LanguageServiceManager};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageWorkspaceState {
    startup_profiles: Vec<LanguageStartupProfile>,
    debug_tracing: bool,
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
    active
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
