use std::collections::HashSet;
use std::path::Path;

use asterlyn_git::ProjectFile;
use asterlyn_workspace::{
    ReplacementFilePreview, ReplacementLimits, SearchCancellationToken, SearchCandidate,
    SearchCoverageReason, SearchOptions, Workspace, WorkspaceError,
};

use super::search_session::{AuthorizedReplacementFile, StoredReplacementPlan};
use super::workspace_catalog::load_authorized_project_catalog;
use super::workspace_search::WORKSPACE_SEARCH_LIMITS;

const WORKSPACE_REPLACEMENT_LIMITS: ReplacementLimits = ReplacementLimits {
    max_files: 200,
    max_plan_bytes: 64 * 1024 * 1024,
    max_replacement_bytes: 16 * 1024,
    max_preview_utf16: 320,
};

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceReplacementPreview {
    pub(crate) plan_id: String,
    pub(crate) files: Vec<WorkspaceReplacementFilePreview>,
    pub(crate) total_matches: usize,
    pub(crate) skipped_count: usize,
    pub(crate) coverage_reasons: Vec<SearchCoverageReason>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceReplacementFilePreview {
    pub(crate) repository_id: String,
    pub(crate) path: String,
    pub(crate) workspace_path: String,
    pub(crate) match_count: usize,
    pub(crate) byte_delta: i64,
    pub(crate) before_preview: String,
    pub(crate) after_preview: String,
}

pub(crate) fn prepare_authorized_replacement(
    root: &Path,
    plan_id: &str,
    query: &str,
    replacement: &str,
    options: &SearchOptions,
    cancellation: &SearchCancellationToken,
) -> Result<(StoredReplacementPlan, WorkspaceReplacementPreview), WorkspaceError> {
    let catalog = load_authorized_project_catalog(root)?;
    if cancellation.is_cancelled() {
        return Err(WorkspaceError::Cancelled {
            message: "workspace replacement preview was cancelled".to_string(),
        });
    }
    let candidates: Vec<_> = catalog
        .files
        .iter()
        .map(|file| SearchCandidate {
            workspace_path: file.workspace_path.clone(),
        })
        .collect();
    let plan = Workspace::open(root)?.plan_text_replacement(
        plan_id,
        &candidates,
        catalog.truncated,
        query,
        replacement,
        options,
        cancellation,
        WORKSPACE_SEARCH_LIMITS,
        WORKSPACE_REPLACEMENT_LIMITS,
    )?;
    let mut authorized_files = Vec::new();
    let mut preview_files = Vec::new();
    for preview in &plan.preview().files {
        let file = catalog
            .files
            .iter()
            .find(|file| file.workspace_path == preview.workspace_path)
            .ok_or_else(|| WorkspaceError::NotAuthorized {
                message: "replacement preview returned an unauthorized file".to_string(),
            })?;
        authorized_files.push(AuthorizedReplacementFile {
            repository_id: file.repository_id.clone(),
            path: file.path.clone(),
            workspace_path: file.workspace_path.clone(),
        });
        preview_files.push(map_replacement_preview(file, preview));
    }
    let preview = WorkspaceReplacementPreview {
        plan_id: plan.plan_id().to_string(),
        files: preview_files,
        total_matches: plan.preview().total_matches,
        skipped_count: plan.preview().skipped_count,
        coverage_reasons: plan.preview().coverage_reasons.clone(),
    };
    Ok((
        StoredReplacementPlan {
            root: Workspace::open(root)?.root().to_path_buf(),
            plan,
            files: authorized_files,
        },
        preview,
    ))
}

fn map_replacement_preview(
    file: &ProjectFile,
    preview: &ReplacementFilePreview,
) -> WorkspaceReplacementFilePreview {
    WorkspaceReplacementFilePreview {
        repository_id: file.repository_id.clone(),
        path: file.path.clone(),
        workspace_path: file.workspace_path.clone(),
        match_count: preview.match_count,
        byte_delta: preview.byte_delta,
        before_preview: preview.before_preview.clone(),
        after_preview: preview.after_preview.clone(),
    }
}

pub(crate) fn authorize_replacement_selection(
    root: &Path,
    stored: &StoredReplacementPlan,
    selected_paths: &[String],
) -> Result<(), WorkspaceError> {
    let selected: HashSet<_> = selected_paths.iter().map(String::as_str).collect();
    if selected.is_empty() || selected.len() != selected_paths.len() {
        return Err(WorkspaceError::InvalidReplacement {
            message: "select one or more unique previewed files".to_string(),
        });
    }
    let current = load_authorized_project_catalog(root)?;
    for selected_path in selected {
        let planned = stored
            .files
            .iter()
            .find(|file| file.workspace_path == selected_path)
            .ok_or_else(|| WorkspaceError::InvalidReplacement {
                message: "replacement selection is outside the reviewed plan".to_string(),
            })?;
        if !current.files.iter().any(|file| {
            file.repository_id == planned.repository_id
                && file.path == planned.path
                && file.workspace_path == planned.workspace_path
        }) {
            return Err(WorkspaceError::NotAuthorized {
                message: format!(
                    "{} is no longer an authorized project file",
                    planned.workspace_path
                ),
            });
        }
    }
    Ok(())
}
