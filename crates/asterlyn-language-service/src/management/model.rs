use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const MAX_ARTIFACTS: usize = 64;
pub const MAX_SELECTIONS: usize = 64;
pub const MAX_OPERATIONS: usize = 8;
pub const MAX_FINISHED_OPERATIONS: usize = 16;
pub const MAX_REVIEWS: usize = 32;
pub const MAX_USES: usize = 128;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_EXPANDED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum ManagedInstallError {
    InvalidRequest,
    UnsupportedSchema,
    PermissionDenied,
    StaleReview,
    ExpiredReview,
    NotFound,
    Busy,
    ResourceLimit,
    IntegrityMismatch,
    StorageFailed,
    ProtectedArtifact,
    ExternalArtifact,
    InUse,
    Cancelled,
    InvalidTransition,
    Unverified,
    StateChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedServerId {
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 160)))]
    pub plugin_id: String,
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 128)))]
    pub server_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedArtifact {
    pub server: ManagedServerId,
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 128)))]
    pub version: String,
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 80)))]
    pub target: String,
    #[cfg_attr(feature = "bindings", schemars(length(min = 71, max = 71)))]
    pub recipe_digest: String,
    #[cfg_attr(feature = "bindings", schemars(length(min = 71, max = 71)))]
    pub archive_digest: String,
    #[cfg_attr(feature = "bindings", schemars(length(min = 71, max = 71)))]
    pub content_digest: String,
}

impl ManagedServerId {
    pub fn validate(&self) -> Result<(), ManagedInstallError> {
        if !identifier(&self.plugin_id, 160) || !identifier(&self.server_id, 128) {
            return Err(ManagedInstallError::InvalidRequest);
        }
        Ok(())
    }
}

impl ManagedArtifact {
    pub fn validate(&self) -> Result<(), ManagedInstallError> {
        self.server.validate()?;
        if !version(&self.version)
            || !target(&self.target)
            || !digest(&self.recipe_digest)
            || !digest(&self.archive_digest)
            || !digest(&self.content_digest)
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        Ok(())
    }

    /// Stable opaque ID, never a user-selected filesystem path or an execution grant.
    pub fn id(&self) -> String {
        let mut hash = Sha256::new();
        hash.update(b"managed-language-artifact-v1\0");
        for part in [
            &self.server.plugin_id,
            &self.server.server_id,
            &self.version,
            &self.target,
            &self.recipe_digest,
            &self.archive_digest,
            &self.content_digest,
        ] {
            hash.update((part.len() as u64).to_be_bytes());
            hash.update(part.as_bytes());
        }
        format!("sha256:{:x}", hash.finalize())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum ManagedArtifactOwnership {
    Managed,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedInstalledArtifact {
    #[cfg_attr(feature = "bindings", schemars(length(min = 71, max = 71)))]
    pub id: String,
    pub identity: ManagedArtifact,
    pub ownership: ManagedArtifactOwnership,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedServerSelection {
    pub server: ManagedServerId,
    pub current: Option<String>,
    pub rollback: Option<String>,
}

/// Durable schema only. Reviews, permissions, jobs, verification and live uses are never persisted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedInstallationIndex {
    #[cfg_attr(feature = "bindings", schemars(range(min = 1, max = 1)))]
    pub schema_version: u32,
    #[cfg_attr(feature = "bindings", schemars(range(max = 9_007_199_254_740_991_u64)))]
    pub revision: u64,
    #[cfg_attr(feature = "bindings", schemars(length(max = 64)))]
    pub artifacts: Vec<ManagedInstalledArtifact>,
    #[cfg_attr(feature = "bindings", schemars(length(max = 64)))]
    pub selections: Vec<ManagedServerSelection>,
}

impl Default for ManagedInstallationIndex {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            artifacts: Vec::new(),
            selections: Vec::new(),
        }
    }
}

impl ManagedInstallationIndex {
    pub fn validate(&self) -> Result<(), ManagedInstallError> {
        if self.schema_version != 1 {
            return Err(ManagedInstallError::UnsupportedSchema);
        }
        if self.revision > MAX_SAFE_INTEGER
            || self.artifacts.len() > MAX_ARTIFACTS
            || self.selections.len() > MAX_SELECTIONS
        {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let mut ids = BTreeSet::new();
        for artifact in &self.artifacts {
            artifact.identity.validate()?;
            if artifact.id != artifact.identity.id() || !ids.insert(&artifact.id) {
                return Err(ManagedInstallError::InvalidRequest);
            }
        }
        let mut servers = BTreeSet::new();
        for selection in &self.selections {
            selection.server.validate()?;
            if !servers.insert(&selection.server)
                || selection.current.is_none() && selection.rollback.is_none()
                || selection.current.is_some() && selection.current == selection.rollback
            {
                return Err(ManagedInstallError::InvalidRequest);
            }
            for id in [&selection.current, &selection.rollback]
                .into_iter()
                .flatten()
            {
                if !self.artifacts.iter().any(|artifact| {
                    &artifact.id == id && artifact.identity.server == selection.server
                }) {
                    return Err(ManagedInstallError::InvalidRequest);
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum ManagedArtifactVerification {
    Required,
    Verified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedArtifactStatus {
    pub artifact: ManagedInstalledArtifact,
    pub verification: ManagedArtifactVerification,
    #[cfg_attr(feature = "bindings", schemars(range(max = 128)))]
    pub use_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum ManagedOperationKind {
    Install,
    Remove,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum ManagedOperationPhase {
    Acquiring,
    Verifying,
    Committing,
    WaitingForUses,
    Completed,
    Cancelled,
    Failed,
}

impl ManagedOperationPhase {
    pub fn terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::Failed)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedInstallOperation {
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 128)))]
    pub id: String,
    pub server: ManagedServerId,
    #[cfg_attr(feature = "bindings", schemars(length(min = 71, max = 71)))]
    pub artifact_id: String,
    pub kind: ManagedOperationKind,
    pub phase: ManagedOperationPhase,
    #[cfg_attr(feature = "bindings", schemars(range(max = 536_870_912_u64)))]
    pub completed_bytes: u64,
    #[cfg_attr(feature = "bindings", schemars(range(max = 536_870_912_u64)))]
    pub total_bytes: u64,
    pub failure: Option<ManagedInstallError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "bindings", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedInstallationSnapshot {
    #[cfg_attr(feature = "bindings", schemars(range(min = 1, max = 1)))]
    pub protocol_version: u32,
    #[cfg_attr(feature = "bindings", schemars(length(min = 1, max = 64)))]
    pub epoch: String,
    #[cfg_attr(feature = "bindings", schemars(range(max = 9_007_199_254_740_991_u64)))]
    pub revision: u64,
    #[cfg_attr(feature = "bindings", schemars(range(max = 9_007_199_254_740_991_u64)))]
    pub index_revision: u64,
    #[cfg_attr(feature = "bindings", schemars(length(max = 64)))]
    pub artifacts: Vec<ManagedArtifactStatus>,
    #[cfg_attr(feature = "bindings", schemars(length(max = 64)))]
    pub selections: Vec<ManagedServerSelection>,
    #[cfg_attr(feature = "bindings", schemars(length(max = 24)))]
    pub operations: Vec<ManagedInstallOperation>,
}

impl ManagedInstallationSnapshot {
    pub fn validate(&self) -> Result<(), ManagedInstallError> {
        if self.protocol_version != 1 {
            return Err(ManagedInstallError::UnsupportedSchema);
        }
        if !opaque(&self.epoch, 64)
            || self.revision > MAX_SAFE_INTEGER
            || self.operations.len() > MAX_OPERATIONS + MAX_FINISHED_OPERATIONS
        {
            return Err(ManagedInstallError::InvalidRequest);
        }
        ManagedInstallationIndex {
            schema_version: 1,
            revision: self.index_revision,
            artifacts: self
                .artifacts
                .iter()
                .map(|item| item.artifact.clone())
                .collect(),
            selections: self.selections.clone(),
        }
        .validate()?;
        let uses: u64 = self
            .artifacts
            .iter()
            .map(|item| u64::from(item.use_count))
            .sum();
        if uses > MAX_USES as u64 {
            return Err(ManagedInstallError::ResourceLimit);
        }
        let mut ids = BTreeSet::new();
        let mut active_servers = BTreeSet::new();
        for operation in &self.operations {
            operation.server.validate()?;
            if !opaque(&operation.id, 128)
                || !ids.insert(&operation.id)
                || !digest(&operation.artifact_id)
                || operation.completed_bytes > operation.total_bytes
                || operation.total_bytes > MAX_DOWNLOAD_BYTES
                || operation.failure.is_some() != (operation.phase == ManagedOperationPhase::Failed)
                || operation.kind == ManagedOperationKind::Install
                    && (operation.phase == ManagedOperationPhase::WaitingForUses
                        || operation.total_bytes == 0)
                || operation.kind == ManagedOperationKind::Install
                    && matches!(
                        operation.phase,
                        ManagedOperationPhase::Verifying
                            | ManagedOperationPhase::Committing
                            | ManagedOperationPhase::Completed
                    )
                    && operation.completed_bytes != operation.total_bytes
                || operation.kind == ManagedOperationKind::Remove
                    && (operation.total_bytes != 0
                        || matches!(
                            operation.phase,
                            ManagedOperationPhase::Acquiring | ManagedOperationPhase::Verifying
                        ))
            {
                return Err(ManagedInstallError::InvalidRequest);
            }
            if !operation.phase.terminal() && !active_servers.insert(&operation.server) {
                return Err(ManagedInstallError::InvalidRequest);
            }
            if !operation.phase.terminal()
                && operation.kind == ManagedOperationKind::Remove
                && !self.artifacts.iter().any(|item| {
                    item.artifact.id == operation.artifact_id
                        && item.artifact.identity.server == operation.server
                        && item.artifact.ownership == ManagedArtifactOwnership::Managed
                })
            {
                return Err(ManagedInstallError::InvalidRequest);
            }
        }
        if active_servers.len() > MAX_OPERATIONS
            || self.operations.len() - active_servers.len() > MAX_FINISHED_OPERATIONS
        {
            return Err(ManagedInstallError::ResourceLimit);
        }
        Ok(())
    }
}

pub(super) fn digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}
pub(super) fn identifier(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
}
pub(super) fn opaque(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}
pub(super) fn version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+'))
}
pub(super) fn target(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-' | b'_')
        })
}
