use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use asterlyn_git::{CommitFileChange, CommitFileVersion, GitError, GitRepository};
use asterlyn_workspace::{
    FileRestoreApplyResult, FileRestorePreview, FileRestoreRecoverySummary, PreparedFileRestore,
    Workspace, WorkspaceError,
};

use super::WorkspaceWriteRegistry;

const COMMIT_FILE_RESTORE_LIMIT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitFileRestorePreview {
    #[serde(flatten)]
    restore: FileRestorePreview,
    repository_id: String,
    commit_oid: String,
    revision_oid: String,
    source_path: String,
    blob_oid: String,
    file_mode: String,
}

#[derive(Clone)]
pub(crate) struct StoredCommitFileRestorePlan {
    root: PathBuf,
    repository_id: String,
    commit_oid: String,
    selected: CommitFileChange,
    source: CommitFileVersion,
    plan: PreparedFileRestore,
}

#[derive(Default)]
struct CommitFileRestoreState {
    sequence: u64,
    planning: HashMap<(String, String), (String, u64)>,
    plans: HashMap<(String, String), StoredCommitFileRestorePlan>,
    executing: HashSet<(String, String)>,
}

pub(crate) struct CommitFileRestoreExecution {
    stored: StoredCommitFileRestorePlan,
    write_lock: Arc<Mutex<()>>,
}

pub(crate) struct CommitFileRestoreRegistry {
    state: Mutex<CommitFileRestoreState>,
    writes: WorkspaceWriteRegistry,
}

pub(crate) fn prepare_commit_file_restore_plan(
    root: &Path,
    plan_id: &str,
    repository_id: &str,
    commit_oid: &str,
    selected: CommitFileChange,
) -> Result<(StoredCommitFileRestorePlan, CommitFileRestorePreview), WorkspaceError> {
    let repository = GitRepository::open(root).map_err(git_restore_error)?;
    let target = repository
        .authorize_project_file_target(repository_id, &selected.path)
        .map_err(git_restore_error)?;
    let source = repository
        .repository_commit_file_version(
            repository_id,
            commit_oid,
            &selected,
            COMMIT_FILE_RESTORE_LIMIT_BYTES,
        )
        .map_err(git_restore_error)?;
    let restored_mode = restore_mode(&source.file_mode)?;
    let plan = Workspace::with_text_limit(root, COMMIT_FILE_RESTORE_LIMIT_BYTES)?
        .plan_file_restore(
            plan_id,
            &target.workspace_path,
            source.bytes.clone(),
            restored_mode,
        )?;
    let preview = CommitFileRestorePreview {
        restore: plan.preview().clone(),
        repository_id: source.repository_id.clone(),
        commit_oid: source.commit_oid.clone(),
        revision_oid: source.revision_oid.clone(),
        source_path: source.source_path.clone(),
        blob_oid: source.blob_oid.clone(),
        file_mode: source.file_mode.clone(),
    };
    Ok((
        StoredCommitFileRestorePlan {
            root: root.to_path_buf(),
            repository_id: repository_id.to_string(),
            commit_oid: commit_oid.to_string(),
            selected,
            source,
            plan,
        },
        preview,
    ))
}

pub(crate) fn execute_commit_file_restore_plan(
    root: &Path,
    recovery_root: &Path,
    execution: CommitFileRestoreExecution,
) -> Result<FileRestoreApplyResult, WorkspaceError> {
    let _guard = execution
        .write_lock
        .lock()
        .map_err(|_| WorkspaceError::Io {
            operation: "serialize workspace writes".into(),
            message: "workspace-write lock was poisoned".into(),
        })?;
    let stored = execution.stored;
    let repository = GitRepository::open(root).map_err(git_restore_error)?;
    let target = repository
        .authorize_project_file_target(&stored.repository_id, &stored.selected.path)
        .map_err(git_restore_error)?;
    if target.workspace_path != stored.plan.workspace_path() {
        return Err(WorkspaceError::NotAuthorized {
            message: "the reviewed historical-file target is no longer current".into(),
        });
    }
    let current_source = repository
        .repository_commit_file_version(
            &stored.repository_id,
            &stored.commit_oid,
            &stored.selected,
            COMMIT_FILE_RESTORE_LIMIT_BYTES,
        )
        .map_err(git_restore_error)?;
    if current_source != stored.source {
        return Err(WorkspaceError::InvalidMutation {
            message: "the reviewed historical file identity changed; review it again".into(),
        });
    }
    Workspace::with_text_limit(root, COMMIT_FILE_RESTORE_LIMIT_BYTES)?
        .apply_file_restore(recovery_root, &stored.plan)
}

pub(crate) fn list_commit_file_restore_recoveries(
    root: &Path,
    recovery_root: &Path,
) -> Result<Vec<FileRestoreRecoverySummary>, WorkspaceError> {
    Workspace::with_text_limit(root, COMMIT_FILE_RESTORE_LIMIT_BYTES)?
        .list_file_restore_recoveries(recovery_root)
}

pub(crate) fn rollback_commit_file_restore(
    root: &Path,
    recovery_root: &Path,
    recovery_id: &str,
    writes: &WorkspaceWriteRegistry,
) -> Result<FileRestoreApplyResult, WorkspaceError> {
    let write_lock = writes.lock_for(root.to_string_lossy().into_owned())?;
    let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
        operation: "serialize workspace writes".into(),
        message: "workspace-write lock was poisoned".into(),
    })?;
    Workspace::with_text_limit(root, COMMIT_FILE_RESTORE_LIMIT_BYTES)?
        .rollback_file_restore(recovery_root, recovery_id)
}

pub(crate) fn finalize_commit_file_restore(
    root: &Path,
    recovery_root: &Path,
    recovery_id: &str,
    writes: &WorkspaceWriteRegistry,
) -> Result<(), WorkspaceError> {
    let write_lock = writes.lock_for(root.to_string_lossy().into_owned())?;
    let _guard = write_lock.lock().map_err(|_| WorkspaceError::Io {
        operation: "serialize workspace writes".into(),
        message: "workspace-write lock was poisoned".into(),
    })?;
    Workspace::with_text_limit(root, COMMIT_FILE_RESTORE_LIMIT_BYTES)?
        .finalize_file_restore(recovery_root, recovery_id)
}

impl CommitFileRestoreRegistry {
    pub(crate) fn new(writes: WorkspaceWriteRegistry) -> Self {
        Self {
            state: Mutex::new(CommitFileRestoreState::default()),
            writes,
        }
    }

    pub(crate) fn begin_plan(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
    ) -> Result<u64, WorkspaceError> {
        validate_plan_id(plan_id)?;
        let mut state = self.lock("begin commit-file restore plan")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.executing.contains(&scope) {
            return Err(busy());
        }
        state.plans.retain(|(label, _), _| label != window_label);
        state.sequence = state.sequence.wrapping_add(1).max(1);
        let token = state.sequence;
        state.planning.insert(scope, (plan_id.to_string(), token));
        Ok(token)
    }

    pub(crate) fn finish_plan(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
        token: u64,
        stored: Option<StoredCommitFileRestorePlan>,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("finish commit-file restore plan")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.planning.get(&scope) != Some(&(plan_id.to_string(), token)) {
            return Err(stale());
        }
        state.planning.remove(&scope);
        if let Some(stored) = stored {
            state
                .plans
                .insert((window_label.to_string(), plan_id.to_string()), stored);
        }
        Ok(())
    }

    pub(crate) fn start_execution(
        &self,
        window_label: &str,
        repository_root: &str,
        root: &Path,
        plan_id: &str,
    ) -> Result<CommitFileRestoreExecution, WorkspaceError> {
        validate_plan_id(plan_id)?;
        let write_lock = self.writes.lock_for(root.to_string_lossy().into_owned())?;
        let mut state = self.lock("start commit-file restore")?;
        let scope = (window_label.to_string(), repository_root.to_string());
        if state.executing.contains(&scope) {
            return Err(busy());
        }
        let stored = state
            .plans
            .get(&(window_label.to_string(), plan_id.to_string()))
            .filter(|stored| stored.root == root)
            .cloned()
            .ok_or_else(stale)?;
        state.executing.insert(scope);
        Ok(CommitFileRestoreExecution { stored, write_lock })
    }

    pub(crate) fn finish_execution(
        &self,
        window_label: &str,
        repository_root: &str,
        plan_id: &str,
    ) -> Result<(), WorkspaceError> {
        let mut state = self.lock("finish commit-file restore")?;
        state
            .executing
            .remove(&(window_label.to_string(), repository_root.to_string()));
        state
            .plans
            .remove(&(window_label.to_string(), plan_id.to_string()));
        Ok(())
    }

    pub(crate) fn remove_window(&self, window_label: &str) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.planning.retain(|(label, _), _| label != window_label);
        state.plans.retain(|(label, _), _| label != window_label);
        state.executing.retain(|(label, _)| label != window_label);
    }

    fn lock(
        &self,
        operation: &str,
    ) -> Result<std::sync::MutexGuard<'_, CommitFileRestoreState>, WorkspaceError> {
        self.state.lock().map_err(|_| WorkspaceError::Io {
            operation: operation.to_string(),
            message: "commit-file restore registry lock was poisoned".into(),
        })
    }
}

fn validate_plan_id(plan_id: &str) -> Result<(), WorkspaceError> {
    if plan_id.is_empty()
        || plan_id.len() > 96
        || plan_id
            .chars()
            .any(|character| character.is_whitespace() || matches!(character, '/' | '\\' | '\0'))
    {
        return Err(WorkspaceError::InvalidMutation {
            message: "commit-file restore plan IDs must be short opaque values".into(),
        });
    }
    Ok(())
}

fn busy() -> WorkspaceError {
    WorkspaceError::Busy {
        message: "another commit-file restore is already running".into(),
    }
}

fn stale() -> WorkspaceError {
    WorkspaceError::InvalidMutation {
        message: "commit-file restore plan is stale; review it again".into(),
    }
}

fn restore_mode(file_mode: &str) -> Result<u32, WorkspaceError> {
    match file_mode {
        "100644" => Ok(0o644),
        "100755" => Ok(0o755),
        _ => Err(WorkspaceError::UnsupportedFile {
            message: format!("historical Git mode {file_mode} is not a restorable regular file"),
        }),
    }
}

fn git_restore_error(error: GitError) -> WorkspaceError {
    WorkspaceError::InvalidMutation {
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::process::Command;

    use super::*;

    fn git(root: &Path, arguments: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(root)
            .args(arguments)
            .output()
            .unwrap();
        assert!(output.status.success(), "git {arguments:?} failed");
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    }

    #[test]
    fn accepts_only_regular_git_file_modes() {
        assert_eq!(restore_mode("100644").unwrap(), 0o644);
        assert_eq!(restore_mode("100755").unwrap(), 0o755);
        assert!(restore_mode("120000").is_err());
        assert!(restore_mode("160000").is_err());
    }

    #[test]
    fn application_service_restores_a_reviewed_commit_file_without_tauri() {
        let root = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        git(root.path(), &["init", "-b", "main"]);
        fs::write(root.path().join("source.txt"), "historical\n").unwrap();
        git(root.path(), &["add", "source.txt"]);
        git(
            root.path(),
            &[
                "-c",
                "user.name=Asterlyn Test",
                "-c",
                "user.email=asterlyn@example.invalid",
                "commit",
                "-m",
                "fixture",
            ],
        );
        let oid = git(root.path(), &["rev-parse", "HEAD"]);
        let repository = GitRepository::open(root.path()).unwrap();
        let selected = repository
            .commit_details(&oid)
            .unwrap()
            .files
            .into_iter()
            .find(|file| file.path == "source.txt")
            .unwrap();
        fs::write(root.path().join("source.txt"), "current\n").unwrap();

        let (stored, preview) =
            prepare_commit_file_restore_plan(root.path(), "restore-source", ".", &oid, selected)
                .unwrap();
        assert_eq!(preview.restore.workspace_path, "source.txt");
        execute_commit_file_restore_plan(
            root.path(),
            recovery.path(),
            CommitFileRestoreExecution {
                stored,
                write_lock: Arc::new(Mutex::new(())),
            },
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(root.path().join("source.txt")).unwrap(),
            "historical\n"
        );
    }
}
