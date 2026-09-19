use std::fs;
use std::io::Write;
use std::process::ExitStatus;

use tempfile::tempdir;

use crate::GitError;
use crate::process::{GitRunner, GitStdin};

const DIFF_OUTPUT_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const STDERR_LIMIT_BYTES: usize = 64 * 1024;
const TEXT_INPUT_LIMIT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedTextDiff {
    pub patch: String,
    pub truncated: bool,
}

pub fn bounded_text_diff(
    path: &str,
    before: &str,
    after: &str,
) -> Result<BoundedTextDiff, GitError> {
    validate_label(path)?;
    validate_text_input(before)?;
    validate_text_input(after)?;
    let directory = tempdir().map_err(|error| io_error("create text diff workspace", error))?;
    let before_path = directory.path().join("before");
    let after_path = directory.path().join("after");
    write_file(&before_path, before)?;
    write_file(&after_path, after)?;

    let bounded = GitRunner::new(directory.path())
        .bounded_output(
            [
                "diff",
                "--no-index",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--text",
                "--unified=3",
                "--",
                "before",
                "after",
            ],
            GitStdin::Null,
            DIFF_OUTPUT_LIMIT_BYTES,
            STDERR_LIMIT_BYTES,
        )
        .map_err(|error| io_error("run text diff", error))?;
    ensure_diff_status(
        bounded.output.status,
        &bounded.output.stderr,
        bounded.stderr_truncated,
        bounded.stdout_truncated,
    )?;

    let mut patch = normalize_patch(path, &bounded.output.stdout);
    if bounded.stdout_truncated {
        patch.push_str("\n\n[Diff truncated at 4 MiB]\n");
    }
    Ok(BoundedTextDiff {
        patch,
        truncated: bounded.stdout_truncated,
    })
}

fn write_file(path: &std::path::Path, content: &str) -> Result<(), GitError> {
    let mut file =
        fs::File::create(path).map_err(|error| io_error("create text diff input", error))?;
    file.write_all(content.as_bytes())
        .and_then(|_| file.flush())
        .map_err(|error| io_error("write text diff input", error))
}

fn ensure_diff_status(
    status: ExitStatus,
    stderr: &[u8],
    stderr_truncated: bool,
    stdout_truncated: bool,
) -> Result<(), GitError> {
    if !stderr_truncated
        && (matches!(status.code(), Some(0 | 1)) || (stdout_truncated && stderr.is_empty()))
    {
        return Ok(());
    }
    let mut message = String::from_utf8_lossy(stderr).trim().to_string();
    if stderr_truncated {
        message.push_str(" [stderr truncated]");
    }
    if message.is_empty() {
        message = "Git could not compare the text snapshots".to_string();
    }
    Err(GitError::CommandFailed {
        operation: "compare text snapshots".to_string(),
        status: status.code(),
        message,
    })
}

fn normalize_patch(path: &str, output: &[u8]) -> String {
    let text = String::from_utf8_lossy(output);
    let Some(hunk) = text.find("@@ ") else {
        return String::new();
    };
    format!(
        "diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n{}",
        &text[hunk..],
    )
}

fn validate_label(path: &str) -> Result<(), GitError> {
    if path.is_empty() || path.contains(['\0', '\r', '\n']) {
        return Err(GitError::InvalidInput {
            field: "text diff path".to_string(),
            message: "the display path must be a non-empty single line".to_string(),
        });
    }
    Ok(())
}

fn validate_text_input(content: &str) -> Result<(), GitError> {
    if content.len() > TEXT_INPUT_LIMIT_BYTES || content.as_bytes().contains(&0) {
        return Err(GitError::InvalidInput {
            field: "text diff content".to_string(),
            message: format!(
                "text diff inputs must be NUL-free UTF-8 at or below {TEXT_INPUT_LIMIT_BYTES} bytes"
            ),
        });
    }
    Ok(())
}

fn io_error(operation: &str, error: std::io::Error) -> GitError {
    GitError::Io {
        operation: operation.to_string(),
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_a_normalized_patch_and_preserves_missing_newline_markers() {
        let diff =
            bounded_text_diff("src/app file.ts", "before\n", "after").expect("text diff succeeds");
        assert!(!diff.truncated);
        assert!(diff.patch.starts_with(
            "diff --git a/src/app file.ts b/src/app file.ts\n--- a/src/app file.ts\n+++ b/src/app file.ts\n@@"
        ));
        assert!(diff.patch.contains("-before"));
        assert!(diff.patch.contains("+after"));
        assert!(diff.patch.contains("\\ No newline at end of file"));
    }

    #[test]
    fn identical_text_has_no_patch_and_invalid_labels_fail_closed() {
        assert_eq!(
            bounded_text_diff("same.txt", "same\n", "same\n")
                .expect("identical compare")
                .patch,
            ""
        );
        assert!(matches!(
            bounded_text_diff("bad\npath", "a", "b"),
            Err(GitError::InvalidInput { .. })
        ));
        assert!(matches!(
            bounded_text_diff("large.txt", &"x".repeat(TEXT_INPUT_LIMIT_BYTES + 1), ""),
            Err(GitError::InvalidInput { .. })
        ));
    }
}
