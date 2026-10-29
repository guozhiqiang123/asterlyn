use super::*;

pub(super) const BUNDLED_ANDROID_PLUGIN_ID: &str = "dev.asterlyn.android-gradle";
pub(super) const BUNDLED_ANDROID_PLUGIN_VERSION: &str = "0.6.2";
pub(super) const BUNDLED_ANDROID_PACKAGE_DIGEST: &str =
    "sha256:1f04f3da4fd8c58b5a14a94a354614a190791aea212f63b3aa50cf30afffe2c7";
pub(super) const BUNDLED_ANDROID_PACKAGE: &[u8] = include_bytes!(
    "../../../resources/plugins/asterlyn-plugin-android-gradle-0.6.2.asterlyn-plugin.tgz"
);
pub(super) const BUNDLED_LSP_PLUGIN_ID: &str = "dev.asterlyn.lsp";
pub(super) const BUNDLED_LSP_PLUGIN_VERSION: &str = "0.3.6";
pub(super) const BUNDLED_LSP_REPOSITORY: &str = "guozhiqiang123/asterlyn-plugin-lsp";
pub(super) const BUNDLED_LSP_PACKAGE_DIGEST: &str =
    "sha256:03596cc16c0063daca7d87f3b2509f6b1816ae7025ec73db515c803a27dbcada";
pub(super) const BUNDLED_LSP_PACKAGE: &[u8] =
    include_bytes!("../../../resources/plugins/asterlyn-plugin-lsp-0.3.6.asterlyn-plugin.tgz");

#[cfg(test)]
pub(super) fn ensure_bundled_android_package(
    marketplace_root: &std::path::Path,
    bytes: &[u8],
) -> Result<PluginInstallationSnapshot, String> {
    ensure_bundled_package(
        marketplace_root,
        bytes,
        BUNDLED_ANDROID_PLUGIN_ID,
        BUNDLED_ANDROID_PLUGIN_VERSION,
        BUILT_IN_ANDROID_REPOSITORY,
        BUNDLED_ANDROID_PACKAGE_DIGEST,
        "Android",
        true,
    )
}

#[cfg(test)]
pub(super) fn ensure_bundled_lsp_package(
    marketplace_root: &std::path::Path,
    bytes: &[u8],
) -> Result<PluginInstallationSnapshot, String> {
    ensure_bundled_package(
        marketplace_root,
        bytes,
        BUNDLED_LSP_PLUGIN_ID,
        BUNDLED_LSP_PLUGIN_VERSION,
        BUNDLED_LSP_REPOSITORY,
        BUNDLED_LSP_PACKAGE_DIGEST,
        "LSP",
        true,
    )
}

pub(super) fn ensure_bundled_packages(
    marketplace_root: &std::path::Path,
    android_bytes: &[u8],
    lsp_bytes: &[u8],
) -> Result<PluginInstallationSnapshot, String> {
    ensure_bundled_package(
        marketplace_root,
        android_bytes,
        BUNDLED_ANDROID_PLUGIN_ID,
        BUNDLED_ANDROID_PLUGIN_VERSION,
        BUILT_IN_ANDROID_REPOSITORY,
        BUNDLED_ANDROID_PACKAGE_DIGEST,
        "Android",
        false,
    )?;
    ensure_bundled_package(
        marketplace_root,
        lsp_bytes,
        BUNDLED_LSP_PLUGIN_ID,
        BUNDLED_LSP_PLUGIN_VERSION,
        BUNDLED_LSP_REPOSITORY,
        BUNDLED_LSP_PACKAGE_DIGEST,
        "LSP",
        false,
    )?;
    let android = inspect_package(
        android_bytes,
        &admission_context(BUILT_IN_ANDROID_REPOSITORY, BUNDLED_ANDROID_PLUGIN_VERSION),
    )
    .map_err(|e| e.to_string())?;
    let lsp = inspect_package(
        lsp_bytes,
        &admission_context(BUNDLED_LSP_REPOSITORY, BUNDLED_LSP_PLUGIN_VERSION),
    )
    .map_err(|e| e.to_string())?;
    PluginInstallationStore::open(marketplace_root.join("installation-state"))
        .map_err(|e| e.to_string())?
        .record_bundled_startup_batch(
            vec![
                (
                    AdmittedPluginIdentity {
                        plugin_id: BUNDLED_ANDROID_PLUGIN_ID,
                        repository: BUILT_IN_ANDROID_REPOSITORY,
                        version: BUNDLED_ANDROID_PLUGIN_VERSION,
                        package_digest: BUNDLED_ANDROID_PACKAGE_DIGEST,
                        content_digest: &android.content_digest,
                    },
                    android.management_manifest.dependencies.clone(),
                ),
                (
                    AdmittedPluginIdentity {
                        plugin_id: BUNDLED_LSP_PLUGIN_ID,
                        repository: BUNDLED_LSP_REPOSITORY,
                        version: BUNDLED_LSP_PLUGIN_VERSION,
                        package_digest: BUNDLED_LSP_PACKAGE_DIGEST,
                        content_digest: &lsp.content_digest,
                    },
                    lsp.management_manifest.dependencies.clone(),
                ),
            ],
            now_ms(),
        )
        .map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
fn ensure_bundled_package(
    marketplace_root: &std::path::Path,
    bytes: &[u8],
    expected_plugin_id: &str,
    expected_version: &str,
    repository: &str,
    expected_digest: &str,
    label: &str,
    record: bool,
) -> Result<PluginInstallationSnapshot, String> {
    let package_digest = format!("sha256:{:x}", Sha256::digest(bytes));
    if package_digest != expected_digest {
        return Err(format!(
            "bundled {label} plugin package does not match the host-pinned digest"
        ));
    }
    let context = admission_context(repository, expected_version);
    let report = inspect_package(bytes, &context).map_err(|error| error.to_string())?;
    if report.plugin_id != expected_plugin_id || report.plugin_version != expected_version {
        return Err(format!(
            "bundled {label} plugin identity does not match the host binding"
        ));
    }
    validate_external_tool_authority(
        PluginToolAuthorityIdentity {
            repository,
            plugin_id: &report.plugin_id,
            plugin_version: &report.plugin_version,
            package_digest: &package_digest,
        },
        report.management_manifest.schema_version,
        &report.management_manifest.host_operations,
        &report.management_manifest.process_queries,
        &report.management_manifest.tool_operations,
    )?;
    let digest_key = package_digest
        .strip_prefix("sha256:")
        .expect("computed package digest has a prefix");
    let package_root = marketplace_root
        .join("packages")
        .join(expected_plugin_id)
        .join(expected_version)
        .join(digest_key);
    let installed_is_valid = package_root.exists()
        && inspect_extracted_package(&package_root, &context)
            .is_ok_and(|installed| installed.content_digest == report.content_digest);
    if package_root.exists() && !installed_is_valid {
        remove_marketplace_entry(&package_root)?;
    }
    if !package_root.exists() {
        fs::create_dir_all(
            package_root
                .parent()
                .ok_or("invalid bundled plugin storage path")?,
        )
        .map_err(|error| format!("create bundled plugin storage: {error}"))?;
        let temporary = package_root.with_extension(format!("bundled-staging-{}", now_ms()));
        extract_admitted_package(bytes, &context, &temporary).map_err(|error| error.to_string())?;
        publish_sealed_package_tree(&temporary, &package_root, "bundled plugin package")?;
    } else {
        seal_package_tree(&package_root)?;
    }
    let archive = package_root.with_file_name(format!("{digest_key}.asterlyn-plugin.tgz"));
    if archive.exists() {
        let retained =
            fs::read(&archive).map_err(|error| format!("read bundled plugin archive: {error}"))?;
        if format!("sha256:{:x}", Sha256::digest(&retained)) != package_digest {
            remove_marketplace_entry(&archive)?;
        }
    }
    retain_package_archive(&archive, bytes, &package_digest)?;
    if !record {
        return PluginInstallationStore::open(marketplace_root.join("installation-state"))
            .map_err(|error| error.to_string())?
            .snapshot()
            .map_err(|error| error.to_string());
    }
    PluginInstallationStore::open(marketplace_root.join("installation-state"))
        .map_err(|error| error.to_string())?
        .record_bundled_with_dependencies(
            AdmittedPluginIdentity {
                plugin_id: expected_plugin_id,
                repository,
                version: expected_version,
                package_digest: &package_digest,
                content_digest: &report.content_digest,
            },
            now_ms(),
            report.management_manifest.dependencies.clone(),
        )
        .map_err(|error| error.to_string())
}
