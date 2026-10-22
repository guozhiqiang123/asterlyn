use std::fs;
use std::path::Path;

use asterlyn_plugin_package::{AdmissionReport, inspect_extracted_package};
use sha2::{Digest, Sha256};

use super::plugin_marketplace::{
    admission_context, installed_package_archive, installed_package_root,
};

pub(super) fn inspect_verified_installed_package(
    app: &tauri::AppHandle,
    plugin_id: &str,
    repository: &str,
    version: &str,
    package_digest: &str,
    content_digest: Option<&str>,
) -> Result<AdmissionReport, String> {
    let root = installed_package_root(app, plugin_id, version, package_digest)?;
    let archive = installed_package_archive(app, plugin_id, version, package_digest)?;
    inspect_verified_installed_package_files(
        &root,
        &archive,
        plugin_id,
        repository,
        version,
        package_digest,
        content_digest,
    )
}

pub(super) fn verify_installed_package_archive_path(
    archive: &Path,
    package_digest: &str,
) -> Result<(), String> {
    let bytes =
        fs::read(archive).map_err(|error| format!("read retained plugin archive: {error}"))?;
    if format!("sha256:{:x}", Sha256::digest(&bytes)) == package_digest {
        Ok(())
    } else {
        Err("retained plugin archive does not match its admitted digest".into())
    }
}

pub(super) fn inspect_verified_installed_package_files(
    root: &Path,
    archive: &Path,
    plugin_id: &str,
    repository: &str,
    version: &str,
    package_digest: &str,
    content_digest: Option<&str>,
) -> Result<AdmissionReport, String> {
    verify_installed_package_archive_path(archive, package_digest)?;
    let expected_content_digest = content_digest.ok_or_else(|| {
        "installed plugin predates immutable content binding; reinstall it".to_owned()
    })?;
    let report = inspect_extracted_package(root, &admission_context(repository, version))
        .map_err(|error| error.to_string())?;
    if report.plugin_id != plugin_id || report.plugin_version != version {
        return Err("installed plugin identity changed after admission".to_owned());
    }
    if report.content_digest != expected_content_digest {
        return Err(
            "installed plugin content is not bound to its admitted package; reinstall it"
                .to_owned(),
        );
    }
    Ok(report)
}
