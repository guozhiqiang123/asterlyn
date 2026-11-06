use super::{
    ManagedInstallError, ManagedInstallRecipe, ManagedInstallRecipeSpec, ManagedRecipeLicense,
    ManagedServerId, ManagementAuthority,
    model::{digest, identifier, target, version},
};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Arc};

const MAX_REGISTERED_RECIPES: usize = 64;
const MAX_NOTICE_BYTES: usize = 128 * 1024;
const MAX_TOTAL_NOTICE_BYTES: usize = 1024 * 1024;

/// Host-owned input. The notice text is retained for the later review and must
/// match the identity already covered by the canonical recipe digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedRecipeCatalogEntry {
    pub plugin_version: String,
    pub package_digest: String,
    pub spec: ManagedInstallRecipeSpec,
    pub notice_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ManagedRecipeReference {
    pub server: ManagedServerId,
    pub target: String,
    pub recipe_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedRecipeSummary {
    pub reference: ManagedRecipeReference,
    pub version: String,
    pub archive_digest: String,
    pub content_digest: String,
    pub download_bytes: u64,
    pub expanded_bytes: u64,
    pub source: String,
    pub license: ManagedRecipeLicense,
}

#[derive(Debug, Clone)]
pub struct ManagedRegisteredRecipe {
    owner: RecipeOwner,
    recipe: ManagedInstallRecipe,
    notice_text: Arc<str>,
}

impl ManagedRegisteredRecipe {
    pub fn recipe(&self) -> &ManagedInstallRecipe {
        &self.recipe
    }

    pub fn notice_text(&self) -> &str {
        &self.notice_text
    }

    pub(super) fn validate_authority(
        &self,
        authority: &ManagementAuthority,
    ) -> Result<(), ManagedInstallError> {
        authority.validate(&self.recipe.artifact().server)?;
        if !self.owner.matches(authority) {
            return Err(ManagedInstallError::PermissionDenied);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct ManagedRecipeRegistry {
    entries: BTreeMap<RecipeKey, ManagedRegisteredRecipe>,
}

impl ManagedRecipeRegistry {
    pub fn admit(
        entries: impl IntoIterator<Item = ManagedRecipeCatalogEntry>,
    ) -> Result<Self, ManagedInstallError> {
        let mut admitted = BTreeMap::new();
        let mut total_notice_bytes = 0_usize;
        for entry in entries {
            if admitted.len() >= MAX_REGISTERED_RECIPES {
                return Err(ManagedInstallError::ResourceLimit);
            }
            let owner = RecipeOwner {
                plugin_id: entry.spec.server.plugin_id.clone(),
                plugin_version: entry.plugin_version,
                package_digest: entry.package_digest,
            };
            owner.validate()?;
            let notice_bytes = entry.notice_text.as_bytes();
            if notice_bytes.is_empty()
                || entry.notice_text.chars().any(|character| {
                    character.is_control() && !matches!(character, '\n' | '\r' | '\t')
                })
            {
                return Err(ManagedInstallError::InvalidRequest);
            }
            if notice_bytes.len() > MAX_NOTICE_BYTES {
                return Err(ManagedInstallError::ResourceLimit);
            }
            total_notice_bytes = total_notice_bytes
                .checked_add(notice_bytes.len())
                .filter(|bytes| *bytes <= MAX_TOTAL_NOTICE_BYTES)
                .ok_or(ManagedInstallError::ResourceLimit)?;
            if sha256(notice_bytes) != entry.spec.license.notice_digest {
                return Err(ManagedInstallError::IntegrityMismatch);
            }
            let recipe = entry.spec.admit()?;
            let key = RecipeKey::new(&owner, &recipe);
            let registered = ManagedRegisteredRecipe {
                owner,
                recipe,
                notice_text: Arc::from(entry.notice_text),
            };
            if admitted.insert(key, registered).is_some() {
                return Err(ManagedInstallError::InvalidRequest);
            }
        }
        Ok(Self { entries: admitted })
    }

    pub fn resolve(
        &self,
        authority: &ManagementAuthority,
        reference: &ManagedRecipeReference,
    ) -> Result<ManagedRegisteredRecipe, ManagedInstallError> {
        authority.validate(&reference.server)?;
        if !target(&reference.target) || !digest(&reference.recipe_digest) {
            return Err(ManagedInstallError::InvalidRequest);
        }
        let key = RecipeKey::from_authority(authority, &reference.server, &reference.target);
        let registered = self
            .entries
            .get(&key)
            .ok_or(ManagedInstallError::NotFound)?;
        registered.validate_authority(authority)?;
        if registered.recipe.artifact().recipe_digest != reference.recipe_digest {
            return Err(ManagedInstallError::StateChanged);
        }
        Ok(registered.clone())
    }

    pub fn summaries(
        &self,
        authority: &ManagementAuthority,
        current_target: &str,
    ) -> Result<Vec<ManagedRecipeSummary>, ManagedInstallError> {
        authority.validate_identity()?;
        if !target(current_target) {
            return Err(ManagedInstallError::InvalidRequest);
        }
        let mut summaries = Vec::new();
        for registered in self.entries.values() {
            if registered.owner.matches(authority)
                && registered.recipe.artifact().target == current_target
            {
                registered.validate_authority(authority)?;
                summaries.push(summary(&registered.recipe));
            }
        }
        summaries.sort_by(|left, right| left.reference.cmp(&right.reference));
        Ok(summaries)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct RecipeOwner {
    plugin_id: String,
    plugin_version: String,
    package_digest: String,
}

impl RecipeOwner {
    fn validate(&self) -> Result<(), ManagedInstallError> {
        if !identifier(&self.plugin_id, 160)
            || !version(&self.plugin_version)
            || !digest(&self.package_digest)
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        Ok(())
    }

    fn matches(&self, authority: &ManagementAuthority) -> bool {
        self.plugin_id == authority.plugin_id
            && self.plugin_version == authority.plugin_version
            && self.package_digest == authority.package_digest
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct RecipeKey {
    owner: RecipeOwner,
    server_id: String,
    target: String,
}

impl RecipeKey {
    fn new(owner: &RecipeOwner, recipe: &ManagedInstallRecipe) -> Self {
        Self {
            owner: owner.clone(),
            server_id: recipe.artifact().server.server_id.clone(),
            target: recipe.artifact().target.clone(),
        }
    }

    fn from_authority(
        authority: &ManagementAuthority,
        server: &ManagedServerId,
        target: &str,
    ) -> Self {
        Self {
            owner: RecipeOwner {
                plugin_id: authority.plugin_id.clone(),
                plugin_version: authority.plugin_version.clone(),
                package_digest: authority.package_digest.clone(),
            },
            server_id: server.server_id.clone(),
            target: target.into(),
        }
    }
}

fn summary(recipe: &ManagedInstallRecipe) -> ManagedRecipeSummary {
    let artifact = recipe.artifact();
    let extraction = recipe.extraction();
    ManagedRecipeSummary {
        reference: ManagedRecipeReference {
            server: artifact.server.clone(),
            target: artifact.target.clone(),
            recipe_digest: artifact.recipe_digest.clone(),
        },
        version: artifact.version.clone(),
        archive_digest: artifact.archive_digest.clone(),
        content_digest: artifact.content_digest.clone(),
        download_bytes: extraction.download_bytes,
        expanded_bytes: extraction.expanded_bytes,
        source: recipe.policy().source().as_str().into(),
        license: recipe.license().clone(),
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::management::{
        MANAGED_INSTALL_RECIPE_SCHEMA_VERSION, ManagedArchiveFormat, ManagedInstallRecipeSpec,
    };

    const NOTICE: &str = "fixture license notice\n";

    fn authority() -> ManagementAuthority {
        ManagementAuthority {
            window_id: "window-one".into(),
            activation: 1,
            plugin_id: "dev.example.lsp".into(),
            plugin_version: "1.0.0".into(),
            package_digest: sha256(b"plugin"),
            enabled: true,
            may_manage: true,
        }
    }

    fn entry(server_id: &str) -> ManagedRecipeCatalogEntry {
        let mut spec = ManagedInstallRecipeSpec {
            schema_version: MANAGED_INSTALL_RECIPE_SCHEMA_VERSION,
            server: ManagedServerId {
                plugin_id: "dev.example.lsp".into(),
                server_id: server_id.into(),
            },
            version: "1.0.0".into(),
            target: "aarch64-apple-darwin".into(),
            recipe_digest: sha256(b"placeholder"),
            archive_digest: sha256(b"archive"),
            content_digest: sha256(b"content"),
            source: "https://downloads.example.com/server.gz".into(),
            allowed_redirect_origins: vec!["https://cdn.example.com".into()],
            format: ManagedArchiveFormat::Gzip {
                output_path: "bin/server".into(),
                executable: true,
            },
            download_bytes: 100,
            expanded_bytes: 200,
            license: ManagedRecipeLicense {
                expression: "MIT".into(),
                notice_url: "https://github.com/example/server/blob/v1/LICENSE".into(),
                notice_digest: sha256(NOTICE.as_bytes()),
            },
        };
        spec.recipe_digest = spec.calculated_digest().unwrap();
        ManagedRecipeCatalogEntry {
            plugin_version: "1.0.0".into(),
            package_digest: sha256(b"plugin"),
            spec,
            notice_text: NOTICE.into(),
        }
    }

    #[test]
    fn exact_package_authority_resolves_a_retained_recipe_and_summary() {
        let registry = ManagedRecipeRegistry::admit([entry("rust")]).unwrap();
        let owner = authority();
        let summary = registry
            .summaries(&owner, "aarch64-apple-darwin")
            .unwrap()
            .pop()
            .unwrap();
        let registered = registry.resolve(&owner, &summary.reference).unwrap();
        assert_eq!(registered.notice_text(), NOTICE);
        assert_eq!(registered.recipe().artifact().version, "1.0.0");
        assert_eq!(summary.source, "https://downloads.example.com/server.gz");
    }

    #[test]
    fn package_changes_and_stale_recipe_references_cannot_reuse_an_entry() {
        let registry = ManagedRecipeRegistry::admit([entry("rust")]).unwrap();
        let owner = authority();
        let reference = registry
            .summaries(&owner, "aarch64-apple-darwin")
            .unwrap()
            .pop()
            .unwrap()
            .reference;
        let mut stale = reference.clone();
        stale.recipe_digest = sha256(b"stale");
        assert!(matches!(
            registry.resolve(&owner, &stale),
            Err(ManagedInstallError::StateChanged)
        ));
        for mutation in 0..3 {
            let mut changed = owner.clone();
            match mutation {
                0 => changed.plugin_version = "2.0.0".into(),
                1 => changed.package_digest = sha256(b"other-package"),
                _ => changed.enabled = false,
            }
            assert!(registry.resolve(&changed, &reference).is_err());
        }
    }

    #[test]
    fn admission_rejects_duplicate_slots_notice_mismatches_and_bounds() {
        let duplicate = entry("rust");
        assert!(matches!(
            ManagedRecipeRegistry::admit([duplicate.clone(), duplicate]),
            Err(ManagedInstallError::InvalidRequest)
        ));
        let mut mismatch = entry("rust");
        mismatch.notice_text = "different".into();
        assert!(matches!(
            ManagedRecipeRegistry::admit([mismatch]),
            Err(ManagedInstallError::IntegrityMismatch)
        ));
        let mut control = entry("rust");
        control.notice_text = "license\0spoof".into();
        assert!(matches!(
            ManagedRecipeRegistry::admit([control]),
            Err(ManagedInstallError::InvalidRequest)
        ));
        let entries = (0..=MAX_REGISTERED_RECIPES)
            .map(|index| entry(&format!("server-{index}")))
            .collect::<Vec<_>>();
        assert!(matches!(
            ManagedRecipeRegistry::admit(entries),
            Err(ManagedInstallError::ResourceLimit)
        ));
    }
}
