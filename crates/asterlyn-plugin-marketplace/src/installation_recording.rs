use super::installation_identity::{validate_content_digest, validate_installation_identity};
use super::{
    AdmittedPluginIdentity, AdmittedPluginVersion, InstalledPlugin, MarketplaceError,
    PluginDependency, PluginInstallationSnapshot, PluginInstallationStore, PluginRuntimeStatus,
};
use std::collections::BTreeSet;

impl PluginInstallationStore {
    /// Startup only, before any runtime is created. Atomically admits a host bundle.
    /// Each package is validated first, then
    /// all pending selections are written in one generation so dependency
    /// checks never observe a half-upgraded built-in set.
    pub fn record_bundled_startup_batch(
        &self,
        identities: Vec<(AdmittedPluginIdentity<'_>, Vec<PluginDependency>)>,
        admitted_at_epoch_ms: u64,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        if identities.is_empty() || identities.len() > 128 {
            return Err(MarketplaceError::Conflict(
                "bundled startup batch size is invalid".into(),
            ));
        }
        let mut validated = Vec::with_capacity(identities.len());
        let mut ids = BTreeSet::new();
        for (identity, dependencies) in identities {
            if !ids.insert(identity.plugin_id.to_owned()) {
                return Err(MarketplaceError::Conflict(
                    "bundled startup batch contains duplicate plugin IDs".into(),
                ));
            }
            validate_installation_identity(
                identity.plugin_id,
                identity.repository,
                identity.version,
                identity.package_digest,
            )?;
            validate_content_digest(identity.content_digest)?;
            asterlyn_plugin_dependencies::validate_declarations(identity.plugin_id, &dependencies)
                .map_err(|e| MarketplaceError::Conflict(e.to_string()))?;
            validated.push((identity, dependencies));
        }
        let snapshot = self.snapshot()?;
        let mut plugins = snapshot.plugins;
        let mut bundled_ids = BTreeSet::new();
        let mut changed = false;
        for (identity, dependencies) in validated {
            bundled_ids.insert(identity.plugin_id.to_owned());
            let plugin = if let Some(plugin) = plugins
                .iter_mut()
                .find(|plugin| plugin.plugin_id == identity.plugin_id)
            {
                if plugin.repository != identity.repository {
                    return Err(MarketplaceError::Conflict(
                        "plugin ID is already owned by another repository".into(),
                    ));
                }
                plugin
            } else {
                plugins.push(InstalledPlugin {
                    required_dependencies: dependencies.clone(),
                    plugin_id: identity.plugin_id.into(),
                    repository: identity.repository.into(),
                    enabled: true,
                    bundled_fallback: true,
                    active_version: None,
                    known_good_version: None,
                    pending_version: None,
                    versions: Vec::new(),
                });
                plugins.last_mut().expect("just inserted plugin")
            };
            if !plugin.bundled_fallback {
                changed = true;
            }
            plugin.bundled_fallback = true;
            if plugin.required_dependencies.is_empty() {
                changed |= !dependencies.is_empty();
                plugin.required_dependencies = dependencies.clone();
            }
            if let Some(existing) = plugin
                .versions
                .iter()
                .find(|version| version.version == identity.version)
            {
                if existing.runtime_status == PluginRuntimeStatus::Quarantined {
                    return Err(MarketplaceError::Conflict(
                        "quarantined bundled version requires explicit repair".into(),
                    ));
                }
                if existing.package_digest != identity.package_digest
                    || existing.content_digest.as_deref() != Some(identity.content_digest)
                    || existing.dependencies != dependencies
                {
                    return Err(MarketplaceError::Conflict(
                        "plugin version admission does not match the bundle".into(),
                    ));
                }
                // An already admitted version may have been deliberately rolled back or
                // abandoned. Re-presenting the same host bundle must preserve that choice.
                continue;
            }
            plugin.versions.push(AdmittedPluginVersion {
                dependencies,
                version: identity.version.into(),
                package_digest: identity.package_digest.into(),
                content_digest: Some(identity.content_digest.into()),
                admitted_at_epoch_ms,
                runtime_status: PluginRuntimeStatus::PendingRestart,
            });
            plugin.pending_version = Some(identity.version.into());
            changed = true;
            plugin
                .versions
                .sort_by(|left, right| left.version.cmp(&right.version));
        }
        // A restart candidate is not active yet. Clearing stale active pointers
        // makes the persisted candidate graph itself pass the ordinary runtime
        // validator; known-good remains the rollback pointer.
        for plugin in &mut plugins {
            if bundled_ids.contains(&plugin.plugin_id)
                && plugin.pending_version.is_some()
                && plugin.pending_version != plugin.active_version
                && plugin.active_version.take().is_some()
            {
                changed = true;
            }
        }
        let nodes = super::dependency_nodes(&plugins);
        asterlyn_plugin_dependencies::validate_enabled(&nodes)
            .map_err(|e| MarketplaceError::Conflict(e.to_string()))?;
        if !changed {
            return self.snapshot();
        }
        self.write(snapshot.generation + 1, plugins)
    }

    pub fn record_admitted(
        &self,
        identity: AdmittedPluginIdentity<'_>,
        admitted_at_epoch_ms: u64,
        bundled_fallback: bool,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.record_admitted_with_defaults(
            identity,
            admitted_at_epoch_ms,
            bundled_fallback,
            false,
            Vec::new(),
        )
    }

    /// Records a host-shipped package without overriding an existing user's enabled choice.
    /// A first installation is enabled so the built-in integration remains available offline.
    pub fn record_bundled(
        &self,
        identity: AdmittedPluginIdentity<'_>,
        admitted_at_epoch_ms: u64,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.record_admitted_with_defaults(identity, admitted_at_epoch_ms, true, true, Vec::new())
    }

    pub fn record_admitted_with_dependencies(
        &self,
        identity: AdmittedPluginIdentity<'_>,
        at: u64,
        bundled: bool,
        dependencies: Vec<PluginDependency>,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.record_admitted_with_defaults(identity, at, bundled, false, dependencies)
    }
    pub fn record_bundled_with_dependencies(
        &self,
        identity: AdmittedPluginIdentity<'_>,
        at: u64,
        dependencies: Vec<PluginDependency>,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.record_admitted_with_defaults(identity, at, true, true, dependencies)
    }
    fn record_admitted_with_defaults(
        &self,
        identity: AdmittedPluginIdentity<'_>,
        admitted_at_epoch_ms: u64,
        bundled_fallback: bool,
        enabled_on_first_install: bool,
        dependencies: Vec<PluginDependency>,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let AdmittedPluginIdentity {
            plugin_id,
            repository,
            version,
            package_digest,
            content_digest,
        } = identity;
        validate_installation_identity(plugin_id, repository, version, package_digest)?;
        validate_content_digest(content_digest)?;
        asterlyn_plugin_dependencies::validate_declarations(plugin_id, &dependencies)
            .map_err(|e| MarketplaceError::Conflict(e.to_string()))?;
        let snapshot = self.snapshot()?;
        if let Some(plugin) = snapshot
            .plugins
            .iter()
            .find(|plugin| plugin.plugin_id == plugin_id)
        {
            if plugin.repository != repository {
                return Err(MarketplaceError::Conflict(
                    "plugin ID is already owned by another repository".into(),
                ));
            }
            if let Some(existing) = plugin
                .versions
                .iter()
                .find(|candidate| candidate.version == version)
            {
                if existing.package_digest != package_digest {
                    return Err(MarketplaceError::Conflict(
                        "plugin version was republished with different bytes".into(),
                    ));
                }
                if existing.dependencies != dependencies {
                    return Err(MarketplaceError::Conflict(
                        "plugin dependency receipt does not match its admitted package".into(),
                    ));
                }
                if existing.content_digest.as_deref() == Some(content_digest) {
                    if bundled_fallback && !plugin.bundled_fallback {
                        let mut plugins = snapshot.plugins;
                        let plugin = plugins
                            .iter_mut()
                            .find(|candidate| candidate.plugin_id == plugin_id)
                            .expect("existing plugin remains present");
                        plugin.bundled_fallback = true;
                        return self.write(snapshot.generation + 1, plugins);
                    }
                    return Ok(snapshot);
                }
                if existing.content_digest.is_some() {
                    return Err(MarketplaceError::Conflict(
                        "plugin version content does not match its admitted package".into(),
                    ));
                }
                let mut plugins = snapshot.plugins;
                let plugin = plugins
                    .iter_mut()
                    .find(|candidate| candidate.plugin_id == plugin_id)
                    .ok_or_else(|| {
                        MarketplaceError::Corrupt(
                            "installed plugin changed during content-digest migration".into(),
                        )
                    })?;
                if bundled_fallback {
                    plugin.bundled_fallback = true;
                }
                let existing = plugin
                    .versions
                    .iter_mut()
                    .find(|candidate| candidate.version == version)
                    .ok_or_else(|| {
                        MarketplaceError::Corrupt(
                            "installed plugin version changed during content-digest migration"
                                .into(),
                        )
                    })?;
                existing.content_digest = Some(content_digest.into());
                return self.write(snapshot.generation + 1, plugins);
            }
        }
        let mut plugins = snapshot.plugins;
        let plugin = if let Some(plugin) = plugins
            .iter_mut()
            .find(|plugin| plugin.plugin_id == plugin_id)
        {
            if plugin.repository != repository {
                return Err(MarketplaceError::Conflict(
                    "plugin ID is already owned by another repository".into(),
                ));
            }
            plugin
        } else {
            plugins.push(InstalledPlugin {
                required_dependencies: Vec::new(),
                plugin_id: plugin_id.into(),
                repository: repository.into(),
                enabled: enabled_on_first_install,
                bundled_fallback,
                active_version: None,
                known_good_version: None,
                pending_version: None,
                versions: Vec::new(),
            });
            plugins.last_mut().expect("just inserted plugin")
        };
        if bundled_fallback {
            plugin.bundled_fallback = true;
        }
        if enabled_on_first_install {
            plugin.required_dependencies = dependencies.clone();
        }
        plugin.versions.push(AdmittedPluginVersion {
            dependencies,
            version: version.into(),
            package_digest: package_digest.into(),
            content_digest: Some(content_digest.into()),
            admitted_at_epoch_ms,
            runtime_status: PluginRuntimeStatus::PendingRestart,
        });
        plugin
            .versions
            .sort_by(|left, right| left.version.cmp(&right.version));
        plugin.pending_version = Some(version.into());
        self.reconcile_dependencies(&mut plugins, plugin_id)?;
        self.write(snapshot.generation + 1, plugins)
    }
}
