use std::path::Path;

use asterlyn_workspace::{
    SearchCancellationToken, SearchCandidate, SearchCoverageReason, SearchLimits, SearchOptions,
    SearchSkipReason, Workspace, WorkspaceError,
};

use super::workspace_catalog::load_authorized_project_catalog;

const WORKSPACE_SEARCH_CANDIDATE_LIMIT: usize = 5_000;

pub(crate) const WORKSPACE_SEARCH_LIMITS: SearchLimits = SearchLimits {
    max_candidates: WORKSPACE_SEARCH_CANDIDATE_LIMIT,
    max_total_bytes: 64 * 1024 * 1024,
    max_matches: 500,
    max_preview_utf16: 320,
    max_reported_skips: 100,
    max_query_bytes: 4_096,
    max_path_patterns_per_kind: 32,
    max_path_pattern_bytes: 256,
    max_context_lines: 3,
    max_regex_size_bytes: 2 * 1024 * 1024,
    max_regex_dfa_size_bytes: 2 * 1024 * 1024,
};

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceTextSearchReport {
    pub(crate) request_id: String,
    pub(crate) matches: Vec<WorkspaceTextSearchMatch>,
    pub(crate) catalog_candidates: usize,
    pub(crate) eligible_candidates: usize,
    pub(crate) files_searched: usize,
    pub(crate) bytes_read: usize,
    pub(crate) skipped_count: usize,
    pub(crate) skipped_files: Vec<WorkspaceTextSearchSkippedFile>,
    pub(crate) coverage_reasons: Vec<SearchCoverageReason>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceTextSearchMatch {
    pub(crate) repository_id: String,
    pub(crate) path: String,
    pub(crate) workspace_path: String,
    pub(crate) revision: String,
    pub(crate) from_utf16: usize,
    pub(crate) to_utf16: usize,
    pub(crate) line: usize,
    pub(crate) column_utf16: usize,
    pub(crate) preview: String,
    pub(crate) preview_from_utf16: usize,
    pub(crate) preview_to_utf16: usize,
    pub(crate) leading_clipped: bool,
    pub(crate) trailing_clipped: bool,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceTextSearchSkippedFile {
    pub(crate) repository_id: String,
    pub(crate) path: String,
    pub(crate) workspace_path: String,
    pub(crate) reason: SearchSkipReason,
}

pub(crate) fn search_authorized_workspace(
    root: &Path,
    request_id: &str,
    query: &str,
    options: &SearchOptions,
    cancellation: &SearchCancellationToken,
) -> Result<WorkspaceTextSearchReport, WorkspaceError> {
    let catalog = load_authorized_project_catalog(root)?;
    if cancellation.is_cancelled() {
        return Err(WorkspaceError::Cancelled {
            message: "workspace search was cancelled".to_string(),
        });
    }
    let candidates: Vec<_> = catalog
        .files
        .iter()
        .map(|file| SearchCandidate {
            workspace_path: file.workspace_path.clone(),
        })
        .collect();
    let report = Workspace::open(root)?.search_text(
        request_id,
        &candidates,
        catalog.truncated,
        query,
        options,
        cancellation,
        WORKSPACE_SEARCH_LIMITS,
    )?;

    let matches = report
        .matches
        .into_iter()
        .map(|found| {
            let file =
                catalog
                    .files
                    .get(found.candidate_index)
                    .ok_or_else(|| WorkspaceError::Io {
                        operation: "map workspace search result".to_string(),
                        message: "search returned an unknown catalog candidate".to_string(),
                    })?;
            Ok(WorkspaceTextSearchMatch {
                repository_id: file.repository_id.clone(),
                path: file.path.clone(),
                workspace_path: found.workspace_path,
                revision: found.revision,
                from_utf16: found.from_utf16,
                to_utf16: found.to_utf16,
                line: found.line,
                column_utf16: found.column_utf16,
                preview: found.preview,
                preview_from_utf16: found.preview_from_utf16,
                preview_to_utf16: found.preview_to_utf16,
                leading_clipped: found.leading_clipped,
                trailing_clipped: found.trailing_clipped,
            })
        })
        .collect::<Result<Vec<_>, WorkspaceError>>()?;
    let skipped_files =
        report
            .skipped_files
            .into_iter()
            .map(|skipped| {
                let file = catalog.files.get(skipped.candidate_index).ok_or_else(|| {
                    WorkspaceError::Io {
                        operation: "map skipped workspace search file".to_string(),
                        message: "search returned an unknown skipped candidate".to_string(),
                    }
                })?;
                Ok(WorkspaceTextSearchSkippedFile {
                    repository_id: file.repository_id.clone(),
                    path: file.path.clone(),
                    workspace_path: skipped.workspace_path,
                    reason: skipped.reason,
                })
            })
            .collect::<Result<Vec<_>, WorkspaceError>>()?;

    Ok(WorkspaceTextSearchReport {
        request_id: report.request_id,
        matches,
        catalog_candidates: report.catalog_candidates,
        eligible_candidates: report.eligible_candidates,
        files_searched: report.files_searched,
        bytes_read: report.bytes_read,
        skipped_count: report.skipped_count,
        skipped_files,
        coverage_reasons: report.coverage_reasons,
    })
}
