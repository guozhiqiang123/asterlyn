use super::{
    AdmittedPluginVersion, InstalledPlugin, MAX_SOURCES, MarketplaceError, PluginRuntimeStatus,
    normalize_github_repository, release_version_parts,
};

pub const INSTALLATION_SCHEMA_VERSION: u32 = 2;
pub(super) const INSTALLATION_FILE: &str = "installations.v1.json";
pub(super) const PREVIOUS_INSTALLATION_FILE: &str = "installations.v1.previous.json";
pub(super) const NEXT_INSTALLATION_FILE: &str = "installations.v1.next.json";
pub(super) const MAX_INSTALLATION_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PersistedInstallations {
    pub(super) schema_version: u32,
    pub(super) generation: u64,
    pub(super) plugins: Vec<InstalledPlugin>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdmittedPluginIdentity<'a> {
    pub plugin_id: &'a str,
    pub repository: &'a str,
    pub version: &'a str,
    pub package_digest: &'a str,
    pub content_digest: &'a str,
}

pub(super) fn validate_content_digest(digest: &str) -> Result<(), MarketplaceError> {
    let value = digest.strip_prefix("sha256:").unwrap_or("");
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(MarketplaceError::Corrupt(
            "invalid installed content digest".into(),
        ));
    }
    Ok(())
}

pub(super) fn validate_installation_identity(
    plugin_id: &str,
    repository: &str,
    version: &str,
    digest: &str,
) -> Result<(), MarketplaceError> {
    if plugin_id.is_empty()
        || plugin_id.len() > 160
        || !plugin_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
    {
        return Err(MarketplaceError::Corrupt(
            "invalid installed plugin ID".into(),
        ));
    }
    normalize_github_repository(repository)?;
    release_version_parts(version).map_err(|error| MarketplaceError::Corrupt(error.to_string()))?;
    let value = digest.strip_prefix("sha256:").unwrap_or("");
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(MarketplaceError::Corrupt(
            "invalid installed package digest".into(),
        ));
    }
    Ok(())
}

pub(super) fn validate_installations(
    value: &PersistedInstallations,
) -> Result<(), MarketplaceError> {
    if value.schema_version != INSTALLATION_SCHEMA_VERSION
        || value.generation == 0
        || value.plugins.len() > MAX_SOURCES
    {
        return Err(MarketplaceError::Corrupt(
            "invalid installation index header".into(),
        ));
    }
    let mut ids = std::collections::BTreeSet::new();
    for plugin in &value.plugins {
        asterlyn_plugin_dependencies::validate_declarations(
            &plugin.plugin_id,
            &plugin.required_dependencies,
        )
        .map_err(|e| MarketplaceError::Corrupt(e.to_string()))?;
        if !ids.insert(plugin.plugin_id.as_str()) || plugin.versions.len() > 64 {
            return Err(MarketplaceError::Corrupt(
                "duplicate or oversized installed plugin entry".into(),
            ));
        }
        let mut versions = std::collections::BTreeSet::new();
        let mut active_attempts = 0;
        for version in &plugin.versions {
            asterlyn_plugin_dependencies::validate_declarations(
                &plugin.plugin_id,
                &version.dependencies,
            )
            .map_err(|e| MarketplaceError::Corrupt(e.to_string()))?;
            if !versions.insert(version.version.as_str()) {
                return Err(MarketplaceError::Corrupt(
                    "duplicate installed plugin version".into(),
                ));
            }
            validate_installation_identity(
                &plugin.plugin_id,
                &plugin.repository,
                &version.version,
                &version.package_digest,
            )?;
            if let Some(content_digest) = &version.content_digest {
                validate_content_digest(content_digest)?;
            }
            if version.runtime_status == PluginRuntimeStatus::Active {
                active_attempts += 1;
            }
        }
        if active_attempts > 1 {
            return Err(MarketplaceError::Corrupt(
                "plugin has more than one active health attempt".into(),
            ));
        }
        validate_version_pointer(plugin, plugin.pending_version.as_deref(), "pending")?;
        let active = validate_version_pointer(plugin, plugin.active_version.as_deref(), "active")?;
        let known_good =
            validate_version_pointer(plugin, plugin.known_good_version.as_deref(), "known-good")?;
        if active.is_some_and(|version| {
            !matches!(
                version.runtime_status,
                PluginRuntimeStatus::Active | PluginRuntimeStatus::KnownGood
            )
        }) {
            return Err(MarketplaceError::Corrupt(
                "active plugin pointer has an invalid runtime state".into(),
            ));
        }
        if known_good
            .is_some_and(|version| version.runtime_status != PluginRuntimeStatus::KnownGood)
        {
            return Err(MarketplaceError::Corrupt(
                "known-good plugin pointer has not passed its health checkpoint".into(),
            ));
        }
    }
    Ok(())
}

pub(super) fn migrate_installations(
    value: &mut PersistedInstallations,
) -> Result<(), MarketplaceError> {
    match value.schema_version {
        INSTALLATION_SCHEMA_VERSION => Ok(()),
        1 => {
            value.schema_version = INSTALLATION_SCHEMA_VERSION;
            Ok(())
        }
        _ => Err(MarketplaceError::Corrupt(
            "unsupported installation index schema".into(),
        )),
    }
}

fn validate_version_pointer<'a>(
    plugin: &'a InstalledPlugin,
    value: Option<&str>,
    label: &str,
) -> Result<Option<&'a AdmittedPluginVersion>, MarketplaceError> {
    let Some(value) = value else { return Ok(None) };
    let version = plugin
        .versions
        .iter()
        .find(|version| version.version == value)
        .ok_or_else(|| {
            MarketplaceError::Corrupt(format!("{label} plugin version is absent from the index"))
        })?;
    if version.runtime_status == PluginRuntimeStatus::Quarantined {
        return Err(MarketplaceError::Corrupt(format!(
            "{label} plugin version is quarantined"
        )));
    }
    Ok(Some(version))
}
