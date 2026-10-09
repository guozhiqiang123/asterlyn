use std::fs;
use std::process::Command;

use asterlyn_git::GitRepository;

#[test]
fn repository_identity_paths_are_canonical() {
    let directory = tempfile::tempdir().expect("temporary repository");
    let status = Command::new("git")
        .args(["init", "--initial-branch=main"])
        .arg(directory.path())
        .status()
        .expect("Git starts");
    assert!(status.success(), "Git repository initializes");

    let repository = GitRepository::open(directory.path()).expect("repository opens");
    let canonical_root = fs::canonicalize(directory.path()).expect("canonical repository root");
    let canonical_git_dir =
        fs::canonicalize(directory.path().join(".git")).expect("canonical Git directory");

    assert_eq!(repository.root(), canonical_root);
    assert_eq!(repository.git_directory(), canonical_git_dir);

    let snapshot = repository.tracked_snapshot(1).expect("snapshot loads");
    assert_eq!(snapshot.root, canonical_root.to_string_lossy());
    assert_eq!(snapshot.git_dir, canonical_git_dir.to_string_lossy());
}
