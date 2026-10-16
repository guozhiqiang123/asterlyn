use asterlyn_task::encode_output;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const PROTOCOL_VERSION: u8 = 1;
const MAX_RUNNING_PER_OWNER: usize = 4;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_PROPERTIES_BYTES: u64 = 64 * 1024;
const ADB_QUERY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PluginProcessQueryStatus {
    Succeeded,
    Failed,
    Unavailable,
    TimedOut,
    Cancelled,
    Crashed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginProcessQueryResult {
    pub(crate) protocol_version: u8,
    pub(crate) plugin_id: String,
    pub(crate) query_id: String,
    pub(crate) status: PluginProcessQueryStatus,
    pub(crate) stdout_base64: String,
    pub(crate) stderr_base64: String,
    pub(crate) truncated: bool,
    pub(crate) exit_code: Option<i32>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone)]
struct AdmittedQuery {
    args: &'static [&'static str],
    timeout: Duration,
    executable: ExecutableResolver,
}

#[derive(Debug, Clone, Copy)]
enum ExecutableResolver {
    AndroidAdb,
}

struct RunningQuery {
    owner: String,
    child: Arc<Mutex<Option<Child>>>,
    pid: u32,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default, Clone)]
pub(crate) struct PluginProcessQueryManager {
    inner: Arc<PluginProcessQueryManagerInner>,
}

#[derive(Default)]
struct PluginProcessQueryManagerInner {
    sequence: std::sync::atomic::AtomicU64,
    running: Mutex<HashMap<String, RunningQuery>>,
}

impl PluginProcessQueryManager {
    pub(crate) fn execute(
        &self,
        owner: &str,
        root: &Path,
        plugin_id: &str,
        query_id: &str,
    ) -> PluginProcessQueryResult {
        let Some(query) = admitted_query(plugin_id, query_id) else {
            return result(
                plugin_id,
                query_id,
                PluginProcessQueryStatus::Unavailable,
                None,
                false,
                Vec::new(),
                Vec::new(),
                Some("process query is not admitted by the bundled plugin catalog".into()),
            );
        };
        let executable = match resolve_executable(root, query.executable) {
            Ok(value) => value,
            Err(error) => {
                return result(
                    plugin_id,
                    query_id,
                    PluginProcessQueryStatus::Unavailable,
                    None,
                    false,
                    Vec::new(),
                    Vec::new(),
                    Some(error),
                );
            }
        };
        self.execute_resolved(owner, root, plugin_id, query_id, &executable, &query)
    }

    fn execute_resolved(
        &self,
        owner: &str,
        root: &Path,
        plugin_id: &str,
        query_id: &str,
        executable: &Path,
        query: &AdmittedQuery,
    ) -> PluginProcessQueryResult {
        let key = format!(
            "query-{}",
            self.inner
                .sequence
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                + 1
        );
        let child = match spawn_query(executable, root, query.args) {
            Ok(value) => value,
            Err(error) => {
                return result(
                    plugin_id,
                    query_id,
                    PluginProcessQueryStatus::Crashed,
                    None,
                    false,
                    Vec::new(),
                    Vec::new(),
                    Some(error),
                );
            }
        };
        let pid = child.id();
        let child = Arc::new(Mutex::new(Some(child)));
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut running = match self.inner.running.lock() {
                Ok(value) => value,
                Err(_) => {
                    terminate(pid, &child);
                    return result(
                        plugin_id,
                        query_id,
                        PluginProcessQueryStatus::Crashed,
                        None,
                        false,
                        Vec::new(),
                        Vec::new(),
                        Some("process query registry lock was poisoned".into()),
                    );
                }
            };
            if running
                .values()
                .filter(|value| value.owner == owner)
                .count()
                >= MAX_RUNNING_PER_OWNER
            {
                terminate(pid, &child);
                return result(
                    plugin_id,
                    query_id,
                    PluginProcessQueryStatus::Failed,
                    None,
                    false,
                    Vec::new(),
                    Vec::new(),
                    Some("too many process queries are active for this window".into()),
                );
            }
            running.insert(
                key.clone(),
                RunningQuery {
                    owner: owner.to_string(),
                    child: child.clone(),
                    pid,
                    cancelled: cancelled.clone(),
                },
            );
        }

        let collected = collect_query(child, cancelled, query.timeout);
        if let Ok(mut running) = self.inner.running.lock() {
            running.remove(&key);
        }
        match collected {
            Ok(output) => result(
                plugin_id,
                query_id,
                output.status,
                output.exit_code,
                output.truncated,
                output.stdout,
                output.stderr,
                output.error,
            ),
            Err(error) => result(
                plugin_id,
                query_id,
                PluginProcessQueryStatus::Crashed,
                None,
                false,
                Vec::new(),
                Vec::new(),
                Some(error),
            ),
        }
    }

    pub(crate) fn cancel_owner(&self, owner: &str) {
        self.cancel_matching(|value| value.owner == owner);
    }

    pub(crate) fn cancel_all(&self) {
        self.cancel_matching(|_| true);
    }

    fn cancel_matching(&self, predicate: impl Fn(&RunningQuery) -> bool) {
        let Ok(running) = self.inner.running.lock() else {
            return;
        };
        for value in running.values().filter(|value| predicate(value)) {
            value.cancelled.store(true, Ordering::Relaxed);
            terminate(value.pid, &value.child);
        }
    }

    #[cfg(test)]
    fn running_count(&self) -> usize {
        self.inner
            .running
            .lock()
            .map(|value| value.len())
            .unwrap_or(0)
    }
}

impl Drop for PluginProcessQueryManager {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            self.cancel_all();
        }
    }
}

fn admitted_query(plugin_id: &str, query_id: &str) -> Option<AdmittedQuery> {
    match (plugin_id, query_id) {
        ("dev.asterlyn.android-gradle", "adb.devices") => Some(AdmittedQuery {
            args: &["devices", "-l"],
            timeout: ADB_QUERY_TIMEOUT,
            executable: ExecutableResolver::AndroidAdb,
        }),
        _ => None,
    }
}

fn resolve_executable(root: &Path, resolver: ExecutableResolver) -> Result<PathBuf, String> {
    match resolver {
        ExecutableResolver::AndroidAdb => resolve_android_adb(root),
    }
}

fn resolve_android_adb(root: &Path) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "adb.exe" } else { "adb" };
    let mut candidates = Vec::new();
    if let Some(sdk) = workspace_android_sdk(root) {
        candidates.push(sdk.join("platform-tools").join(name));
    }
    for variable in ["ANDROID_SDK_ROOT", "ANDROID_HOME"] {
        if let Some(value) = std::env::var_os(variable) {
            candidates.push(PathBuf::from(value).join("platform-tools").join(name));
        }
    }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        if cfg!(target_os = "macos") {
            candidates.push(home.join("Library/Android/sdk/platform-tools").join(name));
        } else if cfg!(windows) {
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                candidates.push(
                    PathBuf::from(local)
                        .join("Android/Sdk/platform-tools")
                        .join(name),
                );
            }
        } else {
            candidates.push(home.join("Android/Sdk/platform-tools").join(name));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|entry| entry.join(name)));
    }
    for candidate in candidates {
        let Ok(canonical) = std::fs::canonicalize(candidate) else {
            continue;
        };
        if canonical.is_file() && executable_file(&canonical) {
            return Ok(canonical);
        }
    }
    Err("Android Debug Bridge was not found. Configure sdk.dir, ANDROID_SDK_ROOT, ANDROID_HOME, or PATH.".into())
}

fn workspace_android_sdk(root: &Path) -> Option<PathBuf> {
    let file = std::fs::File::open(root.join("local.properties")).ok()?;
    if file.metadata().ok()?.len() > MAX_PROPERTIES_BYTES {
        return None;
    }
    let mut text = String::new();
    file.take(MAX_PROPERTIES_BYTES + 1)
        .read_to_string(&mut text)
        .ok()?;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
            continue;
        }
        let Some((key, value)) = line.split_once('=').or_else(|| line.split_once(':')) else {
            continue;
        };
        if key.trim() != "sdk.dir" {
            continue;
        }
        let value = value.trim().replace("\\:", ":").replace("\\\\", "\\");
        if value.is_empty() || value.contains('\0') {
            return None;
        }
        return Some(PathBuf::from(value));
    }
    None
}

#[cfg(unix)]
fn executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn executable_file(_path: &Path) -> bool {
    true
}

fn spawn_query(executable: &Path, root: &Path, args: &[&str]) -> Result<Child, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    for name in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "LOCALAPPDATA",
        "SystemRoot",
        "TEMP",
        "TMP",
        "ANDROID_HOME",
        "ANDROID_SDK_ROOT",
        "ADB_VENDOR_KEYS",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .spawn()
        .map_err(|error| format!("start admitted process query: {error}"))
}

struct CollectedOutput {
    status: PluginProcessQueryStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    truncated: bool,
    exit_code: Option<i32>,
    error: Option<String>,
}

fn collect_query(
    child: Arc<Mutex<Option<Child>>>,
    cancelled: Arc<AtomicBool>,
    timeout: Duration,
) -> Result<CollectedOutput, String> {
    let (stdout, stderr) = {
        let mut guard = child.lock().map_err(lock_error)?;
        let value = guard
            .as_mut()
            .ok_or_else(|| "process query disappeared".to_string())?;
        (value.stdout.take(), value.stderr.take())
    };
    let remaining = Arc::new(AtomicUsize::new(MAX_OUTPUT_BYTES));
    let truncated = Arc::new(AtomicBool::new(false));
    let stdout_handle = stdout.map(|pipe| {
        let remaining = remaining.clone();
        let truncated = truncated.clone();
        std::thread::spawn(move || read_bounded(pipe, remaining, truncated))
    });
    let stderr_handle = stderr.map(|pipe| {
        let remaining = remaining.clone();
        let truncated = truncated.clone();
        std::thread::spawn(move || read_bounded(pipe, remaining, truncated))
    });
    let started = Instant::now();
    let (status, error) = loop {
        let mut guard = child.lock().map_err(lock_error)?;
        let value = guard
            .as_mut()
            .ok_or_else(|| "process query disappeared".to_string())?;
        if let Some(exit) = value
            .try_wait()
            .map_err(|error| format!("wait for process query: {error}"))?
        {
            break (Some(exit), None);
        }
        if cancelled.load(Ordering::Relaxed) {
            let pid = value.id();
            drop(guard);
            terminate(pid, &child);
            break (None, Some(PluginProcessQueryStatus::Cancelled));
        }
        if started.elapsed() >= timeout {
            let pid = value.id();
            drop(guard);
            terminate(pid, &child);
            break (None, Some(PluginProcessQueryStatus::TimedOut));
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(25));
    };
    if status.is_none() {
        if let Ok(mut guard) = child.lock()
            && let Some(value) = guard.as_mut()
        {
            let _ = value.wait();
        }
    }
    let stdout = join_output(stdout_handle)?;
    let stderr = join_output(stderr_handle)?;
    let was_truncated = truncated.load(Ordering::Relaxed);
    if let Some(status) = error {
        return Ok(CollectedOutput {
            status,
            stdout,
            stderr,
            truncated: was_truncated,
            exit_code: None,
            error: None,
        });
    }
    let exit = status.expect("completed process query has an exit status");
    Ok(CollectedOutput {
        status: if exit.success() {
            PluginProcessQueryStatus::Succeeded
        } else {
            PluginProcessQueryStatus::Failed
        },
        stdout,
        stderr,
        truncated: was_truncated,
        exit_code: exit.code(),
        error: None,
    })
}

fn read_bounded(
    mut pipe: impl Read,
    remaining: Arc<AtomicUsize>,
    truncated: Arc<AtomicBool>,
) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        let read = pipe
            .read(&mut chunk)
            .map_err(|error| format!("read process query output: {error}"))?;
        if read == 0 {
            break;
        }
        let allowed = remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                Some(value.saturating_sub(read))
            })
            .unwrap_or(0)
            .min(read);
        output.extend_from_slice(&chunk[..allowed]);
        if allowed < read {
            truncated.store(true, Ordering::Relaxed);
        }
    }
    Ok(output)
}

fn join_output(
    handle: Option<std::thread::JoinHandle<Result<Vec<u8>, String>>>,
) -> Result<Vec<u8>, String> {
    handle
        .map(|value| {
            value
                .join()
                .map_err(|_| "process query output collector panicked".to_string())?
        })
        .unwrap_or_else(|| Ok(Vec::new()))
}

fn terminate(pid: u32, child: &Arc<Mutex<Option<Child>>>) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let taskkill = PathBuf::from(system_root).join("System32/taskkill.exe");
        let _ = Command::new(taskkill)
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    if let Ok(mut guard) = child.lock()
        && let Some(value) = guard.as_mut()
    {
        let _ = value.kill();
    }
}

fn result(
    plugin_id: &str,
    query_id: &str,
    status: PluginProcessQueryStatus,
    exit_code: Option<i32>,
    truncated: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    error: Option<String>,
) -> PluginProcessQueryResult {
    PluginProcessQueryResult {
        protocol_version: PROTOCOL_VERSION,
        plugin_id: plugin_id.to_string(),
        query_id: query_id.to_string(),
        status,
        stdout_base64: encode_output(&stdout),
        stderr_base64: encode_output(&stderr),
        truncated,
        exit_code,
        error,
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "process query lock was poisoned".into()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    fn executable(root: &Path, name: &str, body: &str) -> PathBuf {
        let path = root.join(name);
        fs::write(&path, format!("#!/bin/sh\nset -eu\n{body}\n")).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[test]
    fn rejects_queries_outside_the_bundled_catalog() {
        assert!(admitted_query("dev.asterlyn.android-gradle", "adb.devices").is_some());
        assert!(admitted_query("dev.asterlyn.android-gradle", "adb.shell").is_none());
        assert!(admitted_query("unknown", "adb.devices").is_none());
    }

    #[test]
    fn bounded_query_captures_output_and_releases_registry() {
        let directory = tempfile::tempdir().unwrap();
        let tool = executable(directory.path(), "tool", "printf 'device-list\\n'");
        let manager = PluginProcessQueryManager::default();
        let query = AdmittedQuery {
            args: &[],
            timeout: Duration::from_secs(1),
            executable: ExecutableResolver::AndroidAdb,
        };
        let output = manager.execute_resolved(
            "window-a",
            directory.path(),
            "plugin",
            "query",
            &tool,
            &query,
        );
        assert_eq!(output.status, PluginProcessQueryStatus::Succeeded);
        assert_eq!(output.stdout_base64, encode_output(b"device-list\n"));
        assert_eq!(manager.running_count(), 0);
    }

    #[test]
    fn timeout_terminates_child_and_releases_registry() {
        let directory = tempfile::tempdir().unwrap();
        let tool = executable(directory.path(), "tool", "sleep 5");
        let manager = PluginProcessQueryManager::default();
        let query = AdmittedQuery {
            args: &[],
            timeout: Duration::from_millis(50),
            executable: ExecutableResolver::AndroidAdb,
        };
        let output = manager.execute_resolved(
            "window-a",
            directory.path(),
            "plugin",
            "query",
            &tool,
            &query,
        );
        assert_eq!(output.status, PluginProcessQueryStatus::TimedOut);
        assert_eq!(manager.running_count(), 0);
    }

    #[test]
    fn workspace_sdk_property_resolves_adb() {
        let directory = tempfile::tempdir().unwrap();
        let sdk = directory.path().join("sdk");
        fs::create_dir_all(sdk.join("platform-tools")).unwrap();
        let adb = executable(&sdk.join("platform-tools"), "adb", "exit 0");
        fs::write(
            directory.path().join("local.properties"),
            format!("sdk.dir={}\n", sdk.display()),
        )
        .unwrap();
        assert_eq!(
            resolve_android_adb(directory.path()).unwrap(),
            fs::canonicalize(adb).unwrap()
        );
    }
}
