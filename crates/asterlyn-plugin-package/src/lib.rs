use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::io::{Cursor, Read};
use std::path::{Component, Path};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PACKAGE_SCHEMA_VERSION: u32 = 2;
pub const PACKAGE_ASSET_SUFFIX: &str = ".asterlyn-plugin.tgz";
pub const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_ARCHIVE_ENTRIES: usize = 2_048;
pub const MAX_EXPANDED_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
pub const SUPPORTED_CAPABILITIES: &[&str] = &[
    "executionTargets",
    "notifications",
    "processQueries",
    "runConfigurations",
    "taskAuthorization",
    "taskCache",
    "tasks",
    "toolOperations",
    "workspaceCatalog",
    "workspaceState",
];
pub const SUPPORTED_PERMISSIONS: &[&str] = &[
    "host.execution-targets.read",
    "host.notifications.publish",
    "host.process.query",
    "host.tasks.cache",
    "host.tasks.discover",
    "host.tasks.execute",
    "host.tool.execute",
    "host.workspace.catalog.read",
    "host.workspace.state",
];
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
const MANIFEST_PATH: &str = "manifest.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmissionContext<'a> {
    pub repository: &'a str,
    pub release_version: &'a str,
    pub host_version: &'a str,
    pub sdk_major: u32,
    pub runtime_protocol: u32,
    pub supported_capabilities: &'a [&'a str],
    pub supported_permissions: &'a [&'a str],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionReport {
    pub plugin_id: String,
    pub plugin_version: String,
    pub repository: String,
    pub runtime_entry: String,
    pub license_expression: String,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
    pub files: Vec<AdmittedFile>,
    pub expanded_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmittedFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdmissionError {
    PackageTooLarge,
    InvalidGzip(String),
    InvalidArchive(String),
    EntryLimit,
    InvalidPath(String),
    UnsupportedEntry(String),
    DuplicatePath(String),
    FileTooLarge(String),
    ExpandedSizeLimit,
    MissingManifest,
    ManifestTooLarge,
    InvalidManifest(String),
    Contract(String),
    Integrity(String),
}

impl fmt::Display for AdmissionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PackageTooLarge => write!(formatter, "plugin package exceeds the download limit"),
            Self::InvalidGzip(message) => write!(formatter, "invalid gzip stream: {message}"),
            Self::InvalidArchive(message) => write!(formatter, "invalid tar archive: {message}"),
            Self::EntryLimit => write!(
                formatter,
                "plugin package contains too many archive entries"
            ),
            Self::InvalidPath(path) => write!(formatter, "unsafe plugin package path: {path}"),
            Self::UnsupportedEntry(path) => write!(formatter, "unsupported archive entry: {path}"),
            Self::DuplicatePath(path) => write!(formatter, "duplicate plugin package path: {path}"),
            Self::FileTooLarge(path) => write!(
                formatter,
                "plugin package file exceeds the size limit: {path}"
            ),
            Self::ExpandedSizeLimit => {
                write!(formatter, "plugin package exceeds the expanded size limit")
            }
            Self::MissingManifest => write!(formatter, "plugin package is missing manifest.json"),
            Self::ManifestTooLarge => write!(formatter, "plugin package manifest is too large"),
            Self::InvalidManifest(message) => {
                write!(formatter, "invalid plugin package manifest: {message}")
            }
            Self::Contract(message) => {
                write!(formatter, "plugin package contract rejected: {message}")
            }
            Self::Integrity(message) => {
                write!(formatter, "plugin package integrity rejected: {message}")
            }
        }
    }
}

impl std::error::Error for AdmissionError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    schema_version: u32,
    sdk_major: u32,
    id: String,
    version: String,
    capabilities: Vec<String>,
    #[serde(default)]
    permissions: Vec<String>,
    distribution: Distribution,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Distribution {
    repository: String,
    runtime: Runtime,
    host_compatibility: HostCompatibility,
    license: License,
    integrity: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Runtime {
    protocol: u32,
    entry: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostCompatibility {
    minimum: String,
    maximum_exclusive: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct License {
    expression: String,
    file: String,
}

#[derive(Debug)]
struct ArchiveFile {
    bytes: Vec<u8>,
    size: u64,
    sha256: String,
}

pub fn inspect_package(
    package_bytes: &[u8],
    context: &AdmissionContext<'_>,
) -> Result<AdmissionReport, AdmissionError> {
    if package_bytes.len() > MAX_PACKAGE_BYTES {
        return Err(AdmissionError::PackageTooLarge);
    }
    validate_repository(context.repository)?;
    let files = read_archive(package_bytes)?;
    let manifest_file = files
        .get(MANIFEST_PATH)
        .ok_or(AdmissionError::MissingManifest)?;
    if manifest_file.bytes.len() > MAX_MANIFEST_BYTES {
        return Err(AdmissionError::ManifestTooLarge);
    }
    let manifest: PackageManifest = serde_json::from_slice(&manifest_file.bytes)
        .map_err(|error| AdmissionError::InvalidManifest(error.to_string()))?;
    validate_manifest(&manifest, context, &files)?;

    let admitted_files = files
        .iter()
        .map(|(path, file)| AdmittedFile {
            path: path.clone(),
            size: file.size,
            sha256: format!("sha256:{}", file.sha256),
        })
        .collect::<Vec<_>>();
    let expanded_bytes = admitted_files.iter().map(|file| file.size).sum();
    Ok(AdmissionReport {
        plugin_id: manifest.id,
        plugin_version: manifest.version,
        repository: manifest.distribution.repository,
        runtime_entry: manifest.distribution.runtime.entry,
        license_expression: manifest.distribution.license.expression,
        capabilities: manifest.capabilities,
        permissions: manifest.permissions,
        files: admitted_files,
        expanded_bytes,
    })
}

fn read_archive(package_bytes: &[u8]) -> Result<BTreeMap<String, ArchiveFile>, AdmissionError> {
    let decoder = GzDecoder::new(Cursor::new(package_bytes));
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|error| classify_archive_error(error.to_string()))?;
    let mut files = BTreeMap::new();
    let mut identities = BTreeSet::new();
    let mut expanded_bytes = 0_u64;
    let mut entry_count = 0_usize;

    for entry in entries {
        entry_count += 1;
        if entry_count > MAX_ARCHIVE_ENTRIES {
            return Err(AdmissionError::EntryLimit);
        }
        let mut entry = entry.map_err(|error| AdmissionError::InvalidArchive(error.to_string()))?;
        let path_bytes = entry.path_bytes();
        let path = std::str::from_utf8(path_bytes.as_ref())
            .map_err(|_| AdmissionError::InvalidPath("non-UTF-8 path".into()))?;
        let path = validate_archive_path(path)?;
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            continue;
        }
        if !entry_type.is_file() {
            return Err(AdmissionError::UnsupportedEntry(path));
        }
        if entry.size() > MAX_FILE_BYTES {
            return Err(AdmissionError::FileTooLarge(path));
        }
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .ok_or(AdmissionError::ExpandedSizeLimit)?;
        if expanded_bytes > MAX_EXPANDED_BYTES {
            return Err(AdmissionError::ExpandedSizeLimit);
        }
        let identity = path.to_lowercase();
        if !identities.insert(identity) || files.contains_key(&path) {
            return Err(AdmissionError::DuplicatePath(path));
        }
        let capacity = usize::try_from(entry.size())
            .map_err(|_| AdmissionError::FileTooLarge(path.clone()))?;
        let mut bytes = Vec::with_capacity(capacity);
        entry
            .read_to_end(&mut bytes)
            .map_err(|error| AdmissionError::InvalidArchive(error.to_string()))?;
        if bytes.len() as u64 != entry.size() {
            return Err(AdmissionError::InvalidArchive(format!(
                "archive size mismatch for {path}"
            )));
        }
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        files.insert(
            path,
            ArchiveFile {
                bytes,
                size: entry.size(),
                sha256,
            },
        );
    }
    Ok(files)
}

fn classify_archive_error(message: String) -> AdmissionError {
    if message.to_ascii_lowercase().contains("gzip") {
        AdmissionError::InvalidGzip(message)
    } else {
        AdmissionError::InvalidArchive(message)
    }
}

fn validate_archive_path(path: &str) -> Result<String, AdmissionError> {
    if path.is_empty()
        || path.len() > 512
        || path.contains('\0')
        || path.contains('\\')
        || path.starts_with('/')
        || path.starts_with("//")
        || path.as_bytes().get(1) == Some(&b':')
    {
        return Err(AdmissionError::InvalidPath(path.into()));
    }
    let candidate = Path::new(path);
    if candidate.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) || candidate
        .components()
        .any(|component| matches!(component, Component::CurDir))
    {
        return Err(AdmissionError::InvalidPath(path.into()));
    }
    let normalized = candidate.to_string_lossy().to_string();
    if normalized.is_empty() {
        return Err(AdmissionError::InvalidPath(path.into()));
    }
    Ok(normalized)
}

fn validate_manifest(
    manifest: &PackageManifest,
    context: &AdmissionContext<'_>,
    files: &BTreeMap<String, ArchiveFile>,
) -> Result<(), AdmissionError> {
    if manifest.schema_version != PACKAGE_SCHEMA_VERSION {
        return Err(contract("runtime installation requires package schema 2"));
    }
    if manifest.sdk_major != context.sdk_major {
        return Err(contract("plugin SDK major is not supported"));
    }
    validate_identifier(&manifest.id, "plugin ID")?;
    validate_version(&manifest.version, "plugin version")?;
    validate_version(context.release_version, "Release version")?;
    if manifest.version != context.release_version {
        return Err(contract(
            "manifest version does not match the Release version",
        ));
    }
    validate_repository(&manifest.distribution.repository)?;
    if manifest.distribution.repository != context.repository {
        return Err(contract(
            "manifest repository does not match the configured source",
        ));
    }
    if manifest.distribution.runtime.protocol != context.runtime_protocol {
        return Err(contract("plugin-host runtime protocol is not supported"));
    }
    let runtime_entry = validate_archive_path(&manifest.distribution.runtime.entry)?;
    if runtime_entry == MANIFEST_PATH || !runtime_entry.ends_with(".js") {
        return Err(contract(
            "runtime entry must be a packaged JavaScript artifact",
        ));
    }
    if !files.contains_key(&runtime_entry) {
        return Err(contract("runtime entry is missing from the package"));
    }
    validate_host_compatibility(
        &manifest.distribution.host_compatibility,
        context.host_version,
    )?;
    validate_license(&manifest.distribution.license, files)?;
    validate_declared_values(
        &manifest.capabilities,
        context.supported_capabilities,
        "capability",
    )?;
    validate_declared_values(
        &manifest.permissions,
        context.supported_permissions,
        "permission",
    )?;
    validate_integrity(&manifest.distribution.integrity, files)?;
    Ok(())
}

fn validate_host_compatibility(
    compatibility: &HostCompatibility,
    host_version: &str,
) -> Result<(), AdmissionError> {
    let host = parse_version(host_version, "host version")?;
    let minimum = parse_version(&compatibility.minimum, "minimum host version")?;
    if compare_versions(&host, &minimum).is_lt() {
        return Err(contract("host is older than the package minimum"));
    }
    if let Some(maximum) = compatibility.maximum_exclusive.as_deref() {
        let maximum = parse_version(maximum, "maximum host version")?;
        if compare_versions(&host, &maximum).is_ge() {
            return Err(contract("host is outside the package compatibility range"));
        }
    }
    Ok(())
}

fn validate_license(
    license: &License,
    files: &BTreeMap<String, ArchiveFile>,
) -> Result<(), AdmissionError> {
    if license.expression.len() > 256 || spdx::Expression::parse(&license.expression).is_err() {
        return Err(contract("license expression is not valid SPDX"));
    }
    let license_path = validate_archive_path(&license.file)?;
    if license_path == MANIFEST_PATH || !files.contains_key(&license_path) {
        return Err(contract("declared license text is missing"));
    }
    Ok(())
}

fn validate_integrity(
    integrity: &BTreeMap<String, String>,
    files: &BTreeMap<String, ArchiveFile>,
) -> Result<(), AdmissionError> {
    if integrity.len() + 1 != files.len() {
        return Err(AdmissionError::Integrity(
            "integrity table must cover every file except manifest.json".into(),
        ));
    }
    for (path, file) in files {
        if path == MANIFEST_PATH {
            continue;
        }
        let expected = integrity.get(path).ok_or_else(|| {
            AdmissionError::Integrity(format!("integrity entry is missing for {path}"))
        })?;
        if expected != &format!("sha256:{}", file.sha256) {
            return Err(AdmissionError::Integrity(format!(
                "SHA-256 mismatch for {path}"
            )));
        }
    }
    for path in integrity.keys() {
        let normalized = validate_archive_path(path)?;
        if normalized != *path || path == MANIFEST_PATH || !files.contains_key(path) {
            return Err(AdmissionError::Integrity(format!(
                "integrity table references an invalid file: {path}"
            )));
        }
    }
    Ok(())
}

fn validate_declared_values(
    values: &[String],
    supported: &[&str],
    kind: &str,
) -> Result<(), AdmissionError> {
    if values.len() > 64 {
        return Err(contract(format!("too many declared {kind}s")));
    }
    let mut seen = BTreeSet::new();
    for value in values {
        validate_identifier(value, kind)?;
        if !seen.insert(value) {
            return Err(contract(format!("duplicate {kind}: {value}")));
        }
        if !supported.contains(&value.as_str()) {
            return Err(contract(format!("unsupported required {kind}: {value}")));
        }
    }
    Ok(())
}

fn validate_identifier(value: &str, kind: &str) -> Result<(), AdmissionError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(contract(format!("invalid {kind}")));
    }
    Ok(())
}

fn validate_repository(repository: &str) -> Result<(), AdmissionError> {
    let Some((owner, name)) = repository.split_once('/') else {
        return Err(contract("repository must use owner/name form"));
    };
    if name.contains('/') || repository.len() > 200 {
        return Err(contract("repository must use owner/name form"));
    }
    validate_github_segment(owner, "repository owner")?;
    validate_github_segment(name, "repository name")?;
    if repository != repository.to_ascii_lowercase() {
        return Err(contract(
            "repository identity must be normalized to lowercase",
        ));
    }
    Ok(())
}

fn validate_github_segment(value: &str, kind: &str) -> Result<(), AdmissionError> {
    if value.is_empty()
        || value.len() > 100
        || value.starts_with('.')
        || value.ends_with('.')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(contract(format!("invalid {kind}")));
    }
    Ok(())
}

fn validate_version(value: &str, kind: &str) -> Result<(), AdmissionError> {
    parse_version(value, kind).map(|_| ())
}

fn parse_version(value: &str, kind: &str) -> Result<Vec<u64>, AdmissionError> {
    let raw = value.strip_prefix('v').unwrap_or(value);
    let core = raw.split_once('-').map_or(raw, |(core, _)| core);
    let parts = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| contract(format!("invalid {kind}")))?;
    if parts.len() != 3 || raw.is_empty() || raw.len() > 64 {
        return Err(contract(format!("invalid {kind}")));
    }
    Ok(parts)
}

fn compare_versions(left: &[u64], right: &[u64]) -> std::cmp::Ordering {
    left.cmp(right)
}

fn contract(message: impl Into<String>) -> AdmissionError {
    AdmissionError::Contract(message.into())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::Compression;
    use flate2::write::GzEncoder;
    use serde_json::json;
    use tar::{Builder, EntryType, Header};

    use super::*;

    const RUNTIME: &[u8] = b"export function activate() {}";
    const LICENSE: &[u8] = b"MIT License";

    fn context<'a>() -> AdmissionContext<'a> {
        AdmissionContext {
            repository: "asterlyn/example-plugin",
            release_version: "1.2.3",
            host_version: "0.1.11",
            sdk_major: 1,
            runtime_protocol: 1,
            supported_capabilities: &["tasks"],
            supported_permissions: &["host.tasks.execute"],
        }
    }

    fn digest(bytes: &[u8]) -> String {
        format!("sha256:{:x}", Sha256::digest(bytes))
    }

    fn manifest(overrides: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        let mut value = json!({
            "schemaVersion": 2,
            "sdkMajor": 1,
            "id": "dev.asterlyn.example",
            "version": "1.2.3",
            "nameKey": "name",
            "descriptionKey": "description",
            "localization": { "defaultLocale": "en-US", "locales": { "en-US": { "name": "Example", "description": "Example plugin" } } },
            "settings": [],
            "capabilities": ["tasks"],
            "permissions": ["host.tasks.execute"],
            "distribution": {
                "repository": "asterlyn/example-plugin",
                "runtime": { "protocol": 1, "entry": "runtime/plugin.js" },
                "hostCompatibility": { "minimum": "0.1.0", "maximumExclusive": "0.2.0" },
                "license": { "expression": "MIT", "file": "LICENSE" },
                "integrity": {
                    "LICENSE": digest(LICENSE),
                    "runtime/plugin.js": digest(RUNTIME)
                }
            }
        });
        overrides(&mut value);
        serde_json::to_vec_pretty(&value).unwrap()
    }

    fn archive(entries: &[(&str, &[u8], EntryType)]) -> Vec<u8> {
        let encoder = GzEncoder::new(Vec::new(), Compression::default());
        let mut builder = Builder::new(encoder);
        for (path, bytes, kind) in entries {
            let mut header = Header::new_gnu();
            header.set_entry_type(*kind);
            header.set_mode(0o644);
            header.set_size(bytes.len() as u64);
            header.set_cksum();
            builder.append_data(&mut header, path, *bytes).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    fn valid_package() -> Vec<u8> {
        let manifest = manifest(|_| {});
        archive(&[
            (MANIFEST_PATH, &manifest, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Regular),
            ("LICENSE", LICENSE, EntryType::Regular),
        ])
    }

    #[test]
    fn admits_a_bounded_schema_two_package() {
        let report = inspect_package(&valid_package(), &context()).unwrap();
        assert_eq!(report.plugin_id, "dev.asterlyn.example");
        assert_eq!(report.repository, "asterlyn/example-plugin");
        assert_eq!(report.runtime_entry, "runtime/plugin.js");
        assert_eq!(report.files.len(), 3);
    }

    #[test]
    fn rejects_schema_one_and_source_identity_drift() {
        let old = manifest(|value| value["schemaVersion"] = json!(1));
        let package = archive(&[
            (MANIFEST_PATH, &old, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Regular),
            ("LICENSE", LICENSE, EntryType::Regular),
        ]);
        assert!(
            inspect_package(&package, &context())
                .unwrap_err()
                .to_string()
                .contains("schema 2")
        );

        let drifted =
            manifest(|value| value["distribution"]["repository"] = json!("other/example-plugin"));
        let package = archive(&[
            (MANIFEST_PATH, &drifted, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Regular),
            ("LICENSE", LICENSE, EntryType::Regular),
        ]);
        assert!(
            inspect_package(&package, &context())
                .unwrap_err()
                .to_string()
                .contains("configured source")
        );
    }

    #[test]
    fn rejects_links_case_collisions_and_digest_mismatch() {
        let package_manifest = manifest(|_| {});
        let linked = archive(&[
            (MANIFEST_PATH, &package_manifest, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Symlink),
            ("LICENSE", LICENSE, EntryType::Regular),
        ]);
        assert!(matches!(
            inspect_package(&linked, &context()),
            Err(AdmissionError::UnsupportedEntry(_))
        ));

        let collision = archive(&[
            (MANIFEST_PATH, &package_manifest, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Regular),
            ("RUNTIME/PLUGIN.JS", RUNTIME, EntryType::Regular),
            ("LICENSE", LICENSE, EntryType::Regular),
        ]);
        assert!(matches!(
            inspect_package(&collision, &context()),
            Err(AdmissionError::DuplicatePath(_))
        ));

        let bad_manifest = manifest(|value| {
            value["distribution"]["integrity"]["runtime/plugin.js"] = json!("sha256:0000")
        });
        let package = archive(&[
            (MANIFEST_PATH, &bad_manifest, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Regular),
            ("LICENSE", LICENSE, EntryType::Regular),
        ]);
        assert!(matches!(
            inspect_package(&package, &context()),
            Err(AdmissionError::Integrity(_))
        ));
    }

    #[test]
    fn rejects_unknown_authority_and_missing_license_text() {
        let unknown = manifest(|value| value["permissions"] = json!(["host.everything"]));
        let package = archive(&[
            (MANIFEST_PATH, &unknown, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Regular),
            ("LICENSE", LICENSE, EntryType::Regular),
        ]);
        assert!(
            inspect_package(&package, &context())
                .unwrap_err()
                .to_string()
                .contains("unsupported required permission")
        );

        let manifest = manifest(|_| {});
        let package = archive(&[
            (MANIFEST_PATH, &manifest, EntryType::Regular),
            ("runtime/plugin.js", RUNTIME, EntryType::Regular),
        ]);
        assert!(
            inspect_package(&package, &context())
                .unwrap_err()
                .to_string()
                .contains("license text")
        );
    }

    #[test]
    fn rejects_parent_and_windows_paths_before_manifest_parsing() {
        assert!(matches!(
            validate_archive_path("../escape"),
            Err(AdmissionError::InvalidPath(_))
        ));
        assert!(matches!(
            validate_archive_path("C:/escape"),
            Err(AdmissionError::InvalidPath(_))
        ));
        assert!(matches!(
            validate_archive_path("runtime\\plugin.js"),
            Err(AdmissionError::InvalidPath(_))
        ));
    }

    #[test]
    fn malformed_gzip_fails_closed() {
        let mut bytes = Vec::new();
        bytes.write_all(b"not a package").unwrap();
        assert!(inspect_package(&bytes, &context()).is_err());
    }
}
