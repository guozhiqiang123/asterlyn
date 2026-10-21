use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use asterlyn_plugin_marketplace::PluginInstallationSnapshot;

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct PluginMarketplaceCleanupReport {
    pub(crate) staging_entries: usize,
    pub(crate) package_entries: usize,
    pub(crate) restored_tombstones: usize,
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
                plugin_id: "dev.asterlyn.example".into(),
                repository: "asterlyn/example".into(),
                enabled: true,
                bundled_fallback: false,
                active_version: Some("1.0.0".into()),
                known_good_version: Some("1.0.0".into()),
                pending_version: None,
                versions: vec![AdmittedPluginVersion {
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
