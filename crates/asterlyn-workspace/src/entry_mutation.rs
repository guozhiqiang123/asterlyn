use std::fs::{self, Metadata};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::{
    Workspace, WorkspaceError,
    file_identity::{opened_file_identity_token, opened_file_matches_path},
    validate_relative_path,
};

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryIdentity {
    pub workspace_path: String,
    pub kind: WorkspaceEntryKind,
    pub revision: String,
    pub mode: u32,
    pub byte_length: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryInventoryItem {
    pub workspace_path: String,
    pub kind: WorkspaceEntryKind,
    pub revision: String,
    pub mode: u32,
    pub byte_length: u64,
    pub hidden: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryInventory {
    pub source: WorkspaceEntryIdentity,
    pub entries: Vec<WorkspaceEntryInventoryItem>,
    pub total_bytes: u64,
    pub symlink_paths: Vec<String>,
    pub nested_repository_paths: Vec<String>,
    pub multiple_link_paths: Vec<String>,
    pub truncated: bool,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceCollisionPolicy {
    Cancel,
    RenameTarget,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WorkspaceMutationOperation {
    CreateFile {
        destination: String,
    },
    Copy {
        source: String,
        destination: String,
    },
    Move {
        source: String,
        destination: String,
    },
    Trash {
        #[serde(default)]
        source: String,
        #[serde(default)]
        sources: Vec<String>,
    },
}

impl WorkspaceMutationOperation {
    pub fn trash_sources(&self) -> Vec<String> {
        match self {
            WorkspaceMutationOperation::Trash { source, sources } => {
                if !sources.is_empty() {
                    sources.clone()
                } else if !source.is_empty() {
                    vec![source.clone()]
                } else {
                    vec![]
                }
            }
            _ => vec![],
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WorkspaceMutationBlocker {
    DestinationExists { path: String },
    DestinationInsideSource { path: String },
    Symlink { paths: Vec<String> },
    NestedRepository { paths: Vec<String> },
    MultipleHardLinks { paths: Vec<String> },
    InventoryTruncated,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMutationPlan {
    pub plan_id: String,
    pub operation: WorkspaceMutationOperation,
    pub collision_policy: WorkspaceCollisionPolicy,
    pub limits: WorkspaceMutationLimits,
    #[serde(default)]
    pub inventory: Option<WorkspaceEntryInventory>,
    #[serde(default)]
    pub inventories: Vec<WorkspaceEntryInventory>,
    pub blockers: Vec<WorkspaceMutationBlocker>,
}

impl WorkspaceMutationPlan {
    pub fn executable(&self) -> bool {
        self.blockers.is_empty()
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMutationLimits {
    pub max_entries: usize,
    pub max_total_bytes: u64,
    pub max_depth: usize,
    pub max_path_bytes: usize,
}

impl WorkspaceMutationLimits {
    pub const fn default_transfer() -> Self {
        Self {
            max_entries: 20_000,
            max_total_bytes: 512 * 1024 * 1024,
            max_depth: 64,
            max_path_bytes: 4_096,
        }
    }

    pub const fn default_trash() -> Self {
        Self {
            max_entries: 200_000,
            max_total_bytes: 64 * 1024 * 1024 * 1024,
            max_depth: 64,
            max_path_bytes: 4_096,
        }
    }
}

impl Default for WorkspaceMutationLimits {
    fn default() -> Self {
        Self::default_transfer()
    }
}

impl Workspace {
    /// Resolves one existing regular file or real directory below this canonical workspace root.
    /// Every path component is checked without following symbolic links or reparse points.
    pub fn resolve_existing_entry(
        &self,
        workspace_path: &str,
        expected_kind: WorkspaceEntryKind,
    ) -> Result<PathBuf, WorkspaceError> {
        let relative = validate_relative_path(workspace_path)?;
        let resolved = self.resolve_entry_without_links(relative)?;
        let metadata = fs::symlink_metadata(&resolved).map_err(inventory_io)?;
        if metadata.file_type().is_symlink() {
            return Err(WorkspaceError::OutsideWorkspace {
                message: "workspace entry paths cannot be symbolic links".into(),
            });
        }
        let actual_kind = entry_kind(&metadata)?;
        if actual_kind != expected_kind {
            return Err(WorkspaceError::Conflict {
                current_revision: "workspace-entry-kind-changed".into(),
            });
        }
        Ok(resolved)
    }

    pub fn inspect_entry(
        &self,
        workspace_path: &str,
        limits: WorkspaceMutationLimits,
    ) -> Result<WorkspaceEntryInventory, WorkspaceError> {
        self.inspect_entry_with_revision(workspace_path, limits, FileRevisionPolicy::Content)
    }

    pub(crate) fn inspect_trash_entry(
        &self,
        workspace_path: &str,
        limits: WorkspaceMutationLimits,
    ) -> Result<WorkspaceEntryInventory, WorkspaceError> {
        self.inspect_entry_with_revision(workspace_path, limits, FileRevisionPolicy::Identity)
    }

    fn inspect_entry_with_revision(
        &self,
        workspace_path: &str,
        limits: WorkspaceMutationLimits,
        file_revision: FileRevisionPolicy,
    ) -> Result<WorkspaceEntryInventory, WorkspaceError> {
        validate_limits(limits)?;
        let relative = validate_relative_path(workspace_path)?;
        let source = self.resolve_entry_without_links(relative)?;
        let metadata = fs::symlink_metadata(&source).map_err(inventory_io)?;
        if metadata.file_type().is_symlink() {
            return Err(WorkspaceError::OutsideWorkspace {
                message: "workspace mutation sources cannot be symbolic links".into(),
            });
        }
        let kind = entry_kind(&metadata)?;
        let mut builder = InventoryBuilder::new(relative, limits, file_revision);
        builder.collect(relative, &source, &metadata, 0)?;
        builder.finish(workspace_path, kind, &metadata)
    }

    pub fn plan_create_file(
        &self,
        plan_id: &str,
        destination: &str,
        collision_policy: WorkspaceCollisionPolicy,
    ) -> Result<WorkspaceMutationPlan, WorkspaceError> {
        validate_plan_id(plan_id)?;
        let destination_path = self.resolve_destination(destination)?;
        let mut blockers = Vec::new();
        if destination_exists(&destination_path)? {
            blockers.push(WorkspaceMutationBlocker::DestinationExists {
                path: destination.to_string(),
            });
        }
        Ok(WorkspaceMutationPlan {
            plan_id: plan_id.to_string(),
            operation: WorkspaceMutationOperation::CreateFile {
                destination: destination.to_string(),
            },
            collision_policy,
            limits: WorkspaceMutationLimits::default(),
            inventory: None,
            inventories: Vec::new(),
            blockers,
        })
    }

    pub fn plan_copy(
        &self,
        plan_id: &str,
        source: &str,
        destination: &str,
        collision_policy: WorkspaceCollisionPolicy,
        limits: WorkspaceMutationLimits,
    ) -> Result<WorkspaceMutationPlan, WorkspaceError> {
        self.plan_transfer(
            plan_id,
            source,
            destination,
            collision_policy,
            limits,
            false,
        )
    }

    pub fn plan_move(
        &self,
        plan_id: &str,
        source: &str,
        destination: &str,
        collision_policy: WorkspaceCollisionPolicy,
        limits: WorkspaceMutationLimits,
    ) -> Result<WorkspaceMutationPlan, WorkspaceError> {
        self.plan_transfer(plan_id, source, destination, collision_policy, limits, true)
    }

    pub fn plan_trash(
        &self,
        plan_id: &str,
        source: &str,
        limits: WorkspaceMutationLimits,
    ) -> Result<WorkspaceMutationPlan, WorkspaceError> {
        self.plan_trash_sources(plan_id, &[source.to_string()], limits)
    }

    pub fn plan_trash_sources(
        &self,
        plan_id: &str,
        sources: &[String],
        limits: WorkspaceMutationLimits,
    ) -> Result<WorkspaceMutationPlan, WorkspaceError> {
        validate_plan_id(plan_id)?;
        if sources.is_empty() {
            return Err(WorkspaceError::InvalidMutation {
                message: "trash operation requires at least one source".to_string(),
            });
        }
        let sources = normalize_trash_sources(sources)?;
        let mut inventories = Vec::with_capacity(sources.len());
        let mut blockers = Vec::new();
        let mut entry_count = 0_usize;
        let mut total_bytes = 0_u64;
        for source in &sources {
            let remaining_entries = limits.max_entries.saturating_sub(entry_count);
            let remaining_bytes = limits.max_total_bytes.saturating_sub(total_bytes);
            if remaining_entries == 0 || remaining_bytes == 0 {
                blockers.push(WorkspaceMutationBlocker::InventoryTruncated);
                break;
            }
            let inventory = self.inspect_trash_entry(
                source,
                WorkspaceMutationLimits {
                    max_entries: remaining_entries,
                    max_total_bytes: remaining_bytes,
                    ..limits
                },
            )?;
            blockers.extend(inventory_blockers(&inventory));
            entry_count = entry_count.saturating_add(inventory.entries.len());
            total_bytes = total_bytes.saturating_add(inventory.total_bytes);
            inventories.push(inventory);
        }
        let inventory = (inventories.len() == 1).then(|| inventories.pop().unwrap());
        Ok(WorkspaceMutationPlan {
            plan_id: plan_id.to_string(),
            operation: WorkspaceMutationOperation::Trash {
                source: sources.first().cloned().unwrap_or_default(),
                sources,
            },
            collision_policy: WorkspaceCollisionPolicy::Cancel,
            limits,
            inventory,
            inventories,
            blockers,
        })
    }

    fn plan_transfer(
        &self,
        plan_id: &str,
        source: &str,
        destination: &str,
        collision_policy: WorkspaceCollisionPolicy,
        limits: WorkspaceMutationLimits,
        moving: bool,
    ) -> Result<WorkspaceMutationPlan, WorkspaceError> {
        validate_plan_id(plan_id)?;
        let inventory = self.inspect_entry(source, limits)?;
        let destination_path = self.resolve_destination(destination)?;
        let mut blockers = inventory_blockers(&inventory);
        let source_relative = validate_relative_path(source)?;
        let destination_relative = validate_relative_path(destination)?;
        if inventory.source.kind == WorkspaceEntryKind::Directory
            && destination_relative.starts_with(source_relative)
            && destination_relative != source_relative
        {
            blockers.push(WorkspaceMutationBlocker::DestinationInsideSource {
                path: destination.to_string(),
            });
        }
        if destination_exists(&destination_path)?
            && source_relative != destination_relative
            && !(moving && same_file(&self.root().join(source_relative), &destination_path))
        {
            blockers.push(WorkspaceMutationBlocker::DestinationExists {
                path: destination.to_string(),
            });
        }
        Ok(WorkspaceMutationPlan {
            plan_id: plan_id.to_string(),
            operation: if moving {
                WorkspaceMutationOperation::Move {
                    source: source.to_string(),
                    destination: destination.to_string(),
                }
            } else {
                WorkspaceMutationOperation::Copy {
                    source: source.to_string(),
                    destination: destination.to_string(),
                }
            },
            collision_policy,
            limits,
            inventory: Some(inventory),
            inventories: Vec::new(),
            blockers,
        })
    }

    fn resolve_entry_without_links(&self, relative: &Path) -> Result<PathBuf, WorkspaceError> {
        let mut current = self.root().to_path_buf();
        for component in relative.components() {
            let Component::Normal(name) = component else {
                unreachable!("relative path is validated")
            };
            current.push(name);
            let metadata = fs::symlink_metadata(&current).map_err(inventory_io)?;
            if metadata.file_type().is_symlink() {
                return Err(WorkspaceError::OutsideWorkspace {
                    message: "workspace mutation paths cannot traverse symbolic links".into(),
                });
            }
        }
        Ok(current)
    }

    fn resolve_destination(&self, destination: &str) -> Result<PathBuf, WorkspaceError> {
        let relative = validate_relative_path(destination)?;
        let parent = relative
            .parent()
            .ok_or_else(|| WorkspaceError::InvalidMutation {
                message: "workspace mutation destinations require a parent".into(),
            })?;
        let parent_path = if parent.as_os_str().is_empty() {
            self.root().to_path_buf()
        } else {
            self.resolve_entry_without_links(parent)?
        };
        if !parent_path.is_dir() {
            return Err(WorkspaceError::InvalidMutation {
                message: "workspace mutation destination parent is not a directory".into(),
            });
        }
        Ok(self.root().join(relative))
    }
}

#[derive(Debug, Clone, Copy)]
enum FileRevisionPolicy {
    Content,
    Identity,
}

struct InventoryBuilder {
    source: PathBuf,
    limits: WorkspaceMutationLimits,
    file_revision: FileRevisionPolicy,
    entries: Vec<WorkspaceEntryInventoryItem>,
    total_bytes: u64,
    symlink_paths: Vec<String>,
    nested_repository_paths: Vec<String>,
    multiple_link_paths: Vec<String>,
    truncated: bool,
    digest: Sha256,
}

impl InventoryBuilder {
    fn new(
        source: &Path,
        limits: WorkspaceMutationLimits,
        file_revision: FileRevisionPolicy,
    ) -> Self {
        Self {
            source: source.to_path_buf(),
            limits,
            file_revision,
            entries: Vec::new(),
            total_bytes: 0,
            symlink_paths: Vec::new(),
            nested_repository_paths: Vec::new(),
            multiple_link_paths: Vec::new(),
            truncated: false,
            digest: Sha256::new(),
        }
    }

    fn collect(
        &mut self,
        relative: &Path,
        absolute: &Path,
        metadata: &Metadata,
        depth: usize,
    ) -> Result<(), WorkspaceError> {
        if depth > self.limits.max_depth || self.entries.len() >= self.limits.max_entries {
            self.truncated = true;
            return Ok(());
        }
        let path = workspace_path(relative)?;
        if path.len() > self.limits.max_path_bytes {
            self.truncated = true;
            return Ok(());
        }
        if metadata.file_type().is_symlink() {
            self.symlink_paths.push(path);
            return Ok(());
        }
        let kind = entry_kind(metadata)?;
        let hidden = relative
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with('.'));
        if kind == WorkspaceEntryKind::Directory
            && relative.file_name().is_some_and(|name| name == ".git")
        {
            self.nested_repository_paths.push(path.clone());
        }
        if kind == WorkspaceEntryKind::File && has_multiple_links(metadata) {
            self.multiple_link_paths.push(path.clone());
        }
        let (revision, byte_length) = if kind == WorkspaceEntryKind::File {
            let length = metadata.len();
            if self.total_bytes.saturating_add(length) > self.limits.max_total_bytes {
                self.truncated = true;
                return Ok(());
            }
            let revision = match self.file_revision {
                FileRevisionPolicy::Content => hash_file(absolute, length, metadata)?,
                FileRevisionPolicy::Identity => trash_file_revision(absolute, length, metadata)?,
            };
            self.total_bytes += length;
            (revision, length)
        } else {
            (directory_revision(metadata), 0)
        };
        let fingerprint_path =
            relative
                .strip_prefix(&self.source)
                .map_err(|_| WorkspaceError::InvalidMutation {
                    message: "workspace mutation inventory escaped its source".into(),
                })?;
        self.digest
            .update(workspace_path(fingerprint_path)?.as_bytes());
        self.digest.update([kind_tag(kind)]);
        self.digest.update(revision.as_bytes());
        self.entries.push(WorkspaceEntryInventoryItem {
            workspace_path: path,
            kind,
            revision,
            mode: mode(metadata),
            byte_length,
            hidden,
        });
        if kind == WorkspaceEntryKind::Directory
            && relative.file_name().is_some_and(|name| name == ".git")
        {
            return Ok(());
        }
        if kind == WorkspaceEntryKind::Directory {
            let mut children = fs::read_dir(absolute)
                .map_err(inventory_io)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(inventory_io)?;
            children.sort_by_key(|entry| entry.file_name());
            for child in children {
                if self.truncated && self.entries.len() >= self.limits.max_entries {
                    break;
                }
                let name = child.file_name();
                if name.to_str().is_none() {
                    return Err(WorkspaceError::UnsupportedFile {
                        message: "workspace mutations require UTF-8 entry names".into(),
                    });
                }
                let child_relative = relative.join(name);
                let child_path = child.path();
                let child_metadata = fs::symlink_metadata(&child_path).map_err(inventory_io)?;
                self.collect(&child_relative, &child_path, &child_metadata, depth + 1)?;
            }
        }
        Ok(())
    }

    fn finish(
        mut self,
        source_path: &str,
        source_kind: WorkspaceEntryKind,
        source_metadata: &Metadata,
    ) -> Result<WorkspaceEntryInventory, WorkspaceError> {
        self.symlink_paths.sort();
        self.nested_repository_paths.sort();
        self.multiple_link_paths.sort();
        let source_item = self
            .entries
            .first()
            .ok_or_else(|| WorkspaceError::InvalidMutation {
                message: "workspace mutation inventory has no source".into(),
            })?;
        let source_item_revision = source_item.revision.clone();
        let source_byte_length = source_item.byte_length;
        self.digest.update(self.total_bytes.to_le_bytes());
        self.digest
            .update((self.entries.len() as u64).to_le_bytes());
        self.digest.update([u8::from(self.truncated)]);
        let fingerprint = format!("{:x}", self.digest.finalize());
        let source = WorkspaceEntryIdentity {
            workspace_path: source_path.to_string(),
            kind: source_kind,
            revision: if source_kind == WorkspaceEntryKind::Directory {
                fingerprint.clone()
            } else {
                source_item_revision
            },
            mode: mode(source_metadata),
            byte_length: source_byte_length,
        };
        Ok(WorkspaceEntryInventory {
            source,
            entries: self.entries,
            total_bytes: self.total_bytes,
            symlink_paths: self.symlink_paths,
            nested_repository_paths: self.nested_repository_paths,
            multiple_link_paths: self.multiple_link_paths,
            truncated: self.truncated,
            fingerprint,
        })
    }
}

fn inventory_blockers(inventory: &WorkspaceEntryInventory) -> Vec<WorkspaceMutationBlocker> {
    let mut blockers = Vec::new();
    if inventory.truncated {
        blockers.push(WorkspaceMutationBlocker::InventoryTruncated);
    }
    if !inventory.symlink_paths.is_empty() {
        blockers.push(WorkspaceMutationBlocker::Symlink {
            paths: inventory.symlink_paths.clone(),
        });
    }
    if !inventory.nested_repository_paths.is_empty() {
        blockers.push(WorkspaceMutationBlocker::NestedRepository {
            paths: inventory.nested_repository_paths.clone(),
        });
    }
    if !inventory.multiple_link_paths.is_empty() {
        blockers.push(WorkspaceMutationBlocker::MultipleHardLinks {
            paths: inventory.multiple_link_paths.clone(),
        });
    }
    blockers
}

fn validate_limits(limits: WorkspaceMutationLimits) -> Result<(), WorkspaceError> {
    if limits.max_entries == 0
        || limits.max_total_bytes == 0
        || limits.max_depth == 0
        || limits.max_path_bytes == 0
    {
        return Err(WorkspaceError::InvalidMutation {
            message: "workspace mutation limits must be positive".into(),
        });
    }
    Ok(())
}

fn validate_plan_id(plan_id: &str) -> Result<(), WorkspaceError> {
    if plan_id.is_empty() || plan_id.len() > 128 || plan_id.chars().any(char::is_whitespace) {
        return Err(WorkspaceError::InvalidMutation {
            message: "workspace mutation plan IDs must contain 1 to 128 non-whitespace bytes"
                .into(),
        });
    }
    if plan_id.contains(['/', '\\', '\0', '\r', '\n']) {
        return Err(WorkspaceError::InvalidMutation {
            message: "workspace mutation plan IDs cannot contain path separators".into(),
        });
    }
    Ok(())
}

fn normalize_trash_sources(sources: &[String]) -> Result<Vec<String>, WorkspaceError> {
    let mut validated = Vec::with_capacity(sources.len());
    for source in sources {
        validate_relative_path(source)?;
        validated.push(source.clone());
    }
    validated.sort_by(|left, right| {
        Path::new(left)
            .components()
            .count()
            .cmp(&Path::new(right).components().count())
            .then_with(|| left.cmp(right))
    });
    let mut normalized: Vec<String> = Vec::with_capacity(validated.len());
    for source in validated {
        if normalized
            .iter()
            .any(|ancestor| Path::new(&source).starts_with(Path::new(ancestor)))
        {
            continue;
        }
        normalized.push(source);
    }
    Ok(normalized)
}

fn workspace_path(path: &Path) -> Result<String, WorkspaceError> {
    path.components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().map(str::to_string),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
        .map(|parts| parts.join("/"))
        .ok_or_else(|| WorkspaceError::UnsupportedFile {
            message: "workspace mutations require normalized UTF-8 paths".into(),
        })
}

fn entry_kind(metadata: &Metadata) -> Result<WorkspaceEntryKind, WorkspaceError> {
    if metadata.is_file() {
        Ok(WorkspaceEntryKind::File)
    } else if metadata.is_dir() {
        Ok(WorkspaceEntryKind::Directory)
    } else {
        Err(WorkspaceError::UnsupportedFile {
            message: "workspace mutations support regular files and real directories only".into(),
        })
    }
}

fn hash_file(
    path: &Path,
    expected_length: u64,
    expected_metadata: &Metadata,
) -> Result<String, WorkspaceError> {
    let mut file = open_file_without_links(path)?;
    let opened_metadata = file.metadata().map_err(inventory_io)?;
    if !opened_file_matches_path(path, expected_metadata, &file, &opened_metadata)
        .map_err(inventory_io)?
    {
        return Err(WorkspaceError::Conflict {
            current_revision: "identity-changed-during-inventory".into(),
        });
    }
    let mut digest = Sha256::new();
    digest.update(b"workspace-entry-file-v1\0");
    digest.update(expected_length.to_le_bytes());

    let mut buffer = [0_u8; 256 * 1024];
    let mut read = 0_u64;
    loop {
        let count = file.read(&mut buffer).map_err(inventory_io)?;
        if count == 0 {
            break;
        }
        read = read.saturating_add(count as u64);
        digest.update(&buffer[..count]);
    }
    if read != expected_length {
        return Err(WorkspaceError::Conflict {
            current_revision: "size-changed-during-inventory".into(),
        });
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn trash_file_revision(
    path: &Path,
    expected_length: u64,
    expected_metadata: &Metadata,
) -> Result<String, WorkspaceError> {
    let file = open_file_without_links(path)?;
    let opened_metadata = file.metadata().map_err(inventory_io)?;
    let Some(identity) =
        opened_file_identity_token(path, expected_metadata, &file, &opened_metadata)
            .map_err(inventory_io)?
    else {
        return hash_file(path, expected_length, expected_metadata);
    };
    if opened_metadata.len() != expected_length {
        return Err(WorkspaceError::Conflict {
            current_revision: "size-changed-during-inventory".into(),
        });
    }
    let mut digest = Sha256::new();
    digest.update(b"workspace-trash-file-identity-v1\0");
    digest.update(identity[0].to_le_bytes());
    digest.update(identity[1].to_le_bytes());
    digest.update(expected_length.to_le_bytes());
    digest.update(mode(&opened_metadata).to_le_bytes());
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        digest.update(opened_metadata.mtime().to_le_bytes());
        digest.update(opened_metadata.mtime_nsec().to_le_bytes());
        digest.update(opened_metadata.ctime().to_le_bytes());
        digest.update(opened_metadata.ctime_nsec().to_le_bytes());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        digest.update(opened_metadata.creation_time().to_le_bytes());
        digest.update(opened_metadata.last_write_time().to_le_bytes());
        digest.update(opened_metadata.file_attributes().to_le_bytes());
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(unix)]
fn open_file_without_links(path: &Path) -> Result<fs::File, WorkspaceError> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(inventory_io)
}

#[cfg(windows)]
fn open_file_without_links(path: &Path) -> Result<fs::File, WorkspaceError> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(inventory_io)
}

#[cfg(not(any(unix, windows)))]
fn open_file_without_links(path: &Path) -> Result<fs::File, WorkspaceError> {
    fs::File::open(path).map_err(inventory_io)
}

fn directory_revision(metadata: &Metadata) -> String {
    let mut digest = Sha256::new();
    digest.update(b"workspace-entry-directory-v1\0");
    digest.update(mode(metadata).to_le_bytes());
    format!("{:x}", digest.finalize())
}

fn kind_tag(kind: WorkspaceEntryKind) -> u8 {
    match kind {
        WorkspaceEntryKind::File => 1,
        WorkspaceEntryKind::Directory => 2,
    }
}

fn mode(metadata: &Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o777
    }
    #[cfg(not(unix))]
    {
        u32::from(metadata.permissions().readonly())
    }
}

#[cfg(unix)]
fn has_multiple_links(metadata: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    metadata.nlink() != 1
}

#[cfg(not(unix))]
fn has_multiple_links(_metadata: &Metadata) -> bool {
    false
}

#[cfg(unix)]
fn same_file(source: &Path, destination: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(source) = fs::symlink_metadata(source) else {
        return false;
    };
    let Ok(destination) = fs::symlink_metadata(destination) else {
        return false;
    };
    source.dev() == destination.dev() && source.ino() == destination.ino()
}

fn destination_exists(path: &Path) -> Result<bool, WorkspaceError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(inventory_io(error)),
    }
}

#[cfg(not(unix))]
fn same_file(source: &Path, destination: &Path) -> bool {
    fs::canonicalize(source).ok() == fs::canonicalize(destination).ok()
}

fn inventory_io(error: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        operation: "inventory workspace mutation".into(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_entry_resolution_checks_kind_and_never_traverses_links() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("folder/child")).unwrap();
        fs::write(directory.path().join("folder/file.txt"), b"file").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        assert_eq!(
            workspace
                .resolve_existing_entry("folder/file.txt", WorkspaceEntryKind::File)
                .unwrap(),
            workspace.root().join("folder/file.txt")
        );
        assert!(matches!(
            workspace.resolve_existing_entry("folder/file.txt", WorkspaceEntryKind::Directory),
            Err(WorkspaceError::Conflict { .. })
        ));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                directory.path().join("folder"),
                directory.path().join("linked"),
            )
            .unwrap();
            assert!(matches!(
                workspace.resolve_existing_entry("linked/file.txt", WorkspaceEntryKind::File),
                Err(WorkspaceError::OutsideWorkspace { .. })
            ));
        }
    }

    #[test]
    fn inventory_is_complete_deterministic_and_includes_hidden_entries() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("folder/nested")).unwrap();
        fs::write(directory.path().join("folder/b.txt"), b"bb").unwrap();
        fs::write(directory.path().join("folder/.hidden"), b"h").unwrap();
        fs::write(directory.path().join("folder/nested/a.txt"), b"a").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let first = workspace
            .inspect_entry("folder", WorkspaceMutationLimits::default())
            .unwrap();
        let second = workspace
            .inspect_entry("folder", WorkspaceMutationLimits::default())
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(first.total_bytes, 4);
        assert_eq!(first.entries.len(), 5);
        assert!(first.entries.iter().any(|entry| entry.hidden));
        assert!(!first.truncated);
        assert_eq!(first.fingerprint.len(), 64);
    }

    #[test]
    fn plans_reject_links_nested_repositories_hard_links_and_descendants() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("folder/.git")).unwrap();
        fs::create_dir(directory.path().join("folder/nested")).unwrap();
        fs::write(directory.path().join("folder/file"), b"content").unwrap();
        #[cfg(unix)]
        {
            fs::hard_link(
                directory.path().join("folder/file"),
                directory.path().join("folder/hard"),
            )
            .unwrap();
            std::os::unix::fs::symlink(
                directory.path().join("folder/file"),
                directory.path().join("folder/link"),
            )
            .unwrap();
        }
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_copy(
                "copy-1",
                "folder",
                "folder/nested/copy",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        assert!(plan.blockers.iter().any(|item| matches!(
            item,
            WorkspaceMutationBlocker::DestinationInsideSource { .. }
        )));

        fs::create_dir(directory.path().join("destination")).unwrap();
        let plan = workspace
            .plan_copy(
                "copy-2",
                "folder",
                "destination/folder",
                WorkspaceCollisionPolicy::Cancel,
                WorkspaceMutationLimits::default(),
            )
            .unwrap();
        assert!(!plan.executable());
        assert!(
            plan.blockers
                .iter()
                .any(|item| matches!(item, WorkspaceMutationBlocker::NestedRepository { .. }))
        );
        #[cfg(unix)]
        assert!(
            plan.blockers
                .iter()
                .any(|item| matches!(item, WorkspaceMutationBlocker::Symlink { .. }))
        );
        #[cfg(unix)]
        assert!(
            plan.blockers
                .iter()
                .any(|item| matches!(item, WorkspaceMutationBlocker::MultipleHardLinks { .. }))
        );
    }

    #[test]
    fn bounded_or_colliding_plans_never_authorize_execution() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("source")).unwrap();
        fs::write(directory.path().join("source/a"), b"a").unwrap();
        fs::write(directory.path().join("source/b"), b"b").unwrap();
        fs::write(directory.path().join("taken"), b"taken").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let limits = WorkspaceMutationLimits {
            max_entries: 1,
            ..WorkspaceMutationLimits::default()
        };
        let bounded = workspace.plan_trash("trash-1", "source", limits).unwrap();
        assert!(bounded.inventory.as_ref().unwrap().truncated);
        assert!(!bounded.executable());
        let collision = workspace
            .plan_create_file("create-1", "taken", WorkspaceCollisionPolicy::Cancel)
            .unwrap();
        assert!(!collision.executable());
    }

    #[test]
    fn normalized_paths_and_existing_real_parents_are_required() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        assert!(
            workspace
                .plan_create_file("create-1", "new.txt", WorkspaceCollisionPolicy::Cancel)
                .unwrap()
                .executable()
        );
        assert!(matches!(
            workspace.plan_create_file(
                "create-2",
                "missing/new.txt",
                WorkspaceCollisionPolicy::Cancel
            ),
            Err(WorkspaceError::Io { .. })
        ));
        assert!(matches!(
            workspace.plan_create_file("create-3", "../outside", WorkspaceCollisionPolicy::Cancel),
            Err(WorkspaceError::InvalidPath { .. })
        ));
    }

    #[test]
    fn trash_limits_allow_larger_reviewed_operations_than_copy_or_move() {
        let trash = WorkspaceMutationLimits::default_trash();
        let transfer = WorkspaceMutationLimits::default_transfer();
        assert!(trash.max_entries > transfer.max_entries);
        assert!(trash.max_total_bytes > transfer.max_total_bytes);
    }

    #[test]
    fn large_sparse_file_uses_trash_identity_inventory_without_a_transfer_limit() {
        let directory = tempfile::tempdir().unwrap();
        let file = fs::File::create(directory.path().join("large.bin")).unwrap();
        file.set_len(600 * 1024 * 1024).unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_trash(
                "trash-large",
                "large.bin",
                WorkspaceMutationLimits::default_trash(),
            )
            .unwrap();
        assert!(plan.executable());
        assert_eq!(plan.inventory.unwrap().total_bytes, 600 * 1024 * 1024);
    }

    #[test]
    fn multiple_trash_sources_plan_and_aggregate_inventories() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("dir1")).unwrap();
        fs::write(directory.path().join("dir1/a.txt"), "hello").unwrap();
        fs::create_dir_all(directory.path().join("dir2")).unwrap();
        fs::write(directory.path().join("dir2/b.txt"), "world!").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_trash_sources(
                "trash-multi",
                &["dir1".to_string(), "dir2".to_string()],
                WorkspaceMutationLimits::default_trash(),
            )
            .unwrap();
        assert!(plan.executable());
        assert_eq!(plan.inventories.len(), 2);
        let total_bytes: u64 = plan.inventories.iter().map(|i| i.total_bytes).sum();
        assert_eq!(total_bytes, 11);
    }

    #[test]
    fn multiple_trash_sources_prune_duplicates_and_descendants() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir_all(directory.path().join("parent/child")).unwrap();
        fs::write(directory.path().join("parent/child/file.txt"), "child").unwrap();
        fs::write(directory.path().join("other.txt"), "other").unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let plan = workspace
            .plan_trash_sources(
                "trash-normalized",
                &[
                    "parent/child/file.txt".to_string(),
                    "parent".to_string(),
                    "other.txt".to_string(),
                    "parent".to_string(),
                ],
                WorkspaceMutationLimits::default_trash(),
            )
            .unwrap();
        assert_eq!(
            plan.operation.trash_sources(),
            ["other.txt".to_string(), "parent".to_string()]
        );
        assert_eq!(plan.inventories.len(), 2);
        assert!(plan.inventory.is_none());
    }

    #[test]
    fn trash_identity_fingerprints_detect_same_size_external_edits() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large.bin");
        let mut bytes = vec![0_u8; 9 * 1024 * 1024];
        fs::write(&path, &bytes).unwrap();
        let workspace = Workspace::open(directory.path()).unwrap();
        let before = workspace
            .plan_trash(
                "trash-before",
                "large.bin",
                WorkspaceMutationLimits::default_trash(),
            )
            .unwrap()
            .inventory
            .unwrap();
        bytes[4 * 1024 * 1024] = 1;
        fs::write(&path, &bytes).unwrap();
        let after = workspace
            .plan_trash(
                "trash-after",
                "large.bin",
                WorkspaceMutationLimits::default_trash(),
            )
            .unwrap()
            .inventory
            .unwrap();
        assert_ne!(before.fingerprint, after.fingerprint);
    }
}
