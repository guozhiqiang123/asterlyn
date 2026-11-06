use asterlyn_language_service::management::{
    ManagedArtifact, ManagedInstallError, ManagedInstallationExecutor, ManagedInstallationSnapshot,
    ManagedInstallationTaskRegistry, ManagedOperationKind, ManagedRecipeReference,
    ManagedRecipeRegistry, ManagedRecipeSummary, ManagedServerId, ManagementAuthority,
};
use serde::{Serialize, Serializer};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const STORE_DIRECTORY: &str = "managed-language-tools-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedLanguageEnvironment {
    protocol_version: u32,
    platform: &'static str,
    target: &'static str,
    installation: ManagedInstallationSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedLanguageRecipeCatalog {
    protocol_version: u32,
    target: &'static str,
    recipes: Vec<ManagedLanguageRecipeSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedLanguageRecipeSummary {
    reference: ManagedLanguageRecipeReference,
    version: String,
    archive_digest: String,
    content_digest: String,
    download_bytes: u64,
    expanded_bytes: u64,
    source: String,
    license: ManagedLanguageRecipeLicense,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedLanguageRecipeReference {
    server: ManagedServerId,
    target: String,
    recipe_digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedLanguageRecipeLicense {
    expression: String,
    notice_url: String,
    notice_digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedLanguageInstallReview {
    protocol_version: u32,
    review_id: String,
    kind: ManagedOperationKind,
    artifact: ManagedArtifact,
    index_revision: u64,
    download_bytes: u64,
    expanded_bytes: u64,
    recipe: ManagedLanguageRecipeSummary,
    #[serde(serialize_with = "serialize_notice_text")]
    notice_text: Arc<str>,
}

pub(crate) struct ManagedLanguageInstallationState {
    state: ManagedLanguageInstallationAvailability,
}

enum ManagedLanguageInstallationAvailability {
    Available {
        tasks: ManagedInstallationTaskRegistry,
        platform: &'static str,
        target: &'static str,
    },
    Unavailable(ManagedInstallError),
}

impl ManagedLanguageInstallationState {
    pub(crate) fn open(app: &tauri::AppHandle) -> Self {
        Self {
            state: Self::open_available(app)
                .unwrap_or_else(ManagedLanguageInstallationAvailability::Unavailable),
        }
    }

    fn open_available(
        app: &tauri::AppHandle,
    ) -> Result<ManagedLanguageInstallationAvailability, ManagedInstallError> {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|_| ManagedInstallError::StorageFailed)?
            .join(STORE_DIRECTORY);
        let (platform, target) = native_environment(std::env::consts::OS, std::env::consts::ARCH)
            .ok_or(ManagedInstallError::InvalidRequest)?;
        let epoch = format!(
            "host-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );
        let executor = ManagedInstallationExecutor::open(root, epoch)?;
        let tasks =
            ManagedInstallationTaskRegistry::new(executor, ManagedRecipeRegistry::default());
        Ok(ManagedLanguageInstallationAvailability::Available {
            tasks,
            platform,
            target,
        })
    }

    pub(crate) fn environment(&self) -> Result<ManagedLanguageEnvironment, ManagedInstallError> {
        match &self.state {
            ManagedLanguageInstallationAvailability::Available {
                tasks,
                platform,
                target,
                ..
            } => {
                let installation = tasks.snapshot()?;
                Ok(ManagedLanguageEnvironment {
                    protocol_version: 1,
                    platform,
                    target,
                    installation,
                })
            }
            ManagedLanguageInstallationAvailability::Unavailable(error) => Err(*error),
        }
    }

    pub(crate) fn recipe_catalog(
        &self,
        authority: &ManagementAuthority,
    ) -> Result<ManagedLanguageRecipeCatalog, ManagedInstallError> {
        match &self.state {
            ManagedLanguageInstallationAvailability::Available { tasks, target, .. } => {
                let recipes = tasks
                    .recipe_summaries(authority, target)?
                    .into_iter()
                    .map(ManagedLanguageRecipeSummary::from)
                    .collect();
                Ok(ManagedLanguageRecipeCatalog {
                    protocol_version: 1,
                    target,
                    recipes,
                })
            }
            ManagedLanguageInstallationAvailability::Unavailable(error) => Err(*error),
        }
    }

    pub(crate) fn prepare_install(
        &self,
        authority: &ManagementAuthority,
        server_id: String,
        recipe_digest: String,
        now: Instant,
    ) -> Result<ManagedLanguageInstallReview, ManagedInstallError> {
        match &self.state {
            ManagedLanguageInstallationAvailability::Available { tasks, target, .. } => {
                let reference = ManagedRecipeReference {
                    server: ManagedServerId {
                        plugin_id: authority.plugin_id.clone(),
                        server_id,
                    },
                    target: (*target).into(),
                    recipe_digest,
                };
                let details = tasks.prepare_install(authority, &reference, now)?;
                Ok(ManagedLanguageInstallReview {
                    protocol_version: 1,
                    review_id: details.review.id,
                    kind: details.review.kind,
                    artifact: details.review.artifact,
                    index_revision: details.review.index_revision,
                    download_bytes: details.review.download_bytes,
                    expanded_bytes: details.review.expanded_bytes,
                    recipe: details.recipe.into(),
                    notice_text: details.notice_text,
                })
            }
            ManagedLanguageInstallationAvailability::Unavailable(error) => Err(*error),
        }
    }
}

fn serialize_notice_text<S>(value: &Arc<str>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(value)
}

impl From<ManagedRecipeSummary> for ManagedLanguageRecipeSummary {
    fn from(summary: ManagedRecipeSummary) -> Self {
        Self {
            reference: ManagedLanguageRecipeReference {
                server: summary.reference.server,
                target: summary.reference.target,
                recipe_digest: summary.reference.recipe_digest,
            },
            version: summary.version,
            archive_digest: summary.archive_digest,
            content_digest: summary.content_digest,
            download_bytes: summary.download_bytes,
            expanded_bytes: summary.expanded_bytes,
            source: summary.source,
            license: ManagedLanguageRecipeLicense {
                expression: summary.license.expression,
                notice_url: summary.license.notice_url,
                notice_digest: summary.license.notice_digest,
            },
        }
    }
}

fn native_environment(os: &str, architecture: &str) -> Option<(&'static str, &'static str)> {
    match (os, architecture) {
        ("macos", "aarch64") => Some(("macos-arm64", "aarch64-apple-darwin")),
        ("macos", "x86_64") => Some(("macos-x64", "x86_64-apple-darwin")),
        ("linux", "aarch64") => Some(("linux-arm64", "aarch64-unknown-linux-gnu")),
        ("linux", "x86_64") => Some(("linux-x64", "x86_64-unknown-linux-gnu")),
        ("windows", "aarch64") => Some(("windows-arm64", "aarch64-pc-windows-msvc")),
        ("windows", "x86_64") => Some(("windows-x64", "x86_64-pc-windows-msvc")),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ManagedInstallError, ManagedInstallationExecutor, ManagedInstallationTaskRegistry,
        ManagedLanguageInstallationAvailability, ManagedLanguageInstallationState,
        ManagedRecipeRegistry, ManagementAuthority, native_environment,
    };
    use std::time::Instant;

    #[test]
    fn maps_only_catalog_supported_native_targets() {
        assert_eq!(
            native_environment("macos", "aarch64"),
            Some(("macos-arm64", "aarch64-apple-darwin"))
        );
        assert_eq!(
            native_environment("windows", "x86_64"),
            Some(("windows-x64", "x86_64-pc-windows-msvc"))
        );
        assert_eq!(native_environment("freebsd", "x86_64"), None);
        assert_eq!(native_environment("linux", "riscv64"), None);
    }

    #[test]
    fn unavailable_installation_facts_do_not_require_a_coordinator() {
        let state = ManagedLanguageInstallationState {
            state: ManagedLanguageInstallationAvailability::Unavailable(
                ManagedInstallError::StorageFailed,
            ),
        };
        assert_eq!(
            state.environment().unwrap_err(),
            ManagedInstallError::StorageFailed
        );
    }

    #[test]
    fn desktop_state_owns_an_empty_host_recipe_task_registry() {
        let directory = tempfile::tempdir().expect("temporary installation store");
        let executor = ManagedInstallationExecutor::open(
            directory.path().join("managed-language"),
            "desktop-empty-registry".into(),
        )
        .expect("installation executor");
        let tasks =
            ManagedInstallationTaskRegistry::new(executor, ManagedRecipeRegistry::default());
        let state = ManagedLanguageInstallationState {
            state: ManagedLanguageInstallationAvailability::Available {
                tasks,
                platform: "macos-arm64",
                target: "aarch64-apple-darwin",
            },
        };

        let environment = state.environment().expect("managed environment");
        assert!(environment.installation.artifacts.is_empty());
        let ManagedLanguageInstallationAvailability::Available { target, .. } = &state.state else {
            panic!("expected available managed installation state");
        };
        let authority = ManagementAuthority {
            window_id: "main".into(),
            activation: 1,
            plugin_id: "dev.asterlyn.lsp-manager".into(),
            plugin_version: "1.0.0".into(),
            package_digest:
                "sha256:0000000000000000000000000000000000000000000000000000000000000000".into(),
            enabled: true,
            may_manage: true,
        };
        assert!(
            state
                .recipe_catalog(&authority)
                .expect("empty registered recipe catalog")
                .recipes
                .is_empty()
        );
        assert_eq!(target, &"aarch64-apple-darwin");
        assert!(matches!(
            state.prepare_install(
                &authority,
                "rust".into(),
                "sha256:1111111111111111111111111111111111111111111111111111111111111111".into(),
                Instant::now(),
            ),
            Err(ManagedInstallError::NotFound)
        ));
    }
}
