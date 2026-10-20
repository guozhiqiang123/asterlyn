use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::process::Command;

use asterlyn_git::{GitRepository, HistoryQuery};

#[test]
fn all_refs_history_pins_primary_head_without_breaking_paging() {
    let directory = initialized_fixture();
    fs::write(directory.path().join("current.txt"), "current\n").expect("current file");
    commit_all_at(directory.path(), "Current branch tip", 1_700_000_000);
    let current_head = git_stdout(directory.path(), &["rev-parse", "HEAD"]);

    git(directory.path(), &["switch", "--orphan", "dominant"]);
    for index in 0..7 {
        fs::write(
            directory.path().join("dominant.txt"),
            format!("dominant {index}\n"),
        )
        .expect("dominant file");
        commit_all_at(
            directory.path(),
            &format!("Dominant {index}"),
            1_800_000_000 + index,
        );
    }
    git(directory.path(), &["switch", "current"]);

    let raw_topology = git_stdout(
        directory.path(),
        &[
            "log",
            "--all",
            "--topo-order",
            "--max-count=3",
            "--format=%H",
        ],
    );
    assert!(
        !raw_topology.lines().any(|oid| oid == current_head),
        "fixture must reproduce Git topology starving the current branch tip"
    );

    let repository = GitRepository::open(directory.path()).expect("repository opens");
    let snapshot = repository
        .tracked_snapshot(3)
        .expect("snapshot history loads");
    assert_eq!(snapshot.commits[0].oid, current_head);
    assert!(
        snapshot.commits[0]
            .decorations
            .iter()
            .any(|decoration| decoration == "HEAD -> current")
    );

    let query = HistoryQuery::default();
    let mut offset = 0;
    let mut commits = Vec::new();
    loop {
        let page = repository
            .query_commit_history_page(&query, offset, 3)
            .expect("history page loads");
        assert_eq!(page.offset, offset);
        if offset == 0 {
            assert_eq!(page.commits[0].oid, current_head);
        }
        offset += page.commits.len();
        commits.extend(page.commits);
        if !page.has_more {
            break;
        }
    }

    let total = repository
        .query_commit_history_count(&query)
        .expect("history count loads");
    let identities: HashSet<_> = commits
        .iter()
        .map(|commit| (&commit.repository_id, &commit.oid))
        .collect();
    assert_eq!(commits.len(), total);
    assert_eq!(identities.len(), total);
    assert_eq!(
        commits
            .iter()
            .filter(|commit| commit.repository_id == "." && commit.oid == current_head)
            .count(),
        1
    );
}

fn initialized_fixture() -> tempfile::TempDir {
    let directory = tempfile::tempdir().expect("temp directory");
    git(directory.path(), &["init", "-b", "current"]);
    git(directory.path(), &["config", "user.name", "Asterlyn Test"]);
    git(
        directory.path(),
        &["config", "user.email", "test@asterlyn.invalid"],
    );
    directory
}

fn commit_all_at(repository: &Path, message: &str, epoch: i64) {
    git(repository, &["add", "-A"]);
    let timestamp = format!("{epoch} +0000");
    let output = Command::new("git")
        .args(["commit", "-m", message])
        .env("GIT_AUTHOR_DATE", &timestamp)
        .env("GIT_COMMITTER_DATE", &timestamp)
        .current_dir(repository)
        .output()
        .expect("git commit starts");
    assert!(
        output.status.success(),
        "git commit -m {message:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git(repository: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .output()
        .expect("git starts");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        arguments.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_stdout(repository: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .output()
        .expect("git starts");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        arguments.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git stdout is utf-8")
        .trim()
        .to_string()
}
