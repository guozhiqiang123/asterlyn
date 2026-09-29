use std::fs::{self, File, OpenOptions, Permissions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use crate::{
    Workspace, WorkspaceEntryInventory, WorkspaceEntryKind, WorkspaceError,
    WorkspaceMutationLimits, WorkspaceMutationOperation, WorkspaceMutationPlan,
    file_identity::opened_file_matches_path, sync_directory, validate_relative_path,
};

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMutationStatus {
    Completed,
    NoOp,
    CancelledBeforeWrite,
    FailedWithoutChange,
    FailedWithRecovery,
    Uncertain,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathRemap {
    pub source: String,
    pub destination: String,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMutationInvalidation {
    WorkspaceCatalog,
    OpenDocuments,
    WorkingTree,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMutationOutcome {
    pub plan_id: String,
    pub status: WorkspaceMutationStatus,
    pub affected_paths: Vec<String>,
    pub path_remaps: Vec<WorkspacePathRemap>,
    pub invalidated_slices: Vec<WorkspaceMutationInvalidation>,
    pub recovery_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMutationRecoverySummary {
    pub recovery_id: String,
    pub workspace_root: String,
    pub operation: WorkspaceMutationOperation,
    pub phase: String,
    pub source_states: Vec<WorkspaceMutationRecoveryPathState>,
    pub destination: Option<String>,
    pub destination_state: Option<WorkspaceMutationRecoveryPathStateKind>,
    pub held_source_state: Option<WorkspaceMutationRecoveryPathStateKind>,
    pub supported_actions: Vec<WorkspaceMutationRecoveryAction>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMutationRecoveryAction {
    Rollback,
    Finalize,
    Acknowledge,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMutationRecoveryPathStateKind {
    Missing,
    MatchesReviewed,
    ChangedOrUnknown,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMutationRecoveryPathState {
    pub path: String,
    pub state: WorkspaceMutationRecoveryPathStateKind,
}

#[derive(Debug, Clone, Default)]
pub struct WorkspaceMutationCancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl WorkspaceMutationCancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn refers_to(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MutationRecoveryManifest {
    version: u8,
    recovery_id: String,
    workspace_root: String,
    operation: WorkspaceMutationOperation,
    #[serde(default)]
    fingerprint: Option<String>,
    #[serde(default)]
    inventory: Option<WorkspaceEntryInventory>,
    #[serde(default)]
    inventories: Vec<WorkspaceEntryInventory>,
    #[serde(default)]
    limits: WorkspaceMutationLimits,
    phase: String,
    #[serde(default)]
    destination: Option<String>,
    #[serde(default)]
    source_hold: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrashSourceObservation {
    Missing,
    Unchanged,
    ChangedOrUnknown,
}

impl Workspace {
    pub fn execute_mutation_plan(
        &self,
        recovery_root: &Path,
        plan: &WorkspaceMutationPlan,
        cancellation: &WorkspaceMutationCancellationToken,
    ) -> Result<WorkspaceMutationOutcome, WorkspaceError> {
        if !plan.executable() {
            return Err(WorkspaceError::InvalidMutation {
                message: "a blocked workspace mutation plan cannot execute".into(),
            });
        }
        match &plan.operation {
            WorkspaceMutationOperation::CreateFile { destination } => {
                self.execute_create(plan, destination, cancellation)
            }
            WorkspaceMutationOperation::Copy {
                source,
                destination,
            } => self.execute_copy(recovery_root, plan, source, destination, cancellation),
            WorkspaceMutationOperation::Move {
                source,
                destination,
            } => self.execute_move(recovery_root, plan, source, destination, cancellation),
            WorkspaceMutationOperation::Trash { .. } => Err(WorkspaceError::InvalidMutation {
                message: "trash plans require a platform trash adapter".into(),
            }),
        }
    }

    pub fn execute_trash_plan_with<F>(
        &self,
        recovery_root: &Path,
        plan: &WorkspaceMutationPlan,
        cancellation: &WorkspaceMutationCancellationToken,
        trash: F,
    ) -> Result<WorkspaceMutationOutcome, WorkspaceError>
    where
        F: FnOnce(&[PathBuf]) -> Result<(), WorkspaceError>,
    {
        let WorkspaceMutationOperation::Trash { .. } = &plan.operation else {
            return Err(WorkspaceError::InvalidMutation {
                message: "the workspace mutation plan is not a trash operation".into(),
            });
        };
        if !plan.executable() {
            return Err(WorkspaceError::InvalidMutation {
                message: "a blocked workspace mutation plan cannot execute".into(),
            });
        }
        let sources = plan.operation.trash_sources();
        let inventories = if !plan.inventories.is_empty() {
            &plan.inventories
        } else if let Some(ref inv) = plan.inventory {
            std::slice::from_ref(inv)
        } else {
            return Err(WorkspaceError::InvalidMutation {
                message: "workspace mutation plan has no source inventory".into(),
            });
        };
        if sources.is_empty() || sources.len() != inventories.len() {
            return Err(WorkspaceError::InvalidMutation {
                message: "trash sources and reviewed inventories do not match".into(),
            });
        }
        for (source, inv) in sources.iter().zip(inventories.iter()) {
            if inv.source.workspace_path != *source {
                return Err(WorkspaceError::InvalidMutation {
                    message: "trash source does not match its reviewed inventory".into(),
                });
            }
            let current = self.inspect_trash_entry(source, plan.limits)?;
            if current.fingerprint != inv.fingerprint || current.source != inv.source {
                return Err(WorkspaceError::Conflict {
                    current_revision: current.fingerprint,
                });
            }
        }
        if cancellation.is_cancelled() {
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::CancelledBeforeWrite,
                None,
                None,
            ));
        }
        let mut journal = MutationJournal::create(
            self.root(),
            recovery_root,
            plan,
            plan.inventory.as_ref().or_else(|| plan.inventories.first()),
        )?;
        journal.update("trash-started", None)?;
        let targets = sources
            .iter()
            .map(|source| validate_relative_path(source).map(|relative| self.root().join(relative)))
            .collect::<Result<Vec<_>, _>>()?;
        let adapter_result = trash(&targets);
        let observations = sources
            .iter()
            .zip(inventories.iter())
            .zip(targets.iter())
            .map(
                |((source, inventory), target)| match fs::symlink_metadata(target) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        TrashSourceObservation::Missing
                    }
                    Err(_) => TrashSourceObservation::ChangedOrUnknown,
                    Ok(_) => self
                        .inspect_trash_entry(source, plan.limits)
                        .map(|current| {
                            if current.source == inventory.source
                                && current.fingerprint == inventory.fingerprint
                            {
                                TrashSourceObservation::Unchanged
                            } else {
                                TrashSourceObservation::ChangedOrUnknown
                            }
                        })
                        .unwrap_or(TrashSourceObservation::ChangedOrUnknown),
                },
            )
            .collect::<Vec<_>>();

        if adapter_result.is_ok()
            && observations
                .iter()
                .all(|observation| *observation == TrashSourceObservation::Missing)
        {
            journal.remove()?;
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::Completed,
                None,
                None,
            ));
        }
        if observations
            .iter()
            .all(|observation| *observation == TrashSourceObservation::Unchanged)
            && let Err(error) = &adapter_result
        {
            journal.remove()?;
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::FailedWithoutChange,
                None,
                Some(error.to_string()),
            ));
        }
        let error = adapter_result.err().map_or_else(
            || "the trash adapter returned before every source disappeared".to_string(),
            |error| error.to_string(),
        );
        Ok(outcome(
            plan,
            WorkspaceMutationStatus::Uncertain,
            Some(plan.plan_id.clone()),
            Some(error),
        ))
    }

    pub fn list_mutation_recoveries(
        &self,
        recovery_root: &Path,
    ) -> Result<Vec<WorkspaceMutationRecoverySummary>, WorkspaceError> {
        let directory = mutation_recovery_directory(recovery_root);
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(execution_io("read workspace mutation recoveries", error)),
        };
        let mut summaries = Vec::new();
        for entry in entries {
            let entry =
                entry.map_err(|error| execution_io("read workspace mutation recovery", error))?;
            if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if entry
                .file_type()
                .map_err(|error| execution_io("inspect workspace mutation recovery", error))?
                .is_symlink()
            {
                continue;
            }
            let bytes = fs::read(entry.path())
                .map_err(|error| execution_io("read workspace mutation recovery", error))?;
            let manifest: MutationRecoveryManifest =
                serde_json::from_slice(&bytes).map_err(|error| {
                    WorkspaceError::InvalidMutation {
                        message: format!("invalid workspace mutation recovery: {error}"),
                    }
                })?;
            if !matches!(manifest.version, 1 | 2) {
                return Err(WorkspaceError::InvalidMutation {
                    message: format!(
                        "unsupported workspace mutation recovery version {}",
                        manifest.version
                    ),
                });
            }
            if manifest.workspace_root == self.root().to_string_lossy() {
                summaries.push(self.summarize_mutation_recovery(&manifest));
            }
        }
        summaries.sort_by(|left, right| left.recovery_id.cmp(&right.recovery_id));
        Ok(summaries)
    }

    pub fn rollback_mutation_recovery(
        &self,
        recovery_root: &Path,
        recovery_id: &str,
    ) -> Result<(), WorkspaceError> {
        let Some(mut journal) = MutationJournal::load(self.root(), recovery_root, recovery_id)?
        else {
            return Ok(());
        };
        journal.require_current_schema()?;
        let inventory = journal.manifest.primary_inventory()?.clone();
        match journal.manifest.operation.clone() {
            WorkspaceMutationOperation::Copy { destination, .. } => {
                match self.observe_inventory(&destination, &inventory, journal.manifest.limits) {
                    WorkspaceMutationRecoveryPathStateKind::Missing => {}
                    WorkspaceMutationRecoveryPathStateKind::MatchesReviewed => {
                        self.remove_verified_workspace_entry(&destination, inventory.source.kind)?;
                    }
                    WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown => {
                        return Err(recovery_conflict(
                            "the copy destination no longer matches the reviewed entry",
                        ));
                    }
                }
                journal.remove()
            }
            WorkspaceMutationOperation::Move {
                source,
                destination,
            } => self.rollback_move_recovery(&mut journal, &source, &destination, &inventory),
            WorkspaceMutationOperation::CreateFile { .. }
            | WorkspaceMutationOperation::Trash { .. } => Err(recovery_conflict(
                "this workspace mutation cannot be rolled back automatically",
            )),
        }
    }

    pub fn finalize_mutation_recovery(
        &self,
        recovery_root: &Path,
        recovery_id: &str,
    ) -> Result<(), WorkspaceError> {
        let Some(mut journal) = MutationJournal::load(self.root(), recovery_root, recovery_id)?
        else {
            return Ok(());
        };
        journal.require_current_schema()?;
        let inventory = journal.manifest.primary_inventory()?.clone();
        match journal.manifest.operation.clone() {
            WorkspaceMutationOperation::Copy { destination, .. } => {
                if self.observe_inventory(&destination, &inventory, journal.manifest.limits)
                    != WorkspaceMutationRecoveryPathStateKind::MatchesReviewed
                {
                    return Err(recovery_conflict(
                        "the copy destination is not the reviewed entry",
                    ));
                }
                journal.remove()
            }
            WorkspaceMutationOperation::Move {
                source,
                destination,
            } => self.finalize_move_recovery(&mut journal, &source, &destination, &inventory),
            WorkspaceMutationOperation::CreateFile { .. }
            | WorkspaceMutationOperation::Trash { .. } => Err(recovery_conflict(
                "this workspace mutation cannot be finalized automatically",
            )),
        }
    }

    pub fn acknowledge_mutation_recovery(
        &self,
        recovery_root: &Path,
        recovery_id: &str,
    ) -> Result<(), WorkspaceError> {
        let Some(journal) = MutationJournal::load(self.root(), recovery_root, recovery_id)? else {
            return Ok(());
        };
        if journal
            .validated_source_hold(self.root())?
            .is_some_and(|path| path.exists())
        {
            return Err(recovery_conflict(
                "held source data must be rolled back or finalized before acknowledgement",
            ));
        }
        journal.remove()
    }

    fn summarize_mutation_recovery(
        &self,
        manifest: &MutationRecoveryManifest,
    ) -> WorkspaceMutationRecoverySummary {
        let source_paths = manifest.operation.trash_sources();
        let source_paths = if source_paths.is_empty() {
            match &manifest.operation {
                WorkspaceMutationOperation::Copy { source, .. }
                | WorkspaceMutationOperation::Move { source, .. } => vec![source.clone()],
                _ => Vec::new(),
            }
        } else {
            source_paths
        };
        let source_states = source_paths
            .iter()
            .map(|path| WorkspaceMutationRecoveryPathState {
                path: path.clone(),
                state: manifest.inventory_for_source(path).map_or(
                    WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown,
                    |inventory| {
                        if matches!(
                            &manifest.operation,
                            WorkspaceMutationOperation::Trash { .. }
                        ) {
                            self.observe_trash_inventory(path, inventory, manifest.limits)
                        } else {
                            self.observe_inventory(path, inventory, manifest.limits)
                        }
                    },
                ),
            })
            .collect::<Vec<_>>();
        let destination_state = manifest.destination.as_deref().map(|destination| {
            manifest.primary_inventory().map_or(
                WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown,
                |inventory| self.observe_inventory(destination, inventory, manifest.limits),
            )
        });
        let held_source_state = manifest.source_hold.as_deref().map(|_| {
            manifest
                .primary_inventory()
                .ok()
                .and_then(|inventory| {
                    manifest
                        .validated_source_hold(self.root())
                        .ok()
                        .flatten()
                        .map(|path| {
                            self.observe_absolute_inventory(&path, inventory, manifest.limits)
                        })
                })
                .unwrap_or(WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown)
        });
        let mut supported_actions = Vec::new();
        if manifest.version == 2 {
            match &manifest.operation {
                WorkspaceMutationOperation::Copy { .. } => {
                    if matches!(
                        destination_state,
                        Some(WorkspaceMutationRecoveryPathStateKind::Missing)
                            | Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed)
                    ) {
                        supported_actions.push(WorkspaceMutationRecoveryAction::Rollback);
                    }
                    if destination_state
                        == Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed)
                    {
                        supported_actions.push(WorkspaceMutationRecoveryAction::Finalize);
                    }
                }
                WorkspaceMutationOperation::Move { .. } => {
                    if self.move_recovery_can_rollback(
                        &source_states,
                        destination_state,
                        held_source_state,
                    ) {
                        supported_actions.push(WorkspaceMutationRecoveryAction::Rollback);
                    }
                    if self.move_recovery_can_finalize(
                        &source_states,
                        destination_state,
                        held_source_state,
                    ) {
                        supported_actions.push(WorkspaceMutationRecoveryAction::Finalize);
                    }
                }
                WorkspaceMutationOperation::CreateFile { .. }
                | WorkspaceMutationOperation::Trash { .. } => {}
            }
        }
        if held_source_state.is_none()
            || held_source_state == Some(WorkspaceMutationRecoveryPathStateKind::Missing)
        {
            supported_actions.push(WorkspaceMutationRecoveryAction::Acknowledge);
        }
        WorkspaceMutationRecoverySummary {
            recovery_id: manifest.recovery_id.clone(),
            workspace_root: manifest.workspace_root.clone(),
            operation: manifest.operation.clone(),
            phase: manifest.phase.clone(),
            source_states,
            destination: manifest.destination.clone(),
            destination_state,
            held_source_state,
            supported_actions,
        }
    }

    fn rollback_move_recovery(
        &self,
        journal: &mut MutationJournal,
        source: &str,
        destination: &str,
        inventory: &WorkspaceEntryInventory,
    ) -> Result<(), WorkspaceError> {
        let source_path = self.root().join(validate_relative_path(source)?);
        let destination_path = self.root().join(validate_relative_path(destination)?);
        if same_entry(&source_path, &destination_path) {
            let hold = create_recovery_hold(&source_path, ".asterlyn-case-rollback-")?;
            let hold_path = hold.join("entry");
            journal.update("rollback-case-hold-created", Some(path_string(&hold_path)?))?;
            fs::rename(&destination_path, &hold_path)
                .map_err(|error| execution_io("hold case-only move destination", error))?;
            journal.update(
                "rollback-case-destination-held",
                Some(path_string(&hold_path)?),
            )?;
            fs::rename(&hold_path, &source_path)
                .map_err(|error| execution_io("restore case-only move source", error))?;
            let _ = fs::remove_dir(&hold);
            sync_parent(&source_path)?;
            return journal.remove();
        }

        let source_state = self.observe_inventory(source, inventory, journal.manifest.limits);
        let destination_state =
            self.observe_inventory(destination, inventory, journal.manifest.limits);
        if source_state == WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown
            || destination_state == WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown
        {
            return Err(recovery_conflict(
                "move rollback stopped because a workspace path changed",
            ));
        }
        let hold = journal.validated_source_hold(self.root())?;
        if let Some(hold_path) = hold.filter(|path| path.exists()) {
            if self.observe_absolute_inventory(&hold_path, inventory, journal.manifest.limits)
                != WorkspaceMutationRecoveryPathStateKind::MatchesReviewed
                || source_state != WorkspaceMutationRecoveryPathStateKind::Missing
            {
                return Err(recovery_conflict(
                    "move rollback stopped because held source data changed",
                ));
            }
            if destination_state == WorkspaceMutationRecoveryPathStateKind::MatchesReviewed {
                self.remove_verified_workspace_entry(destination, inventory.source.kind)?;
                journal.update("rollback-destination-removed", None)?;
            }
            fs::rename(&hold_path, &source_path)
                .map_err(|error| execution_io("restore held move source", error))?;
            sync_parent(&source_path)?;
            if let Some(directory) = hold_path.parent() {
                let _ = fs::remove_dir(directory);
            }
            return journal.remove();
        }
        match (source_state, destination_state) {
            (
                WorkspaceMutationRecoveryPathStateKind::MatchesReviewed,
                WorkspaceMutationRecoveryPathStateKind::MatchesReviewed,
            ) => self.remove_verified_workspace_entry(destination, inventory.source.kind)?,
            (
                WorkspaceMutationRecoveryPathStateKind::MatchesReviewed,
                WorkspaceMutationRecoveryPathStateKind::Missing,
            ) => {}
            (
                WorkspaceMutationRecoveryPathStateKind::Missing,
                WorkspaceMutationRecoveryPathStateKind::MatchesReviewed,
            ) => {
                fs::rename(&destination_path, &source_path)
                    .map_err(|error| execution_io("restore move source", error))?;
                sync_parent(&source_path)?;
            }
            _ => {
                return Err(recovery_conflict(
                    "move rollback could not locate an intact reviewed entry",
                ));
            }
        }
        journal.remove()
    }

    fn finalize_move_recovery(
        &self,
        journal: &mut MutationJournal,
        source: &str,
        destination: &str,
        inventory: &WorkspaceEntryInventory,
    ) -> Result<(), WorkspaceError> {
        if self.observe_inventory(destination, inventory, journal.manifest.limits)
            != WorkspaceMutationRecoveryPathStateKind::MatchesReviewed
        {
            return Err(recovery_conflict(
                "move finalization stopped because the destination changed",
            ));
        }
        let source_path = self.root().join(validate_relative_path(source)?);
        let destination_path = self.root().join(validate_relative_path(destination)?);
        if same_entry(&source_path, &destination_path) {
            return journal.remove();
        }
        let source_state = self.observe_inventory(source, inventory, journal.manifest.limits);
        if source_state == WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown {
            return Err(recovery_conflict(
                "move finalization stopped because the source changed",
            ));
        }
        if let Some(hold_path) = journal
            .validated_source_hold(self.root())?
            .filter(|path| path.exists())
        {
            if self.observe_absolute_inventory(&hold_path, inventory, journal.manifest.limits)
                != WorkspaceMutationRecoveryPathStateKind::MatchesReviewed
                || source_state != WorkspaceMutationRecoveryPathStateKind::Missing
            {
                return Err(recovery_conflict(
                    "move finalization stopped because held source data changed",
                ));
            }
            remove_entry(&hold_path, inventory.source.kind)
                .map_err(|error| execution_io("remove finalized held move source", error))?;
            if let Some(directory) = hold_path.parent() {
                let _ = fs::remove_dir(directory);
            }
        } else if source_state == WorkspaceMutationRecoveryPathStateKind::MatchesReviewed {
            let hold = create_recovery_hold(&source_path, ".asterlyn-move-finalize-")?;
            let hold_path = hold.join("entry");
            journal.update(
                "finalize-source-hold-created",
                Some(path_string(&hold_path)?),
            )?;
            fs::rename(&source_path, &hold_path)
                .map_err(|error| execution_io("hold finalized move source", error))?;
            journal.update("finalize-source-held", Some(path_string(&hold_path)?))?;
            remove_entry(&hold_path, inventory.source.kind)
                .map_err(|error| execution_io("remove finalized move source", error))?;
            let _ = fs::remove_dir(&hold);
            sync_parent(&source_path)?;
        }
        journal.remove()
    }

    fn observe_inventory(
        &self,
        workspace_path: &str,
        expected: &WorkspaceEntryInventory,
        limits: WorkspaceMutationLimits,
    ) -> WorkspaceMutationRecoveryPathStateKind {
        let Ok(relative) = validate_relative_path(workspace_path) else {
            return WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown;
        };
        let absolute = self.root().join(relative);
        match fs::symlink_metadata(&absolute) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                WorkspaceMutationRecoveryPathStateKind::Missing
            }
            Err(_) => WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown,
            Ok(metadata) if metadata.file_type().is_symlink() => {
                WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown
            }
            Ok(_) => self
                .inspect_entry(workspace_path, limits)
                .ok()
                .filter(|actual| relocated_inventory_matches(expected, actual))
                .map_or(
                    WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown,
                    |_| WorkspaceMutationRecoveryPathStateKind::MatchesReviewed,
                ),
        }
    }

    fn observe_trash_inventory(
        &self,
        workspace_path: &str,
        expected: &WorkspaceEntryInventory,
        limits: WorkspaceMutationLimits,
    ) -> WorkspaceMutationRecoveryPathStateKind {
        let Ok(relative) = validate_relative_path(workspace_path) else {
            return WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown;
        };
        match fs::symlink_metadata(self.root().join(relative)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                WorkspaceMutationRecoveryPathStateKind::Missing
            }
            Err(_) => WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown,
            Ok(metadata) if metadata.file_type().is_symlink() => {
                WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown
            }
            Ok(_) => self
                .inspect_trash_entry(workspace_path, limits)
                .ok()
                .filter(|actual| {
                    actual.source == expected.source && actual.fingerprint == expected.fingerprint
                })
                .map_or(
                    WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown,
                    |_| WorkspaceMutationRecoveryPathStateKind::MatchesReviewed,
                ),
        }
    }

    fn observe_absolute_inventory(
        &self,
        absolute: &Path,
        expected: &WorkspaceEntryInventory,
        limits: WorkspaceMutationLimits,
    ) -> WorkspaceMutationRecoveryPathStateKind {
        if !absolute.starts_with(self.root()) {
            return WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown;
        }
        let Ok(relative) = absolute.strip_prefix(self.root()) else {
            return WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown;
        };
        let Some(workspace_path) = relative.to_str().map(|path| path.replace('\\', "/")) else {
            return WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown;
        };
        self.observe_inventory(&workspace_path, expected, limits)
    }

    fn remove_verified_workspace_entry(
        &self,
        workspace_path: &str,
        kind: WorkspaceEntryKind,
    ) -> Result<(), WorkspaceError> {
        let absolute = self.root().join(validate_relative_path(workspace_path)?);
        remove_entry(&absolute, kind)
            .map_err(|error| execution_io("remove verified workspace mutation entry", error))?;
        sync_parent(&absolute)
    }

    fn move_recovery_can_rollback(
        &self,
        source_states: &[WorkspaceMutationRecoveryPathState],
        destination_state: Option<WorkspaceMutationRecoveryPathStateKind>,
        held_source_state: Option<WorkspaceMutationRecoveryPathStateKind>,
    ) -> bool {
        let source = source_states.first().map(|state| state.state);
        let destination_safe = matches!(
            destination_state,
            Some(WorkspaceMutationRecoveryPathStateKind::Missing)
                | Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed)
        );
        destination_safe
            && match held_source_state {
                Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed) => {
                    source == Some(WorkspaceMutationRecoveryPathStateKind::Missing)
                }
                Some(WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown) => false,
                _ => matches!(
                    source,
                    Some(WorkspaceMutationRecoveryPathStateKind::Missing)
                        | Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed)
                ),
            }
    }

    fn move_recovery_can_finalize(
        &self,
        source_states: &[WorkspaceMutationRecoveryPathState],
        destination_state: Option<WorkspaceMutationRecoveryPathStateKind>,
        held_source_state: Option<WorkspaceMutationRecoveryPathStateKind>,
    ) -> bool {
        if destination_state != Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed) {
            return false;
        }
        let source = source_states.first().map(|state| state.state);
        match held_source_state {
            Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed) => {
                source == Some(WorkspaceMutationRecoveryPathStateKind::Missing)
            }
            Some(WorkspaceMutationRecoveryPathStateKind::ChangedOrUnknown) => false,
            _ => matches!(
                source,
                Some(WorkspaceMutationRecoveryPathStateKind::Missing)
                    | Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed)
            ),
        }
    }

    fn execute_create(
        &self,
        plan: &WorkspaceMutationPlan,
        destination: &str,
        cancellation: &WorkspaceMutationCancellationToken,
    ) -> Result<WorkspaceMutationOutcome, WorkspaceError> {
        if cancellation.is_cancelled() {
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::CancelledBeforeWrite,
                None,
                None,
            ));
        }
        let refreshed = self.plan_create_file(&plan.plan_id, destination, plan.collision_policy)?;
        if !refreshed.executable() {
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::FailedWithoutChange,
                None,
                Some("the create destination is no longer available".into()),
            ));
        }
        let path = self.root().join(validate_relative_path(destination)?);
        let parent = path
            .parent()
            .ok_or_else(|| WorkspaceError::InvalidMutation {
                message: "create destination has no parent".into(),
            })?;
        let file = OpenOptions::new().write(true).create_new(true).open(&path);
        match file {
            Ok(file) => {
                file.sync_all()
                    .map_err(|error| execution_io("sync new workspace file", error))?;
                sync_directory(parent)?;
                Ok(outcome(
                    plan,
                    WorkspaceMutationStatus::Completed,
                    None,
                    None,
                ))
            }
            Err(error) => Ok(outcome(
                plan,
                WorkspaceMutationStatus::FailedWithoutChange,
                None,
                Some(error.to_string()),
            )),
        }
    }

    fn execute_copy(
        &self,
        recovery_root: &Path,
        plan: &WorkspaceMutationPlan,
        source: &str,
        destination: &str,
        cancellation: &WorkspaceMutationCancellationToken,
    ) -> Result<WorkspaceMutationOutcome, WorkspaceError> {
        let inventory = self.revalidate_source(plan, source)?;
        if source == destination {
            return Ok(outcome(plan, WorkspaceMutationStatus::NoOp, None, None));
        }
        if cancellation.is_cancelled() {
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::CancelledBeforeWrite,
                None,
                None,
            ));
        }
        self.ensure_destination_absent(destination)?;
        let mut journal =
            MutationJournal::create(self.root(), recovery_root, plan, Some(&inventory))?;
        let result = self.copy_inventory_exclusive(&inventory, source, destination);
        match result {
            Ok(()) => {
                let verified = self.inspect_entry(destination, plan.limits)?;
                if !relocated_inventory_matches(&inventory, &verified) {
                    journal.update("destination-verification-failed", None)?;
                    return Ok(outcome(
                        plan,
                        WorkspaceMutationStatus::FailedWithRecovery,
                        Some(plan.plan_id.clone()),
                        Some("the copied destination did not match the reviewed source".into()),
                    ));
                }
                journal.remove()?;
                Ok(outcome(
                    plan,
                    WorkspaceMutationStatus::Completed,
                    None,
                    None,
                ))
            }
            Err(error) => {
                journal.update("copy-failed", None)?;
                Ok(outcome(
                    plan,
                    WorkspaceMutationStatus::FailedWithRecovery,
                    Some(plan.plan_id.clone()),
                    Some(error.to_string()),
                ))
            }
        }
    }

    fn execute_move(
        &self,
        recovery_root: &Path,
        plan: &WorkspaceMutationPlan,
        source: &str,
        destination: &str,
        cancellation: &WorkspaceMutationCancellationToken,
    ) -> Result<WorkspaceMutationOutcome, WorkspaceError> {
        let inventory = self.revalidate_source(plan, source)?;
        if source == destination {
            return Ok(outcome(plan, WorkspaceMutationStatus::NoOp, None, None));
        }
        if cancellation.is_cancelled() {
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::CancelledBeforeWrite,
                None,
                None,
            ));
        }
        let source_path = self.root().join(validate_relative_path(source)?);
        let destination_path = self.root().join(validate_relative_path(destination)?);
        let same_entry = same_entry(&source_path, &destination_path);
        let mut journal =
            MutationJournal::create(self.root(), recovery_root, plan, Some(&inventory))?;
        if same_entry {
            return self.execute_case_only_move(plan, source, destination, inventory, journal);
        }
        self.ensure_destination_absent(destination)?;
        if let Err(error) = self.copy_inventory_exclusive(&inventory, source, destination) {
            journal.update("move-copy-failed", None)?;
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::FailedWithRecovery,
                Some(plan.plan_id.clone()),
                Some(error.to_string()),
            ));
        }
        let verified = self.inspect_entry(destination, plan.limits)?;
        if !relocated_inventory_matches(&inventory, &verified) {
            journal.update("move-destination-verification-failed", None)?;
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::FailedWithRecovery,
                Some(plan.plan_id.clone()),
                Some("the move destination did not match the reviewed source".into()),
            ));
        }
        journal.update("destination-installed", None)?;
        let hold_directory =
            tempfile::Builder::new()
                .prefix(".asterlyn-move-")
                .tempdir_in(source_path.parent().ok_or_else(|| {
                    WorkspaceError::InvalidMutation {
                        message: "move source has no parent".into(),
                    }
                })?)
                .map_err(|error| execution_io("create move recovery hold", error))?
                .keep();
        let hold_path = hold_directory.join("entry");
        journal.update("source-hold-created", Some(path_string(&hold_path)?))?;
        if let Err(error) = fs::rename(&source_path, &hold_path) {
            journal.update("source-hold-failed", Some(path_string(&hold_path)?))?;
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::FailedWithRecovery,
                Some(plan.plan_id.clone()),
                Some(error.to_string()),
            ));
        }
        journal.update("source-held", Some(path_string(&hold_path)?))?;
        if let Err(error) = remove_entry(&hold_path, inventory.source.kind) {
            return Ok(completed_move_outcome(
                plan,
                Some(plan.plan_id.clone()),
                Some(error.to_string()),
            ));
        }
        let _ = fs::remove_dir(&hold_directory);
        journal.remove()?;
        Ok(completed_move_outcome(plan, None, None))
    }

    fn execute_case_only_move(
        &self,
        plan: &WorkspaceMutationPlan,
        _source: &str,
        destination: &str,
        inventory: WorkspaceEntryInventory,
        mut journal: MutationJournal,
    ) -> Result<WorkspaceMutationOutcome, WorkspaceError> {
        let source_path = self
            .root()
            .join(validate_relative_path(&inventory.source.workspace_path)?);
        let destination_path = self.root().join(validate_relative_path(destination)?);
        let hold_directory =
            tempfile::Builder::new()
                .prefix(".asterlyn-case-move-")
                .tempdir_in(source_path.parent().ok_or_else(|| {
                    WorkspaceError::InvalidMutation {
                        message: "move source has no parent".into(),
                    }
                })?)
                .map_err(|error| execution_io("create case-only move hold", error))?
                .keep();
        let hold_path = hold_directory.join("entry");
        journal.update("case-move-hold-created", Some(path_string(&hold_path)?))?;
        if let Err(error) = fs::rename(&source_path, &hold_path) {
            let unchanged = self
                .inspect_entry(&inventory.source.workspace_path, plan.limits)
                .is_ok_and(|current| current.fingerprint == inventory.fingerprint);
            let _ = fs::remove_dir(&hold_directory);
            if unchanged {
                journal.remove()?;
                return Ok(outcome(
                    plan,
                    WorkspaceMutationStatus::FailedWithoutChange,
                    None,
                    Some(error.to_string()),
                ));
            }
            journal.update(
                "case-move-source-hold-failed",
                Some(path_string(&hold_path)?),
            )?;
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::Uncertain,
                Some(plan.plan_id.clone()),
                Some(error.to_string()),
            ));
        }
        journal.update("case-move-source-held", Some(path_string(&hold_path)?))?;
        if let Err(error) = fs::rename(&hold_path, &destination_path) {
            let restored = fs::rename(&hold_path, &source_path).is_ok();
            if restored {
                journal.remove()?;
                return Ok(outcome(
                    plan,
                    WorkspaceMutationStatus::FailedWithoutChange,
                    None,
                    Some(error.to_string()),
                ));
            }
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::Uncertain,
                Some(plan.plan_id.clone()),
                Some(error.to_string()),
            ));
        }
        let _ = fs::remove_dir(hold_directory);
        let verified = self.inspect_entry(destination, plan.limits)?;
        if !relocated_inventory_matches(&inventory, &verified) {
            journal.update("case-move-verification-failed", None)?;
            return Ok(outcome(
                plan,
                WorkspaceMutationStatus::Uncertain,
                Some(plan.plan_id.clone()),
                Some("the case-only rename could not be verified".into()),
            ));
        }
        journal.remove()?;
        Ok(completed_move_outcome(plan, None, None))
    }

    fn revalidate_source(
        &self,
        plan: &WorkspaceMutationPlan,
        source: &str,
    ) -> Result<WorkspaceEntryInventory, WorkspaceError> {
        let reviewed = plan
            .inventory
            .as_ref()
            .ok_or_else(|| WorkspaceError::InvalidMutation {
                message: "workspace mutation plan has no source inventory".into(),
            })?;
        let current = self.inspect_entry(source, plan.limits)?;
        if current.fingerprint != reviewed.fingerprint || current.source != reviewed.source {
            return Err(WorkspaceError::Conflict {
                current_revision: current.fingerprint,
            });
        }
        Ok(current)
    }

    fn ensure_destination_absent(&self, destination: &str) -> Result<(), WorkspaceError> {
        let path = self.root().join(validate_relative_path(destination)?);
        match fs::symlink_metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Ok(_) => Err(WorkspaceError::InvalidMutation {
                message: "workspace mutation destinations are never replaced".into(),
            }),
            Err(error) => Err(execution_io(
                "inspect workspace mutation destination",
                error,
            )),
        }
    }

    fn copy_inventory_exclusive(
        &self,
        inventory: &WorkspaceEntryInventory,
        source: &str,
        destination: &str,
    ) -> Result<(), WorkspaceError> {
        let source_root = self.root().join(validate_relative_path(source)?);
        let destination_root = self.root().join(validate_relative_path(destination)?);
        let destination_parent =
            destination_root
                .parent()
                .ok_or_else(|| WorkspaceError::InvalidMutation {
                    message: "copy destination has no parent".into(),
                })?;
        match inventory.source.kind {
            WorkspaceEntryKind::File => {
                copy_file_noclobber(&source_root, &destination_root, inventory.source.mode)?;
                sync_directory(destination_parent)
            }
            WorkspaceEntryKind::Directory => {
                fs::create_dir(&destination_root)
                    .map_err(|error| execution_io("reserve copy destination directory", error))?;
                let mut directory_modes = vec![(destination_root.clone(), inventory.source.mode)];
                for entry in inventory.entries.iter().skip(1) {
                    let source_path = self
                        .root()
                        .join(validate_relative_path(&entry.workspace_path)?);
                    let suffix = Path::new(&entry.workspace_path)
                        .strip_prefix(source)
                        .map_err(|_| WorkspaceError::InvalidMutation {
                            message: "copy inventory path escaped its source".into(),
                        })?;
                    let destination_path = destination_root.join(suffix);
                    match entry.kind {
                        WorkspaceEntryKind::Directory => {
                            fs::create_dir(&destination_path).map_err(|error| {
                                execution_io("create copied workspace directory", error)
                            })?;
                            directory_modes.push((destination_path, entry.mode));
                        }
                        WorkspaceEntryKind::File => {
                            copy_file_noclobber(&source_path, &destination_path, entry.mode)?;
                        }
                    }
                }
                sync_tree_directories(&destination_root)?;
                for (directory, mode) in directory_modes.into_iter().rev() {
                    set_mode(&directory, mode)?;
                }
                sync_directory(destination_parent)
            }
        }
    }
}

struct MutationJournal {
    directory: PathBuf,
    path: PathBuf,
    manifest: MutationRecoveryManifest,
}

impl MutationRecoveryManifest {
    fn primary_inventory(&self) -> Result<&WorkspaceEntryInventory, WorkspaceError> {
        self.inventory
            .as_ref()
            .or_else(|| self.inventories.first())
            .ok_or_else(|| recovery_conflict("the recovery record has no reviewed inventory"))
    }

    fn inventory_for_source(&self, source: &str) -> Option<&WorkspaceEntryInventory> {
        self.inventory
            .iter()
            .chain(self.inventories.iter())
            .find(|inventory| inventory.source.workspace_path == source)
    }

    fn validated_source_hold(
        &self,
        workspace_root: &Path,
    ) -> Result<Option<PathBuf>, WorkspaceError> {
        let Some(raw) = &self.source_hold else {
            return Ok(None);
        };
        let path = PathBuf::from(raw);
        if !path.is_absolute()
            || !path.starts_with(workspace_root)
            || path.file_name() != Some("entry".as_ref())
        {
            return Err(recovery_conflict(
                "the recovery source hold path is invalid",
            ));
        }
        let Some(directory) = path.parent() else {
            return Err(recovery_conflict(
                "the recovery source hold path has no parent",
            ));
        };
        let valid_prefix = directory
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.starts_with(".asterlyn-move-")
                    || name.starts_with(".asterlyn-case-move-")
                    || name.starts_with(".asterlyn-case-rollback-")
            });
        let source_parent = match &self.operation {
            WorkspaceMutationOperation::Move { source, .. } => workspace_root
                .join(validate_relative_path(source)?)
                .parent()
                .map(Path::to_path_buf),
            _ => None,
        };
        if !valid_prefix || directory.parent().map(Path::to_path_buf) != source_parent {
            return Err(recovery_conflict(
                "the recovery source hold path is outside its source parent",
            ));
        }
        Ok(Some(path))
    }
}

impl MutationJournal {
    fn create(
        workspace_root: &Path,
        recovery_root: &Path,
        plan: &WorkspaceMutationPlan,
        inventory: Option<&WorkspaceEntryInventory>,
    ) -> Result<Self, WorkspaceError> {
        let directory = mutation_recovery_directory(recovery_root);
        fs::create_dir_all(&directory)
            .map_err(|error| execution_io("create workspace mutation recovery directory", error))?;
        let path = directory.join(format!("{}.json", plan.plan_id));
        let destination = match &plan.operation {
            WorkspaceMutationOperation::CreateFile { destination }
            | WorkspaceMutationOperation::Copy { destination, .. }
            | WorkspaceMutationOperation::Move { destination, .. } => Some(destination.clone()),
            WorkspaceMutationOperation::Trash { .. } => None,
        };
        let journal = Self {
            directory,
            path,
            manifest: MutationRecoveryManifest {
                version: 2,
                recovery_id: plan.plan_id.clone(),
                workspace_root: workspace_root.to_string_lossy().into_owned(),
                operation: plan.operation.clone(),
                fingerprint: inventory.map(|value| value.fingerprint.clone()),
                inventory: plan.inventory.clone(),
                inventories: plan.inventories.clone(),
                limits: plan.limits,
                phase: "prepared".into(),
                destination,
                source_hold: None,
            },
        };
        journal.persist_new()?;
        Ok(journal)
    }

    fn load(
        workspace_root: &Path,
        recovery_root: &Path,
        recovery_id: &str,
    ) -> Result<Option<Self>, WorkspaceError> {
        validate_recovery_id(recovery_id)?;
        let directory = mutation_recovery_directory(recovery_root);
        let path = directory.join(format!("{recovery_id}.json"));
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(execution_io("inspect workspace mutation recovery", error)),
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(recovery_conflict(
                "the workspace mutation recovery is not a regular file",
            ));
        }
        let bytes = fs::read(&path)
            .map_err(|error| execution_io("read workspace mutation recovery", error))?;
        let manifest: MutationRecoveryManifest =
            serde_json::from_slice(&bytes).map_err(|error| WorkspaceError::InvalidMutation {
                message: format!("invalid workspace mutation recovery: {error}"),
            })?;
        if manifest.recovery_id != recovery_id
            || manifest.workspace_root != workspace_root.to_string_lossy()
        {
            return Err(recovery_conflict(
                "the workspace mutation recovery identity does not match this workspace",
            ));
        }
        if !matches!(manifest.version, 1 | 2) {
            return Err(recovery_conflict(
                "the workspace mutation recovery version is unsupported",
            ));
        }
        Ok(Some(Self {
            directory,
            path,
            manifest,
        }))
    }

    fn require_current_schema(&self) -> Result<(), WorkspaceError> {
        if self.manifest.version == 2 {
            Ok(())
        } else {
            Err(recovery_conflict(
                "this legacy recovery record requires manual review and acknowledgement",
            ))
        }
    }

    fn validated_source_hold(
        &self,
        workspace_root: &Path,
    ) -> Result<Option<PathBuf>, WorkspaceError> {
        self.manifest.validated_source_hold(workspace_root)
    }

    fn update(&mut self, phase: &str, source_hold: Option<String>) -> Result<(), WorkspaceError> {
        self.manifest.phase = phase.to_string();
        if source_hold.is_some() {
            self.manifest.source_hold = source_hold;
        }
        self.persist()
    }

    fn persist(&self) -> Result<(), WorkspaceError> {
        self.persist_with(false)
    }

    fn persist_new(&self) -> Result<(), WorkspaceError> {
        self.persist_with(true)
    }

    fn persist_with(&self, create_new: bool) -> Result<(), WorkspaceError> {
        let bytes = serde_json::to_vec_pretty(&self.manifest).map_err(|error| {
            WorkspaceError::InvalidMutation {
                message: format!("serialize workspace mutation recovery: {error}"),
            }
        })?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(|error| execution_io("create workspace mutation recovery", error))?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.flush())
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| execution_io("write workspace mutation recovery", error))?;
        if create_new {
            temporary.persist_noclobber(&self.path).map_err(|error| {
                if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                    WorkspaceError::Busy {
                        message: "a workspace mutation recovery already uses this plan ID".into(),
                    }
                } else {
                    execution_io("install workspace mutation recovery", error.error)
                }
            })?;
        } else {
            temporary.persist(&self.path).map_err(|error| {
                execution_io("install workspace mutation recovery", error.error)
            })?;
        }
        sync_directory(&self.directory)
    }

    fn remove(&self) -> Result<(), WorkspaceError> {
        match fs::remove_file(&self.path) {
            Ok(()) => sync_directory(&self.directory),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(execution_io("remove workspace mutation recovery", error)),
        }
    }
}

fn mutation_recovery_directory(root: &Path) -> PathBuf {
    root.join("workspace-mutations-v1")
}

fn outcome(
    plan: &WorkspaceMutationPlan,
    status: WorkspaceMutationStatus,
    recovery_id: Option<String>,
    error: Option<String>,
) -> WorkspaceMutationOutcome {
    let source_paths = || {
        if !plan.inventories.is_empty() {
            plan.inventories
                .iter()
                .flat_map(|inventory| {
                    inventory
                        .entries
                        .iter()
                        .map(|entry| entry.workspace_path.clone())
                })
                .collect::<Vec<_>>()
        } else {
            plan.inventory
                .as_ref()
                .map(|inventory| {
                    inventory
                        .entries
                        .iter()
                        .map(|entry| entry.workspace_path.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        }
    };
    let destination_paths = |source: &str, destination: &str| {
        source_paths()
            .into_iter()
            .filter_map(|path| {
                Path::new(&path)
                    .strip_prefix(source)
                    .ok()
                    .map(|suffix| destination_path(destination, suffix))
            })
            .collect::<Vec<_>>()
    };
    let mut affected_paths = match &plan.operation {
        WorkspaceMutationOperation::CreateFile { destination } => vec![destination.clone()],
        WorkspaceMutationOperation::Copy {
            source,
            destination,
        } => destination_paths(source, destination),
        WorkspaceMutationOperation::Move {
            source,
            destination,
        } => {
            let mut paths = source_paths();
            paths.extend(destination_paths(source, destination));
            paths
        }
        WorkspaceMutationOperation::Trash { .. } => source_paths(),
    };
    affected_paths.sort();
    affected_paths.dedup();
    WorkspaceMutationOutcome {
        plan_id: plan.plan_id.clone(),
        status,
        affected_paths,
        path_remaps: Vec::new(),
        invalidated_slices: match &plan.operation {
            WorkspaceMutationOperation::CreateFile { .. }
            | WorkspaceMutationOperation::Copy { .. } => vec![
                WorkspaceMutationInvalidation::WorkspaceCatalog,
                WorkspaceMutationInvalidation::WorkingTree,
            ],
            WorkspaceMutationOperation::Move { .. } | WorkspaceMutationOperation::Trash { .. } => {
                vec![
                    WorkspaceMutationInvalidation::WorkspaceCatalog,
                    WorkspaceMutationInvalidation::OpenDocuments,
                    WorkspaceMutationInvalidation::WorkingTree,
                ]
            }
        },
        recovery_id,
        error,
    }
}

fn destination_path(destination: &str, suffix: &Path) -> String {
    if suffix.as_os_str().is_empty() {
        destination.to_string()
    } else {
        format!(
            "{destination}/{}",
            suffix.to_string_lossy().replace('\\', "/")
        )
    }
}

fn completed_move_outcome(
    plan: &WorkspaceMutationPlan,
    recovery_id: Option<String>,
    error: Option<String>,
) -> WorkspaceMutationOutcome {
    let mut result = outcome(plan, WorkspaceMutationStatus::Completed, recovery_id, error);
    if let WorkspaceMutationOperation::Move {
        source,
        destination,
    } = &plan.operation
    {
        result.path_remaps.push(WorkspacePathRemap {
            source: source.clone(),
            destination: destination.clone(),
        });
    }
    result
}

fn copy_file_noclobber(source: &Path, destination: &Path, mode: u32) -> Result<(), WorkspaceError> {
    let parent = destination
        .parent()
        .ok_or_else(|| WorkspaceError::InvalidMutation {
            message: "copied file has no destination parent".into(),
        })?;
    let source_metadata =
        fs::symlink_metadata(source).map_err(|error| execution_io("inspect copied file", error))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_file() {
        return Err(WorkspaceError::OutsideWorkspace {
            message: "copied files cannot be symbolic links or reparse points".into(),
        });
    }
    let mut input = open_copy_source_without_links(source)?;
    let opened_metadata = input
        .metadata()
        .map_err(|error| execution_io("inspect opened copied file", error))?;
    if !opened_file_matches_path(source, &source_metadata, &input, &opened_metadata)
        .map_err(|error| execution_io("verify opened copied file identity", error))?
    {
        return Err(WorkspaceError::Conflict {
            current_revision: "identity-changed-before-copy".into(),
        });
    }
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| execution_io("create copied file temporary", error))?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = input
            .read(&mut buffer)
            .map_err(|error| execution_io("read copied file", error))?;
        if count == 0 {
            break;
        }
        temporary
            .write_all(&buffer[..count])
            .map_err(|error| execution_io("write copied file", error))?;
    }
    set_file_permissions(temporary.as_file(), mode)?;
    temporary
        .flush()
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| execution_io("sync copied file", error))?;
    temporary
        .persist_noclobber(destination)
        .map_err(|error| execution_io("install copied file without replacement", error.error))?;
    Ok(())
}

#[cfg(unix)]
fn open_copy_source_without_links(path: &Path) -> Result<File, WorkspaceError> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| execution_io("open copied file without following links", error))
}

#[cfg(windows)]
fn open_copy_source_without_links(path: &Path) -> Result<File, WorkspaceError> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| execution_io("open copied file without following links", error))
}

#[cfg(not(any(unix, windows)))]
fn open_copy_source_without_links(path: &Path) -> Result<File, WorkspaceError> {
    File::open(path).map_err(|error| execution_io("open copied file", error))
}

fn sync_tree_directories(root: &Path) -> Result<(), WorkspaceError> {
    let mut directories = vec![root.to_path_buf()];
    let mut index = 0;
    while index < directories.len() {
        let directory = directories[index].clone();
        index += 1;
        for entry in fs::read_dir(&directory)
            .map_err(|error| execution_io("inspect copied directory", error))?
        {
            let entry = entry.map_err(|error| execution_io("inspect copied directory", error))?;
            if entry
                .file_type()
                .map_err(|error| execution_io("inspect copied entry", error))?
                .is_dir()
            {
                directories.push(entry.path());
            }
        }
    }
    for directory in directories.into_iter().rev() {
        sync_directory(&directory)?;
    }
    Ok(())
}

fn remove_entry(path: &Path, kind: WorkspaceEntryKind) -> Result<(), std::io::Error> {
    match kind {
        WorkspaceEntryKind::File => fs::remove_file(path),
        WorkspaceEntryKind::Directory => fs::remove_dir_all(path),
    }
}

fn set_mode(path: &Path, mode: u32) -> Result<(), WorkspaceError> {
    let permissions = fs::metadata(path)
        .map_err(|error| execution_io("read copied entry permissions", error))?
        .permissions();
    fs::set_permissions(path, permissions_for_mode(permissions, mode))
        .map_err(|error| execution_io("set copied entry permissions", error))
}

fn set_file_permissions(file: &File, mode: u32) -> Result<(), WorkspaceError> {
    let permissions = file
        .metadata()
        .map_err(|error| execution_io("read copied file permissions", error))?
        .permissions();
    file.set_permissions(permissions_for_mode(permissions, mode))
        .map_err(|error| execution_io("set copied file permissions", error))
}

fn permissions_for_mode(mut permissions: Permissions, mode: u32) -> Permissions {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(mode & 0o777);
    }
    #[cfg(not(unix))]
    {
        permissions.set_readonly(mode != 0);
    }
    permissions
}

#[cfg(unix)]
fn same_entry(source: &Path, destination: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let (Ok(source), Ok(destination)) = (
        fs::symlink_metadata(source),
        fs::symlink_metadata(destination),
    ) else {
        return false;
    };
    source.dev() == destination.dev() && source.ino() == destination.ino()
}

#[cfg(not(unix))]
fn same_entry(source: &Path, destination: &Path) -> bool {
    fs::canonicalize(source).ok() == fs::canonicalize(destination).ok()
}

fn path_string(path: &Path) -> Result<String, WorkspaceError> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| WorkspaceError::UnsupportedFile {
            message: "workspace mutation recovery paths must be UTF-8".into(),
        })
}

fn create_recovery_hold(source: &Path, prefix: &str) -> Result<PathBuf, WorkspaceError> {
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(
            source
                .parent()
                .ok_or_else(|| WorkspaceError::InvalidMutation {
                    message: "workspace mutation source has no parent".into(),
                })?,
        )
        .map(|directory| directory.keep())
        .map_err(|error| execution_io("create workspace mutation recovery hold", error))
}

fn sync_parent(path: &Path) -> Result<(), WorkspaceError> {
    path.parent()
        .ok_or_else(|| WorkspaceError::InvalidMutation {
            message: "workspace mutation entry has no parent".into(),
        })
        .and_then(sync_directory)
}

fn relocated_inventory_matches(
    expected: &WorkspaceEntryInventory,
    actual: &WorkspaceEntryInventory,
) -> bool {
    if expected.fingerprint != actual.fingerprint
        || expected.source.kind != actual.source.kind
        || expected.source.mode != actual.source.mode
        || expected.source.byte_length != actual.source.byte_length
        || expected.total_bytes != actual.total_bytes
        || expected.entries.len() != actual.entries.len()
        || expected.truncated != actual.truncated
    {
        return false;
    }
    let expected_root = Path::new(&expected.source.workspace_path);
    let actual_root = Path::new(&actual.source.workspace_path);
    expected
        .entries
        .iter()
        .zip(&actual.entries)
        .all(|(left, right)| {
            let left_suffix = Path::new(&left.workspace_path).strip_prefix(expected_root);
            let right_suffix = Path::new(&right.workspace_path).strip_prefix(actual_root);
            left_suffix.ok() == right_suffix.ok()
                && left.kind == right.kind
                && left.revision == right.revision
                && left.mode == right.mode
                && left.byte_length == right.byte_length
        })
}

fn validate_recovery_id(recovery_id: &str) -> Result<(), WorkspaceError> {
    if recovery_id.is_empty()
        || recovery_id.len() > 200
        || !recovery_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(WorkspaceError::InvalidMutation {
            message: "workspace mutation recovery ID is invalid".into(),
        });
    }
    Ok(())
}

fn recovery_conflict(message: &str) -> WorkspaceError {
    WorkspaceError::InvalidMutation {
        message: message.into(),
    }
}

fn execution_io(operation: &str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        operation: operation.into(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{WorkspaceCollisionPolicy, WorkspaceMutationLimits};

    #[test]
    fn create_is_exclusive_and_cancellable_before_the_first_write() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_create_file("create-1", "new.txt", WorkspaceCollisionPolicy::Cancel)
            .unwrap();
        let cancelled = WorkspaceMutationCancellationToken::default();
        cancelled.cancel();
        assert_eq!(
            workspace
                .execute_mutation_plan(recovery.path(), &plan, &cancelled)
                .unwrap()
                .status,
            WorkspaceMutationStatus::CancelledBeforeWrite
        );
        assert!(!directory.path().join("new.txt").exists());

        let outcome = workspace
            .execute_mutation_plan(
                recovery.path(),
                &plan,
                &WorkspaceMutationCancellationToken::default(),
            )
            .unwrap();
        assert_eq!(outcome.status, WorkspaceMutationStatus::Completed);
        assert_eq!(fs::read(directory.path().join("new.txt")).unwrap(), b"");
        assert_eq!(
            workspace
                .execute_mutation_plan(
                    recovery.path(),
                    &plan,
                    &WorkspaceMutationCancellationToken::default(),
                )
                .unwrap()
                .status,
            WorkspaceMutationStatus::FailedWithoutChange
        );
    }

    #[test]
    fn file_and_directory_copy_are_verified_and_never_replace_destinations() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("src/nested")).unwrap();
        fs::write(directory.path().join("src/nested/a"), b"a").unwrap();
        fs::write(directory.path().join("file"), b"file").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        for (id, source, destination) in [
            ("copy-file", "file", "file-copy"),
            ("copy-directory", "src", "src-copy"),
        ] {
            let plan = workspace
                .plan_copy(
                    id,
                    source,
                    destination,
                    WorkspaceCollisionPolicy::Cancel,
                    WorkspaceMutationLimits::default(),
                )
                .unwrap();
            let outcome = workspace
                .execute_mutation_plan(
                    recovery.path(),
                    &plan,
                    &WorkspaceMutationCancellationToken::default(),
                )
                .unwrap();
            assert_eq!(outcome.status, WorkspaceMutationStatus::Completed);
            assert!(
                outcome
                    .affected_paths
                    .iter()
                    .all(|path| path == destination || path.starts_with(&format!("{destination}/")))
            );
            assert_eq!(
                workspace
                    .inspect_entry(source, plan.limits)
                    .unwrap()
                    .fingerprint,
                workspace
                    .inspect_entry(destination, plan.limits)
                    .unwrap()
                    .fingerprint
            );
        }
        fs::write(directory.path().join("taken"), b"keep").unwrap();
        let blocked = workspace
            .plan_copy(
                "copy-taken",
                "file",
                "taken",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        assert!(!blocked.executable());
        assert_eq!(fs::read(directory.path().join("taken")).unwrap(), b"keep");
    }

    #[test]
    fn move_installs_verified_destination_then_removes_source_with_a_path_remap() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("folder/nested")).unwrap();
        fs::write(directory.path().join("folder/nested/a"), b"a").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_move(
                "move-1",
                "folder",
                "renamed",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        let outcome = workspace
            .execute_mutation_plan(
                recovery.path(),
                &plan,
                &WorkspaceMutationCancellationToken::default(),
            )
            .unwrap();
        assert_eq!(outcome.status, WorkspaceMutationStatus::Completed);
        assert!(!directory.path().join("folder").exists());
        assert_eq!(
            fs::read(directory.path().join("renamed/nested/a")).unwrap(),
            b"a"
        );
        assert_eq!(
            outcome.path_remaps,
            vec![WorkspacePathRemap {
                source: "folder".into(),
                destination: "renamed".into(),
            }]
        );
        assert_eq!(
            outcome.affected_paths,
            vec![
                "folder".to_string(),
                "folder/nested".to_string(),
                "folder/nested/a".to_string(),
                "renamed".to_string(),
                "renamed/nested".to_string(),
                "renamed/nested/a".to_string(),
            ]
        );
        assert!(
            workspace
                .list_mutation_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn execution_rejects_a_source_changed_after_planning() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("source"), b"reviewed").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_copy(
                "stale-copy",
                "source",
                "destination",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        fs::write(directory.path().join("source"), b"changed").unwrap();

        let result = workspace.execute_mutation_plan(
            recovery.path(),
            &plan,
            &WorkspaceMutationCancellationToken::default(),
        );

        assert!(matches!(result, Err(WorkspaceError::Conflict { .. })));
        assert!(!directory.path().join("destination").exists());
        assert!(
            workspace
                .list_mutation_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn trash_adapter_failure_is_typed_by_observed_source_state() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("file"), b"file").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_trash("trash-1", "file", WorkspaceMutationLimits::default())
            .unwrap();
        let outcome = workspace
            .execute_trash_plan_with(
                recovery.path(),
                &plan,
                &WorkspaceMutationCancellationToken::default(),
                |_| {
                    Err(WorkspaceError::Io {
                        operation: "trash".into(),
                        message: "failed".into(),
                    })
                },
            )
            .unwrap();
        assert_eq!(outcome.status, WorkspaceMutationStatus::FailedWithoutChange);
        assert!(outcome.recovery_id.is_none());
    }

    #[test]
    fn trash_rejects_a_plan_whose_sources_and_inventories_do_not_match() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("one"), b"one").unwrap();
        fs::write(directory.path().join("two"), b"two").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let mut plan = workspace
            .plan_trash_sources(
                "trash-mismatch",
                &["one".to_string(), "two".to_string()],
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        plan.inventories.pop();
        let result = workspace.execute_trash_plan_with(
            recovery.path(),
            &plan,
            &WorkspaceMutationCancellationToken::default(),
            |_| panic!("an inconsistent plan must not reach the trash adapter"),
        );
        assert!(matches!(
            result,
            Err(WorkspaceError::InvalidMutation { .. })
        ));
    }

    #[test]
    fn partial_batch_trash_failure_is_uncertain_and_keeps_recovery_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("one"), b"one").unwrap();
        fs::write(directory.path().join("two"), b"two").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_trash_sources(
                "trash-partial",
                &["one".to_string(), "two".to_string()],
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        let outcome = workspace
            .execute_trash_plan_with(
                recovery.path(),
                &plan,
                &WorkspaceMutationCancellationToken::default(),
                |targets| {
                    fs::remove_file(&targets[0]).unwrap();
                    Err(WorkspaceError::Io {
                        operation: "trash".into(),
                        message: "partial failure".into(),
                    })
                },
            )
            .unwrap();
        assert_eq!(outcome.status, WorkspaceMutationStatus::Uncertain);
        assert_eq!(outcome.recovery_id.as_deref(), Some("trash-partial"));
        assert!(!directory.path().join("one").exists());
        assert!(directory.path().join("two").exists());
        assert_eq!(
            workspace
                .list_mutation_recoveries(recovery.path())
                .unwrap()
                .len(),
            1
        );
        let summary = workspace
            .list_mutation_recoveries(recovery.path())
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            summary.supported_actions,
            vec![WorkspaceMutationRecoveryAction::Acknowledge]
        );
        assert_eq!(
            summary.source_states,
            vec![
                WorkspaceMutationRecoveryPathState {
                    path: "one".into(),
                    state: WorkspaceMutationRecoveryPathStateKind::Missing,
                },
                WorkspaceMutationRecoveryPathState {
                    path: "two".into(),
                    state: WorkspaceMutationRecoveryPathStateKind::MatchesReviewed,
                },
            ]
        );
        workspace
            .acknowledge_mutation_recovery(recovery.path(), "trash-partial")
            .unwrap();
        workspace
            .acknowledge_mutation_recovery(recovery.path(), "trash-partial")
            .unwrap();
        assert!(
            workspace
                .list_mutation_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn copy_recovery_rolls_back_only_an_unchanged_reviewed_destination() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("source"), b"reviewed").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_copy(
                "copy-recovery",
                "source",
                "destination",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        let inventory = plan.inventory.as_ref().unwrap();
        workspace
            .copy_inventory_exclusive(inventory, "source", "destination")
            .unwrap();
        let mut journal =
            MutationJournal::create(workspace.root(), recovery.path(), &plan, Some(inventory))
                .unwrap();
        journal.update("copy-failed", None).unwrap();

        let summary = workspace
            .list_mutation_recoveries(recovery.path())
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            summary.destination_state,
            Some(WorkspaceMutationRecoveryPathStateKind::MatchesReviewed)
        );
        assert!(
            summary
                .supported_actions
                .contains(&WorkspaceMutationRecoveryAction::Rollback)
        );
        workspace
            .rollback_mutation_recovery(recovery.path(), "copy-recovery")
            .unwrap();
        workspace
            .rollback_mutation_recovery(recovery.path(), "copy-recovery")
            .unwrap();
        assert!(!directory.path().join("destination").exists());
        assert_eq!(
            fs::read(directory.path().join("source")).unwrap(),
            b"reviewed"
        );
    }

    #[test]
    fn copy_recovery_refuses_to_remove_a_changed_destination() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("source"), b"reviewed").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_copy(
                "copy-changed",
                "source",
                "destination",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        let inventory = plan.inventory.as_ref().unwrap();
        workspace
            .copy_inventory_exclusive(inventory, "source", "destination")
            .unwrap();
        MutationJournal::create(workspace.root(), recovery.path(), &plan, Some(inventory)).unwrap();
        fs::write(directory.path().join("destination"), b"user change").unwrap();

        let summary = workspace
            .list_mutation_recoveries(recovery.path())
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(
            summary.supported_actions,
            vec![WorkspaceMutationRecoveryAction::Acknowledge]
        );
        assert!(
            workspace
                .rollback_mutation_recovery(recovery.path(), "copy-changed")
                .is_err()
        );
        assert_eq!(
            fs::read(directory.path().join("destination")).unwrap(),
            b"user change"
        );
        assert_eq!(
            workspace
                .list_mutation_recoveries(recovery.path())
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn move_recovery_can_finalize_a_verified_destination_and_remove_the_source() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("source"), b"reviewed").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_move(
                "move-finalize",
                "source",
                "destination",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        let inventory = plan.inventory.as_ref().unwrap();
        workspace
            .copy_inventory_exclusive(inventory, "source", "destination")
            .unwrap();
        let mut journal =
            MutationJournal::create(workspace.root(), recovery.path(), &plan, Some(inventory))
                .unwrap();
        journal.update("destination-installed", None).unwrap();

        workspace
            .finalize_mutation_recovery(recovery.path(), "move-finalize")
            .unwrap();
        workspace
            .finalize_mutation_recovery(recovery.path(), "move-finalize")
            .unwrap();
        assert!(!directory.path().join("source").exists());
        assert_eq!(
            fs::read(directory.path().join("destination")).unwrap(),
            b"reviewed"
        );
        assert!(
            workspace
                .list_mutation_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn move_recovery_rolls_back_an_intact_held_source_without_exposing_its_path() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("source"), b"reviewed").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_move(
                "move-held",
                "source",
                "destination",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        let inventory = plan.inventory.as_ref().unwrap();
        workspace
            .copy_inventory_exclusive(inventory, "source", "destination")
            .unwrap();
        let source_path = workspace.root().join("source");
        let hold_directory = create_recovery_hold(&source_path, ".asterlyn-move-test-").unwrap();
        let hold_path = hold_directory.join("entry");
        let mut journal =
            MutationJournal::create(workspace.root(), recovery.path(), &plan, Some(inventory))
                .unwrap();
        fs::rename(&source_path, &hold_path).unwrap();
        journal
            .update("source-held", Some(path_string(&hold_path).unwrap()))
            .unwrap();
        let held_inventory = workspace
            .inspect_entry(
                hold_path
                    .strip_prefix(workspace.root())
                    .unwrap()
                    .to_str()
                    .unwrap(),
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        assert!(
            relocated_inventory_matches(inventory, &held_inventory),
            "reviewed={inventory:?} held={held_inventory:?}"
        );

        let serialized_summary =
            serde_json::to_string(&workspace.list_mutation_recoveries(recovery.path()).unwrap()[0])
                .unwrap();
        assert!(!serialized_summary.contains(hold_path.to_string_lossy().as_ref()));
        assert!(!serialized_summary.contains("source_hold"));
        assert!(
            serialized_summary.contains("rollback"),
            "unexpected held-source recovery summary: {serialized_summary}"
        );
        assert!(serialized_summary.contains("finalize"));
        assert!(!serialized_summary.contains("acknowledge"));

        workspace
            .rollback_mutation_recovery(recovery.path(), "move-held")
            .unwrap();
        assert_eq!(
            fs::read(directory.path().join("source")).unwrap(),
            b"reviewed"
        );
        assert!(!directory.path().join("destination").exists());
        assert!(!hold_path.exists());
    }

    #[test]
    fn unknown_recovery_schema_fails_closed_without_removing_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("source"), b"reviewed").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_copy(
                "future-schema",
                "source",
                "destination",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        let mut journal = MutationJournal::create(
            workspace.root(),
            recovery.path(),
            &plan,
            plan.inventory.as_ref(),
        )
        .unwrap();
        journal.manifest.version = 99;
        journal.persist().unwrap();

        assert!(workspace.list_mutation_recoveries(recovery.path()).is_err());
        assert!(
            workspace
                .rollback_mutation_recovery(recovery.path(), "future-schema")
                .is_err()
        );
        assert!(journal.path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn copy_primitive_never_follows_a_replaced_symbolic_link() {
        let directory = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        fs::write(external.path().join("secret"), b"outside").unwrap();
        std::os::unix::fs::symlink(
            external.path().join("secret"),
            directory.path().join("source"),
        )
        .unwrap();
        let result = copy_file_noclobber(
            &directory.path().join("source"),
            &directory.path().join("destination"),
            0o644,
        );
        assert!(matches!(
            result,
            Err(WorkspaceError::OutsideWorkspace { .. })
        ));
        assert!(!directory.path().join("destination").exists());
    }
}
