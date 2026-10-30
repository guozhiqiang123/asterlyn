use super::{Allowed, ProgressSink, SealedArtifact};
use asterlyn_plugin_models::{
    MAX_ARTIFACT_BYTES, MAX_JOB_DURATION, MAX_RETAINED_BYTES, WorkTicket,
};
use asterlyn_process::{configure_process_group, signal_process_tree, terminate_process_tree};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
pub struct Progress {
    pub stage: String,
    pub count: Option<u64>,
    pub duration_ms: Option<u64>,
    pub cause_class: Option<String>,
    pub error_code: Option<String>,
    pub cause_chain: Option<String>,
    pub source_file: Option<String>,
    pub source_line: Option<u64>,
}
/// Created by the native admission boundary. Not deserializable from a plugin/frontend.
pub struct AdmittedProgram {
    node: PathBuf,
    entry: PathBuf,
    cwd: PathBuf,
    environment: BTreeMap<OsString, OsString>,
    input: Vec<u8>,
    launch_guard: Option<Arc<dyn Fn() -> Result<(), String> + Send + Sync>>,
}
impl AdmittedProgram {
    pub fn new(
        node: &Path,
        package_root: &Path,
        entry: &str,
        workspace: &Path,
        environment: BTreeMap<OsString, OsString>,
        input: Vec<u8>,
    ) -> Result<Self, String> {
        if Path::new(entry).is_absolute()
            || entry.split('/').any(|part| part == ".." || part == ".")
        {
            return Err("analysis entry must be relative".into());
        }
        if environment.len() > 32
            || environment
                .iter()
                .map(|(key, value)| key.len() + value.len())
                .sum::<usize>()
                > 65536
        {
            return Err("analysis environment exceeds its bound".into());
        }
        if input.len() > 64 * 1024 || serde_json::from_slice::<serde_json::Value>(&input).is_err() {
            return Err("analysis input exceeds its bound or is not JSON".into());
        }
        let node = node
            .canonicalize()
            .map_err(|_| "analysis runtime unavailable")?;
        let package = package_root
            .canonicalize()
            .map_err(|_| "analysis package unavailable")?;
        let cwd = workspace
            .canonicalize()
            .map_err(|_| "analysis workspace unavailable")?;
        let candidate = package.join(entry);
        let entry = candidate
            .canonicalize()
            .map_err(|_| "analysis entry unavailable")?;
        if !node.is_file()
            || node.starts_with(&cwd)
            || !entry.is_file()
            || !entry.starts_with(&package)
            || entry != candidate
            || !entry.to_string_lossy().ends_with(".mjs")
        {
            return Err("analysis program identity is invalid".into());
        }
        if environment.keys().any(|key| {
            matches!(
                key.to_str(),
                Some(
                    "NODE_OPTIONS"
                        | "NODE_PATH"
                        | "JAVA_TOOL_OPTIONS"
                        | "_JAVA_OPTIONS"
                        | "JDK_JAVA_OPTIONS"
                )
            )
        }) {
            return Err("analysis environment contains an unapproved runtime override".into());
        }
        Ok(Self {
            node,
            entry,
            cwd,
            environment,
            input,
            launch_guard: None,
        })
    }
    pub fn with_launch_guard(
        mut self,
        guard: Arc<dyn Fn() -> Result<(), String> + Send + Sync>,
    ) -> Self {
        self.launch_guard = Some(guard);
        self
    }
}

pub(super) fn run(
    program: AdmittedProgram,
    cache: &Path,
    ticket: &WorkTicket,
    allowed: Allowed,
    progress: ProgressSink,
    budget: Arc<AtomicU64>,
    processes: Arc<Mutex<BTreeSet<u32>>>,
) -> Result<SealedArtifact, String> {
    if ticket.is_cancelled() || !allowed() {
        return Err("analysis authority was revoked".into());
    }
    if let Some(guard) = &program.launch_guard {
        guard()?;
    }
    let file = tempfile::NamedTempFile::new_in(cache).map_err(|_| "cannot stage model artifact")?;
    let mut command = Command::new(&program.node);
    command
        .env_clear()
        .envs(program.environment)
        .arg(&program.entry)
        .current_dir(&program.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "cannot start analysis program")?;
    let pid = child.id();
    struct Guard(u32, Arc<Mutex<BTreeSet<u32>>>);
    impl Drop for Guard {
        fn drop(&mut self) {
            terminate_process_tree(self.0);
            if let Ok(mut pids) = self.1.lock() {
                pids.remove(&self.0);
            }
        }
    }
    let _guard = Guard(pid, processes.clone());
    processes
        .lock()
        .map_err(|_| "analysis process registry unavailable")?
        .insert(pid);

    let mut stdin = child.stdin.take().ok_or("analysis input unavailable")?;
    std::thread::spawn(move || {
        let _ = stdin.write_all(&program.input);
    });
    let stdout = child.stdout.take().ok_or("analysis output unavailable")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("analysis diagnostics unavailable")?;
    let fatal = Arc::new(AtomicBool::new(false));
    let output_failed = fatal.clone();
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = collect(stdout, file, budget);
        if result.is_err() {
            output_failed.store(true, Ordering::SeqCst);
        }
        let _ = tx.send(result);
    });
    std::thread::spawn(move || drain_progress(stderr, progress));
    let deadline = Instant::now() + MAX_JOB_DURATION;
    let mut cancelled = false;
    let mut stop_deadline = None;
    let status = loop {
        if (!allowed()
            || ticket.is_cancelled()
            || fatal.load(Ordering::SeqCst)
            || Instant::now() >= deadline)
            && stop_deadline.is_none()
        {
            cancelled = true;
            signal_process_tree(pid, false);
            stop_deadline = Some(Instant::now() + Duration::from_secs(10));
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(_) => {
                terminate_process_tree(pid);
                let _ = child.wait();
                return Err("analysis process could not be observed".into());
            }
        }
        if stop_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            terminate_process_tree(pid);
            let _ = child.wait();
            return Err("analysis work cancelled or timed out".into());
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    terminate_process_tree(pid);
    if cancelled || !status.success() {
        return Err("analysis program failed, was cancelled or exceeded a bound".into());
    }
    let artifact = rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "analysis output did not close")??;
    artifact.verify()?;
    let value: serde_json::Value = serde_json::from_reader(
        File::open(artifact.path()).map_err(|_| "model artifact unavailable")?,
    )
    .map_err(|_| "analysis program did not return bounded JSON")?;
    if !value.is_object() {
        return Err("model artifact must be a JSON object".into());
    }
    Ok(artifact)
}
fn collect(
    mut source: impl Read,
    mut file: tempfile::NamedTempFile,
    budget: Arc<AtomicU64>,
) -> Result<SealedArtifact, String> {
    let mut reservation = Reservation { budget, bytes: 0 };
    let mut bytes = 0u64;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|_| "model output failed")?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > MAX_ARTIFACT_BYTES {
            return Err("model output exceeds its bound".into());
        }
        reservation.add(count as u64)?;
        file.write_all(&buffer[..count])
            .map_err(|_| "model staging failed")?;
        hash.update(&buffer[..count]);
    }
    if bytes == 0 {
        return Err("model artifact is empty".into());
    }
    file.flush().map_err(|_| "model staging failed")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "model staging failed")?;
    let mut permissions = file
        .as_file()
        .metadata()
        .map_err(|_| "model staging failed")?
        .permissions();
    permissions.set_readonly(true);
    file.as_file()
        .set_permissions(permissions)
        .map_err(|_| "cannot seal model artifact")?;
    Ok(SealedArtifact {
        file,
        digest: format!("sha256:{:x}", hash.finalize()),
        bytes,
        _reservation: reservation,
    })
}
pub(super) fn verify_artifact(artifact: &SealedArtifact) -> Result<(), String> {
    let metadata =
        std::fs::symlink_metadata(artifact.path()).map_err(|_| "model artifact unavailable")?;
    if !metadata.is_file() || metadata.len() != artifact.bytes || !metadata.permissions().readonly()
    {
        return Err("model artifact changed".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(artifact.path())
        .map_err(|_| "model artifact unavailable")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let original = artifact
            .file
            .as_file()
            .metadata()
            .map_err(|_| "model artifact unavailable")?;
        let current = file.metadata().map_err(|_| "model artifact unavailable")?;
        if original.ino() != current.ino()
            || original.dev() != current.dev()
            || current.nlink() != 1
        {
            return Err("model artifact identity changed".into());
        }
    }
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "model artifact unavailable")?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > MAX_ARTIFACT_BYTES {
            return Err("model artifact exceeds its bound".into());
        }
        hash.update(&buffer[..count]);
    }
    if bytes != artifact.bytes || format!("sha256:{:x}", hash.finalize()) != artifact.digest {
        return Err("model artifact digest changed".into());
    }
    Ok(())
}
fn drain_progress(mut stderr: impl Read, sink: ProgressSink) {
    let mut last = Instant::now() - Duration::from_secs(1);
    let mut terminal_seen = false;
    let mut chunk = [0u8; 4096];
    let mut line = Vec::new();
    let mut overflow = false;
    loop {
        let Ok(count) = stderr.read(&mut chunk) else {
            return;
        };
        if count == 0 {
            return;
        }
        for byte in &chunk[..count] {
            if *byte == b'\n' {
                if !overflow
                    && let Ok(value) = serde_json::from_slice::<serde_json::Value>(&line)
                    && let Some(stage) = value.get("stage").and_then(|v| v.as_str()).filter(|v| {
                        !v.is_empty()
                            && v.len() <= 64
                            && v.bytes().all(|b| {
                                b.is_ascii_lowercase()
                                    || b.is_ascii_digit()
                                    || matches!(b, b'.' | b'-')
                            })
                    })
                    && (last.elapsed() >= Duration::from_millis(100)
                        || (stage == "error" && !terminal_seen))
                {
                    terminal_seen |= stage == "error";
                    last = Instant::now();
                    let event = Progress {
                        stage: stage.into(),
                        count: value.get("count").and_then(|v| v.as_u64()),
                        duration_ms: value.get("durationMs").and_then(|v| v.as_u64()),
                        cause_class: value
                            .get("causeClass")
                            .and_then(|v| v.as_str())
                            .filter(|name| {
                                name.len() <= 160
                                    && name.bytes().all(|b| {
                                        b.is_ascii_alphanumeric() || matches!(b, b'.' | b'$' | b'_')
                                    })
                            })
                            .map(str::to_owned),
                        error_code: value
                            .get("errorCode")
                            .and_then(|v| v.as_str())
                            .filter(|name| {
                                !name.is_empty()
                                    && name.len() <= 80
                                    && name.bytes().all(|b| {
                                        b.is_ascii_lowercase()
                                            || b.is_ascii_digit()
                                            || matches!(b, b'.' | b'-')
                                    })
                            })
                            .map(str::to_owned),
                        cause_chain: value
                            .get("causeChain")
                            .and_then(|v| v.as_str())
                            .filter(|name| {
                                name.len() <= 160
                                    && name.bytes().all(|b| {
                                        b.is_ascii_alphanumeric()
                                            || matches!(b, b'.' | b'$' | b'_' | b'>')
                                    })
                            })
                            .map(str::to_owned),
                        source_file: value
                            .get("sourceFile")
                            .and_then(|v| v.as_str())
                            .filter(|name| {
                                !name.is_empty()
                                    && name.len() <= 96
                                    && !name.contains("..")
                                    && name.bytes().all(|b| {
                                        b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')
                                    })
                            })
                            .map(str::to_owned),
                        source_line: value
                            .get("sourceLine")
                            .and_then(|v| v.as_u64())
                            .filter(|n| *n > 0 && *n <= 1_000_000),
                    };
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sink(event)));
                }
                line.clear();
                overflow = false;
            } else if line.len() < 512 {
                line.push(*byte)
            } else {
                overflow = true
            }
        }
    }
}

// Counts pending and sealed files together; stale references still retaining a file keep its charge.
pub(super) struct Reservation {
    budget: Arc<AtomicU64>,
    bytes: u64,
}
impl Reservation {
    fn add(&mut self, bytes: u64) -> Result<(), String> {
        self.budget
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                current
                    .checked_add(bytes)
                    .filter(|next| *next <= MAX_RETAINED_BYTES)
            })
            .map_err(|_| "model artifact cache exceeds its aggregate bound")?;
        self.bytes += bytes;
        Ok(())
    }
}
impl Drop for Reservation {
    fn drop(&mut self) {
        self.budget.fetch_sub(self.bytes, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod progress_tests {
    use super::*;
    #[test]
    fn bounded_diagnostics_keep_terminal_failures_and_discard_raw_paths_and_messages() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let input = concat!(
            "{\"stage\":\"model\"}\n",
            "{\"stage\":\"error\",\"errorCode\":\"project-configuration-failed\",\"causeClass\":\"org.gradle.GradleException\",\"causeChain\":\"org.gradle.BuildFailure>org.gradle.GradleException\",\"sourceFile\":\"build.gradle\",\"sourceLine\":18,\"message\":\"secret\"}\n"
        );
        drain_progress(
            input.as_bytes(),
            Arc::new(move |event| captured.lock().unwrap().push(event)),
        );
        let values = events.lock().unwrap();
        assert_eq!(values.len(), 2);
        assert_eq!(
            values[1].error_code.as_deref(),
            Some("project-configuration-failed")
        );
        assert_eq!(values[1].source_line, Some(18));
        assert!(!format!("{:?}", *values).contains("secret"));
        drop(values);
        let captured = events.clone();
        drain_progress(b"{\"stage\":\"error\",\"causeChain\":\"password=secret\",\"sourceFile\":\"/private/build.gradle\",\"sourceLine\":0,\"errorCode\":\"bad code secret\"}\n".as_slice(),Arc::new(move|event|captured.lock().unwrap().push(event)));
        let values = events.lock().unwrap();
        let last = values.last().unwrap();
        assert!(
            last.cause_chain.is_none()
                && last.source_file.is_none()
                && last.source_line.is_none()
                && last.error_code.is_none()
        );
    }
}
