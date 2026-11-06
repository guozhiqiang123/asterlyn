use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use asterlyn_plugin_marketplace::{PluginInstallationSnapshot, PluginInstallationStore};

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct PluginMarketplaceCleanupReport {
    pub(crate) staging_entries: usize,
    pub(crate) package_entries: usize,
    pub(crate) restored_tombstones: usize,
}

/// Called under the marketplace coordinator and runtime package-use guards.
pub(crate) fn stage_history_package_removal(
    root: &Path,
    store: &PluginInstallationStore,
    id: &str,
    version: &str,
    digest: &str,
) -> Result<(PluginInstallationSnapshot, Option<std::path::PathBuf>), String> {
    store
        .ensure_can_remove_version(id, version, digest)
        .map_err(|e| e.to_string())?;
    let packages = root.join("packages");
    let plugin = packages.join(id);
    let source = plugin.join(version);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "invalid system time")?
        .as_nanos();
    let tombstone = plugin.join(format!(".removing-version-{version}-{nonce}"));
    for parent in [root, packages.as_path(), plugin.as_path()] {
        if path_exists(parent)? && !is_safe_directory(parent)? {
            return Err("plugin package parent is not a safe directory".into());
        }
    }
    let staged = path_exists(&source)?;
    if staged {
        if !is_safe_directory(&source)? || path_exists(&tombstone)? {
            return Err("plugin version is not a safe directory".into());
        }
        fs::rename(&source, &tombstone)
            .map_err(|e| format!("stage historical package removal: {e}"))?;
    }
    match store.remove_version(id, version, digest) {
        Ok(snapshot) => Ok((snapshot, staged.then_some(tombstone))),
        Err(error) => {
            if staged {
                // Index publication can succeed before a directory-sync error. Reconcile first.
                let referenced = store
                    .snapshot()
                    .map_err(|e| e.to_string())?
                    .plugins
                    .iter()
                    .any(|p| p.plugin_id == id && p.versions.iter().any(|v| v.version == version));
                if referenced {
                    fs::rename(&tombstone, &source).map_err(|e| {
                        format!("restore historical package after index failure: {e}")
                    })?;
                }
            }
            Err(error.to_string())
        }
    }
}

pub(crate) fn cleanup_marketplace_storage(
    root: &Path,
    snapshot: &PluginInstallationSnapshot,
) -> Result<PluginMarketplaceCleanupReport, String> {
    let staging_entries = remove_children(&root.join("staging"))?;

    let referenced = snapshot
        .plugins
        .iter()
        .flat_map(|plugin| {
            plugin.versions.iter().map(|version| {
                (
                    plugin.plugin_id.clone(),
                    version.version.clone(),
                    version
                        .package_digest
                        .strip_prefix("sha256:")
                        .expect("installation snapshots contain validated digests")
                        .to_owned(),
                )
            })
        })
        .collect::<BTreeSet<_>>();
    let (package_entries, restored_tombstones) =
        cleanup_packages(&root.join("packages"), &referenced)?;
    Ok(PluginMarketplaceCleanupReport {
        staging_entries,
        package_entries,
        restored_tombstones,
    })
}

fn cleanup_packages(
    packages: &Path,
    referenced: &BTreeSet<(String, String, String)>,
) -> Result<(usize, usize), String> {
    let Some(entries) = read_directory(packages)? else {
        return Ok((0, 0));
    };
    let mut removed = 0;
    let mut restored = 0;
    for entry in entries {
        let path = entry.path();
        let Some(plugin_id) = file_name(&path) else {
            remove_entry(&path)?;
            removed += 1;
            continue;
        };
        if plugin_id.starts_with(".removing-") {
            if let Some(referenced_plugin) = tombstone_plugin_id(&plugin_id, referenced) {
                let plugin_root = packages.join(&referenced_plugin);
                if !path_exists(&plugin_root)? {
                    if !is_safe_directory(&path)? {
                        return Err(format!(
                            "plugin removal tombstone is not a safe directory: {}",
                            path.display()
                        ));
                    }
                    fs::rename(&path, &plugin_root).map_err(|error| {
                        format!(
                            "restore plugin removal tombstone {}: {error}",
                            path.display()
                        )
                    })?;
                    restored += 1;
                    removed +=
                        cleanup_plugin_versions(&plugin_root, &referenced_plugin, referenced)?;
                    remove_empty_directory(&plugin_root)?;
                    continue;
                }
            }
            remove_entry(&path)?;
            removed += 1;
            continue;
        }
        if !referenced
            .iter()
            .any(|(candidate, _, _)| candidate == &plugin_id)
        {
            remove_entry(&path)?;
            removed += 1;
            continue;
        }
        if !is_safe_directory(&path)? {
            remove_entry(&path)?;
            removed += 1;
            continue;
        }
        removed += cleanup_plugin_versions(&path, &plugin_id, referenced)?;
        remove_empty_directory(&path)?;
    }
    Ok((removed, restored))
}

fn tombstone_plugin_id(
    tombstone: &str,
    referenced: &BTreeSet<(String, String, String)>,
) -> Option<String> {
    referenced
        .iter()
        .map(|(plugin_id, _, _)| plugin_id)
        .filter(|plugin_id| tombstone.starts_with(&format!(".removing-{plugin_id}-")))
        .max_by_key(|plugin_id| plugin_id.len())
        .cloned()
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("inspect {}: {error}", path.display())),
    }
}

fn cleanup_plugin_versions(
    plugin_root: &Path,
    plugin_id: &str,
    referenced: &BTreeSet<(String, String, String)>,
) -> Result<usize, String> {
    let Some(entries) = read_directory(plugin_root)? else {
        return Ok(0);
    };
    let mut removed = 0;
    for entry in entries {
        let path = entry.path();
        let Some(version) = file_name(&path) else {
            remove_entry(&path)?;
            removed += 1;
            continue;
        };
        if version.starts_with(".removing-version-") {
            let original = referenced
                .iter()
                .filter(|(p, v, _)| {
                    p == plugin_id && version.starts_with(&format!(".removing-version-{v}-"))
                })
                .map(|(_, v, _)| v)
                .max_by_key(|v| v.len());
            if let Some(original) = original {
                let restored = plugin_root.join(original);
                if !path_exists(&restored)? {
                    if !is_safe_directory(&path)? {
                        return Err("historical package tombstone is not a safe directory".into());
                    }
                    fs::rename(&path, &restored)
                        .map_err(|e| format!("restore historical package: {e}"))?;
                    removed +=
                        cleanup_version_packages(&restored, plugin_id, original, referenced)?;
                    continue;
                }
            }
            remove_entry(&path)?;
            removed += 1;
            continue;
        }
        if !referenced
            .iter()
            .any(|(candidate_plugin, candidate_version, _)| {
                candidate_plugin == plugin_id && candidate_version == &version
            })
            || !is_safe_directory(&path)?
        {
            remove_entry(&path)?;
            removed += 1;
            continue;
        }
        removed += cleanup_version_packages(&path, plugin_id, &version, referenced)?;
        remove_empty_directory(&path)?;
    }
    Ok(removed)
}

fn cleanup_version_packages(
    version_root: &Path,
    plugin_id: &str,
    version: &str,
    referenced: &BTreeSet<(String, String, String)>,
) -> Result<usize, String> {
    let Some(entries) = read_directory(version_root)? else {
        return Ok(0);
    };
    let mut removed = 0;
    for entry in entries {
        let path = entry.path();
        let name = file_name(&path);
        let directory_digest = name.as_ref().filter(|name| {
            referenced.contains(&(plugin_id.to_owned(), version.to_owned(), (*name).clone()))
        });
        let archive_digest = name.as_deref().and_then(|name| {
            name.strip_suffix(".asterlyn-plugin.tgz").filter(|digest| {
                referenced.contains(&(
                    plugin_id.to_owned(),
                    version.to_owned(),
                    (*digest).to_owned(),
                ))
            })
        });
        if directory_digest.is_some() {
            if !is_safe_directory(&path)? {
                return Err(format!(
                    "referenced plugin package is not a safe directory: {}",
                    path.display()
                ));
            }
        } else if archive_digest.is_some() {
            if !is_safe_file(&path)? {
                return Err(format!(
                    "referenced plugin archive is not a safe file: {}",
                    path.display()
                ));
            }
        } else {
            remove_entry(&path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

fn remove_children(path: &Path) -> Result<usize, String> {
    let Some(entries) = read_directory(path)? else {
        return Ok(0);
    };
    let mut removed = 0;
    for entry in entries {
        remove_entry(&entry.path())?;
        removed += 1;
    }
    Ok(removed)
}

fn read_directory(path: &Path) -> Result<Option<Vec<fs::DirEntry>>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("inspect {}: {error}", path.display())),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "plugin marketplace storage is not a safe directory: {}",
            path.display()
        ));
    }
    match fs::read_dir(path) {
        Ok(entries) => entries
            .map(|entry| entry.map_err(|error| format!("read {}: {error}", path.display())))
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Err(error) => Err(format!("read {}: {error}", path.display())),
    }
}

fn is_safe_directory(path: &Path) -> Result<bool, String> {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        .map_err(|error| format!("inspect {}: {error}", path.display()))
}

fn is_safe_file(path: &Path) -> Result<bool, String> {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        .map_err(|error| format!("inspect {}: {error}", path.display()))
}

pub(crate) fn remove_marketplace_entry(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("inspect {}: {error}", path.display())),
    };
    clear_read_only(path, &metadata)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|error| format!("remove {}: {error}", path.display()))
    } else {
        fs::remove_file(path).map_err(|error| format!("remove {}: {error}", path.display()))
    }
}

fn remove_entry(path: &Path) -> Result<(), String> {
    remove_marketplace_entry(path)
}

#[cfg(windows)]
fn clear_read_only(path: &Path, metadata: &fs::Metadata) -> Result<(), String> {
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        for entry in
            fs::read_dir(path).map_err(|error| format!("read {}: {error}", path.display()))?
        {
            let child = entry
                .map_err(|error| format!("read {}: {error}", path.display()))?
                .path();
            let child_metadata = fs::symlink_metadata(&child)
                .map_err(|error| format!("inspect {}: {error}", child.display()))?;
            clear_read_only(&child, &child_metadata)?;
        }
    }
    if metadata.file_type().is_symlink() {
        return Ok(());
    }
    let mut permissions = metadata.permissions();
    permissions.set_readonly(false);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("prepare {} for removal: {error}", path.display()))
}

#[cfg(unix)]
fn clear_read_only(path: &Path, metadata: &fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        for entry in
            fs::read_dir(path).map_err(|error| format!("read {}: {error}", path.display()))?
        {
            let child = entry
                .map_err(|error| format!("read {}: {error}", path.display()))?
                .path();
            let child_metadata = fs::symlink_metadata(&child)
                .map_err(|error| format!("inspect {}: {error}", child.display()))?;
            clear_read_only(&child, &child_metadata)?;
        }
    }
    if !metadata.file_type().is_symlink() {
        let mut permissions = metadata.permissions();
        permissions.set_mode(permissions.mode() | 0o200);
        fs::set_permissions(path, permissions)
            .map_err(|error| format!("prepare {} for removal: {error}", path.display()))?;
    }
    Ok(())
}

fn remove_empty_directory(path: &Path) -> Result<(), String> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::DirectoryNotEmpty | std::io::ErrorKind::NotFound
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(format!("remove empty {}: {error}", path.display())),
    }
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name()?.to_str().map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use asterlyn_plugin_marketplace::{
        AdmittedPluginVersion, InstalledPlugin, PluginRuntimeStatus,
    };

    #[test]
    fn cleanup_preserves_only_indexed_packages_and_removes_restart_debris() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let digest = "a".repeat(64);
        let referenced = root
            .join("packages/dev.asterlyn.example/1.0.0")
            .join(&digest);
        let retained_archive = root
            .join("packages/dev.asterlyn.example/1.0.0")
            .join(format!("{digest}.asterlyn-plugin.tgz"));
        fs::create_dir_all(&referenced).unwrap();
        fs::write(referenced.join("plugin.json"), b"kept").unwrap();
        fs::write(&retained_archive, b"verified archive").unwrap();
        fs::create_dir_all(root.join("packages/dev.asterlyn.example/1.0.0/orphan")).unwrap();
        fs::create_dir_all(root.join("packages/dev.asterlyn.example/2.0.0/unused")).unwrap();
        fs::create_dir_all(root.join("packages/dev.asterlyn.orphan/1.0.0/unused")).unwrap();
        fs::create_dir_all(root.join("packages/.removing-dev.asterlyn.old-1")).unwrap();
        fs::create_dir_all(root.join("staging/extraction")).unwrap();
        fs::write(root.join("staging/review.tgz"), b"stale").unwrap();

        let snapshot = snapshot(&digest);
        let report = cleanup_marketplace_storage(root, &snapshot).unwrap();

        assert_eq!(report.staging_entries, 2);
        assert!(report.package_entries >= 4);
        assert_eq!(report.restored_tombstones, 0);
        assert_eq!(fs::read(referenced.join("plugin.json")).unwrap(), b"kept");
        assert_eq!(fs::read(retained_archive).unwrap(), b"verified archive");
        assert!(
            !root
                .join("packages/dev.asterlyn.example/1.0.0/orphan")
                .exists()
        );
        assert!(!root.join("packages/dev.asterlyn.example/2.0.0").exists());
        assert!(!root.join("packages/dev.asterlyn.orphan").exists());
        assert!(!root.join("packages/.removing-dev.asterlyn.old-1").exists());
    }

    #[test]
    fn cleanup_restores_tombstone_when_index_removal_did_not_commit() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let digest = "a".repeat(64);
        let plugin_root = root.join("packages/dev.asterlyn.example");
        let package = plugin_root.join("1.0.0").join(&digest);
        fs::create_dir_all(&package).unwrap();
        fs::write(package.join("plugin.json"), b"restored").unwrap();
        let tombstone = root.join("packages/.removing-dev.asterlyn.example-42");
        fs::rename(&plugin_root, &tombstone).unwrap();

        let report = cleanup_marketplace_storage(root, &snapshot(&digest)).unwrap();

        assert_eq!(report.restored_tombstones, 1);
        assert_eq!(
            fs::read(plugin_root.join("1.0.0").join(digest).join("plugin.json")).unwrap(),
            b"restored"
        );
        assert!(!tombstone.exists());
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_unlinks_orphan_symlinks_without_following_them() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let packages = directory.path().join("packages");
        fs::create_dir_all(&packages).unwrap();
        fs::write(outside.path().join("sentinel"), b"outside").unwrap();
        symlink(outside.path(), packages.join("dev.asterlyn.orphan")).unwrap();

        cleanup_marketplace_storage(directory.path(), &snapshot(&"a".repeat(64))).unwrap();

        assert!(!packages.join("dev.asterlyn.orphan").exists());
        assert_eq!(
            fs::read(outside.path().join("sentinel")).unwrap(),
            b"outside"
        );
    }

    fn snapshot(digest: &str) -> PluginInstallationSnapshot {
        PluginInstallationSnapshot {
            schema_version: 1,
            generation: 2,
            recovered: false,
            plugins: vec![InstalledPlugin {
                required_dependencies: Vec::new(),
                plugin_id: "dev.asterlyn.example".into(),
                repository: "asterlyn/example".into(),
                enabled: true,
                bundled_fallback: false,
                active_version: Some("1.0.0".into()),
                known_good_version: Some("1.0.0".into()),
                pending_version: None,
                versions: vec![AdmittedPluginVersion {
                    dependencies: Vec::new(),
                    version: "1.0.0".into(),
                    package_digest: format!("sha256:{digest}"),
                    content_digest: Some(format!("sha256:{}", "b".repeat(64))),
                    admitted_at_epoch_ms: 1,
                    runtime_status: PluginRuntimeStatus::KnownGood,
                }],
            }],
        }
    }
}

#[cfg(test)]
mod history_tests {
    use super::*;
    use asterlyn_plugin_marketplace::AdmittedPluginIdentity;
    const ID: &str = "dev.example.plugin";
    fn remove_history_package(
        root: &Path,
        store: &PluginInstallationStore,
        id: &str,
        version: &str,
        digest: &str,
    ) -> Result<PluginInstallationSnapshot, String> {
        let (snapshot, garbage) = stage_history_package_removal(root, store, id, version, digest)?;
        if let Some(path) = garbage {
            remove_marketplace_entry(&path)?;
        }
        Ok(snapshot)
    }
    fn fixture(root: &Path) -> (PluginInstallationStore, String) {
        let store = PluginInstallationStore::open(root.join("index")).unwrap();
        let digest = format!("sha256:{}", "a".repeat(64));
        for version in ["1.0.0", "2.0.0"] {
            store
                .record_admitted_with_dependencies(
                    AdmittedPluginIdentity {
                        plugin_id: ID,
                        repository: "example/plugin",
                        version,
                        package_digest: &digest,
                        content_digest: &format!("sha256:{}", "b".repeat(64)),
                    },
                    1,
                    false,
                    vec![],
                )
                .unwrap();
            store.set_plugin_enabled(ID, true).unwrap();
            store.recover_interrupted_activations().unwrap();
            store.begin_activation(ID, version, &digest).unwrap();
            store.promote_healthy(ID, version, &digest).unwrap();
            let path = root.join("packages").join(ID).join(version);
            fs::create_dir_all(path.join("content")).unwrap();
            fs::write(path.join("content/source"), "fixture").unwrap();
            fs::write(path.join("archive.asterlyn-plugin.tgz"), "fixture").unwrap();
        }
        (store, digest)
    }
    #[test]
    fn history_removal_reclaims_archive_and_extraction_without_touching_current_or_settings() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let (store, digest) = fixture(root);
        fs::write(root.join("settings"), "keep").unwrap();
        remove_history_package(root, &store, ID, "1.0.0", &digest).unwrap();
        assert!(!root.join("packages").join(ID).join("1.0.0").exists());
        assert!(
            root.join("packages")
                .join(ID)
                .join("2.0.0/content/source")
                .exists()
        );
        assert_eq!(fs::read_to_string(root.join("settings")).unwrap(), "keep");
        assert!(remove_history_package(root, &store, ID, "2.0.0", &digest).is_err());
    }
    #[test]
    fn index_failure_restores_staged_files_and_does_not_remove_version() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let (store, digest) = fixture(root);
        let before = store.snapshot().unwrap();
        fs::create_dir(root.join("index/installations.v1.next.json")).unwrap();
        assert!(remove_history_package(root, &store, ID, "1.0.0", &digest).is_err());
        assert_eq!(store.snapshot().unwrap(), before);
        assert!(
            root.join("packages")
                .join(ID)
                .join("1.0.0/content/source")
                .exists()
        );
    }
    #[test]
    fn startup_recovers_precommit_history_tombstones_and_reclaims_committed_ones() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let (store, digest) = fixture(root);
        let plugin = root.join("packages").join(ID);
        let staged = plugin.join(".removing-version-1.0.0-42");
        // Fixture content names must match the index's immutable digest for normal GC.
        for version in ["1.0.0", "2.0.0"] {
            let dir = plugin.join(version);
            fs::rename(
                dir.join("content"),
                dir.join(digest.trim_start_matches("sha256:")),
            )
            .unwrap();
            fs::rename(
                dir.join("archive.asterlyn-plugin.tgz"),
                dir.join(format!(
                    "{}.asterlyn-plugin.tgz",
                    digest.trim_start_matches("sha256:")
                )),
            )
            .unwrap();
        }
        fs::rename(plugin.join("1.0.0"), &staged).unwrap();
        cleanup_marketplace_storage(root, &store.snapshot().unwrap()).unwrap();
        assert!(plugin.join("1.0.0").exists());
        assert!(!staged.exists());
        fs::rename(plugin.join("1.0.0"), &staged).unwrap();
        store.remove_version(ID, "1.0.0", &digest).unwrap();
        cleanup_marketplace_storage(root, &store.snapshot().unwrap()).unwrap();
        assert!(!staged.exists());
        assert!(!plugin.join("1.0.0").exists());
    }
    #[cfg(unix)]
    #[test]
    fn history_removal_rejects_symlinked_parents_and_unlinks_nested_links_only() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = temp.path();
        let (store, digest) = fixture(root);
        fs::write(outside.path().join("sentinel"), "keep").unwrap();
        let plugin = root.join("packages").join(ID);
        fs::rename(plugin.join("1.0.0"), root.join("saved")).unwrap();
        symlink(outside.path(), plugin.join("1.0.0")).unwrap();
        assert!(remove_history_package(root, &store, ID, "1.0.0", &digest).is_err());
        fs::remove_file(plugin.join("1.0.0")).unwrap();
        fs::rename(root.join("saved"), plugin.join("1.0.0")).unwrap();
        symlink(outside.path(), plugin.join("1.0.0/nested")).unwrap();
        remove_history_package(root, &store, ID, "1.0.0", &digest).unwrap();
        assert_eq!(
            fs::read_to_string(outside.path().join("sentinel")).unwrap(),
            "keep"
        );
    }
}
