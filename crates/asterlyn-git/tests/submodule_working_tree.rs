use std::fs;
use std::path::Path;
use std::process::Command;

use asterlyn_git::{GitError, GitRepository};

#[test]
fn child_changes_are_qualified_routed_and_committed_one_root_at_a_time() {
    let directory = tempfile::tempdir().expect("temp directory");
    let main = directory.path().join("main");
    let source = directory.path().join("source");
    fs::create_dir_all(&main).expect("main directory");
    fs::create_dir_all(&source).expect("source directory");
    for repository in [&main, &source] {
        git(repository, &["init", "-b", "main"]);
        git(repository, &["config", "user.name", "Asterlyn Test"]);
        git(
            repository,
            &["config", "user.email", "test@asterlyn.invalid"],
        );
    }

    fs::write(source.join("shared.txt"), "child baseline\n").expect("child file");
    git(&source, &["add", "shared.txt"]);
    git(&source, &["commit", "-m", "Child baseline"]);
    fs::write(main.join("shared.txt"), "main baseline\n").expect("main file");
    git(&main, &["add", "shared.txt"]);
    git(&main, &["commit", "-m", "Main baseline"]);
    let source_path = source.to_string_lossy().into_owned();
    git(
        &main,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &source_path,
            "modules/library",
        ],
    );
    git(&main, &["commit", "-am", "Add child"]);

    let child = main.join("modules/library");
    git(&child, &["config", "user.name", "Asterlyn Test"]);
    git(&child, &["config", "user.email", "test@asterlyn.invalid"]);
    fs::write(main.join("shared.txt"), "main changed\n").expect("main change");
    fs::write(child.join("shared.txt"), "child changed\n").expect("child change");
    fs::write(child.join("new.txt"), "child new\n").expect("child untracked");

    let repository = GitRepository::open(&main).expect("main repository opens");
    let dirty = repository.snapshot(50).expect("multi-root status loads");
    let main_change = change(&dirty, ".", "shared.txt");
    let child_change = change(&dirty, "modules/library", "shared.txt");
    let child_untracked = change(&dirty, "modules/library", "new.txt");
    assert_eq!(child_change.workspace_path, "modules/library/shared.txt");
    assert_eq!(child_untracked.workspace_path, "modules/library/new.txt");
    assert!(dirty.changes.iter().any(|change| {
        change.repository_id == "." && change.path == "modules/library" && change.submodule
    }));

    let diff = repository
        .repository_local_diff_with_unchanged(&child_change, false)
        .expect("child diff is routed");
    assert!(diff.patch.contains("child changed"));
    assert!(!diff.patch.contains("main changed"));
    assert!(matches!(
        repository.commit_repository_selected("Mixed roots", &[main_change, child_change.clone()]),
        Err(GitError::InvalidInput { .. })
    ));

    repository
        .commit_repository_selected("Child changes", &[child_change, child_untracked])
        .expect("child commit succeeds");
    let committed = repository.snapshot(50).expect("workspace refreshes");
    assert!(
        !committed
            .changes
            .iter()
            .any(|change| change.repository_id == "modules/library")
    );
    assert!(committed.changes.iter().any(|change| {
        change.repository_id == "." && change.path == "modules/library" && change.submodule
    }));
    assert!(
        committed
            .changes
            .iter()
            .any(|change| change.repository_id == "." && change.path == "shared.txt")
    );
}

fn change(
    snapshot: &asterlyn_git::RepositorySnapshot,
    repository_id: &str,
    path: &str,
) -> asterlyn_git::FileChange {
    snapshot
        .changes
        .iter()
        .find(|change| change.repository_id == repository_id && change.path == path)
        .unwrap_or_else(|| panic!("missing {repository_id}:{path}"))
        .clone()
}

fn git(directory: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(directory)
        .output()
        .expect("git starts");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
