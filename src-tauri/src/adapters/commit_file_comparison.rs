use asterlyn_git::{CommitFileVersion, GitError, bounded_text_diff};
use asterlyn_workspace::{
    BinaryFileSnapshot, DEFAULT_TEXT_LIMIT_BYTES, WorkspaceError, decode_utf8_text,
};

use super::image_preview::{ImageDiffPreview, encode_image_diff, has_supported_image_signature};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitFileComparison {
    pub(crate) repository_id: String,
    pub(crate) commit_oid: String,
    pub(crate) revision_oid: String,
    pub(crate) path: String,
    pub(crate) source_path: String,
    pub(crate) blob_oid: String,
    pub(crate) file_mode: String,
    pub(crate) current_revision: String,
    pub(crate) current_source: &'static str,
    pub(crate) current_byte_length: usize,
    pub(crate) kind: &'static str,
    pub(crate) patch: Option<String>,
    pub(crate) image: Option<ImageDiffPreview>,
    pub(crate) truncated: bool,
}

pub(crate) fn compare_commit_file(
    mut version: CommitFileVersion,
    current: BinaryFileSnapshot,
    current_content: Option<String>,
    expected_current_revision: Option<String>,
) -> Result<CommitFileComparison, GitError> {
    let buffer = match (current_content, expected_current_revision) {
        (Some(content), Some(expected)) if expected == current.revision => Some(content),
        (Some(_), Some(_)) => {
            return Err(GitError::InvalidInput {
                field: "current file comparison".to_string(),
                message: "the current file changed after the editor buffer was opened".to_string(),
            });
        }
        (None, None) => None,
        _ => {
            return Err(GitError::InvalidInput {
                field: "current file comparison".to_string(),
                message: "a buffer comparison requires content and its exact disk revision"
                    .to_string(),
            });
        }
    };
    let current_source = if buffer.is_some() { "buffer" } else { "disk" };
    let current_revision = current.revision.clone();

    if has_supported_image_signature(&version.bytes) {
        if buffer.is_some() {
            return Err(GitError::InvalidInput {
                field: "current file comparison".to_string(),
                message: "image comparisons cannot use a text editor buffer".to_string(),
            });
        }
        let current_byte_length = current.byte_length;
        let historical_bytes = std::mem::take(&mut version.bytes);
        let image = encode_image_diff(
            version.path.clone(),
            Some(historical_bytes),
            Some(current.bytes),
        )?;
        return Ok(comparison(
            version,
            current_revision,
            current_source,
            current_byte_length,
            "image",
            None,
            Some(image),
            false,
        ));
    }

    let before =
        decode_utf8_text(&version.bytes, DEFAULT_TEXT_LIMIT_BYTES).map_err(workspace_error)?;
    let after = if let Some(content) = buffer {
        decode_utf8_text(content.as_bytes(), DEFAULT_TEXT_LIMIT_BYTES).map_err(workspace_error)?
    } else {
        decode_utf8_text(&current.bytes, DEFAULT_TEXT_LIMIT_BYTES).map_err(workspace_error)?
    };
    let diff = bounded_text_diff(&version.path, &before.content, &after.content)?;
    Ok(comparison(
        version,
        current_revision,
        current_source,
        after.byte_length,
        "text",
        Some(diff.patch),
        None,
        diff.truncated,
    ))
}

#[allow(clippy::too_many_arguments)]
fn comparison(
    version: CommitFileVersion,
    current_revision: String,
    current_source: &'static str,
    current_byte_length: usize,
    kind: &'static str,
    patch: Option<String>,
    image: Option<ImageDiffPreview>,
    truncated: bool,
) -> CommitFileComparison {
    CommitFileComparison {
        repository_id: version.repository_id,
        commit_oid: version.commit_oid,
        revision_oid: version.revision_oid,
        path: version.path,
        source_path: version.source_path,
        blob_oid: version.blob_oid,
        file_mode: version.file_mode,
        current_revision,
        current_source,
        current_byte_length,
        kind,
        patch,
        image,
        truncated,
    }
}

fn workspace_error(error: WorkspaceError) -> GitError {
    GitError::InvalidInput {
        field: "current file comparison".to_string(),
        message: error.to_string(),
    }
}
