use asterlyn_task::{
    MAX_OUTPUT_BYTES, OutputStream, PROTOCOL_VERSION, PreparedTask, TaskRequest, TaskSessionEvent,
    TrustState, encode_output, validate_request,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
struct Review {
    owner: String,
    root: PathBuf,
    activation: u64,
    request: TaskRequest,
    executable: PathBuf,
    identity: FileIdentity,
    created: Instant,
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct FileIdentity {
    len: u64,
    modified: Option<std::time::SystemTime>,
    digest: String,
}

type Sink = Arc<dyn Fn(TaskSessionEvent) + Send + Sync + 'static>;
struct SerialSink {
    sink: Sink,
    sequence: Mutex<u64>,
}
impl SerialSink {
    fn new(sink: Sink) -> Self {
        Self {
            sink,
            sequence: Mutex::new(0),
        }
    }
}

#[derive(Default, Clone)]
pub(crate) struct TaskManager {
    inner: Arc<TaskManagerInner>,
}
#[derive(Default)]
struct TaskManagerInner {
    sequence: AtomicU64,
    reviews: Mutex<HashMap<String, Review>>,
    running: Mutex<HashMap<String, Running>>,
    workspace_runs: Mutex<HashMap<PathBuf, String>>,
}
struct Running {
    child: Arc<Mutex<Option<Child>>>,
    pid: u32,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    owner: String,
}

impl TaskManager {
    pub(crate) fn prepare(
        &self,
        owner: &str,
        root: &Path,
        activation: u64,
        request: TaskRequest,
        trust_state: TrustState,
    ) -> Result<PreparedTask, String> {
        validate_request(&request)?;
        let relative = Path::new(&request.executable_path);
        let executable = root.join(relative);
        let canonical = std::fs::canonicalize(&executable)
            .map_err(|e| format!("executable is unavailable: {e}"))?;
        if !canonical.starts_with(root) || !canonical.is_file() {
            return Err("executable must remain inside the workspace".into());
        }
        let identity = identity(&canonical)?;
        let review_id = format!(
            "review-{}",
            self.inner.sequence.fetch_add(1, Ordering::Relaxed) + 1
        );
        let mut reviews = self.inner.reviews.lock().map_err(lock_error)?;
        reviews.retain(|_, review| review.created.elapsed() < Duration::from_secs(600));
        if reviews.len() >= 256 {
            return Err("too many pending task reviews".into());
        }
        reviews.insert(
            review_id.clone(),
            Review {
                owner: owner.to_string(),
                root: root.to_path_buf(),
                activation,
                request: request.clone(),
                executable: canonical.clone(),
                identity,
                created: Instant::now(),
            },
        );
        Ok(PreparedTask {
            protocol_version: PROTOCOL_VERSION,
            review_id,
            plugin_id: request.plugin_id,
            provider_id: request.provider_id,
            task_id: request.task_id,
            label: request.label,
            executable_path: request.executable_path,
            canonical_executable_path: canonical.to_string_lossy().into_owned(),
            cwd: root.to_string_lossy().into_owned(),
            args: request.args,
            workspace_root: root.to_string_lossy().into_owned(),
            trust: trust_state,
        })
    }

    pub(crate) fn start(
        &self,
        owner: &str,
        root: &Path,
        activation: u64,
        review_id: &str,
        trust: TrustState,
        sink: Sink,
    ) -> Result<String, String> {
        if trust != TrustState::Trusted {
            return Err("workspace trust is required before running tasks".into());
        }
        let mut review_store = self.inner.reviews.lock().map_err(lock_error)?;
        let review = review_store
            .get(review_id)
            .cloned()
            .ok_or_else(|| "task review is unknown or expired".to_string())?;
        if review.root != root
            || review.owner != owner
            || review.activation != activation
            || review.created.elapsed() >= Duration::from_secs(600)
        {
            return Err("task review belongs to a stale workspace activation".into());
        }
        review_store.remove(review_id);
        if identity(&review.executable)? != review.identity {
            return Err("task executable changed after review".into());
        }
        {
            let mut running = self.inner.workspace_runs.lock().map_err(lock_error)?;
            if running.contains_key(root) {
                return Err("a task is already running for this workspace".into());
            }
            let run_id = format!(
                "run-{}",
                self.inner.sequence.fetch_add(1, Ordering::Relaxed) + 1
            );
            let child = spawn(&review, root, &run_id)?;
            running.insert(root.to_path_buf(), run_id.clone());
            let pid = child.id();
            let child = Arc::new(Mutex::new(Some(child)));
            let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
            self.inner.running.lock().map_err(lock_error)?.insert(
                run_id.clone(),
                Running {
                    child: child.clone(),
                    pid,
                    cancelled: cancelled.clone(),
                    owner: owner.to_string(),
                },
            );
            let sink = Arc::new(SerialSink::new(sink));
            let manager = self.clone();
            let root = root.to_path_buf();
            let run = run_id.clone();
            std::thread::spawn(move || {
                emit(
                    &sink,
                    TaskSessionEvent::Status {
                        protocol_version: PROTOCOL_VERSION,
                        run_id: run.clone(),
                        workspace_root: root.to_string_lossy().into_owned(),
                        sequence: 1,
                        status: asterlyn_task::TaskStatus::Running,
                        message: None,
                        exit_code: None,
                    },
                );
                let result = collect(child, cancelled, &run, &root, sink.clone());
                manager.finish(&root, &run);
                if let Err(message) = result {
                    emit(
                        &sink,
                        TaskSessionEvent::Status {
                            protocol_version: PROTOCOL_VERSION,
                            run_id: run,
                            workspace_root: root.to_string_lossy().into_owned(),
                            sequence: 2,
                            status: asterlyn_task::TaskStatus::Crashed,
                            message: Some(message),
                            exit_code: None,
                        },
                    );
                }
            });
            Ok(run_id)
        }
    }

    pub(crate) fn cancel(&self, owner: &str, run_id: &str) -> Result<(), String> {
        let running_guard = self.inner.running.lock().map_err(lock_error)?;
        let running = running_guard
            .get(run_id)
            .ok_or_else(|| "task run is not active".to_string())?;
        if running.owner != owner {
            return Err("task run belongs to another window".into());
        }
        running.cancelled.store(true, Ordering::Relaxed);
        kill_pid(running.pid);
        if let Ok(mut child) = running.child.lock()
            && let Some(child) = child.as_mut()
        {
            let _ = child.kill();
        }
        Ok(())
    }
    pub(crate) fn cancel_workspace(&self, root: &Path) {
        let run = self
            .inner
            .workspace_runs
            .lock()
            .ok()
            .and_then(|runs| runs.get(root).cloned());
        if let Some(run) = run {
            let owner = self
                .inner
                .running
                .lock()
                .ok()
                .and_then(|runs| runs.get(&run).map(|r| r.owner.clone()))
                .unwrap_or_default();
            let _ = self.cancel(&owner, &run);
        }
    }
    pub(crate) fn cancel_owner(&self, owner: &str) {
        let runs: Vec<String> = self
            .inner
            .running
            .lock()
            .ok()
            .map(|runs| {
                runs.iter()
                    .filter(|(_, value)| value.owner == owner)
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default();
        for run in runs {
            let _ = self.cancel(owner, &run);
        }
        if let Ok(mut reviews) = self.inner.reviews.lock() {
            reviews.retain(|_, review| review.owner != owner);
        }
    }
    pub(crate) fn cancel_all(&self) {
        let owners: Vec<String> = self
            .inner
            .running
            .lock()
            .ok()
            .map(|runs| runs.values().map(|value| value.owner.clone()).collect())
            .unwrap_or_default();
        for owner in owners {
            self.cancel_owner(&owner);
        }
        if let Ok(mut reviews) = self.inner.reviews.lock() {
            reviews.clear();
        }
    }
    fn finish(&self, root: &Path, run_id: &str) {
        if let Ok(mut runs) = self.inner.workspace_runs.lock() {
            runs.remove(root);
        }
        if let Ok(mut running) = self.inner.running.lock() {
            running.remove(run_id);
        }
    }
}
impl Drop for TaskManager {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            self.cancel_all();
        }
    }
}

// The worker only needs cleanup; preserve shared cancellation state through a small forwarding handle.
// A production app owns one manager; this method is replaced below by the shared worker registry.
fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "task manager lock was poisoned".into()
}

fn spawn(review: &Review, root: &Path, _run_id: &str) -> Result<Child, String> {
    let mut command = Command::new(&review.executable);
    command
        .args(&review.request.args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    for name in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "SystemRoot",
        "TEMP",
        "TMP",
        "JAVA_HOME",
        "ANDROID_HOME",
        "ANDROID_SDK_ROOT",
        "GRADLE_USER_HOME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
    ] {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.spawn().map_err(|e| format!("start task: {e}"))
}

fn identity(path: &Path) -> Result<FileIdentity, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("inspect executable: {e}"))?;
    let mut file = std::fs::File::open(path).map_err(|e| format!("read executable: {e}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut chunk)
            .map_err(|e| format!("read executable: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&chunk[..n]);
        total += n as u64;
        if total > 64 * 1024 * 1024 {
            return Err("executable is too large to review".into());
        }
    }
    Ok(FileIdentity {
        len: metadata.len(),
        modified: metadata.modified().ok(),
        digest: format!("{:x}", hasher.finalize()),
    })
}
fn emit(sink: &SerialSink, mut event: TaskSessionEvent) {
    let Ok(mut sequence) = sink.sequence.lock() else {
        return;
    };
    *sequence += 1;
    let value = *sequence;
    match &mut event {
        TaskSessionEvent::Output { sequence, .. }
        | TaskSessionEvent::Truncated { sequence, .. }
        | TaskSessionEvent::Status { sequence, .. } => *sequence = value,
    }
    (sink.sink)(event);
}

fn collect(
    child: Arc<Mutex<Option<Child>>>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    run_id: &str,
    root: &Path,
    sink: Arc<SerialSink>,
) -> Result<(), String> {
    let (stdout, stderr) = {
        let mut child_value = child.lock().map_err(lock_error)?;
        let value = child_value
            .as_mut()
            .ok_or_else(|| "task process disappeared".to_string())?;
        (value.stdout.take(), value.stderr.take())
    };
    let mut handles = Vec::new();
    if let Some(pipe) = stdout {
        handles.push(std::thread::spawn({
            let sink = sink.clone();
            let id = run_id.to_string();
            let workspace_root = root.to_string_lossy().into_owned();
            move || collect_output(pipe, OutputStream::Stdout, id, workspace_root, sink)
        }));
    }
    if let Some(pipe) = stderr {
        handles.push(std::thread::spawn({
            let sink = sink.clone();
            let id = run_id.to_string();
            let workspace_root = root.to_string_lossy().into_owned();
            move || collect_output(pipe, OutputStream::Stderr, id, workspace_root, sink)
        }));
    }
    let status = loop {
        let mut guard = child.lock().map_err(lock_error)?;
        if let Some(value) = guard.as_mut() {
            if let Some(status) = value
                .try_wait()
                .map_err(|e| format!("wait for task: {e}"))?
            {
                break status;
            }
        } else {
            return Err("task process disappeared".into());
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(50));
    };
    for handle in handles {
        handle
            .join()
            .map_err(|_| "task output collector panicked".to_string())??;
    }
    emit(
        &sink,
        TaskSessionEvent::Status {
            protocol_version: PROTOCOL_VERSION,
            run_id: run_id.to_string(),
            workspace_root: root.to_string_lossy().into_owned(),
            sequence: 0,
            status: if cancelled.load(Ordering::Relaxed) {
                asterlyn_task::TaskStatus::Cancelled
            } else if status.success() {
                asterlyn_task::TaskStatus::Succeeded
            } else {
                asterlyn_task::TaskStatus::Failed
            },
            message: None,
            exit_code: status.code(),
        },
    );
    Ok(())
}

fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let taskkill = PathBuf::from(system_root)
            .join("System32")
            .join("taskkill.exe");
        let _ = Command::new(taskkill)
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn collect_output<R: Read + Send + 'static>(
    mut pipe: R,
    stream: OutputStream,
    id: String,
    workspace_root: String,
    sink: Arc<SerialSink>,
) -> Result<(), String> {
    let mut used = 0usize;
    let mut omitted = 0u64;
    let mut buf = [0u8; 16 * 1024];
    loop {
        let n = match pipe.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(error) => return Err(format!("read task output: {error}")),
        };
        if used < MAX_OUTPUT_BYTES {
            let allowed = n.min(MAX_OUTPUT_BYTES - used);
            if allowed > 0 {
                emit(
                    &sink,
                    TaskSessionEvent::Output {
                        protocol_version: PROTOCOL_VERSION,
                        run_id: id.clone(),
                        workspace_root: workspace_root.clone(),
                        stream: stream.clone(),
                        data_base64: encode_output(&buf[..allowed]),
                        sequence: 0,
                    },
                );
                used += allowed;
            }
            if allowed < n {
                omitted += (n - allowed) as u64;
            }
        } else {
            omitted += n as u64;
        }
    }
    if omitted > 0 {
        emit(
            &sink,
            TaskSessionEvent::Truncated {
                protocol_version: PROTOCOL_VERSION,
                run_id: id,
                workspace_root,
                stream,
                omitted_bytes: omitted,
                sequence: 0,
            },
        );
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use asterlyn_task::{TaskStatus, TrustState};
    use base64::Engine;
    use std::fs;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::sync::MutexGuard;

    fn write_executable(root: &Path, name: &str, body: &str) -> PathBuf {
        let path = root.join(name);
        fs::write(&path, format!("#!/bin/sh\nset -eu\n{body}\n")).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    fn request(executable_path: &str, args: Vec<String>) -> TaskRequest {
        TaskRequest {
            plugin_id: "android".into(),
            provider_id: "gradle".into(),
            task_id: "test".into(),
            label: "Test task".into(),
            executable_path: executable_path.into(),
            args,
        }
    }

    fn event_sink() -> (Sink, Arc<Mutex<Vec<TaskSessionEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let sink: Sink = Arc::new(move |event| captured.lock().unwrap().push(event));
        (sink, events)
    }

    fn captured_events(
        events: &Arc<Mutex<Vec<TaskSessionEvent>>>,
    ) -> MutexGuard<'_, Vec<TaskSessionEvent>> {
        events.lock().unwrap()
    }

    fn wait_for_terminal(events: &Arc<Mutex<Vec<TaskSessionEvent>>>) -> TaskSessionEvent {
        for _ in 0..250 {
            if let Some(event) = captured_events(events).iter().find(|event| {
                matches!(
                    event,
                    TaskSessionEvent::Status {
                        status: TaskStatus::Succeeded
                            | TaskStatus::Failed
                            | TaskStatus::Cancelled
                            | TaskStatus::Crashed,
                        ..
                    }
                )
            }) {
                return event.clone();
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!(
            "task did not reach a terminal state: {:?}",
            captured_events(events)
        );
    }

    fn wait_for_stdout(events: &Arc<Mutex<Vec<TaskSessionEvent>>>) -> Vec<u8> {
        for _ in 0..250 {
            let output: Vec<u8> = captured_events(events)
                .iter()
                .filter_map(|event| match event {
                    TaskSessionEvent::Output {
                        stream: OutputStream::Stdout,
                        data_base64,
                        ..
                    } => Some(
                        base64::engine::general_purpose::STANDARD
                            .decode(data_base64)
                            .unwrap(),
                    ),
                    _ => None,
                })
                .flatten()
                .collect();
            if !output.is_empty() {
                return output;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("task did not produce stdout");
    }

    fn prepare(
        manager: &TaskManager,
        owner: &str,
        root: &Path,
        activation: u64,
        executable: &str,
        args: Vec<String>,
    ) -> PreparedTask {
        manager
            .prepare(
                owner,
                root,
                activation,
                request(executable, args),
                TrustState::Trusted,
            )
            .unwrap()
    }

    #[test]
    fn prepare_rejects_path_escape_and_symlink_escape() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("project");
        fs::create_dir(&root).unwrap();
        let outside = write_executable(directory.path(), "outside", "exit 0");
        symlink(&outside, root.join("linked-tool")).unwrap();
        let manager = TaskManager::default();

        assert!(
            manager
                .prepare(
                    "window-a",
                    &root,
                    1,
                    request("../outside", vec![]),
                    TrustState::Trusted,
                )
                .is_err()
        );
        assert!(
            manager
                .prepare(
                    "window-a",
                    &root,
                    1,
                    request("linked-tool", vec![]),
                    TrustState::Trusted,
                )
                .is_err()
        );
    }

    #[test]
    fn start_requires_trust_owner_activation_and_unchanged_executable() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        write_executable(&root, "tool", "exit 0");
        let manager = TaskManager::default();
        let (sink, _) = event_sink();

        let denied = prepare(&manager, "window-a", &root, 1, "tool", vec![]);
        assert!(
            manager
                .start(
                    "window-a",
                    &root,
                    1,
                    &denied.review_id,
                    TrustState::Denied,
                    sink.clone(),
                )
                .is_err()
        );

        let protected = prepare(&manager, "window-a", &root, 1, "tool", vec![]);
        assert!(
            manager
                .start(
                    "window-b",
                    &root,
                    1,
                    &protected.review_id,
                    TrustState::Trusted,
                    sink.clone(),
                )
                .is_err()
        );
        assert!(
            manager
                .start(
                    "window-a",
                    &root,
                    2,
                    &protected.review_id,
                    TrustState::Trusted,
                    sink.clone(),
                )
                .is_err()
        );

        let changed = prepare(&manager, "window-a", &root, 1, "tool", vec![]);
        write_executable(&root, "tool", "printf changed");
        assert!(
            manager
                .start(
                    "window-a",
                    &root,
                    1,
                    &changed.review_id,
                    TrustState::Trusted,
                    sink,
                )
                .is_err()
        );
    }

    #[test]
    fn direct_execution_preserves_literal_arguments_binary_output_and_sequence() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let marker = root.join("must-not-exist");
        write_executable(
            &root,
            "tool",
            "printf '%s' \"$1\"\nprintf '\\342\\202\\254\\000'",
        );
        let manager = TaskManager::default();
        let literal = format!("; touch {}", marker.display());
        let review = prepare(
            &manager,
            "window-a",
            &root,
            1,
            "tool",
            vec![literal.clone()],
        );
        let (sink, captured) = event_sink();
        manager
            .start(
                "window-a",
                &root,
                1,
                &review.review_id,
                TrustState::Trusted,
                sink,
            )
            .unwrap();
        let terminal = wait_for_terminal(&captured);
        assert!(matches!(
            terminal,
            TaskSessionEvent::Status {
                status: TaskStatus::Succeeded,
                exit_code: Some(0),
                ..
            }
        ));
        assert!(
            !marker.exists(),
            "arguments must never be interpreted by a shell"
        );

        let captured = captured_events(&captured);
        let sequences: Vec<u64> = captured
            .iter()
            .map(|event| match event {
                TaskSessionEvent::Output { sequence, .. }
                | TaskSessionEvent::Truncated { sequence, .. }
                | TaskSessionEvent::Status { sequence, .. } => *sequence,
            })
            .collect();
        assert_eq!(sequences, (1..=sequences.len() as u64).collect::<Vec<_>>());
        let output: Vec<u8> = captured
            .iter()
            .filter_map(|event| match event {
                TaskSessionEvent::Output { data_base64, .. } => Some(
                    base64::engine::general_purpose::STANDARD
                        .decode(data_base64)
                        .unwrap(),
                ),
                _ => None,
            })
            .flatten()
            .collect();
        assert!(output.starts_with(literal.as_bytes()));
        assert!(output.ends_with(&[0xe2, 0x82, 0xac, 0]));
    }

    #[test]
    fn reports_nonzero_exit_and_bounded_output_truncation() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        write_executable(
            &root,
            "tool",
            "dd if=/dev/zero bs=1048576 count=3 2>/dev/null\nexit 7",
        );
        let manager = TaskManager::default();
        let review = prepare(&manager, "window-a", &root, 1, "tool", vec![]);
        let (sink, captured) = event_sink();
        manager
            .start(
                "window-a",
                &root,
                1,
                &review.review_id,
                TrustState::Trusted,
                sink,
            )
            .unwrap();
        assert!(matches!(
            wait_for_terminal(&captured),
            TaskSessionEvent::Status {
                status: TaskStatus::Failed,
                exit_code: Some(7),
                ..
            }
        ));
        let captured = captured_events(&captured);
        let delivered: usize = captured
            .iter()
            .filter_map(|event| match event {
                TaskSessionEvent::Output { data_base64, .. } => Some(
                    base64::engine::general_purpose::STANDARD
                        .decode(data_base64)
                        .unwrap()
                        .len(),
                ),
                _ => None,
            })
            .sum();
        let omitted: u64 = captured
            .iter()
            .filter_map(|event| match event {
                TaskSessionEvent::Truncated { omitted_bytes, .. } => Some(*omitted_bytes),
                _ => None,
            })
            .sum();
        assert_eq!(delivered, MAX_OUTPUT_BYTES);
        assert_eq!(delivered as u64 + omitted, 3 * 1024 * 1024);
    }

    #[test]
    fn cancellation_and_owner_cleanup_reach_cancelled_terminal_state() {
        let directory = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        write_executable(&root, "tool", "sleep 30 &\necho $!\nwait");
        let manager = TaskManager::default();
        let review = prepare(&manager, "window-a", &root, 1, "tool", vec![]);
        let (sink, captured) = event_sink();
        manager
            .start(
                "window-a",
                &root,
                1,
                &review.review_id,
                TrustState::Trusted,
                sink,
            )
            .unwrap();
        let child_pid: i32 = String::from_utf8(wait_for_stdout(&captured))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let cancel_started = Instant::now();
        manager.cancel_owner("window-a");
        assert!(matches!(
            wait_for_terminal(&captured),
            TaskSessionEvent::Status {
                status: TaskStatus::Cancelled,
                ..
            }
        ));
        assert!(
            cancel_started.elapsed() < Duration::from_secs(2),
            "task cancellation exceeded the local two-second acceptance budget"
        );
        for _ in 0..100 {
            if unsafe { libc::kill(child_pid, 0) } == -1 {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(
            unsafe { libc::kill(child_pid, 0) },
            -1,
            "cancellation must terminate the spawned process tree"
        );

        let stale = prepare(&manager, "window-a", &root, 2, "tool", vec![]);
        manager.cancel_owner("window-a");
        let (sink, _) = event_sink();
        assert!(
            manager
                .start(
                    "window-a",
                    &root,
                    2,
                    &stale.review_id,
                    TrustState::Trusted,
                    sink,
                )
                .is_err()
        );
    }
}
