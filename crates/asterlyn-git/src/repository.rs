use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use crate::error::GitError;
use crate::model::{
    ChangeKind, DiffResult, FileChange, RepositorySnapshot, UntrackedScan, UntrackedState,
};
use crate::parser::{parse_branches, parse_commits, parse_status};

const DIFF_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(2);

#[derive(Debug, Clone)]
pub struct GitRepository {
    root: PathBuf,
    git_dir: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn refers_to(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }
}

impl GitRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, GitError> {
        let requested = path.as_ref();
        if requested.as_os_str().is_empty() {
            return Err(GitError::InvalidInput {
                field: "repository path".to_string(),
                message: "a path is required".to_string(),
            });
        }

        let root_output = run_from(
            requested,
            "discover repository root",
            ["rev-parse", "--show-toplevel"],
        )?;
        let git_dir_output = run_from(
            requested,
            "discover Git directory",
            ["rev-parse", "--absolute-git-dir"],
        )?;

        let root = output_path(&root_output, "repository root")?;
        let git_dir = output_path(&git_dir_output, "Git directory")?;
        Ok(Self { root, git_dir })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn snapshot(&self, commit_limit: usize) -> Result<RepositorySnapshot, GitError> {
        let mut snapshot = self.tracked_snapshot(commit_limit)?;
        let scan = self.untracked_changes(&CancellationToken::new())?;
        snapshot.changes.extend(scan.changes);
        snapshot
            .changes
            .sort_by(|left, right| left.path.cmp(&right.path));
        snapshot.untracked_state = UntrackedState::Complete;
        Ok(snapshot)
    }

    pub fn tracked_snapshot(&self, commit_limit: usize) -> Result<RepositorySnapshot, GitError> {
        let status = self.run_read(
            "read working tree status",
            [
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=no",
            ],
        )?;
        let (branch, changes) = parse_status(&status.stdout)?;

        let commits = if branch.unborn {
            Vec::new()
        } else {
            let limit = commit_limit.clamp(1, 500).to_string();
            let output = self.run_read_owned(
                "read commit history",
                vec![
                    OsString::from("log"),
                    OsString::from("--all"),
                    OsString::from("--decorate=short"),
                    OsString::from(format!("--max-count={limit}")),
                    OsString::from("--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e"),
                ],
            )?;
            parse_commits(&output.stdout)?
        };

        let refs = self.run_read(
            "read branches and tags",
            [
                "for-each-ref",
                "--sort=-committerdate",
                "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)%00%(subject)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;

        Ok(RepositorySnapshot {
            root: self.root.to_string_lossy().into_owned(),
            git_dir: self.git_dir.to_string_lossy().into_owned(),
            branch,
            operation: self.detect_operation(),
            changes,
            commits,
            branches: parse_branches(&refs.stdout)?,
            untracked_state: UntrackedState::Pending,
        })
    }

    pub fn untracked_changes(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<UntrackedScan, GitError> {
        let output = self.run_cancellable_read(
            "scan untracked files",
            ["ls-files", "--others", "--exclude-standard", "-z"],
            cancellation,
        )?;
        let mut changes: Vec<_> = output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| FileChange {
                path: String::from_utf8_lossy(path).into_owned(),
                original_path: None,
                index_status: ChangeKind::Unmodified,
                worktree_status: ChangeKind::Untracked,
                conflicted: false,
                submodule: false,
            })
            .collect();
        changes.sort_by(|left, right| left.path.cmp(&right.path));

        Ok(UntrackedScan {
            root: self.root.to_string_lossy().into_owned(),
            changes,
        })
    }

    pub fn diff(&self, path: &str, staged: bool) -> Result<DiffResult, GitError> {
        validate_relative_path(path)?;
        let mut args = vec![
            OsString::from("diff"),
            OsString::from("--no-ext-diff"),
            OsString::from("--no-color"),
            OsString::from("--unified=3"),
        ];
        if staged {
            args.push(OsString::from("--cached"));
        }
        args.push(OsString::from("--"));
        args.push(OsString::from(path));

        let output = self.run_read_owned("read file diff", args)?;
        let mut patch = output.stdout;
        let mut binary = patch.windows(15).any(|window| window == b"Binary files ");

        if patch.is_empty() && !staged {
            let candidate = self.root.join(path);
            if candidate.is_file() {
                let data = fs::read(&candidate).map_err(|error| GitError::Io {
                    operation: "read untracked file".to_string(),
                    message: error.to_string(),
                })?;
                binary = data.contains(&0);
                if binary {
                    patch = format!("Binary file: {path}\n").into_bytes();
                } else {
                    patch = untracked_patch(path, &data).into_bytes();
                }
            }
        }

        let truncated = patch.len() > DIFF_LIMIT_BYTES;
        if truncated {
            patch.truncate(DIFF_LIMIT_BYTES);
            patch.extend_from_slice(b"\n\n[Diff truncated at 4 MiB]\n");
        }

        Ok(DiffResult {
            path: path.to_string(),
            staged,
            patch: String::from_utf8_lossy(&patch).into_owned(),
            binary,
            truncated,
        })
    }

    pub fn stage(&self, paths: &[String]) -> Result<(), GitError> {
        let paths = validate_paths(paths)?;
        let mut args = vec![OsString::from("add"), OsString::from("--")];
        args.extend(paths);
        self.run_mutation("stage paths", args)?;
        Ok(())
    }

    pub fn unstage(&self, paths: &[String]) -> Result<(), GitError> {
        let paths = validate_paths(paths)?;
        let has_head = run_git_output(&self.root, ["rev-parse", "--verify", "HEAD"])
            .map(|output| output.status.success())
            .unwrap_or(false);
        let mut args = if has_head {
            vec![
                OsString::from("restore"),
                OsString::from("--staged"),
                OsString::from("--"),
            ]
        } else {
            vec![
                OsString::from("rm"),
                OsString::from("--cached"),
                OsString::from("--quiet"),
                OsString::from("--"),
            ]
        };
        args.extend(paths);
        self.run_mutation("unstage paths", args)?;
        Ok(())
    }

    pub fn commit(&self, message: &str) -> Result<String, GitError> {
        let message = message.trim();
        if message.is_empty() {
            return Err(GitError::InvalidInput {
                field: "commit message".to_string(),
                message: "the message cannot be empty".to_string(),
            });
        }

        let mut child = base_command(&self.root)
            .args(["commit", "--file=-", "--cleanup=strip"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitError::Io {
                operation: "create commit".to_string(),
                message: error.to_string(),
            })?;
        child
            .stdin
            .take()
            .ok_or_else(|| GitError::Io {
                operation: "create commit".to_string(),
                message: "Git stdin was not available".to_string(),
            })?
            .write_all(message.as_bytes())
            .map_err(|error| GitError::Io {
                operation: "create commit".to_string(),
                message: error.to_string(),
            })?;

        let output = child.wait_with_output().map_err(|error| GitError::Io {
            operation: "create commit".to_string(),
            message: error.to_string(),
        })?;
        ensure_success("create commit", output)?;

        let oid = self.run_read("read new commit id", ["rev-parse", "HEAD"])?;
        Ok(String::from_utf8_lossy(&oid.stdout).trim().to_string())
    }

    fn run_read<const N: usize>(
        &self,
        operation: &str,
        args: [&str; N],
    ) -> Result<Output, GitError> {
        let output = run_git_output(&self.root, args).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
        ensure_success(operation, output)
    }

    fn run_read_owned(&self, operation: &str, args: Vec<OsString>) -> Result<Output, GitError> {
        let output = run_git_output(&self.root, args).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
        ensure_success(operation, output)
    }

    fn run_mutation(&self, operation: &str, args: Vec<OsString>) -> Result<Output, GitError> {
        let output = run_git_output(&self.root, args).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })?;
        ensure_success(operation, output)
    }

    fn run_cancellable_read<const N: usize>(
        &self,
        operation: &str,
        args: [&str; N],
        cancellation: &CancellationToken,
    ) -> Result<Output, GitError> {
        if cancellation.is_cancelled() {
            return Err(GitError::Cancelled {
                operation: operation.to_string(),
            });
        }

        let mut child = base_command(&self.root)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })?;
        let stdout = child.stdout.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git stdout was not available".to_string(),
        })?;
        let stderr = child.stderr.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git stderr was not available".to_string(),
        })?;
        let stdout_reader = thread::spawn(move || read_stream(stdout));
        let stderr_reader = thread::spawn(move || read_stream(stderr));

        let status = loop {
            if cancellation.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_stream(stdout_reader, operation, "stdout");
                let _ = join_stream(stderr_reader, operation, "stderr");
                return Err(GitError::Cancelled {
                    operation: operation.to_string(),
                });
            }
            let wait_result = child.try_wait();
            match wait_result {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(CANCELLATION_POLL_INTERVAL),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = join_stream(stdout_reader, operation, "stdout");
                    let _ = join_stream(stderr_reader, operation, "stderr");
                    return Err(GitError::Io {
                        operation: operation.to_string(),
                        message: error.to_string(),
                    });
                }
            }
        };

        let output = Output {
            status,
            stdout: join_stream(stdout_reader, operation, "stdout")?,
            stderr: join_stream(stderr_reader, operation, "stderr")?,
        };
        ensure_success(operation, output)
    }

    fn detect_operation(&self) -> Option<String> {
        let candidates = [
            ("rebase-merge", "rebase"),
            ("rebase-apply", "rebase"),
            ("MERGE_HEAD", "merge"),
            ("CHERRY_PICK_HEAD", "cherry-pick"),
            ("REVERT_HEAD", "revert"),
            ("BISECT_LOG", "bisect"),
        ];
        candidates
            .iter()
            .find(|(marker, _)| self.git_dir.join(marker).exists())
            .map(|(_, operation)| (*operation).to_string())
    }
}

fn read_stream(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn join_stream(
    reader: thread::JoinHandle<std::io::Result<Vec<u8>>>,
    operation: &str,
    stream: &str,
) -> Result<Vec<u8>, GitError> {
    reader
        .join()
        .map_err(|_| GitError::Io {
            operation: operation.to_string(),
            message: format!("Git {stream} reader stopped unexpectedly"),
        })?
        .map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: format!("could not read Git {stream}: {error}"),
        })
}

fn run_from<const N: usize>(
    path: &Path,
    operation: &str,
    args: [&str; N],
) -> Result<Output, GitError> {
    let output = run_git_output(path, args).map_err(|error| GitError::InvalidRepository {
        path: path.to_string_lossy().into_owned(),
        message: error.to_string(),
    })?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(GitError::InvalidRepository {
            path: path.to_string_lossy().into_owned(),
            message: sanitize_stderr(&output.stderr, operation),
        })
    }
}

fn run_git_output<I, S>(path: &Path, args: I) -> std::io::Result<Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    base_command(path).args(args).output()
}

fn base_command(path: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(path)
        .arg("--no-pager")
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("GIT_TERMINAL_PROMPT", "0");
    command
}

fn ensure_success(operation: &str, output: Output) -> Result<Output, GitError> {
    if output.status.success() {
        Ok(output)
    } else {
        Err(GitError::CommandFailed {
            operation: operation.to_string(),
            status: output.status.code(),
            message: sanitize_stderr(&output.stderr, operation),
        })
    }
}

fn sanitize_stderr(stderr: &[u8], fallback: &str) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_string();
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

fn output_path(output: &Output, context: &str) -> Result<PathBuf, GitError> {
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        Err(GitError::Parse {
            context: context.to_string(),
            message: "Git returned an empty path".to_string(),
        })
    } else {
        Ok(PathBuf::from(value))
    }
}

fn validate_paths(paths: &[String]) -> Result<Vec<OsString>, GitError> {
    if paths.is_empty() {
        return Err(GitError::InvalidInput {
            field: "paths".to_string(),
            message: "select at least one path".to_string(),
        });
    }
    paths
        .iter()
        .map(|path| {
            validate_relative_path(path)?;
            Ok(OsString::from(path))
        })
        .collect()
}

fn validate_relative_path(path: &str) -> Result<(), GitError> {
    let candidate = Path::new(path);
    if path.is_empty() || candidate.is_absolute() {
        return Err(GitError::InvalidInput {
            field: "path".to_string(),
            message: "the path must be repository-relative".to_string(),
        });
    }
    if candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(GitError::InvalidInput {
            field: "path".to_string(),
            message: "parent-directory traversal is not allowed".to_string(),
        });
    }
    Ok(())
}

fn untracked_patch(path: &str, data: &[u8]) -> String {
    let content = String::from_utf8_lossy(data);
    let line_count = content.lines().count().max(1);
    let mut patch = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{line_count} @@\n"
    );
    for line in content.split_inclusive('\n') {
        patch.push('+');
        patch.push_str(line);
    }
    if !content.ends_with('\n') {
        patch.push_str("\n\\ No newline at end of file\n");
    }
    patch
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .expect("git should start");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn fixture() -> TempDir {
        let directory = tempfile::tempdir().expect("temp directory");
        git(directory.path(), &["init", "-b", "main"]);
        git(directory.path(), &["config", "user.name", "Asterlyn Test"]);
        git(
            directory.path(),
            &["config", "user.email", "test@asterlyn.invalid"],
        );
        directory
    }

    #[test]
    fn opens_repository_and_reads_unborn_state() {
        let directory = fixture();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let snapshot = repository.snapshot(50).expect("snapshot loads");
        assert_eq!(snapshot.branch.head.as_deref(), Some("main"));
        assert!(snapshot.branch.unborn);
        assert!(snapshot.commits.is_empty());
    }

    #[test]
    fn tracked_snapshot_defers_untracked_discovery() {
        let directory = fixture();
        fs::write(directory.path().join("later.txt"), "later\n").expect("fixture file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        let tracked = repository
            .tracked_snapshot(50)
            .expect("tracked snapshot loads");
        assert_eq!(tracked.untracked_state, UntrackedState::Pending);
        assert!(tracked.changes.is_empty());

        let scan = repository
            .untracked_changes(&CancellationToken::new())
            .expect("untracked scan loads");
        assert_eq!(scan.changes.len(), 1);
        assert_eq!(scan.changes[0].path, "later.txt");

        let complete = repository.snapshot(50).expect("full snapshot loads");
        assert_eq!(complete.untracked_state, UntrackedState::Complete);
        assert_eq!(complete.changes.len(), 1);
    }

    #[test]
    fn untracked_discovery_honors_preemptive_cancellation() {
        let directory = fixture();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let error = repository
            .untracked_changes(&cancellation)
            .expect_err("cancelled scan should stop");
        assert!(matches!(error, GitError::Cancelled { .. }));
    }

    #[test]
    fn stages_unstages_diffs_and_commits_without_touching_user_data() {
        let directory = fixture();
        fs::write(directory.path().join("hello.txt"), "hello\nworld\n").expect("fixture file");
        let repository = GitRepository::open(directory.path()).expect("repository opens");

        let snapshot = repository.snapshot(50).expect("snapshot loads");
        assert_eq!(snapshot.changes.len(), 1);
        assert_eq!(snapshot.changes[0].path, "hello.txt");

        let diff = repository.diff("hello.txt", false).expect("untracked diff");
        assert!(diff.patch.contains("+hello"));

        repository
            .stage(&["hello.txt".to_string()])
            .expect("stage succeeds");
        let snapshot = repository.snapshot(50).expect("staged snapshot loads");
        assert!(snapshot.changes[0].has_staged_change());

        repository
            .unstage(&["hello.txt".to_string()])
            .expect("unstage succeeds on unborn branch");
        let snapshot = repository.snapshot(50).expect("unstaged snapshot loads");
        assert!(!snapshot.changes[0].has_staged_change());

        repository
            .stage(&["hello.txt".to_string()])
            .expect("restage succeeds");
        let oid = repository
            .commit("Initial fixture")
            .expect("commit succeeds");
        assert_eq!(oid.len(), 40);
        let snapshot = repository.snapshot(50).expect("committed snapshot loads");
        assert_eq!(snapshot.commits[0].subject, "Initial fixture");
        assert!(snapshot.changes.is_empty());
    }

    #[test]
    fn rejects_paths_outside_repository() {
        let directory = fixture();
        let repository = GitRepository::open(directory.path()).expect("repository opens");
        let error = repository
            .stage(&["../outside".to_string()])
            .expect_err("traversal should fail");
        assert!(matches!(error, GitError::InvalidInput { .. }));
    }
}
