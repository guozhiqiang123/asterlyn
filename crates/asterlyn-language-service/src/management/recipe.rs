use super::{
    ManagedArchiveExtraction, ManagedArchiveFormat, ManagedArtifact, ManagedDownloadPolicy,
    ManagedInstallError, ManagedInstallPlan, ManagedServerId, model::digest,
};
use sha2::{Digest, Sha256};

pub const MANAGED_INSTALL_RECIPE_SCHEMA_VERSION: u32 = 1;

/// License evidence displayed during a future host-owned review. The digest
/// binds the exact notice text retained by the admitted catalog adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedRecipeLicense {
    pub expression: String,
    pub notice_url: String,
    pub notice_digest: String,
}

/// Input accepted only from a native catalog adapter. It is deliberately not
/// serializable as a plugin/renderer management request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedInstallRecipeSpec {
    pub schema_version: u32,
    pub server: ManagedServerId,
    pub version: String,
    pub target: String,
    pub recipe_digest: String,
    pub archive_digest: String,
    pub content_digest: String,
    pub source: String,
    pub allowed_redirect_origins: Vec<String>,
    pub format: ManagedArchiveFormat,
    pub download_bytes: u64,
    pub expanded_bytes: u64,
    pub license: ManagedRecipeLicense,
}

/// Canonical, native-only recipe proof. All transport and extraction inputs
/// are covered by `artifact.recipe_digest` and cannot be replaced separately.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedInstallRecipe {
    artifact: ManagedArtifact,
    extraction: ManagedArchiveExtraction,
    policy: ManagedDownloadPolicy,
    license: ManagedRecipeLicense,
}

impl ManagedInstallRecipeSpec {
    /// Used by trusted catalog tooling to produce the digest that must later be
    /// rechecked by `admit`. It does not silently overwrite the supplied value.
    pub fn calculated_digest(&self) -> Result<String, ManagedInstallError> {
        let canonical = self.canonical_parts()?;
        Ok(canonical_digest(self, &canonical))
    }

    pub fn admit(self) -> Result<ManagedInstallRecipe, ManagedInstallError> {
        if !digest(&self.recipe_digest) {
            return Err(ManagedInstallError::InvalidRequest);
        }
        let canonical = self.canonical_parts()?;
        if canonical_digest(&self, &canonical) != self.recipe_digest {
            return Err(ManagedInstallError::IntegrityMismatch);
        }
        let artifact = ManagedArtifact {
            server: self.server,
            version: self.version,
            target: self.target,
            recipe_digest: self.recipe_digest,
            archive_digest: self.archive_digest,
            content_digest: self.content_digest,
        };
        artifact.validate()?;
        Ok(ManagedInstallRecipe {
            artifact,
            extraction: canonical.extraction,
            policy: canonical.policy,
            license: canonical.license,
        })
    }

    fn canonical_parts(&self) -> Result<CanonicalRecipeParts, ManagedInstallError> {
        if self.schema_version != MANAGED_INSTALL_RECIPE_SCHEMA_VERSION {
            return Err(ManagedInstallError::UnsupportedSchema);
        }
        let identity = ManagedArtifact {
            server: self.server.clone(),
            version: self.version.clone(),
            target: self.target.clone(),
            recipe_digest: format!("sha256:{}", "0".repeat(64)),
            archive_digest: self.archive_digest.clone(),
            content_digest: self.content_digest.clone(),
        };
        identity.validate()?;
        let extraction = ManagedArchiveExtraction {
            format: self.format.clone(),
            download_bytes: self.download_bytes,
            expanded_bytes: self.expanded_bytes,
        };
        extraction.validate()?;
        let policy = ManagedDownloadPolicy::new(&self.source, &self.allowed_redirect_origins)?;
        let license = canonical_license(&self.license)?;
        Ok(CanonicalRecipeParts {
            extraction,
            policy,
            license,
        })
    }
}

impl ManagedInstallRecipe {
    pub fn artifact(&self) -> &ManagedArtifact {
        &self.artifact
    }

    pub fn extraction(&self) -> &ManagedArchiveExtraction {
        &self.extraction
    }

    pub fn policy(&self) -> &ManagedDownloadPolicy {
        &self.policy
    }

    pub fn license(&self) -> &ManagedRecipeLicense {
        &self.license
    }

    pub fn plan(&self) -> ManagedInstallPlan {
        ManagedInstallPlan {
            artifact: self.artifact.clone(),
            download_bytes: self.extraction.download_bytes,
            expanded_bytes: self.extraction.expanded_bytes,
        }
    }
}

struct CanonicalRecipeParts {
    extraction: ManagedArchiveExtraction,
    policy: ManagedDownloadPolicy,
    license: ManagedRecipeLicense,
}

fn canonical_license(
    license: &ManagedRecipeLicense,
) -> Result<ManagedRecipeLicense, ManagedInstallError> {
    if license.expression.is_empty()
        || license.expression.len() > 256
        || license.expression.trim() != license.expression
        || spdx::Expression::parse(&license.expression).is_err()
        || !digest(&license.notice_digest)
    {
        return Err(ManagedInstallError::InvalidRequest);
    }
    let notice = ManagedDownloadPolicy::new(&license.notice_url, &[])?;
    Ok(ManagedRecipeLicense {
        expression: license.expression.clone(),
        notice_url: notice.source().as_str().to_owned(),
        notice_digest: license.notice_digest.clone(),
    })
}

fn canonical_digest(spec: &ManagedInstallRecipeSpec, canonical: &CanonicalRecipeParts) -> String {
    let mut hash = Sha256::new();
    hash.update(b"managed-language-install-recipe-v1\0");
    hash.update(spec.schema_version.to_be_bytes());
    for value in [
        spec.server.plugin_id.as_str(),
        spec.server.server_id.as_str(),
        spec.version.as_str(),
        spec.target.as_str(),
        spec.archive_digest.as_str(),
        spec.content_digest.as_str(),
        canonical.policy.source().as_str(),
    ] {
        hash_string(&mut hash, value);
    }
    let origins = canonical.policy.allowed_origins().collect::<Vec<_>>();
    hash.update((origins.len() as u64).to_be_bytes());
    for origin in origins {
        hash_string(&mut hash, origin);
    }
    match &canonical.extraction.format {
        ManagedArchiveFormat::TarGzip => hash_string(&mut hash, "tar-gzip"),
        ManagedArchiveFormat::Zip => hash_string(&mut hash, "zip"),
        ManagedArchiveFormat::Gzip {
            output_path,
            executable,
        } => {
            hash_string(&mut hash, "gzip");
            hash_string(&mut hash, output_path);
            hash.update([u8::from(*executable)]);
        }
    }
    hash.update(canonical.extraction.download_bytes.to_be_bytes());
    hash.update(canonical.extraction.expanded_bytes.to_be_bytes());
    for value in [
        canonical.license.expression.as_str(),
        canonical.license.notice_url.as_str(),
        canonical.license.notice_digest.as_str(),
    ] {
        hash_string(&mut hash, value);
    }
    format!("sha256:{:x}", hash.finalize())
}

fn hash_string(hash: &mut Sha256, value: &str) {
    hash.update((value.len() as u64).to_be_bytes());
    hash.update(value.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(value: &str) -> String {
        format!("sha256:{:x}", Sha256::digest(value.as_bytes()))
    }

    fn spec() -> ManagedInstallRecipeSpec {
        ManagedInstallRecipeSpec {
            schema_version: MANAGED_INSTALL_RECIPE_SCHEMA_VERSION,
            server: ManagedServerId {
                plugin_id: "dev.example.lsp".into(),
                server_id: "rust".into(),
            },
            version: "1.0.0".into(),
            target: "aarch64-apple-darwin".into(),
            recipe_digest: hash("placeholder"),
            archive_digest: hash("archive"),
            content_digest: hash("content"),
            source: "https://downloads.example.com/server.gz".into(),
            allowed_redirect_origins: vec![
                "https://cdn.example.com".into(),
                "https://downloads.example.com".into(),
            ],
            format: ManagedArchiveFormat::Gzip {
                output_path: "bin/server".into(),
                executable: true,
            },
            download_bytes: 100,
            expanded_bytes: 200,
            license: ManagedRecipeLicense {
                expression: "Apache-2.0 OR MIT".into(),
                notice_url: "https://github.com/example/server/blob/v1/LICENSE".into(),
                notice_digest: hash("license"),
            },
        }
    }

    fn admitted() -> ManagedInstallRecipe {
        let mut spec = spec();
        spec.recipe_digest = spec.calculated_digest().unwrap();
        spec.admit().unwrap()
    }

    #[test]
    fn canonical_recipe_binds_artifact_transport_extraction_and_license() {
        let recipe = admitted();
        assert_eq!(recipe.plan().artifact, *recipe.artifact());
        assert_eq!(recipe.plan().download_bytes, 100);
        assert_eq!(recipe.license().expression, "Apache-2.0 OR MIT");
        assert_eq!(
            recipe.policy().allowed_origins().collect::<Vec<_>>(),
            vec!["https://cdn.example.com", "https://downloads.example.com"]
        );
    }

    #[test]
    fn canonicalization_removes_redirect_order_and_redundant_source_origin() {
        let original = spec().calculated_digest().unwrap();
        let mut reordered = spec();
        reordered.allowed_redirect_origins = vec!["https://cdn.example.com".into()];
        assert_eq!(reordered.calculated_digest().unwrap(), original);
    }

    #[test]
    fn digest_rejects_any_transport_extraction_or_license_substitution() {
        let mut original = spec();
        original.recipe_digest = original.calculated_digest().unwrap();
        for mutation in 0..8 {
            let mut changed = original.clone();
            match mutation {
                0 => changed.source = "https://mirror.example.com/server.gz".into(),
                1 => changed.format = ManagedArchiveFormat::Zip,
                2 => changed.expanded_bytes += 1,
                3 => changed.license.expression = "MIT".into(),
                4 => changed.license.notice_digest = hash("other-license"),
                5 => {
                    changed.format = ManagedArchiveFormat::Gzip {
                        output_path: "bin/other-server".into(),
                        executable: true,
                    }
                }
                6 => {
                    changed.format = ManagedArchiveFormat::Gzip {
                        output_path: "bin/server".into(),
                        executable: false,
                    }
                }
                _ => changed
                    .allowed_redirect_origins
                    .push("https://mirror.example.com".into()),
            }
            assert_eq!(changed.admit(), Err(ManagedInstallError::IntegrityMismatch));
        }
    }

    #[test]
    fn invalid_source_license_and_schema_are_rejected_before_admission() {
        for source in [
            "http://downloads.example.com/server.gz",
            "https://127.0.0.1/server.gz",
            "https://localhost/server.gz",
        ] {
            let mut invalid = spec();
            invalid.source = source.into();
            assert!(invalid.calculated_digest().is_err());
        }

        let mut invalid = spec();
        invalid.license.expression = "not an SPDX expression".into();
        assert!(invalid.calculated_digest().is_err());

        let mut invalid = spec();
        invalid.schema_version += 1;
        assert_eq!(
            invalid.calculated_digest(),
            Err(ManagedInstallError::UnsupportedSchema)
        );
    }
}
