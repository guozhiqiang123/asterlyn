//! Native path adapter; approval state and policy belong to the language core.
use std::path::PathBuf;
use tauri::Manager;
pub(crate) fn app_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|root| root.join("language-service-consent-v1.json"))
        .map_err(|_| "language approval directory unavailable".into())
}
