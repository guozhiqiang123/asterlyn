use std::fs;
use std::path::Path;
use std::process::Command;

use asterlyn_git::{
    GitError, GitRepository, PushTagMode, RepositoryPushTarget, TagMutationKind, TagMutationRequest,
};

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
    assert!(
        dirty
            .remotes
            .iter()
            .any(|remote| { remote.repository_id == "modules/library" && remote.name == "origin" })
    );
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
    let preview = repository
        .repository_push_preview(
            RepositoryPushTarget {
                repository_id: "modules/library",
                remote: "origin",
                destination_branch: None,
                source_branch: None,
            },
            PushTagMode::None,
            0,
            100,
        )
        .expect("child push preview is routed");
    assert_eq!(preview.repository_id, "modules/library");
    assert_eq!(preview.total_commits, 1);
    assert!(
        preview
            .commits
            .iter()
            .all(|commit| commit.repository_id == "modules/library")
    );
    let committed = repository.snapshot(50).expect("workspace refreshes");
    let child_branch = committed
        .branches
        .iter()
        .find(|branch| {
            branch.repository_id == "modules/library"
                && branch.kind == asterlyn_git::BranchKind::Local
                && branch.current
        })
        .expect("child current branch is projected");
    assert_eq!(child_branch.upstream_remote.as_deref(), Some("origin"));
    assert_eq!(child_branch.ahead, 1);
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

    let child_repository = repository
        .discovered_repository("modules/library")
        .expect("child mutation root is safely resolved");
    let canonical_child = fs::canonicalize(&child).expect("child path resolves");
    assert_eq!(child_repository.root(), canonical_child);
    assert!(matches!(
        repository.discovered_repository("../source"),
        Err(GitError::InvalidInput { .. })
    ));
    let child_head = git_stdout(&child, &["rev-parse", "HEAD"]);
    let revert = child_repository
        .prepare_revert(&child_head)
        .expect("child commit operation is prepared in the child repository");
    assert_eq!(revert.repository_root, canonical_child.to_string_lossy());
    child_repository
        .execute_local_tag_mutation(&TagMutationRequest {
            kind: TagMutationKind::Create,
            tag_name: "child-context-action".to_string(),
            commit_oid: child_head,
            remote: None,
        })
        .expect("child tag mutation is routed to the child repository");
    assert_eq!(
        git_stdout(&child, &["rev-parse", "refs/tags/child-context-action"]),
        git_stdout(&child, &["rev-parse", "HEAD"])
    );
    assert!(
        !Command::new("git")
            .args(["rev-parse", "--verify", "refs/tags/child-context-action"])
            .current_dir(&main)
            .output()
            .expect("main ref check starts")
            .status
            .success()
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

fn git_stdout(directory: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(directory)
        .output()
        .expect("git starts");
    assert!(output.status.success(), "git {arguments:?} failed");
    String::from_utf8(output.stdout)
        .expect("Git output is UTF-8")
        .trim()
        .to_string()
}
