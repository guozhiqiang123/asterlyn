use asterlyn_language_service::management::{ManagedInstallError, ManagementAuthority};
use std::time::Instant;
use tauri::{State, WebviewWindow};

use crate::application::{
    ActiveWorkspaces, ManagedLanguageEnvironment, ManagedLanguageInstallReview,
    ManagedLanguageInstallationState, ManagedLanguageRecipeCatalog, PluginMarketplaceCoordinator,
};

use super::{
    plugin_marketplace::installation_store,
    plugin_marketplace_verification::inspect_verified_installed_package,
    plugin_runtime::select_installed_plugin,
};

#[tauri::command]
pub(crate) fn read_managed_language_environment(
    state: State<'_, ManagedLanguageInstallationState>,
) -> Result<ManagedLanguageEnvironment, ManagedInstallError> {
    state.environment()
}

#[tauri::command]
pub(crate) fn list_managed_language_recipes(
    plugin_id: String,
    window: WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    state: State<'_, ManagedLanguageInstallationState>,
) -> Result<ManagedLanguageRecipeCatalog, ManagedInstallError> {
    let authority = resolve_management_authority(
        &app,
        &active,
        &marketplace,
        window.label(),
        &plugin_id,
        None,
    )?;
    state.recipe_catalog(&authority)
}

#[tauri::command]
// Tauri injects the window and three host-owned state handles beside the bounded request fields.
#[allow(clippy::too_many_arguments)]
pub(crate) fn prepare_managed_language_install(
    plugin_id: String,
    server_id: String,
    recipe_digest: String,
    window: WebviewWindow,
    app: tauri::AppHandle,
    active: State<'_, ActiveWorkspaces>,
    marketplace: State<'_, PluginMarketplaceCoordinator>,
    state: State<'_, ManagedLanguageInstallationState>,
) -> Result<ManagedLanguageInstallReview, ManagedInstallError> {
    let authority = resolve_management_authority(
        &app,
        &active,
        &marketplace,
        window.label(),
        &plugin_id,
        Some(&server_id),
    )?;
    state.prepare_install(&authority, server_id, recipe_digest, Instant::now())
}

fn resolve_management_authority(
    app: &tauri::AppHandle,
    active: &ActiveWorkspaces,
    marketplace: &PluginMarketplaceCoordinator,
    window_label: &str,
    plugin_id: &str,
    declared_server: Option<&str>,
) -> Result<ManagementAuthority, ManagedInstallError> {
    if !management_identifier(plugin_id, 160)
        || declared_server.is_some_and(|server| !management_identifier(server, 128))
    {
        return Err(ManagedInstallError::InvalidRequest);
    }
    let activation = active
        .activation_token(window_label)
        .map_err(|_| ManagedInstallError::PermissionDenied)?;
    let identity = marketplace
        .run(|| {
            let resolved = (|| {
                let snapshot = installation_store(app)
                    .map_err(|_| ManagedInstallError::StorageFailed)?
                    .snapshot()
                    .map_err(|_| ManagedInstallError::StorageFailed)?;
                let selection = select_installed_plugin(&snapshot, plugin_id)
                    .map_err(|_| ManagedInstallError::PermissionDenied)?;
                let report = inspect_verified_installed_package(
                    app,
                    plugin_id,
                    &selection.repository,
                    &selection.version,
                    &selection.package_digest,
                    Some(&selection.content_digest),
                )
                .map_err(|_| ManagedInstallError::IntegrityMismatch)?;
                let catalog = report
                    .management_manifest
                    .language_server_catalog
                    .ok_or(ManagedInstallError::PermissionDenied)?;
                if declared_server.is_some_and(|server| {
                    !catalog
                        .servers
                        .iter()
                        .any(|candidate| candidate.id == server)
                }) {
                    return Err(ManagedInstallError::NotFound);
                }
                Ok::<_, ManagedInstallError>((selection.version, selection.package_digest))
            })();
            Ok::<_, String>(resolved)
        })
        .map_err(|_| ManagedInstallError::StorageFailed)??;
    if active
        .activation_token(window_label)
        .map_err(|_| ManagedInstallError::PermissionDenied)?
        != activation
    {
        return Err(ManagedInstallError::StateChanged);
    }
    Ok(ManagementAuthority {
        window_id: window_label.into(),
        activation,
        plugin_id: plugin_id.into(),
        plugin_version: identity.0,
        package_digest: identity.1,
        enabled: true,
        // Only the first-party Tauri route creates this authority. Static catalog
        // metadata remains unable to invoke management from plugin runtime code.
        may_manage: true,
    })
}

fn management_identifier(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::management_identifier;

    #[test]
    fn management_identity_accepts_only_bounded_catalog_identifiers() {
        assert!(management_identifier("dev.asterlyn.lsp", 160));
        assert!(management_identifier("android-jvm", 128));
        assert!(!management_identifier("Dev.asterlyn.lsp", 160));
        assert!(!management_identifier("dev_asterlyn_lsp", 160));
        assert!(!management_identifier(
            &format!("a{}", "b".repeat(160)),
            160
        ));
    }
}
