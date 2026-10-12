use std::fs;
use std::path::Path;
use std::process::Command;

use asterlyn_git::{
    CancellationToken, GitError, GitRepository, PushMode, PushTagMode, RemoteFailureKind,
    RemoteRefFailureReason, RemoteRefKind,
};

#[test]
fn atomic_push_reports_existing_tag_as_root_cause_without_updating_branch() {
    let directory = tempfile::tempdir().expect("remote temp directory");
    let remote = directory.path().join("remote.git");
    let seed = directory.path().join("seed");
    let local = directory.path().join("local");

    git(directory.path(), &["init", "--bare", path(&remote)]);
    git(directory.path(), &["init", "-b", "main", path(&seed)]);
    configure_identity(&seed);
    fs::write(seed.join("base.txt"), "base\n").expect("seed file");
    git(&seed, &["add", "base.txt"]);
    git(&seed, &["commit", "-m", "Root"]);
    git(&seed, &["remote", "add", "origin", path(&remote)]);
    git(&seed, &["push", "--set-upstream", "origin", "main"]);
    git(&remote, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(directory.path(), &["clone", path(&remote), path(&local)]);
    configure_identity(&local);

    let remote_base = git_stdout(&local, &["rev-parse", "HEAD"]);
    git(&local, &["tag", "existing-tag", remote_base.as_str()]);
    git(&local, &["push", "origin", "refs/tags/existing-tag"]);
    fs::write(local.join("local.txt"), "local\n").expect("outgoing file");
    git(&local, &["add", "local.txt"]);
    git(&local, &["commit", "-m", "Local outgoing"]);
    let local_oid = git_stdout(&local, &["rev-parse", "HEAD"]);
    git(
        &local,
        &["tag", "--force", "existing-tag", local_oid.as_str()],
    );

    let repository = GitRepository::open(&local).expect("repository opens");
    let preview = repository
        .push_preview_with_tags("origin", PushTagMode::All, 0, 100)
        .expect("tagged push preview loads");
    let error = repository
        .push_current_with_options(
            "origin",
            PushMode::Ordinary,
            PushTagMode::All,
            &preview.preview_token,
            &CancellationToken::new(),
        )
        .expect_err("the remote rejects the existing tag");

    let serialized = serde_json::to_value(&error).expect("remote failure serializes");
    assert_eq!(serialized["kind"], "remoteFailed");
    assert_eq!(serialized["reason"], "rejected");
    let serialized_failures = serialized["refFailures"]
        .as_array()
        .expect("ref failures serialize as a bounded array");
    assert!(serialized_failures.iter().any(|failure| {
        failure["refKind"] == "tag"
            && failure["refName"] == "existing-tag"
            && failure["reason"] == "alreadyExists"
            && failure["primary"] == true
    }));

    let GitError::RemoteFailed {
        reason,
        ref_failures,
        ..
    } = error
    else {
        panic!("expected a typed remote failure");
    };
    assert_eq!(reason, RemoteFailureKind::Rejected);
    assert!(ref_failures.iter().any(|failure| {
        failure.primary
            && failure.ref_kind == RemoteRefKind::Tag
            && failure.ref_name == "existing-tag"
            && failure.reason == RemoteRefFailureReason::AlreadyExists
    }));
    assert!(ref_failures.iter().any(|failure| {
        !failure.primary && failure.reason == RemoteRefFailureReason::AtomicPushFailed
    }));
    assert_eq!(
        git_stdout(&remote, &["rev-parse", "refs/heads/main"]),
        remote_base
    );
    assert_eq!(
        git_stdout(&remote, &["rev-parse", "refs/tags/existing-tag"]),
        remote_base
    );
}

fn configure_identity(repository: &Path) {
    git(repository, &["config", "user.name", "Asterlyn Test"]);
    git(
        repository,
        &["config", "user.email", "test@asterlyn.invalid"],
    );
}

fn git(repository: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(repository)
        .output()
        .expect("git starts");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_stdout(repository: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(repository)
        .output()
        .expect("git starts");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn path(path: &Path) -> &str {
    path.to_str().expect("fixture path is UTF-8")
}
