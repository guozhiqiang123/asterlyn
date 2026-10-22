use super::*;
use crate::commands::plugin_marketplace_verification::inspect_verified_installed_package_files;

#[test]
fn repair_verification_rejects_archive_or_extracted_content_tampering() {
    let archive_directory = tempfile::tempdir().unwrap();
    let archive_snapshot =
        ensure_bundled_android_package(archive_directory.path(), BUNDLED_ANDROID_PACKAGE).unwrap();
    let archive_plugin = &archive_snapshot.plugins[0];
    let archive_version = &archive_plugin.versions[0];
    let archive_root = installed_test_package_root(
        archive_directory.path(),
        &archive_plugin.plugin_id,
        &archive_version.version,
        &archive_version.package_digest,
    );
    let archive = archive_root.with_file_name(format!(
        "{}.asterlyn-plugin.tgz",
        archive_version.package_digest.trim_start_matches("sha256:")
    ));
    inspect_verified_installed_package_files(
        &archive_root,
        &archive,
        &archive_plugin.plugin_id,
        &archive_plugin.repository,
        &archive_version.version,
        &archive_version.package_digest,
        archive_version.content_digest.as_deref(),
    )
    .unwrap();
    make_test_file_writable(&archive);
    fs::write(&archive, b"tampered archive").unwrap();
    assert!(
        inspect_verified_installed_package_files(
            &archive_root,
            &archive,
            &archive_plugin.plugin_id,
            &archive_plugin.repository,
            &archive_version.version,
            &archive_version.package_digest,
            archive_version.content_digest.as_deref(),
        )
        .unwrap_err()
        .contains("admitted digest")
    );

    let content_directory = tempfile::tempdir().unwrap();
    let content_snapshot =
        ensure_bundled_android_package(content_directory.path(), BUNDLED_ANDROID_PACKAGE).unwrap();
    let content_plugin = &content_snapshot.plugins[0];
    let content_version = &content_plugin.versions[0];
    let content_root = installed_test_package_root(
        content_directory.path(),
        &content_plugin.plugin_id,
        &content_version.version,
        &content_version.package_digest,
    );
    let content_archive = content_root.with_file_name(format!(
        "{}.asterlyn-plugin.tgz",
        content_version.package_digest.trim_start_matches("sha256:")
    ));
    let runtime = content_root.join("runtime/plugin.js");
    make_test_file_writable(&runtime);
    fs::write(&runtime, b"tampered runtime").unwrap();
    let error = inspect_verified_installed_package_files(
        &content_root,
        &content_archive,
        &content_plugin.plugin_id,
        &content_plugin.repository,
        &content_version.version,
        &content_version.package_digest,
        content_version.content_digest.as_deref(),
    )
    .unwrap_err();
    assert!(error.contains("integrity") || error.contains("content"));
}

fn installed_test_package_root(
    marketplace_root: &std::path::Path,
    plugin_id: &str,
    version: &str,
    package_digest: &str,
) -> std::path::PathBuf {
    marketplace_root
        .join("packages")
        .join(plugin_id)
        .join(version)
        .join(package_digest.trim_start_matches("sha256:"))
}

fn make_test_file_writable(path: &std::path::Path) {
    let mut permissions = fs::metadata(path).unwrap().permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(permissions.mode() | 0o200);
    }
    #[cfg(windows)]
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions).unwrap();
}
