use crate::error::{RemoteRefFailure, RemoteRefFailureReason, RemoteRefKind};

const MAX_REMOTE_REF_FAILURES: usize = 8;
const MAX_REMOTE_REF_NAME_CHARS: usize = 256;

pub(crate) fn parse_remote_ref_failures(stdout: &[u8], stderr: &[u8]) -> Vec<RemoteRefFailure> {
    let mut output = Vec::with_capacity(stdout.len() + stderr.len() + 1);
    output.extend_from_slice(stdout);
    output.push(b'\n');
    output.extend_from_slice(stderr);
    let output = String::from_utf8_lossy(&output);
    let mut failures = output
        .lines()
        .filter_map(parse_remote_ref_failure)
        .take(MAX_REMOTE_REF_FAILURES)
        .collect::<Vec<_>>();
    let has_concrete_failure = failures
        .iter()
        .any(|failure| failure.reason != RemoteRefFailureReason::AtomicPushFailed);
    for (index, failure) in failures.iter_mut().enumerate() {
        failure.primary = if has_concrete_failure {
            failure.reason != RemoteRefFailureReason::AtomicPushFailed
        } else {
            index == 0
        };
    }
    failures
}

fn parse_remote_ref_failure(line: &str) -> Option<RemoteRefFailure> {
    let mut fields = line.trim_end_matches('\r').splitn(3, '\t');
    if fields.next()?.trim() != "!" {
        return None;
    }
    let refspec = fields.next()?.trim();
    let diagnostic = fields.next()?.trim();
    let destination = refspec.rsplit_once(':').map_or(refspec, |(_, value)| value);
    let (ref_kind, ref_name) = remote_ref_identity(destination);
    let diagnostic = diagnostic.to_ascii_lowercase();
    let reason = if diagnostic.contains("already exists")
        || diagnostic.contains("would clobber existing tag")
    {
        RemoteRefFailureReason::AlreadyExists
    } else if diagnostic.contains("non-fast-forward") || diagnostic.contains("fetch first") {
        RemoteRefFailureReason::NonFastForward
    } else if diagnostic.contains("stale info") || diagnostic.contains("stale lease") {
        RemoteRefFailureReason::StaleLease
    } else if diagnostic.contains("protected branch")
        || diagnostic.contains("permission denied")
        || diagnostic.contains("not allowed to push")
        || diagnostic.contains("prohibited")
    {
        RemoteRefFailureReason::PermissionDenied
    } else if diagnostic.contains("hook declined") {
        RemoteRefFailureReason::HookRejected
    } else if diagnostic.contains("atomic push failed") {
        RemoteRefFailureReason::AtomicPushFailed
    } else {
        RemoteRefFailureReason::Rejected
    };
    Some(RemoteRefFailure {
        ref_kind,
        ref_name,
        reason,
        primary: false,
    })
}

fn remote_ref_identity(reference: &str) -> (RemoteRefKind, String) {
    let (kind, name) = if let Some(name) = reference.strip_prefix("refs/heads/") {
        (RemoteRefKind::Branch, name)
    } else if let Some(name) = reference.strip_prefix("refs/tags/") {
        (RemoteRefKind::Tag, name)
    } else {
        (RemoteRefKind::Other, reference)
    };
    let bounded = name
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_REMOTE_REF_NAME_CHARS)
        .collect::<String>();
    (kind, bounded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bounded_push_failures_and_prioritizes_the_concrete_cause() {
        let failures = parse_remote_ref_failures(
            b"!\tHEAD:refs/heads/main\t[rejected] (atomic push failed)\r\n!\trefs/tags/existing-tag:refs/tags/existing-tag\t[rejected] (already exists)\r\n",
            b"error: failed to push some refs",
        );
        assert_eq!(failures.len(), 2);
        assert_eq!(failures[0].ref_kind, RemoteRefKind::Branch);
        assert_eq!(failures[0].ref_name, "main");
        assert_eq!(failures[0].reason, RemoteRefFailureReason::AtomicPushFailed);
        assert!(!failures[0].primary);
        assert_eq!(failures[1].ref_kind, RemoteRefKind::Tag);
        assert_eq!(failures[1].ref_name, "existing-tag");
        assert_eq!(failures[1].reason, RemoteRefFailureReason::AlreadyExists);
        assert!(failures[1].primary);

        let bounded_name = "x".repeat(MAX_REMOTE_REF_NAME_CHARS + 20);
        let bounded_output = format!(
            "!\trefs/tags/{bounded_name}:refs/tags/{bounded_name}\t[rejected] (already exists)\n"
        );
        let bounded = parse_remote_ref_failures(bounded_output.as_bytes(), b"");
        assert_eq!(
            bounded[0].ref_name.chars().count(),
            MAX_REMOTE_REF_NAME_CHARS
        );
    }

    #[test]
    fn classifies_known_porcelain_rejections_and_bounds_the_failure_count() {
        for (diagnostic, expected) in [
            (
                "[rejected] (non-fast-forward)",
                RemoteRefFailureReason::NonFastForward,
            ),
            (
                "[rejected] (fetch first)",
                RemoteRefFailureReason::NonFastForward,
            ),
            (
                "[rejected] (stale info)",
                RemoteRefFailureReason::StaleLease,
            ),
            (
                "[remote rejected] (protected branch hook declined)",
                RemoteRefFailureReason::PermissionDenied,
            ),
            (
                "[remote rejected] (pre-receive hook declined)",
                RemoteRefFailureReason::HookRejected,
            ),
            ("[remote rejected]", RemoteRefFailureReason::Rejected),
        ] {
            let output = format!("!\tHEAD:refs/heads/main\t{diagnostic}\n");
            let parsed = parse_remote_ref_failures(output.as_bytes(), b"");
            assert_eq!(parsed[0].reason, expected, "diagnostic: {diagnostic}");
            assert!(parsed[0].primary);
        }

        let too_many = (0..MAX_REMOTE_REF_FAILURES + 3)
            .map(|index| {
                format!(
                    "!\trefs/tags/tag-{index}:refs/tags/tag-{index}\t[rejected] (already exists)\n"
                )
            })
            .collect::<String>();
        assert_eq!(
            parse_remote_ref_failures(too_many.as_bytes(), b"").len(),
            MAX_REMOTE_REF_FAILURES
        );
    }
}
