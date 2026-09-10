use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::search::replace_text_line_local;
use super::{
    SaveTextFileRequest, SearchCancellationToken, SearchCandidate, SearchCoverageReason,
    SearchLimits, SearchOptions, Workspace, WorkspaceError, decode_snapshot, encode_text,
    read_bounded, revision, sync_directory, validate_request_id,
};

const MANIFEST_VERSION: u8 = 1;
const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_LIMIT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplacementLimits {
    pub max_files: usize,
    pub max_plan_bytes: usize,
    pub max_replacement_bytes: usize,
    pub max_preview_utf16: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementFilePreview {
    pub workspace_path: String,
    pub match_count: usize,
    pub byte_delta: i64,
    pub before_preview: String,
    pub after_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReplacementPreview {
    pub plan_id: String,
    pub files: Vec<ReplacementFilePreview>,
    pub total_matches: usize,
    pub skipped_count: usize,
    pub coverage_reasons: Vec<SearchCoverageReason>,
}

#[derive(Debug, Clone)]
pub struct PreparedWorkspaceReplacement {
    plan_id: String,
    files: Vec<PreparedReplacementFile>,
    preview: WorkspaceReplacementPreview,
}

impl PreparedWorkspaceReplacement {
    pub fn plan_id(&self) -> &str {
        &self.plan_id
    }

    pub fn preview(&self) -> &WorkspaceReplacementPreview {
        &self.preview
    }

    pub fn workspace_paths(&self) -> impl Iterator<Item = &str> {
        self.files.iter().map(|file| file.workspace_path.as_str())
    }
}

#[derive(Debug, Clone)]
struct PreparedReplacementFile {
    workspace_path: String,
    expected_revision: String,
    original_bytes: Vec<u8>,
    replacement_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReplacementRecoveryStatus {
    Applied,
    RolledBack,
    NeedsRecovery,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReplacementFileState {
    Original,
    Replaced,
    Conflict,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementRecoveryFile {
    pub workspace_path: String,
    pub state: ReplacementFileState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementRecoverySummary {
    pub recovery_id: String,
    pub status: ReplacementRecoveryStatus,
    pub files: Vec<ReplacementRecoveryFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementApplyResult {
    pub recovery_id: String,
    pub status: ReplacementRecoveryStatus,
    pub files: Vec<ReplacementRecoveryFile>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryManifest {
    version: u8,
    recovery_id: String,
    workspace_root: String,
    status: ManifestStatus,
    files: Vec<RecoveryFile>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ManifestStatus {
    Prepared,
    Applying,
    Applied,
    NeedsRecovery,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryFile {
    workspace_path: String,
    original_blob: String,
    replacement_blob: String,
}

impl Workspace {
    #[allow(clippy::too_many_arguments)]
    pub fn plan_text_replacement(
        &self,
        plan_id: &str,
        candidates: &[SearchCandidate],
        catalog_truncated: bool,
        query: &str,
        replacement: &str,
        options: &SearchOptions,
        cancellation: &SearchCancellationToken,
        search_limits: SearchLimits,
        replacement_limits: ReplacementLimits,
    ) -> Result<PreparedWorkspaceReplacement, WorkspaceError> {
        validate_replacement_request(plan_id, replacement, replacement_limits)?;
        let report = self.search_text(
            plan_id,
            candidates,
            catalog_truncated,
            query,
            options,
            cancellation,
            search_limits,
        )?;
        if report.coverage_reasons.iter().any(|reason| {
            matches!(
                reason,
                SearchCoverageReason::CatalogTruncated
                    | SearchCoverageReason::CandidateLimit
                    | SearchCoverageReason::ByteLimit
                    | SearchCoverageReason::MatchLimit
            )
        }) {
            return Err(WorkspaceError::InvalidReplacement {
                message: "replacement preview requires complete candidate and match coverage"
                    .to_string(),
            });
        }

        let mut matches_by_path = HashMap::<String, (String, usize)>::new();
        for found in &report.matches {
            let entry = matches_by_path
                .entry(found.workspace_path.clone())
                .or_insert_with(|| (found.revision.clone(), 0));
            if entry.0 != found.revision {
                return Err(WorkspaceError::Conflict {
                    current_revision: found.revision.clone(),
                });
            }
            entry.1 += 1;
        }
        if matches_by_path.is_empty() {
            return Err(WorkspaceError::InvalidReplacement {
                message: "the current search has no replaceable matches".to_string(),
            });
        }
        if matches_by_path.len() > replacement_limits.max_files {
            return Err(WorkspaceError::InvalidReplacement {
                message: format!(
                    "replacement preview accepts at most {} files",
                    replacement_limits.max_files
                ),
            });
        }

        let mut prepared_files = Vec::with_capacity(matches_by_path.len());
        let mut previews = Vec::with_capacity(matches_by_path.len());
        let mut plan_bytes = 0usize;
        for candidate in candidates {
            let Some((searched_revision, expected_matches)) =
                matches_by_path.get(&candidate.workspace_path)
            else {
                continue;
            };
            check_cancelled(cancellation)?;
            let snapshot = self.read_text_file(&candidate.workspace_path)?;
            if snapshot.revision != *searched_revision {
                return Err(WorkspaceError::Conflict {
                    current_revision: snapshot.revision,
                });
            }
            let (replacement_content, actual_matches) = replace_text_line_local(
                &snapshot.content,
                query,
                replacement,
                options.mode,
                cancellation,
                search_limits,
            )?;
            if actual_matches != *expected_matches {
                return Err(WorkspaceError::Conflict {
                    current_revision: snapshot.revision,
                });
            }
            let original_bytes =
                encode_text(&snapshot.content, snapshot.utf8_bom, self.text_limit_bytes)?;
            let replacement_bytes = encode_text(
                &replacement_content,
                snapshot.utf8_bom,
                self.text_limit_bytes,
            )?;
            if original_bytes == replacement_bytes {
                continue;
            }
            plan_bytes = plan_bytes
                .checked_add(original_bytes.len())
                .and_then(|total| total.checked_add(replacement_bytes.len()))
                .ok_or_else(|| WorkspaceError::InvalidReplacement {
                    message: "replacement preview is too large".to_string(),
                })?;
            if plan_bytes > replacement_limits.max_plan_bytes {
                return Err(WorkspaceError::InvalidReplacement {
                    message: format!(
                        "replacement preview exceeds the {}-byte memory limit",
                        replacement_limits.max_plan_bytes
                    ),
                });
            }
            let (before_preview, after_preview) = change_preview(
                &snapshot.content,
                &replacement_content,
                replacement_limits.max_preview_utf16,
            );
            previews.push(ReplacementFilePreview {
                workspace_path: candidate.workspace_path.clone(),
                match_count: actual_matches,
                byte_delta: replacement_bytes.len() as i64 - original_bytes.len() as i64,
                before_preview,
                after_preview,
            });
            prepared_files.push(PreparedReplacementFile {
                workspace_path: candidate.workspace_path.clone(),
                expected_revision: snapshot.revision,
                original_bytes,
                replacement_bytes,
            });
        }
        if prepared_files.is_empty() {
            return Err(WorkspaceError::InvalidReplacement {
                message: "the replacement would not change any file".to_string(),
            });
        }

        let total_matches = previews.iter().map(|file| file.match_count).sum();
        Ok(PreparedWorkspaceReplacement {
            plan_id: plan_id.to_string(),
            files: prepared_files,
            preview: WorkspaceReplacementPreview {
                plan_id: plan_id.to_string(),
                files: previews,
                total_matches,
                skipped_count: report.skipped_count,
                coverage_reasons: report.coverage_reasons,
            },
        })
    }

    pub fn apply_replacement_plan(
        &self,
        recovery_root: &Path,
        plan: &PreparedWorkspaceReplacement,
        selected_paths: &[String],
        cancellation: &SearchCancellationToken,
    ) -> Result<ReplacementApplyResult, WorkspaceError> {
        self.apply_replacement_plan_with_hook(
            recovery_root,
            plan,
            selected_paths,
            cancellation,
            |_| Ok(()),
        )
    }

    fn apply_replacement_plan_with_hook<F>(
        &self,
        recovery_root: &Path,
        plan: &PreparedWorkspaceReplacement,
        selected_paths: &[String],
        cancellation: &SearchCancellationToken,
        mut before_file: F,
    ) -> Result<ReplacementApplyResult, WorkspaceError>
    where
        F: FnMut(usize) -> Result<(), WorkspaceError>,
    {
        let files = selected_plan_files(plan, selected_paths)?;
        check_cancelled(cancellation)?;
        for file in &files {
            let snapshot = self.read_text_file(&file.workspace_path)?;
            let current_bytes =
                encode_text(&snapshot.content, snapshot.utf8_bom, self.text_limit_bytes)?;
            if snapshot.revision != file.expected_revision || current_bytes != file.original_bytes {
                return Err(WorkspaceError::Conflict {
                    current_revision: snapshot.revision,
                });
            }
        }

        let store = RecoveryStore::open(recovery_root)?;
        let mut manifest = store.create(self.root(), plan.plan_id(), &files)?;
        manifest.status = ManifestStatus::Applying;
        store.write_manifest(&manifest)?;

        let mut operation_error = None;
        for (index, file) in files.iter().enumerate() {
            if let Err(error) = check_cancelled(cancellation).and_then(|_| before_file(index)) {
                operation_error = Some(error.to_string());
                break;
            }
            let replacement = decode_snapshot(
                &file.workspace_path,
                file.replacement_bytes.clone(),
                &self.resolve_regular_file(&file.workspace_path)?.1,
            )?;
            let request = SaveTextFileRequest {
                workspace_path: file.workspace_path.clone(),
                expected_revision: file.expected_revision.clone(),
                content: replacement.content,
                utf8_bom: replacement.utf8_bom,
                request_id: format!("{}-{index}", plan.plan_id()),
            };
            if let Err(error) = self.save_text_file(&request) {
                operation_error = Some(error.to_string());
                break;
            }
        }

        if let Some(message) = operation_error {
            manifest.status = ManifestStatus::NeedsRecovery;
            store.write_manifest(&manifest)?;
            let mut result = self.rollback_replacement_internal(&store, &manifest)?;
            result.message = Some(message);
            return Ok(result);
        }

        manifest.status = ManifestStatus::Applied;
        store.write_manifest(&manifest)?;
        let summary = self.inspect_recovery(&store, &manifest)?;
        Ok(ReplacementApplyResult {
            recovery_id: summary.recovery_id,
            status: summary.status,
            files: summary.files,
            message: None,
        })
    }

    pub fn list_replacement_recoveries(
        &self,
        recovery_root: &Path,
    ) -> Result<Vec<ReplacementRecoverySummary>, WorkspaceError> {
        let store = RecoveryStore::open(recovery_root)?;
        let mut recoveries = Vec::new();
        for manifest in store.manifests()? {
            if manifest.workspace_root == workspace_root_text(self.root()) {
                recoveries.push(self.inspect_recovery(&store, &manifest)?);
            }
        }
        recoveries.sort_by(|left, right| left.recovery_id.cmp(&right.recovery_id));
        Ok(recoveries)
    }

    pub fn rollback_replacement(
        &self,
        recovery_root: &Path,
        recovery_id: &str,
    ) -> Result<ReplacementApplyResult, WorkspaceError> {
        let store = RecoveryStore::open(recovery_root)?;
        let manifest = store.read_manifest(recovery_id)?;
        ensure_workspace_manifest(self.root(), &manifest)?;
        self.rollback_replacement_internal(&store, &manifest)
    }

    pub fn finalize_replacement(
        &self,
        recovery_root: &Path,
        recovery_id: &str,
    ) -> Result<(), WorkspaceError> {
        let store = RecoveryStore::open(recovery_root)?;
        let manifest = store.read_manifest(recovery_id)?;
        ensure_workspace_manifest(self.root(), &manifest)?;
        let summary = self.inspect_recovery(&store, &manifest)?;
        if summary
            .files
            .iter()
            .any(|file| file.state != ReplacementFileState::Replaced)
        {
            return Err(WorkspaceError::InvalidReplacement {
                message: "recovery can be finalized only while every file still contains the reviewed replacement"
                    .to_string(),
            });
        }
        store.remove(recovery_id)
    }

    fn rollback_replacement_internal(
        &self,
        store: &RecoveryStore,
        manifest: &RecoveryManifest,
    ) -> Result<ReplacementApplyResult, WorkspaceError> {
        ensure_workspace_manifest(self.root(), manifest)?;
        for (index, file) in manifest.files.iter().enumerate() {
            let original = store.read_blob(
                &manifest.recovery_id,
                &file.original_blob,
                self.text_limit_bytes,
            )?;
            let replacement = store.read_blob(
                &manifest.recovery_id,
                &file.replacement_blob,
                self.text_limit_bytes,
            )?;
            let Ok((_, metadata)) = self.resolve_regular_file(&file.workspace_path) else {
                continue;
            };
            let path = self.root().join(&file.workspace_path);
            let Ok(current) = read_bounded(&path, self.text_limit_bytes) else {
                continue;
            };
            if current == original {
                continue;
            }
            if current != replacement {
                continue;
            }
            let original_snapshot = decode_snapshot(&file.workspace_path, original, &metadata)?;
            let request = SaveTextFileRequest {
                workspace_path: file.workspace_path.clone(),
                expected_revision: revision(&current, &metadata),
                content: original_snapshot.content,
                utf8_bom: original_snapshot.utf8_bom,
                request_id: format!("{}-rollback-{index}", manifest.recovery_id),
            };
            let _ = self.save_text_file(&request);
        }

        let mut current_manifest = manifest.clone();
        current_manifest.status = ManifestStatus::NeedsRecovery;
        store.write_manifest(&current_manifest)?;
        let summary = self.inspect_recovery(store, &current_manifest)?;
        let completely_restored = summary
            .files
            .iter()
            .all(|file| file.state == ReplacementFileState::Original);
        if completely_restored {
            store.remove(&manifest.recovery_id)?;
            return Ok(ReplacementApplyResult {
                recovery_id: manifest.recovery_id.clone(),
                status: ReplacementRecoveryStatus::RolledBack,
                files: summary.files,
                message: None,
            });
        }
        Ok(ReplacementApplyResult {
            recovery_id: manifest.recovery_id.clone(),
            status: ReplacementRecoveryStatus::NeedsRecovery,
            files: summary.files,
            message: None,
        })
    }

    fn inspect_recovery(
        &self,
        store: &RecoveryStore,
        manifest: &RecoveryManifest,
    ) -> Result<ReplacementRecoverySummary, WorkspaceError> {
        ensure_workspace_manifest(self.root(), manifest)?;
        let mut files = Vec::with_capacity(manifest.files.len());
        for file in &manifest.files {
            let original = store.read_blob(
                &manifest.recovery_id,
                &file.original_blob,
                self.text_limit_bytes,
            )?;
            let replacement = store.read_blob(
                &manifest.recovery_id,
                &file.replacement_blob,
                self.text_limit_bytes,
            )?;
            let state = self
                .resolve_regular_file(&file.workspace_path)
                .ok()
                .and_then(|(path, _)| read_bounded(&path, self.text_limit_bytes).ok())
                .map_or(ReplacementFileState::Unavailable, |current| {
                    if current == original {
                        ReplacementFileState::Original
                    } else if current == replacement {
                        ReplacementFileState::Replaced
                    } else {
                        ReplacementFileState::Conflict
                    }
                });
            files.push(ReplacementRecoveryFile {
                workspace_path: file.workspace_path.clone(),
                state,
            });
        }
        let status = if files
            .iter()
            .all(|file| file.state == ReplacementFileState::Replaced)
        {
            ReplacementRecoveryStatus::Applied
        } else {
            ReplacementRecoveryStatus::NeedsRecovery
        };
        Ok(ReplacementRecoverySummary {
            recovery_id: manifest.recovery_id.clone(),
            status,
            files,
        })
    }
}

fn validate_replacement_request(
    plan_id: &str,
    replacement: &str,
    limits: ReplacementLimits,
) -> Result<(), WorkspaceError> {
    validate_request_id(plan_id)?;
    if limits.max_files == 0
        || limits.max_plan_bytes == 0
        || limits.max_replacement_bytes == 0
        || limits.max_preview_utf16 == 0
    {
        return Err(WorkspaceError::InvalidReplacement {
            message: "replacement limits must be positive".to_string(),
        });
    }
    if replacement.as_bytes().contains(&0) || replacement.len() > limits.max_replacement_bytes {
        return Err(WorkspaceError::InvalidReplacement {
            message: format!(
                "replacement text must contain no NUL and be at most {} UTF-8 bytes",
                limits.max_replacement_bytes
            ),
        });
    }
    Ok(())
}

fn selected_plan_files<'plan>(
    plan: &'plan PreparedWorkspaceReplacement,
    selected_paths: &[String],
) -> Result<Vec<&'plan PreparedReplacementFile>, WorkspaceError> {
    if selected_paths.is_empty() {
        return Err(WorkspaceError::InvalidReplacement {
            message: "select at least one previewed file".to_string(),
        });
    }
    let selected: HashSet<_> = selected_paths.iter().map(String::as_str).collect();
    if selected.len() != selected_paths.len() {
        return Err(WorkspaceError::InvalidReplacement {
            message: "replacement file selections must be unique".to_string(),
        });
    }
    let files: Vec<_> = plan
        .files
        .iter()
        .filter(|file| selected.contains(file.workspace_path.as_str()))
        .collect();
    if files.len() != selected.len() {
        return Err(WorkspaceError::InvalidReplacement {
            message: "replacement selection contains a file outside the reviewed plan".to_string(),
        });
    }
    Ok(files)
}

fn change_preview(before: &str, after: &str, max_utf16: usize) -> (String, String) {
    let common_chars = before
        .chars()
        .zip(after.chars())
        .take_while(|(left, right)| left == right)
        .count();
    let before_byte = before
        .char_indices()
        .nth(common_chars)
        .map_or(before.len(), |(index, _)| index);
    let after_byte = after
        .char_indices()
        .nth(common_chars)
        .map_or(after.len(), |(index, _)| index);
    (
        preview_line(before, before_byte, max_utf16),
        preview_line(after, after_byte, max_utf16),
    )
}

fn preview_line(content: &str, offset: usize, max_utf16: usize) -> String {
    let start = content[..offset]
        .rfind(['\r', '\n'])
        .map_or(0, |index| index + 1);
    let end = content[offset..]
        .find(['\r', '\n'])
        .map_or(content.len(), |index| offset + index);
    let line = &content[start..end];
    let mut utf16 = 0;
    let mut byte_end = 0;
    for character in line.chars() {
        let width = character.len_utf16();
        if utf16 + width > max_utf16 {
            break;
        }
        utf16 += width;
        byte_end += character.len_utf8();
    }
    let mut preview = line[..byte_end].to_string();
    if byte_end < line.len() {
        preview.push('…');
    }
    preview
}

fn check_cancelled(cancellation: &SearchCancellationToken) -> Result<(), WorkspaceError> {
    if cancellation.is_cancelled() {
        Err(WorkspaceError::Cancelled {
            message: "workspace replacement was cancelled".to_string(),
        })
    } else {
        Ok(())
    }
}

struct RecoveryStore {
    root: PathBuf,
}

impl RecoveryStore {
    fn open(root: &Path) -> Result<Self, WorkspaceError> {
        fs::create_dir_all(root).map_err(|error| recovery_io("create recovery store", error))?;
        let root =
            fs::canonicalize(root).map_err(|error| recovery_io("resolve recovery store", error))?;
        if !root.is_dir() {
            return Err(WorkspaceError::InvalidReplacement {
                message: "replacement recovery location is not a directory".to_string(),
            });
        }
        Ok(Self { root })
    }

    fn create(
        &self,
        workspace_root: &Path,
        recovery_id: &str,
        files: &[&PreparedReplacementFile],
    ) -> Result<RecoveryManifest, WorkspaceError> {
        validate_request_id(recovery_id)?;
        let final_directory = self.root.join(recovery_id);
        if final_directory.exists() {
            return Err(WorkspaceError::Busy {
                message: "a replacement recovery with this ID already exists".to_string(),
            });
        }
        let directory = self.root.join(format!(".{recovery_id}.preparing"));
        fs::create_dir(&directory).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                WorkspaceError::Busy {
                    message: "a replacement recovery is still being prepared".to_string(),
                }
            } else {
                recovery_io("create replacement recovery", error)
            }
        })?;
        sync_directory(&self.root)?;

        let prepared = (|| {
            let mut recovery_files = Vec::with_capacity(files.len());
            for (index, file) in files.iter().enumerate() {
                let original_blob = format!("original-{index:04}.bin");
                let replacement_blob = format!("replacement-{index:04}.bin");
                write_new_durable(&directory.join(&original_blob), &file.original_bytes)?;
                write_new_durable(&directory.join(&replacement_blob), &file.replacement_bytes)?;
                recovery_files.push(RecoveryFile {
                    workspace_path: file.workspace_path.clone(),
                    original_blob,
                    replacement_blob,
                });
            }
            let manifest = RecoveryManifest {
                version: MANIFEST_VERSION,
                recovery_id: recovery_id.to_string(),
                workspace_root: workspace_root_text(workspace_root),
                status: ManifestStatus::Prepared,
                files: recovery_files,
            };
            write_manifest_at(&directory, &manifest)?;
            fs::rename(&directory, &final_directory)
                .map_err(|error| recovery_io("publish replacement recovery", error))?;
            sync_directory(&self.root)?;
            Ok(manifest)
        })();
        if prepared.is_err() {
            let _ = fs::remove_dir_all(&directory);
            let _ = sync_directory(&self.root);
        }
        prepared
    }

    fn manifests(&self) -> Result<Vec<RecoveryManifest>, WorkspaceError> {
        let mut manifests = Vec::new();
        for entry in fs::read_dir(&self.root)
            .map_err(|error| recovery_io("list replacement recoveries", error))?
        {
            let entry = entry.map_err(|error| recovery_io("list replacement recoveries", error))?;
            let metadata = entry
                .file_type()
                .map_err(|error| recovery_io("inspect replacement recovery", error))?;
            if metadata.is_dir() {
                let id = entry.file_name().to_string_lossy().to_string();
                if id.starts_with('.') {
                    continue;
                }
                manifests.push(self.read_manifest(&id)?);
            }
        }
        Ok(manifests)
    }

    fn read_manifest(&self, recovery_id: &str) -> Result<RecoveryManifest, WorkspaceError> {
        validate_request_id(recovery_id)?;
        let directory = self.checked_directory(recovery_id)?;
        let bytes = read_limited_file(&directory.join(MANIFEST_FILE), MANIFEST_LIMIT_BYTES)?;
        let manifest: RecoveryManifest =
            serde_json::from_slice(&bytes).map_err(|error| WorkspaceError::InvalidReplacement {
                message: format!("replacement recovery manifest is invalid: {error}"),
            })?;
        if manifest.version != MANIFEST_VERSION || manifest.recovery_id != recovery_id {
            return Err(WorkspaceError::InvalidReplacement {
                message: "replacement recovery manifest identity is invalid".to_string(),
            });
        }
        for file in &manifest.files {
            super::validate_relative_path(&file.workspace_path)?;
            validate_blob_name(&file.original_blob)?;
            validate_blob_name(&file.replacement_blob)?;
        }
        Ok(manifest)
    }

    fn write_manifest(&self, manifest: &RecoveryManifest) -> Result<(), WorkspaceError> {
        let directory = self.checked_or_new_directory(&manifest.recovery_id)?;
        write_manifest_at(&directory, manifest)
    }

    fn read_blob(
        &self,
        recovery_id: &str,
        name: &str,
        limit: usize,
    ) -> Result<Vec<u8>, WorkspaceError> {
        validate_blob_name(name)?;
        let directory = self.checked_directory(recovery_id)?;
        read_limited_file(&directory.join(name), limit)
    }

    fn remove(&self, recovery_id: &str) -> Result<(), WorkspaceError> {
        let directory = self.checked_directory(recovery_id)?;
        fs::remove_dir_all(&directory)
            .map_err(|error| recovery_io("remove finalized replacement recovery", error))?;
        sync_directory(&self.root)
    }

    fn checked_directory(&self, recovery_id: &str) -> Result<PathBuf, WorkspaceError> {
        validate_request_id(recovery_id)?;
        let directory = self.root.join(recovery_id);
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|error| recovery_io("inspect replacement recovery", error))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(WorkspaceError::InvalidReplacement {
                message: "replacement recovery path is unsafe".to_string(),
            });
        }
        Ok(directory)
    }

    fn checked_or_new_directory(&self, recovery_id: &str) -> Result<PathBuf, WorkspaceError> {
        self.checked_directory(recovery_id)
    }
}

fn write_manifest_at(directory: &Path, manifest: &RecoveryManifest) -> Result<(), WorkspaceError> {
    let bytes = serde_json::to_vec(manifest).map_err(|error| WorkspaceError::Io {
        operation: "serialize replacement recovery".to_string(),
        message: error.to_string(),
    })?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)
        .map_err(|error| recovery_io("create recovery manifest temporary file", error))?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.flush())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| recovery_io("write replacement recovery manifest", error))?;
    temporary
        .persist(directory.join(MANIFEST_FILE))
        .map_err(|error| recovery_io("replace replacement recovery manifest", error.error))?;
    sync_directory(directory)
}

fn ensure_workspace_manifest(
    workspace_root: &Path,
    manifest: &RecoveryManifest,
) -> Result<(), WorkspaceError> {
    if manifest.workspace_root != workspace_root_text(workspace_root) {
        return Err(WorkspaceError::NotAuthorized {
            message: "replacement recovery belongs to another workspace".to_string(),
        });
    }
    Ok(())
}

fn workspace_root_text(root: &Path) -> String {
    root.to_string_lossy().to_string()
}

fn validate_blob_name(name: &str) -> Result<(), WorkspaceError> {
    if name.is_empty()
        || Path::new(name).components().count() != 1
        || name.contains(['\0', '\r', '\n', '/', '\\'])
    {
        return Err(WorkspaceError::InvalidReplacement {
            message: "replacement recovery blob name is invalid".to_string(),
        });
    }
    Ok(())
}

fn write_new_durable(path: &Path, bytes: &[u8]) -> Result<(), WorkspaceError> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| recovery_io("create replacement recovery blob", error))?;
    file.write_all(bytes)
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all())
        .map_err(|error| recovery_io("write replacement recovery blob", error))
}

fn read_limited_file(path: &Path, limit: usize) -> Result<Vec<u8>, WorkspaceError> {
    let file = File::open(path).map_err(|error| recovery_io("open replacement recovery", error))?;
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    file.take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| recovery_io("read replacement recovery", error))?;
    if bytes.len() > limit {
        return Err(WorkspaceError::InvalidReplacement {
            message: "replacement recovery exceeds its size limit".to_string(),
        });
    }
    Ok(bytes)
}

fn recovery_io(operation: &str, error: std::io::Error) -> WorkspaceError {
    WorkspaceError::Io {
        operation: operation.to_string(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const SEARCH_LIMITS: SearchLimits = SearchLimits {
        max_candidates: 100,
        max_total_bytes: 1024 * 1024,
        max_matches: 500,
        max_preview_utf16: 320,
        max_reported_skips: 20,
        max_query_bytes: 4096,
        max_path_patterns_per_kind: 32,
        max_path_pattern_bytes: 256,
        max_context_lines: 3,
        max_regex_size_bytes: 2 * 1024 * 1024,
        max_regex_dfa_size_bytes: 2 * 1024 * 1024,
    };
    const REPLACEMENT_LIMITS: ReplacementLimits = ReplacementLimits {
        max_files: 20,
        max_plan_bytes: 2 * 1024 * 1024,
        max_replacement_bytes: 16 * 1024,
        max_preview_utf16: 320,
    };

    fn fixture() -> (tempfile::TempDir, tempfile::TempDir, Workspace) {
        let directory = tempfile::tempdir().expect("workspace directory");
        fs::write(
            directory.path().join("one.txt"),
            b"needle\r\nkeep\nneedle\r",
        )
        .expect("first fixture");
        fs::write(directory.path().join("two.txt"), b"needle two\n").expect("second fixture");
        let recovery = tempfile::tempdir().expect("recovery directory");
        let workspace = Workspace::open(directory.path()).expect("workspace opens");
        (directory, recovery, workspace)
    }

    fn plan(
        workspace: &Workspace,
        id: &str,
        mode: super::super::SearchMode,
    ) -> PreparedWorkspaceReplacement {
        workspace
            .plan_text_replacement(
                id,
                &[
                    SearchCandidate {
                        workspace_path: "one.txt".to_string(),
                    },
                    SearchCandidate {
                        workspace_path: "two.txt".to_string(),
                    },
                ],
                false,
                if mode == super::super::SearchMode::Regex {
                    "(needle)"
                } else {
                    "needle"
                },
                if mode == super::super::SearchMode::Regex {
                    "$1-ok"
                } else {
                    "found"
                },
                &SearchOptions {
                    mode,
                    ..SearchOptions::default()
                },
                &SearchCancellationToken::new(),
                SEARCH_LIMITS,
                REPLACEMENT_LIMITS,
            )
            .expect("replacement plans")
    }

    #[test]
    fn previews_and_rolls_back_selected_files_with_exact_line_endings() {
        let (directory, recovery, workspace) = fixture();
        let planned = plan(&workspace, "replace-one", super::super::SearchMode::Literal);
        assert_eq!(planned.preview.total_matches, 3);
        assert_eq!(planned.preview.files.len(), 2);

        let result = workspace
            .apply_replacement_plan(
                recovery.path(),
                &planned,
                &["one.txt".to_string()],
                &SearchCancellationToken::new(),
            )
            .expect("replacement applies");
        assert_eq!(result.status, ReplacementRecoveryStatus::Applied);
        assert_eq!(
            fs::read(directory.path().join("one.txt")).unwrap(),
            b"found\r\nkeep\nfound\r"
        );
        assert_eq!(
            workspace
                .list_replacement_recoveries(recovery.path())
                .unwrap()
                .len(),
            1
        );

        let rolled_back = workspace
            .rollback_replacement(recovery.path(), "replace-one")
            .expect("replacement rolls back");
        assert_eq!(rolled_back.status, ReplacementRecoveryStatus::RolledBack);
        assert_eq!(
            fs::read(directory.path().join("one.txt")).unwrap(),
            b"needle\r\nkeep\nneedle\r"
        );
        assert!(
            workspace
                .list_replacement_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn finalizes_only_an_intact_applied_replacement() {
        let (directory, recovery, workspace) = fixture();
        let planned = plan(&workspace, "replace-final", super::super::SearchMode::Regex);
        workspace
            .apply_replacement_plan(
                recovery.path(),
                &planned,
                &["two.txt".to_string()],
                &SearchCancellationToken::new(),
            )
            .expect("replacement applies");
        assert_eq!(
            fs::read_to_string(directory.path().join("two.txt")).unwrap(),
            "needle-ok two\n"
        );
        workspace
            .finalize_replacement(recovery.path(), "replace-final")
            .expect("replacement finalizes");
        assert!(
            workspace
                .list_replacement_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn conflict_before_journaling_changes_nothing() {
        let (directory, recovery, workspace) = fixture();
        let planned = plan(
            &workspace,
            "replace-conflict",
            super::super::SearchMode::Literal,
        );
        fs::write(directory.path().join("one.txt"), "external\n").expect("external change");
        let error = workspace
            .apply_replacement_plan(
                recovery.path(),
                &planned,
                &["one.txt".to_string()],
                &SearchCancellationToken::new(),
            )
            .expect_err("stale plan conflicts");
        assert!(matches!(error, WorkspaceError::Conflict { .. }));
        assert_eq!(
            fs::read_to_string(directory.path().join("one.txt")).unwrap(),
            "external\n"
        );
        assert!(
            workspace
                .list_replacement_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn partial_failure_automatically_restores_already_written_files() {
        let (directory, recovery, workspace) = fixture();
        let planned = plan(
            &workspace,
            "replace-failure",
            super::super::SearchMode::Literal,
        );
        let calls = AtomicUsize::new(0);
        let result = workspace
            .apply_replacement_plan_with_hook(
                recovery.path(),
                &planned,
                &["one.txt".to_string(), "two.txt".to_string()],
                &SearchCancellationToken::new(),
                |_| {
                    if calls.fetch_add(1, Ordering::SeqCst) == 1 {
                        Err(WorkspaceError::Io {
                            operation: "test interruption".to_string(),
                            message: "stop".to_string(),
                        })
                    } else {
                        Ok(())
                    }
                },
            )
            .expect("failure reports recovery outcome");
        assert_eq!(result.status, ReplacementRecoveryStatus::RolledBack);
        assert_eq!(
            fs::read(directory.path().join("one.txt")).unwrap(),
            b"needle\r\nkeep\nneedle\r"
        );
        assert_eq!(
            fs::read(directory.path().join("two.txt")).unwrap(),
            b"needle two\n"
        );
        assert!(
            workspace
                .list_replacement_recoveries(recovery.path())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rollback_preserves_an_external_change_and_keeps_recovery() {
        let (directory, recovery, workspace) = fixture();
        let planned = plan(
            &workspace,
            "replace-recovery",
            super::super::SearchMode::Literal,
        );
        workspace
            .apply_replacement_plan(
                recovery.path(),
                &planned,
                &["one.txt".to_string()],
                &SearchCancellationToken::new(),
            )
            .expect("replacement applies");
        fs::write(
            directory.path().join("one.txt"),
            "external after replacement\n",
        )
        .expect("external change");
        let result = workspace
            .rollback_replacement(recovery.path(), "replace-recovery")
            .expect("rollback reports conflict");
        assert_eq!(result.status, ReplacementRecoveryStatus::NeedsRecovery);
        assert_eq!(result.files[0].state, ReplacementFileState::Conflict);
        assert_eq!(
            fs::read_to_string(directory.path().join("one.txt")).unwrap(),
            "external after replacement\n"
        );
        assert_eq!(
            workspace
                .list_replacement_recoveries(recovery.path())
                .unwrap()
                .len(),
            1
        );
    }
}
