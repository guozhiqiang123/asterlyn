use super::*;
use asterlyn_plugin_dependencies::{
    DependencyNode, enable_closure, required_by, validate_enabled, validate_graph,
};

pub fn dependency_nodes(plugins: &[InstalledPlugin]) -> Vec<DependencyNode> {
    plugins
        .iter()
        .map(|plugin| {
            let mut selected = Vec::new();
            for pointer in [
                plugin.active_version.as_deref(),
                plugin.pending_version.as_deref(),
            ] {
                if let Some(version) = pointer
                    .and_then(|pointer| plugin.versions.iter().find(|v| v.version == pointer))
                    && !selected
                        .iter()
                        .any(|v: &&AdmittedPluginVersion| v.version == version.version)
                {
                    selected.push(version);
                }
            }
            if selected.is_empty()
                && let Some(version) = plugin
                    .known_good_version
                    .as_deref()
                    .and_then(|pointer| plugin.versions.iter().find(|v| v.version == pointer))
                    .or_else(|| {
                        plugin
                            .versions
                            .iter()
                            .max_by_key(|v| v.admitted_at_epoch_ms)
                    })
            {
                selected.push(version);
            }
            DependencyNode {
                id: plugin.plugin_id.clone(),
                versions: selected.iter().map(|v| v.version.clone()).collect(),
                enabled: plugin.enabled,
                available: !selected.is_empty()
                    && selected.iter().all(|v| {
                        v.content_digest.is_some()
                            && v.runtime_status != PluginRuntimeStatus::Quarantined
                    }),
                dependencies: plugin
                    .required_dependencies
                    .iter()
                    .cloned()
                    .chain(selected.iter().flat_map(|v| v.dependencies.clone()))
                    .collect(),
            }
        })
        .collect()
}
fn conflict(error: impl ToString) -> MarketplaceError {
    MarketplaceError::Conflict(error.to_string())
}

pub(super) fn validate_selection(plugins: &[InstalledPlugin]) -> Result<(), MarketplaceError> {
    validate_enabled(&dependency_nodes(plugins)).map_err(conflict)
}
pub(super) fn enable_required(
    plugins: &mut [InstalledPlugin],
    id: &str,
) -> Result<(), MarketplaceError> {
    let order = enable_closure(&dependency_nodes(plugins), id).map_err(conflict)?;
    for id in order {
        let plugin = plugins
            .iter_mut()
            .find(|p| p.plugin_id == id)
            .expect("validated closure");
        if !plugin.enabled && plugin.pending_version.is_none() {
            plugin.pending_version = plugin
                .active_version
                .clone()
                .or_else(|| plugin.known_good_version.clone());
        }
        plugin.enabled = true;
    }
    validate_selection(plugins)
}

impl PluginInstallationStore {
    pub fn required_by(&self, plugin_id: &str) -> Result<Vec<String>, MarketplaceError> {
        required_by(&dependency_nodes(&self.snapshot()?.plugins), plugin_id).map_err(conflict)
    }
    pub fn ensure_can_remove(&self, plugin_id: &str) -> Result<(), MarketplaceError> {
        let dependents = self.required_by(plugin_id)?;
        if dependents.is_empty() {
            Ok(())
        } else {
            Err(conflict(
                asterlyn_plugin_dependencies::DependencyError::RequiredBy(dependents),
            ))
        }
    }
    /// Applies before admission/selection writes; disabled consumers may have missing packages.
    pub(super) fn reconcile_dependencies(
        &self,
        plugins: &mut [InstalledPlugin],
        plugin_id: &str,
    ) -> Result<(), MarketplaceError> {
        validate_graph(&dependency_nodes(plugins)).map_err(conflict)?;
        if plugins
            .iter()
            .any(|p| p.plugin_id == plugin_id && p.enabled)
        {
            enable_required(plugins, plugin_id)?;
        }
        validate_selection(plugins)
    }
    pub fn ensure_dependencies_available(&self, plugin_id: &str) -> Result<(), MarketplaceError> {
        let nodes = dependency_nodes(&self.snapshot()?.plugins);
        let closure = enable_closure(&nodes, plugin_id).map_err(conflict)?;
        for id in closure {
            if !nodes.iter().any(|n| n.id == id && n.enabled) {
                return Err(conflict(
                    asterlyn_plugin_dependencies::DependencyError::Disabled(id),
                ));
            }
        }
        Ok(())
    }
}

pub fn ensure_enabled_dependencies(
    plugins: &[InstalledPlugin],
    id: &str,
) -> Result<(), MarketplaceError> {
    let nodes = dependency_nodes(plugins);
    let closure = enable_closure(&nodes, id).map_err(conflict)?;
    for dependency in closure {
        if !nodes.iter().any(|n| n.id == dependency && n.enabled) {
            return Err(conflict(
                asterlyn_plugin_dependencies::DependencyError::Disabled(dependency),
            ));
        }
    }
    Ok(())
}

impl PluginInstallationStore {
    pub fn set_plugin_enabled(
        &self,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let snapshot = self.snapshot()?;
        let mut plugins = snapshot.plugins.clone();
        let plugin = plugins
            .iter_mut()
            .find(|plugin| plugin.plugin_id == plugin_id)
            .ok_or_else(|| MarketplaceError::NotFound(plugin_id.into()))?;
        if plugin.enabled == enabled && !enabled {
            return Ok(PluginInstallationSnapshot {
                plugins,
                ..snapshot
            });
        }
        if !enabled {
            let dependents =
                asterlyn_plugin_dependencies::required_by(&dependency_nodes(&plugins), plugin_id)
                    .map_err(|e| MarketplaceError::Conflict(e.to_string()))?;
            if !dependents.is_empty() {
                return Err(MarketplaceError::Conflict(
                    asterlyn_plugin_dependencies::DependencyError::RequiredBy(dependents)
                        .to_string(),
                ));
            }
        }
        let plugin = plugins
            .iter_mut()
            .find(|plugin| plugin.plugin_id == plugin_id)
            .expect("validated plugin");
        if !enabled {
            let abandoned = plugin
                .versions
                .iter_mut()
                .filter(|version| version.runtime_status == PluginRuntimeStatus::Active)
                .map(|version| {
                    version.runtime_status = PluginRuntimeStatus::PendingRuntime;
                    version.version.clone()
                })
                .collect::<Vec<_>>();
            plugin.active_version = plugin.known_good_version.clone();
            if plugin.pending_version.is_none() {
                plugin.pending_version = abandoned.first().cloned();
            }
        } else if !plugin.enabled && plugin.pending_version.is_none() {
            plugin.pending_version = plugin
                .active_version
                .clone()
                .or_else(|| plugin.known_good_version.clone());
        }
        plugin.enabled = enabled;
        if enabled {
            dependencies::enable_required(&mut plugins, plugin_id)?;
        }
        // Disabling must remain possible while another enabled consumer has a failed dependency.
        if enabled {
            dependencies::validate_selection(&plugins)?;
        }
        if plugins == snapshot.plugins {
            return Ok(snapshot);
        }
        self.write(snapshot.generation + 1, plugins)
    }

    pub fn select_rollback(
        &self,
        plugin_id: &str,
        version: &str,
        package_digest: &str,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.mutate_exact_version_with_policy(
            plugin_id,
            version,
            package_digest,
            true,
            |plugin, admitted| {
                if admitted.runtime_status != PluginRuntimeStatus::KnownGood {
                    return Err(MarketplaceError::Conflict(
                        "rollback requires a known-good plugin version".into(),
                    ));
                }
                if plugin.active_version.as_deref() == Some(version)
                    && plugin.pending_version.is_none()
                {
                    return Ok(false);
                }
                plugin.pending_version = Some(version.into());
                Ok(true)
            },
        )
    }

    pub fn repair_quarantined_version(
        &self,
        plugin_id: &str,
        version: &str,
        package_digest: &str,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.mutate_exact_version_with_policy(
            plugin_id,
            version,
            package_digest,
            true,
            |plugin, admitted| {
                if admitted.runtime_status != PluginRuntimeStatus::Quarantined {
                    return Err(MarketplaceError::Conflict(
                        "repair requires a quarantined plugin version".into(),
                    ));
                }
                if admitted.content_digest.is_none() {
                    return Err(MarketplaceError::Conflict(
                        "plugin version predates immutable content binding; reinstall it".into(),
                    ));
                }
                admitted.runtime_status = if plugin.enabled {
                    PluginRuntimeStatus::PendingRestart
                } else {
                    PluginRuntimeStatus::PendingRuntime
                };
                plugin.pending_version = Some(version.into());
                Ok(true)
            },
        )
    }

    pub fn remove_plugin(
        &self,
        plugin_id: &str,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.ensure_can_remove(plugin_id)?;
        let snapshot = self.snapshot()?;
        if snapshot
            .plugins
            .iter()
            .any(|plugin| plugin.plugin_id == plugin_id && plugin.bundled_fallback)
        {
            return Err(MarketplaceError::Conflict(
                "host-bundled plugins can be disabled but not uninstalled".into(),
            ));
        }
        let mut plugins = snapshot.plugins;
        let previous_len = plugins.len();
        plugins.retain(|plugin| plugin.plugin_id != plugin_id);
        if plugins.len() == previous_len {
            return Err(MarketplaceError::NotFound(plugin_id.into()));
        }
        self.write(snapshot.generation + 1, plugins)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    const ANDROID: &str = "dev.asterlyn.android-gradle";
    const LSP: &str = "dev.asterlyn.lsp";
    fn requirement() -> PluginDependency {
        PluginDependency {
            id: ANDROID.into(),
            minimum: "1.0.0".into(),
            maximum_exclusive: Some("2.0.0".into()),
        }
    }
    fn record(
        store: &PluginInstallationStore,
        id: &str,
        version: &str,
        dependencies: Vec<PluginDependency>,
        bundled: bool,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let digest = format!("sha256:{}", "a".repeat(64));
        let content = format!("sha256:{}", "b".repeat(64));
        let identity = AdmittedPluginIdentity {
            plugin_id: id,
            repository: "example/plugins",
            version,
            package_digest: &digest,
            content_digest: &content,
        };
        if bundled {
            store.record_bundled_with_dependencies(identity, 1, dependencies)
        } else {
            store.record_admitted_with_dependencies(identity, 1, false, dependencies)
        }
    }
    #[test]
    fn dependency_enablement_and_locks_are_atomic_and_release_only_after_all_consumers_disable() {
        let directory = tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        record(&store, ANDROID, "1.1.0", vec![], true).unwrap();
        store.set_plugin_enabled(ANDROID, false).unwrap();
        record(&store, LSP, "1.0.0", vec![requirement()], false).unwrap();
        let enabled = store.set_plugin_enabled(LSP, true).unwrap();
        assert!(enabled.plugins.iter().all(|p| p.enabled));
        record(
            &store,
            "dev.other.consumer",
            "1.0.0",
            vec![requirement()],
            false,
        )
        .unwrap();
        store
            .set_plugin_enabled("dev.other.consumer", true)
            .unwrap();
        let before = store.snapshot().unwrap();
        assert!(
            store
                .set_plugin_enabled(ANDROID, false)
                .unwrap_err()
                .to_string()
                .contains(LSP)
        );
        assert!(store.remove_plugin(ANDROID).is_err());
        assert_eq!(store.snapshot().unwrap(), before);
        store.set_plugin_enabled(LSP, false).unwrap();
        assert!(store.set_plugin_enabled(ANDROID, false).is_err());
        store
            .set_plugin_enabled("dev.other.consumer", false)
            .unwrap();
        store.set_plugin_enabled(ANDROID, false).unwrap();
    }
    #[test]
    fn missing_dependencies_and_cycles_never_partially_enable_or_publish() {
        let directory = tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        record(&store, LSP, "1.0.0", vec![requirement()], false).unwrap();
        let before = store.snapshot().unwrap();
        assert!(store.set_plugin_enabled(LSP, true).is_err());
        assert_eq!(store.snapshot().unwrap(), before);
        let back = PluginDependency {
            id: LSP.into(),
            minimum: "1.0.0".into(),
            maximum_exclusive: None,
        };
        assert!(record(&store, ANDROID, "1.1.0", vec![back], false).is_err());
        assert_eq!(store.snapshot().unwrap(), before);
    }
    #[test]
    fn incompatible_provider_update_preserves_the_previous_selection() {
        let directory = tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        record(&store, ANDROID, "1.1.0", vec![], true).unwrap();
        record(&store, LSP, "1.0.0", vec![requirement()], true).unwrap();
        let before = store.snapshot().unwrap();
        assert!(record(&store, ANDROID, "2.0.0", vec![], false).is_err());
        assert_eq!(store.snapshot().unwrap(), before);
    }
    #[test]
    fn bundled_dependency_floor_survives_selection_of_a_legacy_consumer() {
        let directory = tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        record(&store, ANDROID, "1.1.0", vec![], true).unwrap();
        record(&store, LSP, "1.0.0", vec![], false).unwrap();
        let digest = format!("sha256:{}", "a".repeat(64));
        store.recover_interrupted_activations().unwrap();
        store.set_plugin_enabled(LSP, true).unwrap();
        store.begin_activation(LSP, "1.0.0", &digest).unwrap();
        store.promote_healthy(LSP, "1.0.0", &digest).unwrap();
        record(&store, LSP, "1.1.0", vec![requirement()], true).unwrap();
        store.set_plugin_enabled(LSP, false).unwrap();
        store.select_rollback(LSP, "1.0.0", &digest).unwrap();
        store.set_plugin_enabled(LSP, true).unwrap();
        assert_eq!(store.required_by(ANDROID).unwrap(), vec![LSP]);
        assert!(store.set_plugin_enabled(ANDROID, false).is_err());
    }
    #[test]
    fn unavailable_provider_blocks_consumers_but_does_not_unlock_enabled_dependency_edges() {
        let directory = tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        record(&store, ANDROID, "1.1.0", vec![], true).unwrap();
        record(&store, LSP, "1.0.0", vec![requirement()], true).unwrap();
        record(
            &store,
            "dev.other.consumer",
            "1.0.0",
            vec![requirement()],
            true,
        )
        .unwrap();
        let digest = format!("sha256:{}", "a".repeat(64));
        store.recover_interrupted_activations().unwrap();
        store.begin_activation(ANDROID, "1.1.0", &digest).unwrap();
        store
            .mark_activation_failed(ANDROID, "1.1.0", &digest)
            .unwrap();
        assert!(store.ensure_dependencies_available(LSP).is_err());
        assert!(store.set_plugin_enabled(ANDROID, false).is_err());
        store.set_plugin_enabled(LSP, false).unwrap();
        assert!(store.set_plugin_enabled(ANDROID, false).is_err());
        store
            .set_plugin_enabled("dev.other.consumer", false)
            .unwrap();
        store.set_plugin_enabled(ANDROID, false).unwrap();
    }

    #[test]
    fn external_provider_uninstall_requires_consumers_to_disable_first() {
        let directory = tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        record(&store, ANDROID, "1.1.0", vec![], false).unwrap();
        record(&store, LSP, "1.0.0", vec![requirement()], false).unwrap();
        store.set_plugin_enabled(LSP, true).unwrap();
        let before = store.snapshot().unwrap();
        assert!(
            store
                .remove_plugin(ANDROID)
                .unwrap_err()
                .to_string()
                .contains(LSP)
        );
        assert_eq!(store.snapshot().unwrap(), before);
        store.set_plugin_enabled(LSP, false).unwrap();
        let removed = store.remove_plugin(ANDROID).unwrap();
        assert!(
            !removed
                .plugins
                .iter()
                .any(|plugin| plugin.plugin_id == ANDROID)
        );
    }
}
