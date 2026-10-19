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
const TOOL_OPERATION_TIMEOUT: Duration = Duration::from_secs(15);
const ANDROID_INSTALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_REQUEST_ID_LENGTH: usize = 256;

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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginToolOperationResult {
    pub(crate) protocol_version: u8,
    pub(crate) plugin_id: String,
    pub(crate) request_id: String,
    pub(crate) operation_id: String,
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

#[derive(Debug, Clone)]
struct AdmittedToolOperation {
    args: &'static [ToolOperationArgument],
    parameters: &'static [ToolOperationParameter],
    timeout: Duration,
    max_output_bytes: usize,
    executable: ExecutableResolver,
}

#[derive(Debug, Clone, Copy)]
enum ToolOperationArgument {
    Literal(&'static str),
    Parameter(&'static str),
}

#[derive(Debug, Clone, Copy)]
struct ToolOperationParameter {
    name: &'static str,
    kind: ToolOperationParameterKind,
}

#[derive(Debug, Clone, Copy)]
enum ToolOperationParameterKind {
    ExecutionTargetId,
    AndroidApplicationId,
    AndroidComponent,
    WorkspaceApk,
}

impl AdmittedToolOperation {
    fn resolve_arguments(
        &self,
        root: &Path,
        values: &HashMap<String, String>,
    ) -> Result<Vec<String>, String> {
        if values.len() != self.parameters.len() {
            return Err("tool-operation parameters do not match the admitted declaration".into());
        }
        let mut resolved = HashMap::new();
        for parameter in self.parameters {
            let value = values
                .get(parameter.name)
                .ok_or_else(|| format!("missing tool-operation parameter: {}", parameter.name))?;
            let value = validate_tool_parameter(root, parameter.kind, value)?;
            resolved.insert(parameter.name, value);
        }
        self.args
            .iter()
            .map(|argument| match argument {
                ToolOperationArgument::Literal(value) => Ok((*value).to_string()),
                ToolOperationArgument::Parameter(name) => resolved
                    .get(name)
                    .cloned()
                    .ok_or_else(|| format!("unresolved tool-operation parameter: {name}")),
            })
            .collect()
    }
}

#[derive(Debug, Clone, Copy)]
enum ExecutableResolver {
    AndroidAdb,
    AndroidAapt,
}

struct RunningQuery {
    owner: String,
    plugin_id: String,
    request_id: Option<String>,
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
                CollectedOutput::with_error(
                    PluginProcessQueryStatus::Unavailable,
                    "process query is not admitted by the bundled plugin catalog",
                ),
            );
        };
        let executable = match resolve_executable(root, query.executable) {
            Ok(value) => value,
            Err(error) => {
                return result(
                    plugin_id,
                    query_id,
                    CollectedOutput::with_error(PluginProcessQueryStatus::Unavailable, error),
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
                    CollectedOutput::with_error(PluginProcessQueryStatus::Crashed, error),
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
                        CollectedOutput::with_error(
                            PluginProcessQueryStatus::Crashed,
                            "process query registry lock was poisoned",
                        ),
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
                    CollectedOutput::with_error(
                        PluginProcessQueryStatus::Failed,
                        "too many process queries are active for this window",
                    ),
                );
            }
            running.insert(
                key.clone(),
                RunningQuery {
                    owner: owner.to_string(),
                    plugin_id: plugin_id.to_string(),
                    request_id: None,
                    child: child.clone(),
                    pid,
                    cancelled: cancelled.clone(),
                },
            );
        }

        let collected = collect_query(child, cancelled, query.timeout, MAX_OUTPUT_BYTES);
        if let Ok(mut running) = self.inner.running.lock() {
            running.remove(&key);
        }
        match collected {
            Ok(output) => result(plugin_id, query_id, output),
            Err(error) => result(
                plugin_id,
                query_id,
                CollectedOutput::with_error(PluginProcessQueryStatus::Crashed, error),
            ),
        }
    }

    pub(crate) fn cancel_owner(&self, owner: &str) {
        self.cancel_matching(|value| value.owner == owner);
    }

    pub(crate) fn cancel_plugin(&self, plugin_id: &str) {
        self.cancel_matching(|value| value.plugin_id == plugin_id);
    }

    pub(crate) fn execute_tool_operation(
        &self,
        owner: &str,
        root: &Path,
        plugin_id: &str,
        request_id: &str,
        operation_id: &str,
        parameters: &HashMap<String, String>,
    ) -> PluginToolOperationResult {
        if !valid_request_id(request_id) {
            return tool_result(
                plugin_id,
                request_id,
                operation_id,
                CollectedOutput::with_error(
                    PluginProcessQueryStatus::Failed,
                    "invalid tool-operation request identity",
                ),
            );
        }
        let Some(operation) = admitted_tool_operation(plugin_id, operation_id) else {
            return tool_result(
                plugin_id,
                request_id,
                operation_id,
                CollectedOutput::with_error(
                    PluginProcessQueryStatus::Failed,
                    "tool operation is not admitted by the bundled plugin catalog",
                ),
            );
        };
        let args = match operation.resolve_arguments(root, parameters) {
            Ok(value) => value,
            Err(error) => {
                return tool_result(
                    plugin_id,
                    request_id,
                    operation_id,
                    CollectedOutput::with_error(PluginProcessQueryStatus::Failed, error),
                );
            }
        };
        let executable = match resolve_executable(root, operation.executable) {
            Ok(value) => value,
            Err(error) => {
                return tool_result(
                    plugin_id,
                    request_id,
                    operation_id,
                    CollectedOutput::with_error(PluginProcessQueryStatus::Failed, error),
                );
            }
        };
        let key = format!(
            "operation-{}",
            self.inner
                .sequence
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                + 1
        );
        let child = match spawn_process(&executable, root, &args) {
            Ok(value) => value,
            Err(error) => {
                return tool_result(
                    plugin_id,
                    request_id,
                    operation_id,
                    CollectedOutput::with_error(PluginProcessQueryStatus::Crashed, error),
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
                    return tool_result(
                        plugin_id,
                        request_id,
                        operation_id,
                        CollectedOutput::with_error(
                            PluginProcessQueryStatus::Crashed,
                            "tool-operation registry lock was poisoned",
                        ),
                    );
                }
            };
            if running.values().any(|value| {
                value.owner == owner && value.request_id.as_deref() == Some(request_id)
            }) {
                terminate(pid, &child);
                return tool_result(
                    plugin_id,
                    request_id,
                    operation_id,
                    CollectedOutput::with_error(
                        PluginProcessQueryStatus::Failed,
                        "tool-operation request is already active",
                    ),
                );
            }
            if running
                .values()
                .filter(|value| value.owner == owner)
                .count()
                >= MAX_RUNNING_PER_OWNER
            {
                terminate(pid, &child);
                return tool_result(
                    plugin_id,
                    request_id,
                    operation_id,
                    CollectedOutput::with_error(
                        PluginProcessQueryStatus::Failed,
                        "too many plugin tool operations are active for this window",
                    ),
                );
            }
            running.insert(
                key.clone(),
                RunningQuery {
                    owner: owner.to_string(),
                    plugin_id: plugin_id.to_string(),
                    request_id: Some(request_id.to_string()),
                    child: child.clone(),
                    pid,
                    cancelled: cancelled.clone(),
                },
            );
        }
        let collected = collect_query(
            child,
            cancelled,
            operation.timeout,
            operation.max_output_bytes,
        );
        if let Ok(mut running) = self.inner.running.lock() {
            running.remove(&key);
        }
        match collected {
            Ok(output) => tool_result(plugin_id, request_id, operation_id, output),
            Err(error) => tool_result(
                plugin_id,
                request_id,
                operation_id,
                CollectedOutput::with_error(PluginProcessQueryStatus::Crashed, error),
            ),
        }
    }

    pub(crate) fn cancel_request(&self, owner: &str, request_id: &str) {
        self.cancel_matching(|value| {
            value.owner == owner && value.request_id.as_deref() == Some(request_id)
        });
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

fn admitted_tool_operation(plugin_id: &str, operation_id: &str) -> Option<AdmittedToolOperation> {
    match (plugin_id, operation_id) {
        ("dev.asterlyn.android-gradle", "android.apk.inspect") => Some(AdmittedToolOperation {
            args: &[
                ToolOperationArgument::Literal("dump"),
                ToolOperationArgument::Literal("badging"),
                ToolOperationArgument::Parameter("artifact"),
            ],
            parameters: &[ToolOperationParameter {
                name: "artifact",
                kind: ToolOperationParameterKind::WorkspaceApk,
            }],
            timeout: TOOL_OPERATION_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executable: ExecutableResolver::AndroidAapt,
        }),
        ("dev.asterlyn.android-gradle", "android.adb.launch") => Some(AdmittedToolOperation {
            args: &[
                ToolOperationArgument::Literal("-s"),
                ToolOperationArgument::Parameter("target"),
                ToolOperationArgument::Literal("shell"),
                ToolOperationArgument::Literal("am"),
                ToolOperationArgument::Literal("start"),
                ToolOperationArgument::Literal("-n"),
                ToolOperationArgument::Parameter("component"),
            ],
            parameters: &[
                ToolOperationParameter {
                    name: "target",
                    kind: ToolOperationParameterKind::ExecutionTargetId,
                },
                ToolOperationParameter {
                    name: "component",
                    kind: ToolOperationParameterKind::AndroidComponent,
                },
            ],
            timeout: TOOL_OPERATION_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executable: ExecutableResolver::AndroidAdb,
        }),
        ("dev.asterlyn.android-gradle", "android.adb.install") => Some(AdmittedToolOperation {
            args: &[
                ToolOperationArgument::Literal("-s"),
                ToolOperationArgument::Parameter("target"),
                ToolOperationArgument::Literal("install"),
                ToolOperationArgument::Literal("-r"),
                ToolOperationArgument::Parameter("artifact"),
            ],
            parameters: &[
                ToolOperationParameter {
                    name: "target",
                    kind: ToolOperationParameterKind::ExecutionTargetId,
                },
                ToolOperationParameter {
                    name: "artifact",
                    kind: ToolOperationParameterKind::WorkspaceApk,
                },
            ],
            timeout: ANDROID_INSTALL_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executable: ExecutableResolver::AndroidAdb,
        }),
        ("dev.asterlyn.android-gradle", "android.adb.uninstall") => Some(AdmittedToolOperation {
            args: &[
                ToolOperationArgument::Literal("-s"),
                ToolOperationArgument::Parameter("target"),
                ToolOperationArgument::Literal("uninstall"),
                ToolOperationArgument::Parameter("application"),
            ],
            parameters: &[
                ToolOperationParameter {
                    name: "target",
                    kind: ToolOperationParameterKind::ExecutionTargetId,
                },
                ToolOperationParameter {
                    name: "application",
                    kind: ToolOperationParameterKind::AndroidApplicationId,
                },
            ],
            timeout: TOOL_OPERATION_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executable: ExecutableResolver::AndroidAdb,
        }),
        _ => None,
    }
}

fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_LENGTH
        && value.bytes().all(|value| {
            value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'-' | b':')
        })
}

fn validate_tool_parameter(
    root: &Path,
    kind: ToolOperationParameterKind,
    value: &str,
) -> Result<String, String> {
    if value.is_empty() || value.len() > 4_096 || value.contains('\0') {
        return Err("invalid tool-operation parameter value".into());
    }
    match kind {
        ToolOperationParameterKind::ExecutionTargetId => {
            if value.len() <= 512
                && value.bytes().all(|value| {
                    value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'-' | b':')
                })
            {
                Ok(value.to_string())
            } else {
                Err("invalid Android execution target".into())
            }
        }
        ToolOperationParameterKind::AndroidComponent => {
            let Some((package, activity)) = value.split_once('/') else {
                return Err("invalid Android launch component".into());
            };
            let activity = activity.strip_prefix('.').unwrap_or(activity);
            if valid_android_name(package) && valid_android_name(activity) {
                Ok(value.to_string())
            } else {
                Err("invalid Android launch component".into())
            }
        }
        ToolOperationParameterKind::AndroidApplicationId => {
            if valid_android_name(value) {
                Ok(value.to_string())
            } else {
                Err("invalid Android application ID".into())
            }
        }
        ToolOperationParameterKind::WorkspaceApk => {
            let relative = Path::new(value);
            if relative.is_absolute() {
                return Err("workspace artifact must use a relative path".into());
            }
            let canonical_root = std::fs::canonicalize(root)
                .map_err(|error| format!("resolve active workspace: {error}"))?;
            let canonical = std::fs::canonicalize(canonical_root.join(relative))
                .map_err(|error| format!("resolve workspace artifact: {error}"))?;
            if !canonical.starts_with(&canonical_root)
                || !canonical.is_file()
                || canonical.extension().and_then(|value| value.to_str()) != Some("apk")
            {
                return Err("workspace artifact is not an admitted APK".into());
            }
            Ok(canonical.to_string_lossy().into_owned())
        }
    }
}

fn valid_android_name(value: &str) -> bool {
    value.len() <= 512
        && value.split('.').all(|part| {
            !part.is_empty()
                && part.bytes().enumerate().all(|(index, value)| {
                    value.is_ascii_alphabetic()
                        || value == b'_'
                        || (index > 0 && (value.is_ascii_digit() || value == b'$'))
                })
        })
}

fn resolve_executable(root: &Path, resolver: ExecutableResolver) -> Result<PathBuf, String> {
    match resolver {
        ExecutableResolver::AndroidAdb => resolve_android_adb(root),
        ExecutableResolver::AndroidAapt => resolve_android_aapt(root),
    }
}

fn resolve_android_aapt(root: &Path) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "aapt.exe" } else { "aapt" };
    let mut candidates = Vec::new();
    for sdk in android_sdk_roots(root) {
        let build_tools = sdk.join("build-tools");
        let Ok(entries) = std::fs::read_dir(build_tools) else {
            continue;
        };
        let mut versions = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>();
        versions.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
        candidates.extend(versions.into_iter().map(|version| version.join(name)));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|entry| entry.join(name)));
    }
    first_executable(candidates).ok_or_else(|| {
        "Android Asset Packaging Tool was not found. Install Android SDK Build Tools or configure sdk.dir, ANDROID_SDK_ROOT, or ANDROID_HOME.".into()
    })
}

fn resolve_android_adb(root: &Path) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "adb.exe" } else { "adb" };
    let mut candidates = Vec::new();
    candidates.extend(
        android_sdk_roots(root)
            .into_iter()
            .map(|sdk| sdk.join("platform-tools").join(name)),
    );
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|entry| entry.join(name)));
    }
    first_executable(candidates).ok_or_else(|| "Android Debug Bridge was not found. Configure sdk.dir, ANDROID_SDK_ROOT, ANDROID_HOME, or PATH.".into())
}

fn first_executable(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    for candidate in candidates {
        let Ok(canonical) = std::fs::canonicalize(candidate) else {
            continue;
        };
        if canonical.is_file() && executable_file(&canonical) {
            return Some(canonical);
        }
    }
    None
}

fn android_sdk_roots(root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(sdk) = workspace_android_sdk(root) {
        candidates.push(sdk);
    }
    for variable in ["ANDROID_SDK_ROOT", "ANDROID_HOME"] {
        if let Some(value) = std::env::var_os(variable) {
            candidates.push(PathBuf::from(value));
        }
    }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        if cfg!(target_os = "macos") {
            candidates.push(home.join("Library/Android/sdk"));
        } else if cfg!(windows) {
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                candidates.push(PathBuf::from(local).join("Android/Sdk"));
            }
        } else {
            candidates.push(home.join("Android/Sdk"));
        }
    }
    candidates
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
    let args = args
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    spawn_process(executable, root, &args)
}

fn spawn_process(executable: &Path, root: &Path, args: &[String]) -> Result<Child, String> {
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

impl CollectedOutput {
    fn with_error(status: PluginProcessQueryStatus, error: impl Into<String>) -> Self {
        Self {
            status,
            stdout: Vec::new(),
            stderr: Vec::new(),
            truncated: false,
            exit_code: None,
            error: Some(error.into()),
        }
    }
}

fn collect_query(
    child: Arc<Mutex<Option<Child>>>,
    cancelled: Arc<AtomicBool>,
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<CollectedOutput, String> {
    let (stdout, stderr) = {
        let mut guard = child.lock().map_err(lock_error)?;
        let value = guard
            .as_mut()
            .ok_or_else(|| "process query disappeared".to_string())?;
        (value.stdout.take(), value.stderr.take())
    };
    let remaining = Arc::new(AtomicUsize::new(max_output_bytes));
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
    if status.is_none()
        && let Ok(mut guard) = child.lock()
        && let Some(value) = guard.as_mut()
    {
        let _ = value.wait();
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

fn result(plugin_id: &str, query_id: &str, output: CollectedOutput) -> PluginProcessQueryResult {
    let CollectedOutput {
        status,
        stdout,
        stderr,
        truncated,
        exit_code,
        error,
    } = output;
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

fn tool_result(
    plugin_id: &str,
    request_id: &str,
    operation_id: &str,
    output: CollectedOutput,
) -> PluginToolOperationResult {
    let CollectedOutput {
        status,
        stdout,
        stderr,
        truncated,
        exit_code,
        error,
    } = output;
    PluginToolOperationResult {
        protocol_version: PROTOCOL_VERSION,
        plugin_id: plugin_id.to_string(),
        request_id: request_id.to_string(),
        operation_id: operation_id.to_string(),
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
    use base64::Engine;
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
        assert!(
            admitted_tool_operation("dev.asterlyn.android-gradle", "android.apk.inspect").is_some()
        );
        assert!(
            admitted_tool_operation("dev.asterlyn.android-gradle", "android.adb.install").is_some()
        );
        assert!(
            admitted_tool_operation("dev.asterlyn.android-gradle", "android.adb.uninstall")
                .is_some()
        );
        assert!(
            admitted_tool_operation("dev.asterlyn.android-gradle", "android.adb.shell").is_none()
        );
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

    #[test]
    fn apk_inspection_is_bounded_to_the_active_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let sdk = directory.path().join("sdk");
        fs::create_dir_all(sdk.join("build-tools/36.0.0")).unwrap();
        executable(
            &sdk.join("build-tools/36.0.0"),
            "aapt",
            "printf '%s\\n' \"$*\"",
        );
        fs::write(
            directory.path().join("local.properties"),
            format!("sdk.dir={}\n", sdk.display()),
        )
        .unwrap();
        fs::create_dir_all(directory.path().join("app/build/outputs/apk/debug")).unwrap();
        fs::write(
            directory
                .path()
                .join("app/build/outputs/apk/debug/app-debug.apk"),
            b"apk",
        )
        .unwrap();
        let output = PluginProcessQueryManager::default().execute_tool_operation(
            "window-a",
            directory.path(),
            "dev.asterlyn.android-gradle",
            "run-1",
            "android.apk.inspect",
            &HashMap::from([(
                "artifact".into(),
                "app/build/outputs/apk/debug/app-debug.apk".into(),
            )]),
        );
        assert_eq!(output.status, PluginProcessQueryStatus::Succeeded);
        assert!(
            String::from_utf8(
                base64::engine::general_purpose::STANDARD
                    .decode(output.stdout_base64)
                    .unwrap()
            )
            .unwrap()
            .contains("dump badging")
        );

        let outside = tempfile::NamedTempFile::new().unwrap();
        let rejected = validate_tool_parameter(
            directory.path(),
            ToolOperationParameterKind::WorkspaceApk,
            outside.path().to_str().unwrap(),
        );
        assert!(rejected.is_err());
    }

    #[test]
    fn launch_parameters_reject_shell_injection() {
        assert!(
            validate_tool_parameter(
                Path::new("/"),
                ToolOperationParameterKind::ExecutionTargetId,
                "emulator-5554;rm"
            )
            .is_err()
        );
        assert!(
            validate_tool_parameter(
                Path::new("/"),
                ToolOperationParameterKind::AndroidComponent,
                "com.example.app/com.example.app.MainActivity"
            )
            .is_ok()
        );
        assert!(
            validate_tool_parameter(
                Path::new("/"),
                ToolOperationParameterKind::AndroidComponent,
                "com.example.app/$(bad)"
            )
            .is_err()
        );
    }

    #[test]
    fn exact_device_install_contains_the_apk_and_serial() {
        let directory = tempfile::tempdir().unwrap();
        let operation =
            admitted_tool_operation("dev.asterlyn.android-gradle", "android.adb.install").unwrap();
        fs::create_dir_all(directory.path().join("app/build/outputs/apk/debug")).unwrap();
        fs::write(
            directory
                .path()
                .join("app/build/outputs/apk/debug/app-debug.apk"),
            b"apk",
        )
        .unwrap();
        let args = operation
            .resolve_arguments(
                directory.path(),
                &HashMap::from([
                    ("target".into(), "emulator-5554".into()),
                    (
                        "artifact".into(),
                        "app/build/outputs/apk/debug/app-debug.apk".into(),
                    ),
                ]),
            )
            .unwrap();
        assert_eq!(&args[..4], &["-s", "emulator-5554", "install", "-r"]);
        assert_eq!(
            PathBuf::from(&args[4]),
            fs::canonicalize(
                directory
                    .path()
                    .join("app/build/outputs/apk/debug/app-debug.apk")
            )
            .unwrap()
        );
    }

    #[test]
    fn exact_device_uninstall_contains_only_the_package_and_serial() {
        let operation =
            admitted_tool_operation("dev.asterlyn.android-gradle", "android.adb.uninstall")
                .unwrap();
        let args = operation
            .resolve_arguments(
                Path::new("/"),
                &HashMap::from([
                    ("target".into(), "emulator-5554".into()),
                    ("application".into(), "com.example.demo".into()),
                ]),
            )
            .unwrap();
        assert_eq!(
            args,
            ["-s", "emulator-5554", "uninstall", "com.example.demo"]
        );
        assert!(
            validate_tool_parameter(
                Path::new("/"),
                ToolOperationParameterKind::AndroidApplicationId,
                "com.example;rm"
            )
            .is_err()
        );
    }
}
