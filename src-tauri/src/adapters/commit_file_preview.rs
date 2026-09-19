use asterlyn_git::{CommitFileVersion, GitError};
use asterlyn_workspace::{DEFAULT_TEXT_LIMIT_BYTES, decode_utf8_text};

use super::image_preview::{ImagePreview, encode_image_preview, has_supported_image_signature};

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitFilePreview {
    pub(crate) repository_id: String,
    pub(crate) commit_oid: String,
    pub(crate) revision_oid: String,
    pub(crate) path: String,
    pub(crate) source_path: String,
    pub(crate) blob_oid: String,
    pub(crate) file_mode: String,
    pub(crate) byte_length: usize,
    pub(crate) kind: &'static str,
    pub(crate) content: Option<String>,
    pub(crate) utf8_bom: Option<bool>,
    pub(crate) image: Option<ImagePreview>,
}

pub(crate) fn commit_file_preview(
    version: CommitFileVersion,
) -> Result<CommitFilePreview, GitError> {
    let byte_length = version.bytes.len();
    if has_supported_image_signature(&version.bytes) {
        let image = encode_image_preview(&version.path, version.bytes).map_err(preview_error)?;
        return Ok(CommitFilePreview {
            repository_id: version.repository_id,
            commit_oid: version.commit_oid,
            revision_oid: version.revision_oid,
            path: version.path,
            source_path: version.source_path,
            blob_oid: version.blob_oid,
            file_mode: version.file_mode,
            byte_length,
            kind: "image",
            content: None,
            utf8_bom: None,
            image: Some(image),
        });
    }
    let decoded = decode_utf8_text(&version.bytes, DEFAULT_TEXT_LIMIT_BYTES)
        .map_err(|error| preview_error(error.to_string()))?;
    Ok(CommitFilePreview {
        repository_id: version.repository_id,
        commit_oid: version.commit_oid,
        revision_oid: version.revision_oid,
        path: version.path,
        source_path: version.source_path,
        blob_oid: version.blob_oid,
        file_mode: version.file_mode,
        byte_length,
        kind: "text",
        content: Some(decoded.content),
        utf8_bom: Some(decoded.utf8_bom),
        image: None,
    })
}

fn preview_error(message: String) -> GitError {
    GitError::InvalidInput {
        field: "historical file".to_string(),
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(bytes: Vec<u8>) -> CommitFileVersion {
        CommitFileVersion {
            repository_id: ".".to_string(),
            commit_oid: "b".repeat(40),
            revision_oid: "a".repeat(40),
            path: "source.txt".to_string(),
            source_path: "source.txt".to_string(),
            blob_oid: "c".repeat(40),
            file_mode: "100644".to_string(),
            bytes,
        }
    }

    #[test]
    fn historical_text_preview_preserves_exact_identity_and_bom() {
        let preview =
            commit_file_preview(version(b"\xef\xbb\xbfhello\r\n".to_vec())).expect("text preview");
        assert_eq!(preview.kind, "text");
        assert_eq!(preview.content.as_deref(), Some("hello\r\n"));
        assert_eq!(preview.utf8_bom, Some(true));
        assert!(preview.image.is_none());
        assert_eq!(preview.byte_length, 10);
    }

    #[test]
    fn historical_binary_without_a_supported_image_signature_is_rejected() {
        assert!(matches!(
            commit_file_preview(version(b"binary\0content".to_vec())),
            Err(GitError::InvalidInput { .. })
        ));
    }
}
