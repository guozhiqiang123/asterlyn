use super::*;

impl GitRepository {
    pub fn stash_selected(
        &self,
        message: &str,
        selected: &[FileChange],
        keep_index: bool,
    ) -> Result<String, GitError> {
        const OPERATION: &str = "stash selected changes";
        self.ensure_no_repository_operation(OPERATION)?;
        let changes = self.status_changes_with_untracked()?;
        let conflicts = changes
            .iter()
            .filter(|change| change.conflicted)
            .map(|change| change.path.clone())
            .collect::<Vec<_>>();
        if !conflicts.is_empty() {
            return Err(GitError::UnsafeOperation {
                operation: OPERATION.into(),
                message: "resolve every conflicted path before creating a stash".into(),
                blockers: conflicts,
            });
        }
        let selected = match_fresh_changes(&changes, selected, OPERATION)?;
        reject_submodule_changes(&selected, OPERATION)?;
        let staged = selected
            .iter()
            .filter(|change| has_staged_change(change))
            .cloned()
            .collect::<Vec<_>>();
        if keep_index && !selected.iter().any(has_unstaged_or_untracked_change) {
            return Err(GitError::InvalidInput {
                field: "keep index".into(),
                message: "all selected changes are staged; clear Keep staged changes to stash them"
                    .into(),
            });
        }
        if message.contains('\0') {
            return Err(GitError::InvalidInput {
                field: "stash message".into(),
                message: "the message cannot contain a null character".into(),
            });
        }
        let temporary = tempfile::tempdir().map_err(|error| GitError::Io {
            operation: "prepare isolated stash index".into(),
            message: error.to_string(),
        })?;
        let temporary_index = temporary.path().join("index");
        let initialize = self.head_oid()?.map_or_else(
            || vec![OsString::from("read-tree"), OsString::from("--empty")],
            |oid| vec![OsString::from("read-tree"), OsString::from(oid)],
        );
        self.run_with_index("prepare isolated stash index", &temporary_index, initialize)?;
        if !staged.is_empty() {
            let index_tree = self.run_read("snapshot selected stash index", ["write-tree"])?;
            let mut overlay = vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("restore"),
                OsString::from("--source"),
                OsString::from(String::from_utf8_lossy(&index_tree.stdout).trim()),
                OsString::from("--staged"),
                OsString::from("--"),
            ];
            overlay.extend(expanded_change_paths(&staged)?);
            self.run_with_index("isolate selected stash index", &temporary_index, overlay)?;
        }
        let before = self.current_stash_oid()?;
        let mut args = vec![
            OsString::from("--literal-pathspecs"),
            OsString::from("stash"),
            OsString::from("push"),
            OsString::from("--quiet"),
            OsString::from("--include-untracked"),
        ];
        let message = message.trim();
        if !message.is_empty() {
            args.extend([OsString::from("--message"), OsString::from(message)]);
        }
        args.push(OsString::from("--"));
        args.extend(expanded_change_paths(&selected)?);
        self.run_with_index(OPERATION, &temporary_index, args)?;

        let created = self
            .current_stash_oid()?
            .ok_or_else(|| GitError::UnsafeOperation {
                operation: OPERATION.into(),
                message: "Git reported success but did not create a stash".into(),
                blockers: selected.iter().map(|change| change.path.clone()).collect(),
            })?;
        if before.as_deref() == Some(created.as_str()) {
            return Err(GitError::UnsafeOperation {
                operation: OPERATION.into(),
                message: "Git reported success but the stash reference did not advance".into(),
                blockers: selected.iter().map(|change| change.path.clone()).collect(),
            });
        }
        if !staged.is_empty() {
            let mut restore = vec![
                OsString::from("--literal-pathspecs"),
                OsString::from("restore"),
            ];
            if keep_index {
                restore.push(OsString::from("--worktree"));
            } else {
                let baseline = self.run_with_index(
                    "read isolated stash index",
                    &temporary_index,
                    vec![OsString::from("write-tree")],
                )?;
                restore.extend([
                    OsString::from("--source"),
                    OsString::from(String::from_utf8_lossy(&baseline.stdout).trim()),
                    OsString::from("--staged"),
                ]);
            }
            restore.push(OsString::from("--"));
            restore.extend(expanded_change_paths(&staged)?);
            self.run_mutation("restore selected stash index state", restore)?;
        }
        Ok(created)
    }

    fn run_with_index(
        &self,
        operation: &str,
        index_file: &Path,
        args: Vec<OsString>,
    ) -> Result<Output, GitError> {
        let output = GitRunner::new(&self.root)
            .output_with_index(args, index_file)
            .map_err(|error| GitError::Io {
                operation: operation.into(),
                message: error.to_string(),
            })?;
        ensure_success(operation, output)
    }

    fn current_stash_oid(&self) -> Result<Option<String>, GitError> {
        let output = run_git_output(&self.root, ["rev-parse", "--verify", "refs/stash"]).map_err(
            |error| GitError::Io {
                operation: "read current stash".into(),
                message: error.to_string(),
            },
        )?;
        Ok(output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string()))
    }
}

fn has_unstaged_or_untracked_change(change: &FileChange) -> bool {
    !matches!(
        change.worktree_status,
        ChangeKind::Unmodified | ChangeKind::Ignored
    )
}

fn has_staged_change(change: &FileChange) -> bool {
    !matches!(
        change.index_status,
        ChangeKind::Unmodified | ChangeKind::Ignored
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    #[test]
    fn stashes_exact_selected_staged_unstaged_and_untracked_paths() {
        let directory = fixture();
        for path in ["mixed.txt", "unstaged.txt", "kept.txt", "kept-staged.txt"] {
            fs::write(directory.path().join(path), "base\n").unwrap();
        }
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "base"]);
        fs::write(directory.path().join("mixed.txt"), "staged\n").unwrap();
        git(directory.path(), &["add", "mixed.txt"]);
        fs::write(directory.path().join("mixed.txt"), "working\n").unwrap();
        fs::write(directory.path().join("unstaged.txt"), "working\n").unwrap();
        fs::write(directory.path().join("kept.txt"), "keep me\n").unwrap();
        fs::write(directory.path().join("kept-staged.txt"), "keep staged\n").unwrap();
        git(directory.path(), &["add", "kept-staged.txt"]);
        fs::write(directory.path().join("new.txt"), "new\n").unwrap();
        let repository = GitRepository::open(directory.path()).unwrap();
        let snapshot = repository.snapshot(50).unwrap();
        let selected = ["mixed.txt", "unstaged.txt", "new.txt"].map(|path| {
            snapshot
                .changes
                .iter()
                .find(|change| change.path == path)
                .unwrap()
                .clone()
        });

        let oid = repository
            .stash_selected("focused stash", &selected, false)
            .unwrap();

        assert_eq!(oid.len(), 40);
        assert_eq!(
            fs::read_to_string(directory.path().join("mixed.txt")).unwrap(),
            "base\n"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("unstaged.txt")).unwrap(),
            "base\n"
        );
        assert!(!directory.path().join("new.txt").exists());
        assert_eq!(
            fs::read_to_string(directory.path().join("kept.txt")).unwrap(),
            "keep me\n"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("kept-staged.txt")).unwrap(),
            "keep staged\n"
        );
        assert!(git_stdout(directory.path(), &["stash", "list", "-1"]).contains("focused stash"));
        let files = git_stdout(
            directory.path(),
            &[
                "stash",
                "show",
                "--include-untracked",
                "--name-only",
                "--format=",
            ],
        );
        assert!(
            files.contains("mixed.txt")
                && files.contains("unstaged.txt")
                && files.contains("new.txt")
        );
        assert!(!files.contains("kept.txt"));
        assert!(!files.contains("kept-staged.txt"));
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "kept-staged.txt"
        );
    }

    #[test]
    fn keep_index_leaves_staged_content_and_stashes_the_remaining_work() {
        let directory = fixture();
        fs::write(directory.path().join("mixed.txt"), "base\n").unwrap();
        fs::write(directory.path().join("staged.txt"), "base\n").unwrap();
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "base"]);
        fs::write(directory.path().join("mixed.txt"), "staged\n").unwrap();
        fs::write(directory.path().join("staged.txt"), "staged\n").unwrap();
        git(directory.path(), &["add", "mixed.txt", "staged.txt"]);
        fs::write(directory.path().join("mixed.txt"), "working\n").unwrap();
        fs::write(directory.path().join("new.txt"), "new\n").unwrap();
        let repository = GitRepository::open(directory.path()).unwrap();
        let snapshot = repository.snapshot(50).unwrap();
        let selected = ["mixed.txt", "staged.txt", "new.txt"].map(|path| {
            snapshot
                .changes
                .iter()
                .find(|change| change.path == path)
                .unwrap()
                .clone()
        });

        repository
            .stash_selected("keep staged", &selected, true)
            .unwrap();

        assert_eq!(
            fs::read_to_string(directory.path().join("mixed.txt")).unwrap(),
            "staged\n"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("staged.txt")).unwrap(),
            "staged\n"
        );
        assert!(!directory.path().join("new.txt").exists());
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "mixed.txt\nstaged.txt"
        );
        assert!(git_stdout(directory.path(), &["diff", "--name-only"]).is_empty());
    }

    #[test]
    fn keep_index_rejects_a_selection_that_contains_only_staged_changes() {
        let directory = fixture();
        fs::write(directory.path().join("staged.txt"), "base\n").unwrap();
        git(directory.path(), &["add", "."]);
        git(directory.path(), &["commit", "-m", "base"]);
        fs::write(directory.path().join("staged.txt"), "staged\n").unwrap();
        git(directory.path(), &["add", "staged.txt"]);
        let repository = GitRepository::open(directory.path()).unwrap();
        let selected = repository.snapshot(50).unwrap().changes.remove(0);

        assert!(matches!(
            repository.stash_selected("", &[selected], true),
            Err(GitError::InvalidInput { field, .. }) if field == "keep index"
        ));
        assert!(git_stdout(directory.path(), &["stash", "list"]).is_empty());
        assert_eq!(
            git_stdout(directory.path(), &["diff", "--cached", "--name-only"]),
            "staged.txt"
        );
    }

    fn fixture() -> TempDir {
        let directory = tempfile::tempdir().unwrap();
        git(directory.path(), &["init", "-b", "main"]);
        git(directory.path(), &["config", "core.autocrlf", "false"]);
        git(directory.path(), &["config", "user.name", "Asterlyn Test"]);
        git(
            directory.path(),
            &["config", "user.email", "test@asterlyn.invalid"],
        );
        directory
    }

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_stdout(path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }
}
