use super::{
    ManagedArchiveExtraction, ManagedArtifact, ManagedInstallError, storage::ensure_private_root,
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::File,
    io::{Read, Write},
    path::Path,
};
use url::{Host, Url};

const MAX_DOWNLOAD_REDIRECTS: usize = 5;
const MAX_DOWNLOAD_ORIGINS: usize = 8;

/// Native-recipe transport policy. It is deliberately not serializable and
/// never accepts a URL supplied by a plugin or the renderer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedDownloadPolicy {
    source: Url,
    allowed_origins: BTreeSet<String>,
}

impl ManagedDownloadPolicy {
    pub fn new(
        source: &str,
        allowed_redirect_origins: &[String],
    ) -> Result<Self, ManagedInstallError> {
        if allowed_redirect_origins.len() > MAX_DOWNLOAD_ORIGINS {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let source = validated_https_url(source)?;
        let mut allowed_origins = BTreeSet::new();
        allowed_origins.insert(origin(&source)?);
        for candidate in allowed_redirect_origins {
            let url = validated_https_url(candidate)?;
            if url.path() != "/" || url.query().is_some() {
                return Err(ManagedInstallError::InvalidRequest);
            }
            allowed_origins.insert(origin(&url)?);
        }
        if allowed_origins.len() > MAX_DOWNLOAD_ORIGINS {
            return Err(ManagedInstallError::ResourceLimit);
        }
        Ok(Self {
            source,
            allowed_origins,
        })
    }

    pub fn source(&self) -> &Url {
        &self.source
    }

    pub fn allowed_origins(&self) -> impl Iterator<Item = &str> {
        self.allowed_origins.iter().map(String::as_str)
    }

    /// Validate the exact response URL chain reported by the native HTTP
    /// adapter. The first item is the admitted source and later items are
    /// redirects, including the final response URL.
    pub fn validate_chain(&self, chain: &[Url]) -> Result<(), ManagedInstallError> {
        if chain.is_empty()
            || chain.len().saturating_sub(1) > MAX_DOWNLOAD_REDIRECTS
            || chain.first() != Some(&self.source)
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        let mut visited = BTreeSet::new();
        for candidate in chain {
            validate_https_url(candidate)?;
            if !self.allowed_origins.contains(&origin(candidate)?)
                || !visited.insert(candidate.as_str())
            {
                return Err(ManagedInstallError::PermissionDenied);
            }
        }
        Ok(())
    }
}

pub(super) fn acquire_verified_archive(
    root: &Path,
    artifact: &ManagedArtifact,
    extraction: &ManagedArchiveExtraction,
    source: &mut impl Read,
    mut is_cancelled: impl FnMut() -> bool,
    mut progress: impl FnMut(u64) -> Result<(), ManagedInstallError>,
) -> Result<tempfile::NamedTempFile, ManagedInstallError> {
    artifact.validate()?;
    extraction.validate()?;
    ensure_private_root(root)?;
    if is_cancelled() {
        return Err(ManagedInstallError::Cancelled);
    }
    let mut archive = tempfile::Builder::new()
        .prefix("download-")
        .tempfile_in(root)
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    set_private_file_permissions(archive.as_file())?;
    let mut digest = Sha256::new();
    let mut downloaded = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if is_cancelled() {
            return Err(ManagedInstallError::Cancelled);
        }
        let remaining = extraction.download_bytes.saturating_sub(downloaded);
        let read_limit = buffer.len().min(remaining.saturating_add(1) as usize);
        let count = source
            .read(&mut buffer[..read_limit])
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        if count == 0 {
            break;
        }
        if is_cancelled() {
            return Err(ManagedInstallError::Cancelled);
        }
        downloaded = downloaded
            .checked_add(count as u64)
            .filter(|bytes| *bytes <= extraction.download_bytes)
            .ok_or(ManagedInstallError::ResourceLimit)?;
        archive
            .write_all(&buffer[..count])
            .map_err(|_| ManagedInstallError::StorageFailed)?;
        digest.update(&buffer[..count]);
        progress(downloaded)?;
    }
    if is_cancelled() {
        return Err(ManagedInstallError::Cancelled);
    }
    if downloaded != extraction.download_bytes
        || format!("sha256:{:x}", digest.finalize()) != artifact.archive_digest
    {
        return Err(ManagedInstallError::IntegrityMismatch);
    }
    archive
        .flush()
        .and_then(|()| archive.as_file().sync_all())
        .map_err(|_| ManagedInstallError::StorageFailed)?;
    sync_directory(root)?;
    Ok(archive)
}

fn validated_https_url(value: &str) -> Result<Url, ManagedInstallError> {
    let url = Url::parse(value).map_err(|_| ManagedInstallError::InvalidRequest)?;
    validate_https_url(&url)?;
    Ok(url)
}

fn validate_https_url(url: &Url) -> Result<(), ManagedInstallError> {
    let public_domain = matches!(
        url.host(),
        Some(Host::Domain(domain))
            if domain != "localhost"
                && !domain.ends_with(".localhost")
                && !domain.ends_with(".local")
    );
    if url.scheme() != "https"
        || !public_domain
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(ManagedInstallError::InvalidRequest);
    }
    Ok(())
}

fn origin(url: &Url) -> Result<String, ManagedInstallError> {
    let value = url.origin().ascii_serialization();
    if value == "null" {
        return Err(ManagedInstallError::InvalidRequest);
    }
    Ok(value)
}

fn set_private_file_permissions(file: &File) -> Result<(), ManagedInstallError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| ManagedInstallError::StorageFailed)?;
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), ManagedInstallError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| ManagedInstallError::StorageFailed)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), ManagedInstallError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_accepts_only_the_admitted_https_chain() {
        let policy = ManagedDownloadPolicy::new(
            "https://github.com/example/server/releases/download/v1/server.gz",
            &["https://release-assets.githubusercontent.com".into()],
        )
        .unwrap();
        assert_eq!(
            policy.validate_chain(&[
                policy.source().clone(),
                Url::parse("https://release-assets.githubusercontent.com/object?token=fixed")
                    .unwrap(),
            ]),
            Ok(())
        );
        assert_eq!(
            policy.validate_chain(&[
                policy.source().clone(),
                Url::parse("http://release-assets.githubusercontent.com/object").unwrap(),
            ]),
            Err(ManagedInstallError::InvalidRequest)
        );
        assert_eq!(
            policy.validate_chain(&[
                policy.source().clone(),
                Url::parse("https://example.com/object").unwrap(),
            ]),
            Err(ManagedInstallError::PermissionDenied)
        );
    }

    #[test]
    fn policy_rejects_credentials_fragments_origin_paths_and_redirect_loops() {
        for source in [
            "http://example.com/server",
            "https://user@example.com/server",
            "https://example.com/server#fragment",
            "https://127.0.0.1/server",
            "https://service.local/server",
        ] {
            assert_eq!(
                ManagedDownloadPolicy::new(source, &[]),
                Err(ManagedInstallError::InvalidRequest)
            );
        }
        assert_eq!(
            ManagedDownloadPolicy::new(
                "https://example.com/server",
                &["https://cdn.example.com/path".into()],
            ),
            Err(ManagedInstallError::InvalidRequest)
        );
        let policy = ManagedDownloadPolicy::new("https://example.com/server", &[]).unwrap();
        assert_eq!(
            policy.validate_chain(&[policy.source().clone(), policy.source().clone()]),
            Err(ManagedInstallError::PermissionDenied)
        );
    }
}
