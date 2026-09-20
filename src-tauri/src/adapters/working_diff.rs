use asterlyn_git::{GitError, WorkingDiffBaseVersion};
use asterlyn_workspace::{DEFAULT_TEXT_LIMIT_BYTES, decode_utf8_text};

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkingDiffBase {
    pub(crate) path: String,
    pub(crate) original_path: Option<String>,
    pub(crate) head_oid: Option<String>,
    pub(crate) blob_oid: Option<String>,
    pub(crate) content: String,
    pub(crate) utf8_bom: bool,
    pub(crate) byte_length: usize,
}

pub(crate) fn working_diff_base(
    version: WorkingDiffBaseVersion,
) -> Result<WorkingDiffBase, GitError> {
    let decoded = decode_utf8_text(&version.bytes, DEFAULT_TEXT_LIMIT_BYTES).map_err(|error| {
        GitError::InvalidInput {
            field: "working diff".to_string(),
            message: error.to_string(),
        }
    })?;
    Ok(WorkingDiffBase {
        path: version.path,
        original_path: version.original_path,
        head_oid: version.head_oid,
        blob_oid: version.blob_oid,
        content: decoded.content,
        utf8_bom: decoded.utf8_bom,
        byte_length: decoded.byte_length,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_preview_decodes_utf8_and_preserves_identity() {
        let preview = working_diff_base(WorkingDiffBaseVersion {
            path: "new.txt".to_string(),
            original_path: Some("old.txt".to_string()),
            head_oid: Some("a".repeat(40)),
            blob_oid: Some("b".repeat(40)),
            bytes: b"\xef\xbb\xbfbefore\r\n".to_vec(),
        })
        .expect("working Diff text");
        assert_eq!(preview.content, "before\r\n");
        assert!(preview.utf8_bom);
        assert_eq!(preview.original_path.as_deref(), Some("old.txt"));
    }
}
