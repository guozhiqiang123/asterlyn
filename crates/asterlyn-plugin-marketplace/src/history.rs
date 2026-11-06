use super::*;

fn remove_history(
    plugins: &mut [InstalledPlugin],
    id: &str,
    version: &str,
    digest: &str,
) -> Result<(), MarketplaceError> {
    let selection_before = dependencies::dependency_nodes(plugins);
    let plugin = plugins
        .iter_mut()
        .find(|p| p.plugin_id == id)
        .ok_or_else(|| MarketplaceError::NotFound(id.into()))?;
    validate_installation_identity(id, &plugin.repository, version, digest)?;
    let index = plugin
        .versions
        .iter()
        .position(|v| v.version == version)
        .ok_or_else(|| MarketplaceError::NotFound(format!("{id}@{version}")))?;
    let candidate = &plugin.versions[index];
    if candidate.package_digest != digest {
        return Err(MarketplaceError::Conflict(
            "plugin package digest does not match the installed version".into(),
        ));
    }
    if plugin.versions.len() <= 1
        || [
            plugin.active_version.as_deref(),
            plugin.pending_version.as_deref(),
            plugin.known_good_version.as_deref(),
        ]
        .contains(&Some(version))
        || matches!(
            candidate.runtime_status,
            PluginRuntimeStatus::Active
                | PluginRuntimeStatus::PendingRuntime
                | PluginRuntimeStatus::PendingRestart
        )
    {
        return Err(MarketplaceError::Conflict(
            "current, pending, recovery and final plugin packages cannot be deleted".into(),
        ));
    }
    plugin.versions.remove(index);
    // History cleanup must remain available while recovering an already degraded graph.
    // Only revalidate when deleting a fallback candidate changes the selected packages.
    if dependencies::dependency_nodes(plugins) != selection_before {
        dependencies::validate_selection(plugins)?;
    }
    Ok(())
}

impl PluginInstallationStore {
    pub fn ensure_can_remove_version(
        &self,
        id: &str,
        version: &str,
        digest: &str,
    ) -> Result<(), MarketplaceError> {
        remove_history(&mut self.snapshot()?.plugins, id, version, digest)
    }
    pub fn remove_version(
        &self,
        id: &str,
        version: &str,
        digest: &str,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let mut snapshot = self.snapshot()?;
        remove_history(&mut snapshot.plugins, id, version, digest)?;
        self.write(snapshot.generation + 1, snapshot.plugins)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(store: &PluginInstallationStore, version: &str) {
        store
            .record_admitted_with_dependencies(
                AdmittedPluginIdentity {
                    plugin_id: "dev.example.plugin",
                    repository: "example/plugin",
                    version,
                    package_digest: &format!("sha256:{}", "a".repeat(64)),
                    content_digest: &format!("sha256:{}", "b".repeat(64)),
                },
                1,
                false,
                vec![],
            )
            .unwrap();
    }
    #[test]
    fn removes_only_exact_unselected_history_and_keeps_active_recovery_and_pending() {
        let temp = tempfile::tempdir().unwrap();
        let store = PluginInstallationStore::open(temp.path()).unwrap();
        let id = "dev.example.plugin";
        let digest = format!("sha256:{}", "a".repeat(64));
        for version in ["1.0.0", "2.0.0"] {
            record(&store, version);
            store.set_plugin_enabled(id, true).unwrap();
            store.recover_interrupted_activations().unwrap();
            store.begin_activation(id, version, &digest).unwrap();
            store.promote_healthy(id, version, &digest).unwrap();
        }
        let before = store.snapshot().unwrap();
        for (version, d) in [
            ("2.0.0", digest.clone()),
            ("1.0.0", format!("sha256:{}", "c".repeat(64))),
            ("../escape", digest.clone()),
        ] {
            assert!(store.remove_version(id, version, &d).is_err());
            assert_eq!(store.snapshot().unwrap(), before);
        }
        record(&store, "3.0.0");
        let pending = store.snapshot().unwrap();
        assert!(store.remove_version(id, "3.0.0", &digest).is_err());
        assert_eq!(store.snapshot().unwrap(), pending);
        let result = store.remove_version(id, "1.0.0", &digest).unwrap();
        assert_eq!(result.generation, pending.generation + 1);
        assert_eq!(result.plugins[0].active_version.as_deref(), Some("2.0.0"));
        assert_eq!(result.plugins[0].pending_version.as_deref(), Some("3.0.0"));
        assert_eq!(
            result.plugins[0].known_good_version.as_deref(),
            Some("2.0.0")
        );
        assert_eq!(result.plugins[0].versions.len(), 2);
        assert_eq!(store.snapshot().unwrap(), result);
    }
    #[test]
    fn final_disabled_or_quarantined_package_is_not_history() {
        let temp = tempfile::tempdir().unwrap();
        let store = PluginInstallationStore::open(temp.path()).unwrap();
        record(&store, "1.0.0");
        let digest = format!("sha256:{}", "a".repeat(64));
        store.recover_interrupted_activations().unwrap();
        store
            .mark_activation_failed("dev.example.plugin", "1.0.0", &digest)
            .unwrap();
        assert!(
            store
                .remove_version("dev.example.plugin", "1.0.0", &digest)
                .is_err()
        );
    }

    #[test]
    fn history_cleanup_preserves_selection_when_a_crash_has_degraded_dependencies() {
        let temp = tempfile::tempdir().unwrap();
        let store = PluginInstallationStore::open(temp.path()).unwrap();
        let id = "dev.example.plugin";
        let digest = format!("sha256:{}", "a".repeat(64));
        for version in ["0.5.0", "1.0.0", "2.0.0"] {
            record(&store, version);
            store.set_plugin_enabled(id, true).unwrap();
            store.recover_interrupted_activations().unwrap();
            store.begin_activation(id, version, &digest).unwrap();
            store.promote_healthy(id, version, &digest).unwrap();
        }
        store
            .record_admitted_with_dependencies(
                AdmittedPluginIdentity {
                    plugin_id: "dev.example.consumer",
                    repository: "example/consumer",
                    version: "1.0.0",
                    package_digest: &digest,
                    content_digest: &format!("sha256:{}", "b".repeat(64)),
                },
                2,
                false,
                vec![PluginDependency {
                    id: id.into(),
                    minimum: "2.0.0".into(),
                    maximum_exclusive: Some("3.0.0".into()),
                }],
            )
            .unwrap();
        store
            .set_plugin_enabled("dev.example.consumer", true)
            .unwrap();
        store.mark_runtime_crashed(id, "2.0.0", &digest).unwrap();
        let before = store.snapshot().unwrap();
        assert!(dependencies::validate_selection(&before.plugins).is_err());
        store
            .ensure_can_remove_version(id, "0.5.0", &digest)
            .unwrap();
        let after = store.remove_version(id, "0.5.0", &digest).unwrap();
        assert_eq!(
            dependencies::dependency_nodes(&before.plugins),
            dependencies::dependency_nodes(&after.plugins)
        );
        assert_eq!(after.plugins[0].active_version.as_deref(), Some("1.0.0"));
        assert!(after.plugins[1].enabled);
        assert_eq!(after.plugins[0].versions.len(), 2);
    }
}
