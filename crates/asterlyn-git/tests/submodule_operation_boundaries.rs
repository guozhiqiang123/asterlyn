use std::fs;
use std::path::Path;
use std::process::Command;

use asterlyn_git::{GitError, GitRepository};

#[test]
fn top_level_revert_preserves_an_unstaged_submodule_checkout() {
    let child = initialized_fixture();
    fs::write(child.path().join("library.txt"), "recorded\n").expect("recorded child");
    commit_all(child.path(), "recorded child");
    let recorded_child = git_stdout(child.path(), &["rev-parse", "HEAD"]);

    let parent = initialized_fixture();
    let child_path = child.path().to_string_lossy().into_owned();
    git(
        parent.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &child_path,
            "modules/child",
        ],
    );
    commit_all(parent.path(), "add child");
    fs::write(parent.path().join("app.txt"), "baseline\n").expect("parent baseline");
    commit_all(parent.path(), "app baseline");
    fs::write(parent.path().join("app.txt"), "changed\n").expect("parent change");
    commit_all(parent.path(), "app change");
    let target = git_stdout(parent.path(), &["rev-parse", "HEAD"]);
    git(parent.path(), &["config", "submodule.recurse", "true"]);

    fs::write(child.path().join("library.txt"), "advanced\n").expect("advanced child");
    commit_all(child.path(), "advanced child");
    let advanced_child = git_stdout(child.path(), &["rev-parse", "HEAD"]);
    let nested = parent.path().join("modules/child");
    git(&nested, &["fetch", "origin"]);
    git(&nested, &["checkout", "--detach", &advanced_child]);

    let repository = GitRepository::open(parent.path()).expect("open parent repository");
    let plan = repository
        .prepare_revert(&target)
        .expect("prepare parent revert");
    assert!(
        repository
            .execute_operation_plan(&plan)
            .expect("execute parent revert")
            .is_none()
    );
    assert_eq!(
        fs::read_to_string(parent.path().join("app.txt")).expect("read reverted parent file"),
        "baseline\n"
    );
    assert_eq!(git_stdout(&nested, &["rev-parse", "HEAD"]), advanced_child);
    assert_eq!(
        git_stdout(parent.path(), &["rev-parse", ":modules/child"]),
        recorded_child
    );

    git(parent.path(), &["add", "modules/child"]);
    assert!(matches!(
        repository.prepare_revert(&target),
        Err(GitError::UnsafeOperation { .. })
    ));
}

#[test]
fn superproject_switch_preserves_unstaged_submodule_checkout() {
    let directory = tempfile::tempdir().expect("temp directory");
    let parent = directory.path().join("parent");
    let source = directory.path().join("source");
    fs::create_dir_all(&parent).expect("parent directory");
    fs::create_dir_all(&source).expect("source directory");
    for repository in [&parent, &source] {
        git(repository, &["init", "-b", "main"]);
        git(repository, &["config", "user.name", "Asterlyn Test"]);
        git(
            repository,
            &["config", "user.email", "test@asterlyn.invalid"],
        );
    }

    fs::write(source.join("library.txt"), "recorded\n").expect("recorded child");
    git(&source, &["add", "library.txt"]);
    git(&source, &["commit", "-m", "Recorded child"]);
    fs::write(parent.join("app.txt"), "app\n").expect("parent file");
    git(&parent, &["add", "app.txt"]);
    git(&parent, &["commit", "-m", "Parent root"]);
    let source_path = source.to_string_lossy().into_owned();
    git(
        &parent,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &source_path,
            "modules/library",
        ],
    );
    git(&parent, &["commit", "-am", "Add child"]);
    git(&parent, &["switch", "-c", "feature"]);

    fs::write(source.join("library.txt"), "feature\n").expect("feature child");
    git(&source, &["commit", "-am", "Feature child"]);
    let nested = parent.join("modules/library");
    git(&nested, &["fetch", "origin"]);
    git(&nested, &["checkout", "--detach", "origin/main"]);
    git(&parent, &["add", "modules/library"]);
    git(&parent, &["commit", "-m", "Feature child pointer"]);
    git(
        &parent,
        &["-c", "submodule.recurse=false", "switch", "main"],
    );

    fs::write(source.join("library.txt"), "independent\n").expect("independent child");
    git(&source, &["commit", "-am", "Independent child"]);
    let independent_child = git_stdout(&source, &["rev-parse", "HEAD"]);
    git(&nested, &["fetch", "origin"]);
    git(&nested, &["checkout", "--detach", &independent_child]);
    git(&parent, &["config", "submodule.recurse", "true"]);

    let repository = GitRepository::open(&parent).expect("parent repository opens");
    repository
        .switch_branch("refs/heads/feature")
        .expect("submodule-only state does not block switching");
    assert_eq!(
        git_stdout(&nested, &["rev-parse", "HEAD"]),
        independent_child
    );
    assert_eq!(
        git_stdout(&parent, &["branch", "--show-current"]),
        "feature"
    );

    git(&parent, &["add", "modules/library"]);
    let staged = repository
        .switch_branch("refs/heads/main")
        .expect_err("staged gitlink still blocks switching");
    assert!(matches!(
        staged,
        GitError::UnsafeOperation { ref blockers, .. } if blockers == &["modules/library"]
    ));
}

fn initialized_fixture() -> tempfile::TempDir {
    let fixture = tempfile::tempdir().expect("temporary repository");
    git(fixture.path(), &["init", "-b", "main"]);
    git(fixture.path(), &["config", "user.name", "Asterlyn Test"]);
    git(
        fixture.path(),
        &["config", "user.email", "test@asterlyn.invalid"],
    );
    fixture
}

fn commit_all(repository: &Path, message: &str) {
    git(repository, &["add", "."]);
    git(repository, &["commit", "-m", message]);
}

fn git_stdout(repository: &Path, arguments: &[&str]) -> String {
    let output = command(repository, arguments);
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn git(repository: &Path, arguments: &[&str]) {
    command(repository, arguments);
}

fn command(repository: &Path, arguments: &[&str]) -> std::process::Output {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(arguments)
        .output()
        .expect("run Git fixture command");
    assert!(
        output.status.success(),
        "git {:?}: {}",
        arguments,
        String::from_utf8_lossy(&output.stderr)
    );
    output
}
