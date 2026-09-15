use std::path::Path;

use asterlyn_workspace::{WorkspaceEntryKind, WorkspaceError};

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevealWorkspaceEntryResult {
    pub(crate) selected: bool,
}

pub(crate) fn reveal_workspace_entry(
    path: &Path,
    kind: WorkspaceEntryKind,
) -> Result<RevealWorkspaceEntryResult, WorkspaceError> {
    let result = asterlyn_desktop::reveal_workspace_entry(path, kind)?;
    Ok(RevealWorkspaceEntryResult {
        selected: result.selected,
    })
}
