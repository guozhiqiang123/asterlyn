use super::*;
use std::process::Command;
use tempfile::TempDir;

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().into()
}

fn fixture() -> (TempDir, TempDir, GitRepository) {
    let directory = tempfile::tempdir().unwrap();
    let recovery = tempfile::tempdir().unwrap();
    let root = directory.path();
    git(root, &["init", "-b", "main"]);
    git(root, &["config", "user.name", "Test"]);
    git(root, &["config", "user.email", "test@example.invalid"]);
    fs::write(root.join("file.txt"), "base\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-m", "base"]);
    let repository = GitRepository::open(root).unwrap();
    (directory, recovery, repository)
}

#[test]
fn restore_review_rejects_new_content_with_identical_git_status() {
    let (directory, recovery, repository) = fixture();
    let file = directory.path().join("file.txt");
    fs::write(&file, "reviewed\n").unwrap();
    let selected = repository.tracked_changes().unwrap().changes;
    let plan = prepare_restore(&repository, &selected).unwrap();
    fs::write(&file, "newer external save\n").unwrap();
    assert_eq!(repository.tracked_changes().unwrap().changes, selected);
    assert!(restore_changes(&repository, recovery.path(), &plan).is_err());
    assert_eq!(fs::read_to_string(file).unwrap(), "newer external save\n");
    assert!(
        list_recoveries(&repository, recovery.path())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn restore_undo_after_restart_recovers_distinct_index_and_exact_worktree_bytes() {
    let (directory, recovery, repository) = fixture();
    let root = directory.path();
    fs::write(root.join("file.txt"), b"staged\n").unwrap();
    git(root, &["add", "file.txt"]);
    fs::write(root.join("file.txt"), b"unstaged\r\n").unwrap();
    let index_before = fs::read(repository.git_directory().join("index")).unwrap();
    let plan =
        prepare_restore(&repository, &repository.tracked_changes().unwrap().changes).unwrap();
    restore_changes(&repository, recovery.path(), &plan).unwrap();
    assert_eq!(fs::read(root.join("file.txt")).unwrap(), b"base\n");
    let reopened = GitRepository::open(root).unwrap();
    let records = list_recoveries(&reopened, recovery.path()).unwrap();
    assert_eq!(records.len(), 1);
    assert!(records[0].can_undo);
    undo_recovery(&reopened, recovery.path(), &records[0].id).unwrap();
    assert_eq!(fs::read(root.join("file.txt")).unwrap(), b"unstaged\r\n");
    assert_eq!(
        fs::read(repository.git_directory().join("index")).unwrap(),
        index_before
    );
    assert_eq!(git(root, &["show", ":file.txt"]), "staged");
    assert!(
        list_recoveries(&reopened, recovery.path())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn undo_never_overwrites_an_external_save_or_a_later_index_change() {
    let (directory, recovery, repository) = fixture();
    let root = directory.path();
    fs::write(root.join("file.txt"), "reviewed\n").unwrap();
    let plan =
        prepare_restore(&repository, &repository.tracked_changes().unwrap().changes).unwrap();
    restore_changes(&repository, recovery.path(), &plan).unwrap();
    let id = list_recoveries(&repository, recovery.path()).unwrap()[0]
        .id
        .clone();
    fs::write(root.join("file.txt"), "new external\n").unwrap();
    assert!(undo_recovery(&repository, recovery.path(), &id).is_err());
    assert_eq!(
        fs::read_to_string(root.join("file.txt")).unwrap(),
        "new external\n"
    );
    fs::write(root.join("file.txt"), "base\n").unwrap();
    fs::write(root.join("unrelated.txt"), "unrelated").unwrap();
    git(root, &["add", "unrelated.txt"]);
    assert!(undo_recovery(&repository, recovery.path(), &id).is_err());
    assert_eq!(git(root, &["show", ":unrelated.txt"]), "unrelated");
}

fn conflicted_fixture() -> (TempDir, TempDir, GitRepository) {
    let (directory, recovery, _) = fixture();
    let root = directory.path();
    fs::write(root.join(".gitattributes"), "*.txt text eol=lf ident\n").unwrap();
    git(root, &["add", ".gitattributes"]);
    git(root, &["commit", "-m", "attributes"]);
    git(root, &["switch", "-c", "feature"]);
    fs::write(root.join("file.txt"), "theirs\n").unwrap();
    git(root, &["commit", "-am", "theirs"]);
    git(root, &["switch", "main"]);
    fs::write(root.join("file.txt"), "ours\n").unwrap();
    git(root, &["commit", "-am", "ours"]);
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["merge", "feature"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let repository = GitRepository::open(root).unwrap();
    (directory, recovery, repository)
}

#[test]
fn conflict_resolution_preserves_raw_text_and_verifies_git_attributes_then_undoes() {
    let (directory, recovery, repository) = conflicted_fixture();
    let root = directory.path();
    let original = fs::read(root.join("file.txt")).unwrap();
    let conflict = repository.read_conflict_content("file.txt").unwrap();
    let result = "$Id: expanded-object $\r\nresolved\r\n";
    resolve_conflict(
        &repository,
        recovery.path(),
        "file.txt",
        &conflict.revision_token,
        Some(result),
    )
    .unwrap();
    assert_eq!(fs::read(root.join("file.txt")).unwrap(), result.as_bytes());
    assert_eq!(git(root, &["show", ":file.txt"]), "$Id$\nresolved");
    assert!(
        repository
            .operation_snapshot()
            .unwrap()
            .unwrap()
            .conflicts
            .is_empty()
    );
    let records = list_recoveries(&repository, recovery.path()).unwrap();
    undo_recovery(&repository, recovery.path(), &records[0].id).unwrap();
    assert_eq!(fs::read(root.join("file.txt")).unwrap(), original);
    assert_eq!(
        repository
            .operation_snapshot()
            .unwrap()
            .unwrap()
            .conflicts
            .len(),
        1
    );
}

#[test]
fn failed_staging_retains_original_index_worktree_and_proposed_resolution() {
    let (directory, recovery, repository) = conflicted_fixture();
    let original = fs::read(directory.path().join("file.txt")).unwrap();
    let conflict = repository.read_conflict_content("file.txt").unwrap();
    let index = fs::read(repository.git_directory().join("index")).unwrap();
    fs::write(
        repository.git_directory().join("index.lock"),
        "external Git writer",
    )
    .unwrap();
    assert!(
        resolve_conflict(
            &repository,
            recovery.path(),
            "file.txt",
            &conflict.revision_token,
            Some("merged result\n")
        )
        .is_err()
    );
    let records = list_recoveries(&repository, recovery.path()).unwrap();
    assert_eq!(records.len(), 1);
    assert!(!records[0].can_undo);
    let backup = Path::new(&records[0].backup_path);
    assert_eq!(fs::read(backup.join("file-0")).unwrap(), original);
    assert_eq!(fs::read(backup.join("index-before")).unwrap(), index);
    assert_eq!(
        fs::read(backup.join("resolved-result")).unwrap(),
        b"merged result\n"
    );
}

#[cfg(unix)]
#[test]
fn conflict_resolution_rejects_hard_links_before_writing() {
    let (directory, recovery, repository) = conflicted_fixture();
    let conflict = repository.read_conflict_content("file.txt").unwrap();
    fs::hard_link(
        directory.path().join("file.txt"),
        directory.path().join("linked.txt"),
    )
    .unwrap();
    let before = fs::read(directory.path().join("file.txt")).unwrap();
    assert!(
        resolve_conflict(
            &repository,
            recovery.path(),
            "file.txt",
            &conflict.revision_token,
            Some("replacement")
        )
        .is_err()
    );
    assert_eq!(
        fs::read(directory.path().join("linked.txt")).unwrap(),
        before
    );
}
