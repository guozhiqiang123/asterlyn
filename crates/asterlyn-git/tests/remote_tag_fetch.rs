use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use asterlyn_git::{CancellationToken, GitRepository};

struct RemoteFixture {
    _directory: tempfile::TempDir,
    remote: PathBuf,
    local: PathBuf,
    peer: PathBuf,
}

#[test]
fn fetch_and_update_import_remote_tags_without_touching_uncommitted_content() {
    let fixture = remote_fixture();
    let fetch_oid = commit_file(&fixture.peer, "fetch.txt", "fetch\n", "Fetch tag");
    publish(&fixture.peer, "fetch-release");
    fs::write(fixture.local.join("base.txt"), "dirty\n").expect("dirty local file");

    let repository = GitRepository::open(&fixture.local).expect("repository opens");
    repository
        .fetch_remote("origin", &CancellationToken::new())
        .expect("fetch imports remote tags with a dirty worktree");
    assert_eq!(
        git_stdout(&fixture.local, &["rev-parse", "refs/tags/fetch-release"]),
        fetch_oid
    );
    assert_eq!(
        fs::read_to_string(fixture.local.join("base.txt")).expect("dirty file remains"),
        "dirty\n"
    );

    git(&fixture.local, &["restore", "base.txt"]);
    let update_oid = commit_file(&fixture.peer, "update.txt", "update\n", "Update tag");
    publish(&fixture.peer, "update-release");
    repository
        .pull_ff_only(&CancellationToken::new())
        .expect("update imports remote tags while fast-forwarding");
    assert_eq!(
        git_stdout(&fixture.local, &["rev-parse", "HEAD"]),
        update_oid
    );
    assert_eq!(
        git_stdout(&fixture.local, &["rev-parse", "refs/tags/update-release"]),
        update_oid
    );
}

#[test]
fn conflicting_remote_tag_fails_without_partially_updating_refs() {
    let fixture = remote_fixture();
    let original_oid = git_stdout(&fixture.local, &["rev-parse", "HEAD"]);
    let original_tracking = git_stdout(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]);
    git(&fixture.local, &["tag", "collision"]);

    let peer_oid = commit_file(&fixture.peer, "peer.txt", "peer\n", "Peer change");
    publish(&fixture.peer, "collision");
    let repository = GitRepository::open(&fixture.local).expect("repository opens");
    repository
        .fetch_remote("origin", &CancellationToken::new())
        .expect_err("a different local tag blocks the atomic fetch");

    assert_eq!(
        git_stdout(&fixture.local, &["rev-parse", "refs/tags/collision"]),
        original_oid
    );
    assert_eq!(
        git_stdout(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]),
        original_tracking
    );
    assert_eq!(
        git_stdout(&fixture.remote, &["rev-parse", "refs/tags/collision"]),
        peer_oid
    );
}

fn remote_fixture() -> RemoteFixture {
    let directory = tempfile::tempdir().expect("remote temp directory");
    let remote = directory.path().join("remote.git");
    let seed = directory.path().join("seed");
    let local = directory.path().join("local");
    let peer = directory.path().join("peer");

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
    git(directory.path(), &["clone", path(&remote), path(&peer)]);
    configure_identity(&local);
    configure_identity(&peer);

    RemoteFixture {
        _directory: directory,
        remote,
        local,
        peer,
    }
}

fn publish(repository: &Path, tag: &str) {
    git(repository, &["tag", tag]);
    git(repository, &["push", "origin", "main"]);
    git(repository, &["push", "origin", &format!("refs/tags/{tag}")]);
}

fn commit_file(repository: &Path, name: &str, contents: &str, message: &str) -> String {
    fs::write(repository.join(name), contents).expect("fixture file");
    git(repository, &["add", name]);
    git(repository, &["commit", "-m", message]);
    git_stdout(repository, &["rev-parse", "HEAD"])
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
