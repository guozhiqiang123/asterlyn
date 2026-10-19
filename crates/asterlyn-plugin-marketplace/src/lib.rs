use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const SOURCE_SCHEMA_VERSION: u32 = 1;
pub const MAX_SOURCES: usize = 64;
pub const BUILT_IN_ANDROID_REPOSITORY: &str = "guozhiqiang123/asterlyn-plugin-android-gradle";
const SOURCE_FILE: &str = "sources.v1.json";
const PREVIOUS_SOURCE_FILE: &str = "sources.v1.previous.json";
const NEXT_SOURCE_FILE: &str = "sources.v1.next.json";
const MAX_SOURCE_FILE_BYTES: u64 = 256 * 1024;
const MAX_NAME_CHARACTERS: usize = 80;
const MAX_DESCRIPTION_CHARACTERS: usize = 500;
const MAX_RELEASE_METADATA_BYTES: usize = 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;
const PACKAGE_SUFFIX: &str = ".asterlyn-plugin.tgz";
pub const INSTALLATION_SCHEMA_VERSION: u32 = 1;
const INSTALLATION_FILE: &str = "installations.v1.json";
const PREVIOUS_INSTALLATION_FILE: &str = "installations.v1.previous.json";
const NEXT_INSTALLATION_FILE: &str = "installations.v1.next.json";
const MAX_INSTALLATION_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSource {
    pub repository: String,
    pub name: String,
    pub description: String,
    pub built_in: bool,
    pub enabled: bool,
    #[serde(default)]
    pub catalog: Option<PluginSourceCatalog>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSourceCatalog {
    pub status: PluginSourceCatalogStatus,
    pub checked_at_epoch_ms: u64,
    pub stale: bool,
    pub version: Option<String>,
    pub release_url: Option<String>,
    pub asset_name: Option<String>,
    #[serde(default)]
    pub asset_download_url: Option<String>,
    pub asset_size_bytes: Option<u64>,
    pub digest: Option<String>,
    pub error: Option<String>,
    pub rate_limit_reset_epoch_ms: Option<u64>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginSourceCatalogStatus {
    Available,
    NoRelease,
    Error,
    RateLimited,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSourceSnapshot {
    pub schema_version: u32,
    pub generation: u64,
    pub sources: Vec<PluginSource>,
    pub recovered: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmittedPluginVersion {
    pub version: String,
    pub package_digest: String,
    pub admitted_at_epoch_ms: u64,
    pub runtime_status: PluginRuntimeStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginRuntimeStatus {
    PendingRuntime,
    PendingRestart,
    Active,
    KnownGood,
    Quarantined,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub plugin_id: String,
    pub repository: String,
    pub enabled: bool,
    pub bundled_fallback: bool,
    pub active_version: Option<String>,
    pub known_good_version: Option<String>,
    pub pending_version: Option<String>,
    pub versions: Vec<AdmittedPluginVersion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallationSnapshot {
    pub schema_version: u32,
    pub generation: u64,
    pub plugins: Vec<InstalledPlugin>,
    pub recovered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedInstallations {
    schema_version: u32,
    generation: u64,
    plugins: Vec<InstalledPlugin>,
}

pub struct PluginInstallationStore {
    root: PathBuf,
}

impl PluginInstallationStore {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, MarketplaceError> {
        let root = root.into();
        fs::create_dir_all(&root)
            .map_err(|error| io_error("create installation directory", error))?;
        Ok(Self { root })
    }

    pub fn snapshot(&self) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let (persisted, recovered) = self.read_with_recovery()?;
        Ok(PluginInstallationSnapshot {
            schema_version: INSTALLATION_SCHEMA_VERSION,
            generation: persisted.generation,
            plugins: persisted.plugins,
            recovered,
        })
    }

    pub fn record_admitted(
        &self,
        plugin_id: &str,
        repository: &str,
        version: &str,
        package_digest: &str,
        admitted_at_epoch_ms: u64,
        bundled_fallback: bool,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        validate_installation_identity(plugin_id, repository, version, package_digest)?;
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
                return Ok(snapshot);
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
                plugin_id: plugin_id.into(),
                repository: repository.into(),
                enabled: true,
                bundled_fallback,
                active_version: None,
                known_good_version: None,
                pending_version: None,
                versions: Vec::new(),
            });
            plugins.last_mut().expect("just inserted plugin")
        };
        plugin.versions.push(AdmittedPluginVersion {
            version: version.into(),
            package_digest: package_digest.into(),
            admitted_at_epoch_ms,
            runtime_status: PluginRuntimeStatus::PendingRestart,
        });
        plugin
            .versions
            .sort_by(|left, right| left.version.cmp(&right.version));
        plugin.pending_version = Some(version.into());
        self.write(snapshot.generation + 1, plugins)
    }

    pub fn begin_activation(
        &self,
        plugin_id: &str,
        version: &str,
        package_digest: &str,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.mutate_exact_version(plugin_id, version, package_digest, |plugin, admitted| {
            if !plugin.enabled {
                return Err(MarketplaceError::Conflict(
                    "installed plugin is disabled".into(),
                ));
            }
            if plugin.pending_version.as_deref() != Some(version)
                && plugin.active_version.as_deref() != Some(version)
                && plugin.known_good_version.as_deref() != Some(version)
            {
                return Err(MarketplaceError::Conflict(
                    "plugin version is not selected for activation".into(),
                ));
            }
            match admitted.runtime_status {
                PluginRuntimeStatus::PendingRuntime => {
                    admitted.runtime_status = PluginRuntimeStatus::Active;
                    plugin.active_version = Some(version.into());
                    Ok(true)
                }
                PluginRuntimeStatus::Active | PluginRuntimeStatus::KnownGood => Ok(false),
                PluginRuntimeStatus::PendingRestart => Err(MarketplaceError::Conflict(
                    "plugin version requires restart before activation".into(),
                )),
                PluginRuntimeStatus::Quarantined => Err(MarketplaceError::Conflict(
                    "plugin version is quarantined".into(),
                )),
            }
        })
    }

    pub fn promote_healthy(
        &self,
        plugin_id: &str,
        version: &str,
        package_digest: &str,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.mutate_exact_version(plugin_id, version, package_digest, |plugin, admitted| {
            if admitted.runtime_status == PluginRuntimeStatus::KnownGood
                && plugin.active_version.as_deref() == Some(version)
                && plugin.known_good_version.as_deref() == Some(version)
                && plugin.pending_version.is_none()
            {
                return Ok(false);
            }
            if admitted.runtime_status != PluginRuntimeStatus::Active
                || plugin.active_version.as_deref() != Some(version)
            {
                return Err(MarketplaceError::Conflict(
                    "plugin activation is not awaiting a health checkpoint".into(),
                ));
            }
            admitted.runtime_status = PluginRuntimeStatus::KnownGood;
            plugin.active_version = Some(version.into());
            plugin.known_good_version = Some(version.into());
            if plugin.pending_version.as_deref() == Some(version) {
                plugin.pending_version = None;
            }
            Ok(true)
        })
    }

    pub fn mark_activation_failed(
        &self,
        plugin_id: &str,
        version: &str,
        package_digest: &str,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.mutate_exact_version(plugin_id, version, package_digest, |plugin, admitted| {
            if admitted.runtime_status == PluginRuntimeStatus::Quarantined {
                return Ok(false);
            }
            if !matches!(
                admitted.runtime_status,
                PluginRuntimeStatus::PendingRuntime | PluginRuntimeStatus::Active
            ) {
                return Err(MarketplaceError::Conflict(
                    "only a pending activation can be quarantined".into(),
                ));
            }
            admitted.runtime_status = PluginRuntimeStatus::Quarantined;
            if plugin.pending_version.as_deref() == Some(version) {
                plugin.pending_version = None;
            }
            if plugin.active_version.as_deref() == Some(version) {
                plugin.active_version = plugin.known_good_version.clone();
            }
            Ok(true)
        })
    }

    pub fn abandon_activation(
        &self,
        plugin_id: &str,
        version: &str,
        package_digest: &str,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        self.mutate_exact_version(plugin_id, version, package_digest, |plugin, admitted| {
            if admitted.runtime_status != PluginRuntimeStatus::Active {
                return Ok(false);
            }
            admitted.runtime_status = PluginRuntimeStatus::PendingRuntime;
            plugin.active_version = plugin.known_good_version.clone();
            plugin.pending_version = Some(version.into());
            Ok(true)
        })
    }

    pub fn recover_interrupted_activations(
        &self,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let snapshot = self.snapshot()?;
        let mut plugins = snapshot.plugins;
        let mut changed = false;
        for plugin in &mut plugins {
            for version in &mut plugin.versions {
                if version.runtime_status == PluginRuntimeStatus::PendingRestart {
                    version.runtime_status = PluginRuntimeStatus::PendingRuntime;
                    changed = true;
                }
            }
            let interrupted = plugin
                .versions
                .iter_mut()
                .filter(|version| version.runtime_status == PluginRuntimeStatus::Active)
                .map(|version| {
                    version.runtime_status = PluginRuntimeStatus::Quarantined;
                    version.version.clone()
                })
                .collect::<Vec<_>>();
            if interrupted.is_empty() {
                continue;
            }
            changed = true;
            if plugin
                .pending_version
                .as_ref()
                .is_some_and(|version| interrupted.contains(version))
            {
                plugin.pending_version = None;
            }
            if plugin
                .active_version
                .as_ref()
                .is_some_and(|version| interrupted.contains(version))
            {
                plugin.active_version = plugin.known_good_version.clone();
            }
        }
        if changed {
            self.write(snapshot.generation + 1, plugins)
        } else {
            Ok(PluginInstallationSnapshot {
                plugins,
                ..snapshot
            })
        }
    }

    pub fn abandon_all_activations(&self) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let snapshot = self.snapshot()?;
        let mut plugins = snapshot.plugins;
        let mut changed = false;
        for plugin in &mut plugins {
            let abandoned = plugin
                .versions
                .iter_mut()
                .filter(|version| version.runtime_status == PluginRuntimeStatus::Active)
                .map(|version| {
                    version.runtime_status = PluginRuntimeStatus::PendingRuntime;
                    version.version.clone()
                })
                .collect::<Vec<_>>();
            if abandoned.is_empty() {
                continue;
            }
            changed = true;
            plugin.active_version = plugin.known_good_version.clone();
            if plugin.pending_version.is_none() {
                plugin.pending_version = abandoned.first().cloned();
            }
        }
        if changed {
            self.write(snapshot.generation + 1, plugins)
        } else {
            Ok(PluginInstallationSnapshot {
                plugins,
                ..snapshot
            })
        }
    }

    fn mutate_exact_version(
        &self,
        plugin_id: &str,
        version: &str,
        package_digest: &str,
        mutate: impl FnOnce(
            &mut InstalledPlugin,
            &mut AdmittedPluginVersion,
        ) -> Result<bool, MarketplaceError>,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let snapshot = self.snapshot()?;
        let mut plugins = snapshot.plugins;
        let plugin = plugins
            .iter_mut()
            .find(|plugin| plugin.plugin_id == plugin_id)
            .ok_or_else(|| MarketplaceError::NotFound(plugin_id.into()))?;
        validate_installation_identity(plugin_id, &plugin.repository, version, package_digest)?;
        let version_index = plugin
            .versions
            .iter()
            .position(|candidate| candidate.version == version)
            .ok_or_else(|| MarketplaceError::NotFound(format!("{plugin_id}@{version}")))?;
        if plugin.versions[version_index].package_digest != package_digest {
            return Err(MarketplaceError::Conflict(
                "plugin package digest does not match the installed version".into(),
            ));
        }
        let mut admitted = plugin.versions.remove(version_index);
        let changed = mutate(plugin, &mut admitted)?;
        plugin.versions.insert(version_index, admitted);
        if changed {
            self.write(snapshot.generation + 1, plugins)
        } else {
            Ok(PluginInstallationSnapshot {
                plugins,
                ..snapshot
            })
        }
    }

    fn read_with_recovery(&self) -> Result<(PersistedInstallations, bool), MarketplaceError> {
        match self.read_file(INSTALLATION_FILE) {
            Ok(Some(value)) => Ok((value, false)),
            Ok(None) => Ok((
                PersistedInstallations {
                    schema_version: INSTALLATION_SCHEMA_VERSION,
                    generation: 1,
                    plugins: Vec::new(),
                },
                false,
            )),
            Err(current) => match self.read_file(PREVIOUS_INSTALLATION_FILE) {
                Ok(Some(value)) => Ok((value, true)),
                _ => Err(current),
            },
        }
    }

    fn read_file(&self, name: &str) -> Result<Option<PersistedInstallations>, MarketplaceError> {
        let path = self.root.join(name);
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(io_error("read installation metadata", error)),
        };
        if !metadata.is_file() || metadata.len() > MAX_INSTALLATION_FILE_BYTES {
            return Err(MarketplaceError::Corrupt(
                "installation index has an invalid size or type".into(),
            ));
        }
        let bytes = fs::read(path).map_err(|error| io_error("read installation index", error))?;
        let value: PersistedInstallations = serde_json::from_slice(&bytes)
            .map_err(|error| MarketplaceError::Corrupt(error.to_string()))?;
        validate_installations(&value)?;
        Ok(Some(value))
    }

    fn write(
        &self,
        generation: u64,
        plugins: Vec<InstalledPlugin>,
    ) -> Result<PluginInstallationSnapshot, MarketplaceError> {
        let persisted = PersistedInstallations {
            schema_version: INSTALLATION_SCHEMA_VERSION,
            generation,
            plugins,
        };
        validate_installations(&persisted)?;
        let bytes = serde_json::to_vec_pretty(&persisted)
            .map_err(|error| MarketplaceError::Io(error.to_string()))?;
        if bytes.len() as u64 > MAX_INSTALLATION_FILE_BYTES {
            return Err(MarketplaceError::Conflict(
                "installation index exceeds its storage limit".into(),
            ));
        }
        let next = self.root.join(NEXT_INSTALLATION_FILE);
        write_new_file(&next, &bytes)?;
        let current = self.root.join(INSTALLATION_FILE);
        let previous = self.root.join(PREVIOUS_INSTALLATION_FILE);
        if previous.exists() {
            fs::remove_file(&previous)
                .map_err(|error| io_error("replace installation backup", error))?;
        }
        if current.exists() {
            fs::rename(&current, &previous)
                .map_err(|error| io_error("preserve installation backup", error))?;
        }
        fs::rename(&next, &current)
            .map_err(|error| io_error("publish installation index", error))?;
        sync_directory(&self.root)?;
        Ok(PluginInstallationSnapshot {
            schema_version: INSTALLATION_SCHEMA_VERSION,
            generation,
            plugins: persisted.plugins,
            recovered: false,
        })
    }
}

fn validate_installation_identity(
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

fn validate_installations(value: &PersistedInstallations) -> Result<(), MarketplaceError> {
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
        if !ids.insert(plugin.plugin_id.as_str()) || plugin.versions.len() > 64 {
            return Err(MarketplaceError::Corrupt(
                "duplicate or oversized installed plugin entry".into(),
            ));
        }
        let mut versions = std::collections::BTreeSet::new();
        let mut active_attempts = 0;
        for version in &plugin.versions {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MarketplaceError {
    InvalidInput(String),
    Conflict(String),
    NotFound(String),
    Io(String),
    Corrupt(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReleaseDiscoveryError {
    MetadataTooLarge,
    Invalid(String),
}

impl std::fmt::Display for ReleaseDiscoveryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MetadataTooLarge => {
                write!(formatter, "GitHub returned oversized Release metadata")
            }
            Self::Invalid(message) => write!(formatter, "GitHub Release was rejected: {message}"),
        }
    }
}

impl std::error::Error for ReleaseDiscoveryError {}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

impl std::fmt::Display for MarketplaceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(formatter, "invalid plugin source: {message}"),
            Self::Conflict(message) => write!(formatter, "plugin source conflict: {message}"),
            Self::NotFound(message) => write!(formatter, "plugin source was not found: {message}"),
            Self::Io(message) => write!(formatter, "plugin source storage failed: {message}"),
            Self::Corrupt(message) => {
                write!(formatter, "plugin source catalog is corrupt: {message}")
            }
        }
    }
}

impl std::error::Error for MarketplaceError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedSources {
    schema_version: u32,
    generation: u64,
    sources: Vec<PluginSource>,
}

pub struct PluginSourceStore {
    root: PathBuf,
}

impl PluginSourceStore {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, MarketplaceError> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(|error| io_error("create source directory", error))?;
        if !root.is_dir() {
            return Err(MarketplaceError::Io(
                "source storage location is not a directory".into(),
            ));
        }
        Ok(Self { root })
    }

    pub fn snapshot(&self) -> Result<PluginSourceSnapshot, MarketplaceError> {
        let (persisted, recovered) = self.read_with_recovery()?;
        let persisted = merge_built_in(persisted);
        Ok(PluginSourceSnapshot {
            schema_version: SOURCE_SCHEMA_VERSION,
            generation: persisted.generation,
            sources: persisted.sources,
            recovered,
        })
    }

    pub fn upsert_custom(
        &self,
        repository_input: &str,
        name: &str,
        description: &str,
    ) -> Result<PluginSourceSnapshot, MarketplaceError> {
        let repository = normalize_github_repository(repository_input)?;
        let name = validate_text(name, MAX_NAME_CHARACTERS, "name")?;
        let description = validate_text(description, MAX_DESCRIPTION_CHARACTERS, "description")?;
        let snapshot = self.snapshot()?;
        if snapshot
            .sources
            .iter()
            .any(|source| source.repository == repository && source.built_in)
        {
            return Err(MarketplaceError::Conflict(
                "the built-in source cannot be replaced".into(),
            ));
        }
        let mut sources = snapshot.sources;
        if let Some(source) = sources
            .iter_mut()
            .find(|source| source.repository == repository)
        {
            source.name = name;
            source.description = description;
        } else {
            if sources.len() >= MAX_SOURCES {
                return Err(MarketplaceError::Conflict(format!(
                    "at most {MAX_SOURCES} sources are allowed"
                )));
            }
            sources.push(PluginSource {
                repository,
                name,
                description,
                built_in: false,
                enabled: true,
                catalog: None,
            });
        }
        self.write(snapshot.generation + 1, sources)
    }

    pub fn set_enabled(
        &self,
        repository_input: &str,
        enabled: bool,
    ) -> Result<PluginSourceSnapshot, MarketplaceError> {
        let repository = normalize_github_repository(repository_input)?;
        let snapshot = self.snapshot()?;
        let mut sources = snapshot.sources;
        let source = sources
            .iter_mut()
            .find(|source| source.repository == repository)
            .ok_or_else(|| MarketplaceError::NotFound(repository.clone()))?;
        if source.enabled == enabled {
            return Ok(PluginSourceSnapshot {
                sources,
                ..snapshot
            });
        }
        source.enabled = enabled;
        self.write(snapshot.generation + 1, sources)
    }

    pub fn remove_custom(
        &self,
        repository_input: &str,
    ) -> Result<PluginSourceSnapshot, MarketplaceError> {
        let repository = normalize_github_repository(repository_input)?;
        let snapshot = self.snapshot()?;
        let source = snapshot
            .sources
            .iter()
            .find(|source| source.repository == repository)
            .ok_or_else(|| MarketplaceError::NotFound(repository.clone()))?;
        if source.built_in {
            return Err(MarketplaceError::Conflict(
                "the built-in source cannot be removed".into(),
            ));
        }
        let sources = snapshot
            .sources
            .into_iter()
            .filter(|source| source.repository != repository)
            .collect();
        self.write(snapshot.generation + 1, sources)
    }

    pub fn update_catalog(
        &self,
        repository_input: &str,
        expected_generation: u64,
        catalog: PluginSourceCatalog,
    ) -> Result<PluginSourceSnapshot, MarketplaceError> {
        let repository = normalize_github_repository(repository_input)?;
        validate_catalog(&catalog)?;
        let snapshot = self.snapshot()?;
        if snapshot.generation != expected_generation {
            return Err(MarketplaceError::Conflict(
                "source catalog changed while the Release was being checked".into(),
            ));
        }
        let mut sources = snapshot.sources;
        let source = sources
            .iter_mut()
            .find(|source| source.repository == repository)
            .ok_or_else(|| MarketplaceError::NotFound(repository.clone()))?;
        source.catalog = Some(catalog);
        self.write(snapshot.generation + 1, sources)
    }

    fn read_with_recovery(&self) -> Result<(PersistedSources, bool), MarketplaceError> {
        match self.read_file(SOURCE_FILE) {
            Ok(Some(value)) => Ok((value, false)),
            Ok(None) => Ok((empty_sources(), false)),
            Err(current_error) => match self.read_file(PREVIOUS_SOURCE_FILE) {
                Ok(Some(value)) => Ok((value, true)),
                Ok(None) | Err(_) => Err(current_error),
            },
        }
    }

    fn read_file(&self, name: &str) -> Result<Option<PersistedSources>, MarketplaceError> {
        let path = self.root.join(name);
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(io_error("read source metadata", error)),
        };
        if !metadata.is_file() || metadata.len() > MAX_SOURCE_FILE_BYTES {
            return Err(MarketplaceError::Corrupt(
                "source catalog file has an invalid size or type".into(),
            ));
        }
        let bytes = fs::read(&path).map_err(|error| io_error("read source catalog", error))?;
        let persisted: PersistedSources = serde_json::from_slice(&bytes)
            .map_err(|error| MarketplaceError::Corrupt(error.to_string()))?;
        validate_persisted(&persisted)?;
        Ok(Some(persisted))
    }

    fn write(
        &self,
        generation: u64,
        sources: Vec<PluginSource>,
    ) -> Result<PluginSourceSnapshot, MarketplaceError> {
        let persisted = PersistedSources {
            schema_version: SOURCE_SCHEMA_VERSION,
            generation,
            sources,
        };
        validate_persisted(&persisted)?;
        let bytes = serde_json::to_vec_pretty(&persisted)
            .map_err(|error| MarketplaceError::Io(error.to_string()))?;
        if bytes.len() as u64 > MAX_SOURCE_FILE_BYTES {
            return Err(MarketplaceError::Conflict(
                "source catalog exceeds its storage limit".into(),
            ));
        }
        let next = self.root.join(NEXT_SOURCE_FILE);
        write_new_file(&next, &bytes)?;
        let current = self.root.join(SOURCE_FILE);
        let previous = self.root.join(PREVIOUS_SOURCE_FILE);
        if previous.exists() {
            fs::remove_file(&previous).map_err(|error| io_error("replace source backup", error))?;
        }
        if current.exists() {
            fs::rename(&current, &previous)
                .map_err(|error| io_error("preserve source backup", error))?;
        }
        fs::rename(&next, &current).map_err(|error| io_error("publish source catalog", error))?;
        sync_directory(&self.root)?;
        Ok(PluginSourceSnapshot {
            schema_version: SOURCE_SCHEMA_VERSION,
            generation,
            sources: persisted.sources,
            recovered: false,
        })
    }
}

pub fn normalize_github_repository(input: &str) -> Result<String, MarketplaceError> {
    let mut value = input.trim().trim_end_matches('/');
    if let Some(repository) = value.strip_prefix("https://github.com/") {
        value = repository;
    } else if value.contains("://") || value.starts_with("git@") {
        return Err(MarketplaceError::InvalidInput(
            "only public https://github.com URLs or owner/repository are supported".into(),
        ));
    }
    value = value.strip_suffix(".git").unwrap_or(value);
    let Some((owner, repository)) = value.split_once('/') else {
        return Err(MarketplaceError::InvalidInput(
            "repository must use owner/repository form".into(),
        ));
    };
    if repository.contains('/') || value.len() > 200 {
        return Err(MarketplaceError::InvalidInput(
            "repository must identify exactly one GitHub repository".into(),
        ));
    }
    validate_repository_segment(owner, "owner")?;
    validate_repository_segment(repository, "repository")?;
    Ok(format!(
        "{}/{}",
        owner.to_ascii_lowercase(),
        repository.to_ascii_lowercase()
    ))
}

pub fn parse_github_release(
    repository_input: &str,
    bytes: &[u8],
    checked_at_epoch_ms: u64,
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<PluginSourceCatalog, ReleaseDiscoveryError> {
    if bytes.len() > MAX_RELEASE_METADATA_BYTES {
        return Err(ReleaseDiscoveryError::MetadataTooLarge);
    }
    let repository = normalize_github_repository(repository_input)
        .map_err(|error| ReleaseDiscoveryError::Invalid(error.to_string()))?;
    let release: GitHubRelease = serde_json::from_slice(bytes).map_err(|error| {
        ReleaseDiscoveryError::Invalid(format!("unrecognized response: {error}"))
    })?;
    if release.draft || release.prerelease {
        return Err(ReleaseDiscoveryError::Invalid(
            "draft and prerelease versions are not installable".into(),
        ));
    }
    let version = normalize_release_version(&release.tag_name)?;
    let expected_release_url = format!(
        "https://github.com/{repository}/releases/tag/{}",
        release.tag_name
    );
    if release.html_url != expected_release_url {
        return Err(ReleaseDiscoveryError::Invalid(
            "Release URL does not match the configured repository".into(),
        ));
    }
    let mut assets = release
        .assets
        .iter()
        .filter(|asset| asset.name.ends_with(PACKAGE_SUFFIX));
    let asset = assets.next().ok_or_else(|| {
        ReleaseDiscoveryError::Invalid(format!("Release must contain one {PACKAGE_SUFFIX} asset"))
    })?;
    if assets.next().is_some() {
        return Err(ReleaseDiscoveryError::Invalid(format!(
            "Release contains more than one {PACKAGE_SUFFIX} asset"
        )));
    }
    validate_release_asset(&repository, &release.tag_name, asset)?;
    Ok(PluginSourceCatalog {
        status: PluginSourceCatalogStatus::Available,
        checked_at_epoch_ms,
        stale: false,
        version: Some(version),
        release_url: Some(release.html_url),
        asset_name: Some(asset.name.clone()),
        asset_download_url: Some(asset.browser_download_url.clone()),
        asset_size_bytes: Some(asset.size),
        digest: asset
            .digest
            .as_ref()
            .map(|digest| digest.to_ascii_lowercase()),
        error: None,
        rate_limit_reset_epoch_ms: None,
        etag,
        last_modified,
    })
}

pub fn compare_release_versions(
    left: &str,
    right: &str,
) -> Result<std::cmp::Ordering, ReleaseDiscoveryError> {
    Ok(release_version_parts(left)?.cmp(&release_version_parts(right)?))
}

fn normalize_release_version(tag: &str) -> Result<String, ReleaseDiscoveryError> {
    let value = tag.strip_prefix('v').unwrap_or(tag);
    release_version_parts(value)?;
    Ok(value.into())
}

fn release_version_parts(version: &str) -> Result<Vec<u64>, ReleaseDiscoveryError> {
    if version.is_empty() || version.len() > 64 || version.contains(['-', '+']) {
        return Err(ReleaseDiscoveryError::Invalid(
            "Release tag must be a stable semantic version".into(),
        ));
    }
    let parts = version
        .strip_prefix('v')
        .unwrap_or(version)
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            ReleaseDiscoveryError::Invalid("Release tag is not semantic versioned".into())
        })?;
    if parts.len() != 3 {
        return Err(ReleaseDiscoveryError::Invalid(
            "Release tag is not semantic versioned".into(),
        ));
    }
    Ok(parts)
}

fn validate_release_asset(
    repository: &str,
    tag: &str,
    asset: &GitHubReleaseAsset,
) -> Result<(), ReleaseDiscoveryError> {
    if asset.size == 0 || asset.size > MAX_PACKAGE_BYTES {
        return Err(ReleaseDiscoveryError::Invalid(
            "plugin asset size is outside the allowed range".into(),
        ));
    }
    if asset.name.is_empty()
        || asset.name.len() > 200
        || !asset
            .name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(ReleaseDiscoveryError::Invalid(
            "plugin asset name is unsafe".into(),
        ));
    }
    let digest = asset
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .filter(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| {
            ReleaseDiscoveryError::Invalid("plugin asset is missing a SHA-256 digest".into())
        })?;
    let expected_url = format!(
        "https://github.com/{repository}/releases/download/{tag}/{}",
        asset.name
    );
    if asset.browser_download_url != expected_url || digest.is_empty() {
        return Err(ReleaseDiscoveryError::Invalid(
            "plugin asset download URL does not match the Release".into(),
        ));
    }
    Ok(())
}

fn merge_built_in(mut persisted: PersistedSources) -> PersistedSources {
    for source in &mut persisted.sources {
        repair_legacy_download_url(source);
    }
    if let Some(source) = persisted
        .sources
        .iter_mut()
        .find(|source| source.repository == BUILT_IN_ANDROID_REPOSITORY)
    {
        source.name = "Android".into();
        source.description = "Android project tasks, devices, deployment, and Run support.".into();
        source.built_in = true;
    } else {
        persisted.sources.insert(0, built_in_android_source());
    }
    persisted
}

fn repair_legacy_download_url(source: &mut PluginSource) {
    let Some(catalog) = source.catalog.as_mut() else {
        return;
    };
    if catalog.asset_download_url.is_some() {
        return;
    }
    let Some(release_url) = catalog.release_url.as_deref() else {
        return;
    };
    let Some(asset_name) = catalog.asset_name.as_deref() else {
        return;
    };
    let prefix = format!("https://github.com/{}/releases/tag/", source.repository);
    let Some(tag) = release_url.strip_prefix(&prefix) else {
        return;
    };
    if tag.is_empty() || tag.contains('/') {
        return;
    }
    catalog.asset_download_url = Some(format!(
        "https://github.com/{}/releases/download/{tag}/{asset_name}",
        source.repository
    ));
}

fn built_in_android_source() -> PluginSource {
    PluginSource {
        repository: BUILT_IN_ANDROID_REPOSITORY.into(),
        name: "Android".into(),
        description: "Android project tasks, devices, deployment, and Run support.".into(),
        built_in: true,
        enabled: true,
        catalog: None,
    }
}

fn empty_sources() -> PersistedSources {
    PersistedSources {
        schema_version: SOURCE_SCHEMA_VERSION,
        generation: 1,
        sources: vec![built_in_android_source()],
    }
}

fn validate_persisted(persisted: &PersistedSources) -> Result<(), MarketplaceError> {
    if persisted.schema_version != SOURCE_SCHEMA_VERSION || persisted.generation == 0 {
        return Err(MarketplaceError::Corrupt(
            "source catalog schema or generation is invalid".into(),
        ));
    }
    if persisted.sources.len() > MAX_SOURCES {
        return Err(MarketplaceError::Corrupt(
            "source catalog exceeds the source limit".into(),
        ));
    }
    let mut repositories = std::collections::BTreeSet::new();
    for source in &persisted.sources {
        if normalize_github_repository(&source.repository)? != source.repository {
            return Err(MarketplaceError::Corrupt(
                "source repository is not normalized".into(),
            ));
        }
        validate_text(&source.name, MAX_NAME_CHARACTERS, "name")?;
        validate_text(
            &source.description,
            MAX_DESCRIPTION_CHARACTERS,
            "description",
        )?;
        if !repositories.insert(&source.repository) {
            return Err(MarketplaceError::Corrupt(
                "source repository is duplicated".into(),
            ));
        }
        if let Some(catalog) = &source.catalog {
            validate_catalog(catalog)?;
        }
    }
    Ok(())
}

fn validate_catalog(catalog: &PluginSourceCatalog) -> Result<(), MarketplaceError> {
    if catalog.checked_at_epoch_ms == 0 {
        return Err(MarketplaceError::InvalidInput(
            "catalog check time is invalid".into(),
        ));
    }
    for value in [
        catalog.version.as_deref(),
        catalog.release_url.as_deref(),
        catalog.asset_name.as_deref(),
        catalog.asset_download_url.as_deref(),
        catalog.digest.as_deref(),
        catalog.error.as_deref(),
        catalog.etag.as_deref(),
        catalog.last_modified.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if value.is_empty() || value.len() > 2_048 || value.contains(['\r', '\n', '\0']) {
            return Err(MarketplaceError::InvalidInput(
                "catalog metadata contains an invalid value".into(),
            ));
        }
    }
    let has_release = catalog.version.is_some()
        && catalog.release_url.is_some()
        && catalog.asset_name.is_some()
        && catalog.asset_size_bytes.is_some()
        && catalog.digest.is_some();
    match catalog.status {
        PluginSourceCatalogStatus::Available if !has_release => {
            return Err(MarketplaceError::InvalidInput(
                "available catalog state requires complete Release metadata".into(),
            ));
        }
        PluginSourceCatalogStatus::Available if catalog.error.is_some() && !catalog.stale => {
            return Err(MarketplaceError::InvalidInput(
                "a fresh available catalog cannot contain an error".into(),
            ));
        }
        PluginSourceCatalogStatus::Available => {}
        _ if (has_release && !catalog.stale) || catalog.error.is_none() => {
            return Err(MarketplaceError::InvalidInput(
                "unavailable catalog state requires one error; cached Release metadata must be stale".into(),
            ));
        }
        _ => {}
    }
    Ok(())
}

fn validate_repository_segment(value: &str, label: &str) -> Result<(), MarketplaceError> {
    if value.is_empty()
        || value.len() > 100
        || value.starts_with('.')
        || value.ends_with('.')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(MarketplaceError::InvalidInput(format!(
            "GitHub {label} is invalid"
        )));
    }
    Ok(())
}

fn validate_text(
    value: &str,
    max_characters: usize,
    label: &str,
) -> Result<String, MarketplaceError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > max_characters
        || value.contains(['\r', '\n', '\0'])
    {
        return Err(MarketplaceError::InvalidInput(format!(
            "{label} must contain 1 to {max_characters} plain-text characters"
        )));
    }
    Ok(value.into())
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), MarketplaceError> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| io_error("replace staged source catalog", error))?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| io_error("stage source catalog", error))?;
    file.write_all(bytes)
        .map_err(|error| io_error("write source catalog", error))?;
    file.sync_all()
        .map_err(|error| io_error("sync source catalog", error))?;
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), MarketplaceError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| io_error("sync source directory", error))
}

fn io_error(operation: &str, error: std::io::Error) -> MarketplaceError {
    MarketplaceError::Io(format!("{operation}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_supported_github_repository_inputs() {
        assert_eq!(
            normalize_github_repository("https://github.com/Asterlyn/Example.git/").unwrap(),
            "asterlyn/example"
        );
        assert_eq!(
            normalize_github_repository("Asterlyn/Example").unwrap(),
            "asterlyn/example"
        );
        assert!(normalize_github_repository("https://example.com/owner/repo").is_err());
        assert!(normalize_github_repository("https://github.com/owner/repo/releases").is_err());
    }

    #[test]
    fn persists_custom_sources_and_protects_the_built_in_source() {
        let directory = tempfile::tempdir().unwrap();
        let store = PluginSourceStore::open(directory.path()).unwrap();
        let initial = store.snapshot().unwrap();
        assert_eq!(initial.sources.len(), 1);
        assert!(initial.sources[0].built_in);

        let added = store
            .upsert_custom(
                "https://github.com/Asterlyn/Example",
                "Example tools",
                "Example plugin source",
            )
            .unwrap();
        assert_eq!(added.sources.len(), 2);
        assert_eq!(added.generation, initial.generation + 1);
        let reopened = PluginSourceStore::open(directory.path())
            .unwrap()
            .snapshot()
            .unwrap();
        assert_eq!(reopened.sources, added.sources);
        assert!(store.remove_custom(BUILT_IN_ANDROID_REPOSITORY).is_err());
    }

    #[test]
    fn records_admitted_versions_for_restart_without_selecting_them_active() {
        let directory = tempfile::tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        let snapshot = store
            .record_admitted(
                "dev.asterlyn.example",
                "asterlyn/example",
                "1.2.3",
                &format!("sha256:{}", "a".repeat(64)),
                42,
                false,
            )
            .unwrap();
        assert_eq!(
            snapshot.plugins[0].pending_version.as_deref(),
            Some("1.2.3")
        );
        assert_eq!(snapshot.plugins[0].active_version, None);
        assert_eq!(
            snapshot.plugins[0].versions[0].runtime_status,
            PluginRuntimeStatus::PendingRestart
        );
        assert_eq!(
            PluginInstallationStore::open(directory.path())
                .unwrap()
                .snapshot()
                .unwrap()
                .plugins,
            snapshot.plugins
        );
        let repeated = store
            .record_admitted(
                "dev.asterlyn.example",
                "asterlyn/example",
                "1.2.3",
                &format!("sha256:{}", "a".repeat(64)),
                99,
                false,
            )
            .unwrap();
        assert_eq!(repeated.generation, snapshot.generation);
        assert_eq!(repeated.plugins, snapshot.plugins);
    }

    #[test]
    fn promotes_only_the_exact_active_package_to_known_good() {
        let directory = tempfile::tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        let digest = format!("sha256:{}", "a".repeat(64));
        store
            .record_admitted(
                "dev.asterlyn.example",
                "asterlyn/example",
                "1.2.3",
                &digest,
                42,
                false,
            )
            .unwrap();
        store.recover_interrupted_activations().unwrap();

        let active = store
            .begin_activation("dev.asterlyn.example", "1.2.3", &digest)
            .unwrap();
        assert_eq!(active.plugins[0].active_version.as_deref(), Some("1.2.3"));
        assert_eq!(
            active.plugins[0].versions[0].runtime_status,
            PluginRuntimeStatus::Active
        );
        assert!(
            store
                .promote_healthy(
                    "dev.asterlyn.example",
                    "1.2.3",
                    &format!("sha256:{}", "b".repeat(64)),
                )
                .is_err()
        );

        let healthy = store
            .promote_healthy("dev.asterlyn.example", "1.2.3", &digest)
            .unwrap();
        assert_eq!(healthy.plugins[0].pending_version, None);
        assert_eq!(healthy.plugins[0].active_version.as_deref(), Some("1.2.3"));
        assert_eq!(
            healthy.plugins[0].known_good_version.as_deref(),
            Some("1.2.3")
        );
        assert_eq!(
            healthy.plugins[0].versions[0].runtime_status,
            PluginRuntimeStatus::KnownGood
        );
        assert_eq!(
            store
                .promote_healthy("dev.asterlyn.example", "1.2.3", &digest)
                .unwrap()
                .generation,
            healthy.generation
        );
    }

    #[test]
    fn quarantines_failed_update_and_selects_previous_known_good() {
        let directory = tempfile::tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        let first = format!("sha256:{}", "a".repeat(64));
        let update = format!("sha256:{}", "b".repeat(64));
        store
            .record_admitted(
                "dev.asterlyn.example",
                "asterlyn/example",
                "1.0.0",
                &first,
                1,
                false,
            )
            .unwrap();
        store.recover_interrupted_activations().unwrap();
        store
            .begin_activation("dev.asterlyn.example", "1.0.0", &first)
            .unwrap();
        store
            .promote_healthy("dev.asterlyn.example", "1.0.0", &first)
            .unwrap();
        store
            .record_admitted(
                "dev.asterlyn.example",
                "asterlyn/example",
                "2.0.0",
                &update,
                2,
                false,
            )
            .unwrap();
        store.recover_interrupted_activations().unwrap();
        store
            .begin_activation("dev.asterlyn.example", "2.0.0", &update)
            .unwrap();

        let recovered = store
            .mark_activation_failed("dev.asterlyn.example", "2.0.0", &update)
            .unwrap();
        let plugin = &recovered.plugins[0];
        assert_eq!(plugin.pending_version, None);
        assert_eq!(plugin.active_version.as_deref(), Some("1.0.0"));
        assert_eq!(plugin.known_good_version.as_deref(), Some("1.0.0"));
        assert_eq!(
            plugin
                .versions
                .iter()
                .find(|version| version.version == "2.0.0")
                .unwrap()
                .runtime_status,
            PluginRuntimeStatus::Quarantined
        );
    }

    #[test]
    fn interrupted_attempt_is_quarantined_but_graceful_abandon_is_retryable() {
        let directory = tempfile::tempdir().unwrap();
        let store = PluginInstallationStore::open(directory.path()).unwrap();
        let digest = format!("sha256:{}", "a".repeat(64));
        store
            .record_admitted(
                "dev.asterlyn.example",
                "asterlyn/example",
                "1.0.0",
                &digest,
                1,
                false,
            )
            .unwrap();
        store.recover_interrupted_activations().unwrap();
        store
            .begin_activation("dev.asterlyn.example", "1.0.0", &digest)
            .unwrap();
        let abandoned = store
            .abandon_activation("dev.asterlyn.example", "1.0.0", &digest)
            .unwrap();
        assert_eq!(
            abandoned.plugins[0].versions[0].runtime_status,
            PluginRuntimeStatus::PendingRuntime
        );
        assert_eq!(
            abandoned.plugins[0].pending_version.as_deref(),
            Some("1.0.0")
        );

        store
            .begin_activation("dev.asterlyn.example", "1.0.0", &digest)
            .unwrap();
        let app_exit = store.abandon_all_activations().unwrap();
        assert_eq!(
            app_exit.plugins[0].versions[0].runtime_status,
            PluginRuntimeStatus::PendingRuntime
        );
        store
            .begin_activation("dev.asterlyn.example", "1.0.0", &digest)
            .unwrap();
        let recovered = PluginInstallationStore::open(directory.path())
            .unwrap()
            .recover_interrupted_activations()
            .unwrap();
        assert_eq!(recovered.plugins[0].active_version, None);
        assert_eq!(recovered.plugins[0].pending_version, None);
        assert_eq!(
            recovered.plugins[0].versions[0].runtime_status,
            PluginRuntimeStatus::Quarantined
        );
    }

    #[test]
    fn recovers_from_the_previous_generation() {
        let directory = tempfile::tempdir().unwrap();
        let store = PluginSourceStore::open(directory.path()).unwrap();
        store
            .upsert_custom("asterlyn/one", "One", "First source")
            .unwrap();
        store
            .upsert_custom("asterlyn/two", "Two", "Second source")
            .unwrap();
        fs::write(directory.path().join(SOURCE_FILE), b"not json").unwrap();
        let recovered = store.snapshot().unwrap();
        assert!(recovered.recovered);
        assert!(
            recovered
                .sources
                .iter()
                .any(|source| source.repository == "asterlyn/one")
        );
    }

    #[test]
    fn rejects_stale_catalog_results() {
        let directory = tempfile::tempdir().unwrap();
        let store = PluginSourceStore::open(directory.path()).unwrap();
        let snapshot = store.snapshot().unwrap();
        store
            .upsert_custom("asterlyn/one", "One", "First source")
            .unwrap();
        let result = store.update_catalog(
            BUILT_IN_ANDROID_REPOSITORY,
            snapshot.generation,
            PluginSourceCatalog {
                status: PluginSourceCatalogStatus::NoRelease,
                checked_at_epoch_ms: 1,
                stale: false,
                version: None,
                release_url: None,
                asset_name: None,
                asset_download_url: None,
                asset_size_bytes: None,
                digest: None,
                error: Some("No stable Release".into()),
                rate_limit_reset_epoch_ms: None,
                etag: None,
                last_modified: None,
            },
        );
        assert!(matches!(result, Err(MarketplaceError::Conflict(_))));
    }

    #[test]
    fn parses_one_digest_bound_plugin_asset() {
        let digest = "a".repeat(64);
        let body = serde_json::json!({
            "tag_name": "v1.2.3",
            "html_url": "https://github.com/asterlyn/example/releases/tag/v1.2.3",
            "draft": false,
            "prerelease": false,
            "assets": [{
                "name": "example-1.2.3.asterlyn-plugin.tgz",
                "browser_download_url": "https://github.com/asterlyn/example/releases/download/v1.2.3/example-1.2.3.asterlyn-plugin.tgz",
                "size": 1234,
                "digest": format!("sha256:{digest}")
            }]
        });
        let catalog = parse_github_release(
            "asterlyn/example",
            &serde_json::to_vec(&body).unwrap(),
            42,
            Some("etag-value".into()),
            None,
        )
        .unwrap();
        assert_eq!(catalog.status, PluginSourceCatalogStatus::Available);
        assert_eq!(catalog.version.as_deref(), Some("1.2.3"));
        assert_eq!(
            catalog.digest.as_deref(),
            Some(format!("sha256:{digest}").as_str())
        );
    }

    #[test]
    fn rejects_ambiguous_or_unverified_release_assets() {
        let asset = serde_json::json!({
            "name": "example.asterlyn-plugin.tgz",
            "browser_download_url": "https://github.com/asterlyn/example/releases/download/1.2.3/example.asterlyn-plugin.tgz",
            "size": 1234,
            "digest": null
        });
        let body = serde_json::json!({
            "tag_name": "1.2.3",
            "html_url": "https://github.com/asterlyn/example/releases/tag/1.2.3",
            "draft": false,
            "prerelease": false,
            "assets": [asset]
        });
        assert!(
            parse_github_release(
                "asterlyn/example",
                &serde_json::to_vec(&body).unwrap(),
                1,
                None,
                None
            )
            .is_err()
        );

        let mut ambiguous = body;
        ambiguous["assets"] = serde_json::json!([
            {
                "name": "one.asterlyn-plugin.tgz",
                "browser_download_url": "https://github.com/asterlyn/example/releases/download/1.2.3/one.asterlyn-plugin.tgz",
                "size": 1,
                "digest": format!("sha256:{}", "a".repeat(64))
            },
            {
                "name": "two.asterlyn-plugin.tgz",
                "browser_download_url": "https://github.com/asterlyn/example/releases/download/1.2.3/two.asterlyn-plugin.tgz",
                "size": 1,
                "digest": format!("sha256:{}", "b".repeat(64))
            }
        ]);
        assert!(
            parse_github_release(
                "asterlyn/example",
                &serde_json::to_vec(&ambiguous).unwrap(),
                1,
                None,
                None
            )
            .is_err()
        );
    }
}
