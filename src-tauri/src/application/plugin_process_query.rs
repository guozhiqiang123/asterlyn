use asterlyn_plugin_package::{
    ProcessExecutableCandidate, ProcessQuery, ToolOperation,
    ToolOperationArgument as PackageToolArgument,
};
use asterlyn_task::encode_output;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[path = "plugin_process_executable.rs"]
mod executable;

use executable::{
    ToolOperationParameterKind, executable_name, resolve_executable, valid_request_id,
    validate_tool_parameter,
};

const PROTOCOL_VERSION: u8 = 1;
const MAX_RUNNING_PER_OWNER: usize = 4;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const ADB_QUERY_TIMEOUT: Duration = Duration::from_secs(10);
const TOOL_OPERATION_TIMEOUT: Duration = Duration::from_secs(15);
const ANDROID_INSTALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

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
    args: Vec<String>,
    timeout: Duration,
    max_output_bytes: usize,
    executables: Vec<ProcessExecutableCandidate>,
}

#[derive(Debug, Clone)]
struct AdmittedToolOperation {
    args: Vec<ToolOperationArgument>,
    parameters: Vec<ToolOperationParameter>,
    timeout: Duration,
    max_output_bytes: usize,
    executables: Vec<ProcessExecutableCandidate>,
}

#[derive(Debug, Clone)]
enum ToolOperationArgument {
    Literal(String),
    Parameter(String),
}

#[derive(Debug, Clone)]
struct ToolOperationParameter {
    name: String,
    kind: ToolOperationParameterKind,
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
        for parameter in &self.parameters {
            let value = values
                .get(parameter.name.as_str())
                .ok_or_else(|| format!("missing tool-operation parameter: {}", parameter.name))?;
            let value = validate_tool_parameter(root, &parameter.kind, value)?;
            resolved.insert(parameter.name.as_str(), value);
        }
        self.args
            .iter()
            .map(|argument| match argument {
                ToolOperationArgument::Literal(value) => Ok(value.clone()),
                ToolOperationArgument::Parameter(name) => resolved
                    .get(name.as_str())
                    .cloned()
                    .ok_or_else(|| format!("unresolved tool-operation parameter: {name}")),
            })
            .collect()
    }
}

#[derive(Debug, Clone)]
struct PluginToolAuthority {
    plugin_version: String,
    package_digest: String,
    queries: HashMap<String, AdmittedQuery>,
    operations: HashMap<String, AdmittedToolOperation>,
}

impl PluginToolAuthority {
    fn from_package(
        plugin_version: &str,
        package_digest: &str,
        queries: &[ProcessQuery],
        operations: &[ToolOperation],
    ) -> Result<Self, String> {
        let queries = queries
            .iter()
            .map(|query| {
                Ok((
                    query.id.clone(),
                    AdmittedQuery {
                        args: query.args.clone(),
                        timeout: Duration::from_millis(query.timeout_ms),
                        max_output_bytes: query.max_output_bytes,
                        executables: query.executables.clone(),
                    },
                ))
            })
            .collect::<Result<HashMap<_, _>, String>>()?;
        let operations = operations
            .iter()
            .map(|operation| {
                let args = operation
                    .args
                    .iter()
                    .map(|argument| match argument {
                        PackageToolArgument::Literal { value } => {
                            ToolOperationArgument::Literal(value.clone())
                        }
                        PackageToolArgument::Parameter { name } => {
                            ToolOperationArgument::Parameter(name.clone())
                        }
                    })
                    .collect();
                let parameters = operation
                    .parameters
                    .iter()
                    .map(|parameter| {
                        let kind = match parameter.kind.as_str() {
                            "executionTargetId" => ToolOperationParameterKind::ExecutionTargetId,
                            "androidApplicationId" => {
                                ToolOperationParameterKind::AndroidApplicationId
                            }
                            "androidComponent" => ToolOperationParameterKind::AndroidComponent,
                            "workspaceArtifact" => ToolOperationParameterKind::WorkspaceArtifact(
                                parameter.suffixes.clone().unwrap_or_default(),
                            ),
                            _ => {
                                return Err(format!(
                                    "unsupported tool-operation parameter kind: {}",
                                    parameter.kind
                                ));
                            }
                        };
                        Ok(ToolOperationParameter {
                            name: parameter.name.clone(),
                            kind,
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()?;
                Ok((
                    operation.id.clone(),
                    AdmittedToolOperation {
                        args,
                        parameters,
                        timeout: Duration::from_millis(operation.timeout_ms),
                        max_output_bytes: operation.max_output_bytes,
                        executables: operation.executables.clone(),
                    },
                ))
            })
            .collect::<Result<HashMap<_, _>, String>>()?;
        Ok(Self {
            plugin_version: plugin_version.to_owned(),
            package_digest: package_digest.to_owned(),
            queries,
            operations,
        })
    }
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
    authorities: Mutex<HashMap<(String, String), PluginToolAuthority>>,
}

impl PluginProcessQueryManager {
    pub(crate) fn admit_authority(
        &self,
        owner: &str,
        plugin_id: &str,
        plugin_version: &str,
        package_digest: &str,
        queries: &[ProcessQuery],
        operations: &[ToolOperation],
    ) -> Result<(), String> {
        let authority =
            PluginToolAuthority::from_package(plugin_version, package_digest, queries, operations)?;
        self.inner
            .authorities
            .lock()
            .map_err(|_| "plugin tool-authority registry is unavailable".to_owned())?
            .insert((owner.to_owned(), plugin_id.to_owned()), authority);
        Ok(())
    }

    pub(crate) fn revoke_authority(&self, owner: &str, plugin_id: &str) {
        if let Ok(mut authorities) = self.inner.authorities.lock() {
            authorities.remove(&(owner.to_owned(), plugin_id.to_owned()));
        }
    }

    pub(crate) fn execute(
        &self,
        owner: &str,
        root: &Path,
        plugin_id: &str,
        query_id: &str,
    ) -> PluginProcessQueryResult {
        let Some(query) = self.admitted_query(owner, plugin_id, query_id, None) else {
            return result(
                plugin_id,
                query_id,
                CollectedOutput::with_error(
                    PluginProcessQueryStatus::Unavailable,
                    "process query is not admitted by the active plugin package",
                ),
            );
        };
        let executable = match resolve_executable(root, &query.executables) {
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

    pub(crate) fn execute_exact(
        &self,
        owner: &str,
        root: &Path,
        plugin_id: &str,
        plugin_version: &str,
        package_digest: &str,
        query_id: &str,
    ) -> PluginProcessQueryResult {
        let Some(query) = self.admitted_query(
            owner,
            plugin_id,
            query_id,
            Some((plugin_version, package_digest)),
        ) else {
            return result(
                plugin_id,
                query_id,
                CollectedOutput::with_error(
                    PluginProcessQueryStatus::Unavailable,
                    "process query is not admitted by this plugin package identity",
                ),
            );
        };
        let executable = match resolve_executable(root, &query.executables) {
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
        let child = match spawn_query(executable, root, &query.args) {
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

        let collected = collect_query(child, cancelled, query.timeout, query.max_output_bytes);
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
        if let Ok(mut authorities) = self.inner.authorities.lock() {
            authorities.retain(|(candidate, _), _| candidate != owner);
        }
    }

    pub(crate) fn cancel_plugin(&self, plugin_id: &str) {
        self.cancel_matching(|value| value.plugin_id == plugin_id);
        if let Ok(mut authorities) = self.inner.authorities.lock() {
            authorities.retain(|(_, candidate), _| candidate != plugin_id);
        }
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
        let Some(operation) = self.admitted_tool_operation(owner, plugin_id, operation_id) else {
            return tool_result(
                plugin_id,
                request_id,
                operation_id,
                CollectedOutput::with_error(
                    PluginProcessQueryStatus::Failed,
                    "tool operation is not admitted by the active plugin package",
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
        let executable = match resolve_executable(root, &operation.executables) {
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
        if let Ok(mut authorities) = self.inner.authorities.lock() {
            authorities.clear();
        }
    }

    fn admitted_query(
        &self,
        owner: &str,
        plugin_id: &str,
        query_id: &str,
        exact_identity: Option<(&str, &str)>,
    ) -> Option<AdmittedQuery> {
        let authority = self
            .inner
            .authorities
            .lock()
            .ok()?
            .get(&(owner.to_owned(), plugin_id.to_owned()))
            .cloned();
        if let Some(authority) = authority {
            if exact_identity.is_some_and(|(version, digest)| {
                authority.plugin_version != version || authority.package_digest != digest
            }) {
                return None;
            }
            return authority.queries.get(query_id).cloned();
        }
        if exact_identity.is_some() {
            None
        } else {
            bundled_query(plugin_id, query_id)
        }
    }

    fn admitted_tool_operation(
        &self,
        owner: &str,
        plugin_id: &str,
        operation_id: &str,
    ) -> Option<AdmittedToolOperation> {
        let authority = self
            .inner
            .authorities
            .lock()
            .ok()?
            .get(&(owner.to_owned(), plugin_id.to_owned()))
            .cloned();
        match authority {
            Some(value) => value.operations.get(operation_id).cloned(),
            None => bundled_tool_operation(plugin_id, operation_id),
        }
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

fn bundled_query(plugin_id: &str, query_id: &str) -> Option<AdmittedQuery> {
    match (plugin_id, query_id) {
        ("dev.asterlyn.android-gradle", "adb.devices") => Some(AdmittedQuery {
            args: vec!["devices".into(), "-l".into()],
            timeout: ADB_QUERY_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executables: android_adb_candidates(),
        }),
        _ => None,
    }
}

fn bundled_tool_operation(plugin_id: &str, operation_id: &str) -> Option<AdmittedToolOperation> {
    match (plugin_id, operation_id) {
        ("dev.asterlyn.android-gradle", "android.apk.inspect") => Some(AdmittedToolOperation {
            args: vec![
                ToolOperationArgument::Literal("dump".into()),
                ToolOperationArgument::Literal("badging".into()),
                ToolOperationArgument::Parameter("artifact".into()),
            ],
            parameters: vec![ToolOperationParameter {
                name: "artifact".into(),
                kind: ToolOperationParameterKind::WorkspaceArtifact(vec![".apk".into()]),
            }],
            timeout: TOOL_OPERATION_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executables: vec![ProcessExecutableCandidate::AndroidSdkBuildTools {
                name: "aapt".into(),
            }],
        }),
        ("dev.asterlyn.android-gradle", "android.adb.launch") => Some(AdmittedToolOperation {
            args: vec![
                ToolOperationArgument::Literal("-s".into()),
                ToolOperationArgument::Parameter("target".into()),
                ToolOperationArgument::Literal("shell".into()),
                ToolOperationArgument::Literal("am".into()),
                ToolOperationArgument::Literal("start".into()),
                ToolOperationArgument::Literal("-n".into()),
                ToolOperationArgument::Parameter("component".into()),
            ],
            parameters: vec![
                ToolOperationParameter {
                    name: "target".into(),
                    kind: ToolOperationParameterKind::ExecutionTargetId,
                },
                ToolOperationParameter {
                    name: "component".into(),
                    kind: ToolOperationParameterKind::AndroidComponent,
                },
            ],
            timeout: TOOL_OPERATION_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executables: android_adb_candidates(),
        }),
        ("dev.asterlyn.android-gradle", "android.adb.install") => Some(AdmittedToolOperation {
            args: vec![
                ToolOperationArgument::Literal("-s".into()),
                ToolOperationArgument::Parameter("target".into()),
                ToolOperationArgument::Literal("install".into()),
                ToolOperationArgument::Literal("-r".into()),
                ToolOperationArgument::Parameter("artifact".into()),
            ],
            parameters: vec![
                ToolOperationParameter {
                    name: "target".into(),
                    kind: ToolOperationParameterKind::ExecutionTargetId,
                },
                ToolOperationParameter {
                    name: "artifact".into(),
                    kind: ToolOperationParameterKind::WorkspaceArtifact(vec![".apk".into()]),
                },
            ],
            timeout: ANDROID_INSTALL_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executables: android_adb_candidates(),
        }),
        ("dev.asterlyn.android-gradle", "android.adb.uninstall") => Some(AdmittedToolOperation {
            args: vec![
                ToolOperationArgument::Literal("-s".into()),
                ToolOperationArgument::Parameter("target".into()),
                ToolOperationArgument::Literal("uninstall".into()),
                ToolOperationArgument::Parameter("application".into()),
            ],
            parameters: vec![
                ToolOperationParameter {
                    name: "target".into(),
                    kind: ToolOperationParameterKind::ExecutionTargetId,
                },
                ToolOperationParameter {
                    name: "application".into(),
                    kind: ToolOperationParameterKind::AndroidApplicationId,
                },
            ],
            timeout: TOOL_OPERATION_TIMEOUT,
            max_output_bytes: MAX_OUTPUT_BYTES,
            executables: android_adb_candidates(),
        }),
        _ => None,
    }
}

fn android_adb_candidates() -> Vec<ProcessExecutableCandidate> {
    vec![
        ProcessExecutableCandidate::WorkspaceProperty {
            path: "local.properties".into(),
            key: "sdk.dir".into(),
            relative_path: platform_tool_path("adb"),
        },
        ProcessExecutableCandidate::Environment {
            variable: "ANDROID_SDK_ROOT".into(),
            relative_path: platform_tool_path("adb"),
        },
        ProcessExecutableCandidate::Environment {
            variable: "ANDROID_HOME".into(),
            relative_path: platform_tool_path("adb"),
        },
        ProcessExecutableCandidate::Path {
            name: executable_name("adb"),
        },
    ]
}

fn platform_tool_path(name: &str) -> String {
    format!("platform-tools/{}", executable_name(name))
}

fn spawn_query(executable: &Path, root: &Path, args: &[String]) -> Result<Child, String> {
    spawn_process(executable, root, args)
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
    use std::path::PathBuf;

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
        assert!(bundled_query("dev.asterlyn.android-gradle", "adb.devices").is_some());
        assert!(bundled_query("dev.asterlyn.android-gradle", "adb.shell").is_none());
        assert!(bundled_query("unknown", "adb.devices").is_none());
        assert!(
            bundled_tool_operation("dev.asterlyn.android-gradle", "android.apk.inspect").is_some()
        );
        assert!(
            bundled_tool_operation("dev.asterlyn.android-gradle", "android.adb.install").is_some()
        );
        assert!(
            bundled_tool_operation("dev.asterlyn.android-gradle", "android.adb.uninstall")
                .is_some()
        );
        assert!(
            bundled_tool_operation("dev.asterlyn.android-gradle", "android.adb.shell").is_none()
        );
    }

    #[test]
    fn package_authority_is_scoped_to_owner_and_exact_identity() {
        let manager = PluginProcessQueryManager::default();
        manager
            .admit_authority(
                "window-a",
                "dev.example.fixture",
                "1.2.3",
                "sha256:fixture",
                &[ProcessQuery {
                    id: "fixture.query".into(),
                    args: vec!["--version".into()],
                    timeout_ms: 1_000,
                    max_output_bytes: 1_024,
                    executables: vec![ProcessExecutableCandidate::Path {
                        name: "fixture-tool".into(),
                    }],
                }],
                &[],
            )
            .unwrap();

        assert!(
            manager
                .admitted_query(
                    "window-a",
                    "dev.example.fixture",
                    "fixture.query",
                    Some(("1.2.3", "sha256:fixture")),
                )
                .is_some()
        );
        assert!(
            manager
                .admitted_query(
                    "window-b",
                    "dev.example.fixture",
                    "fixture.query",
                    Some(("1.2.3", "sha256:fixture")),
                )
                .is_none()
        );
        assert!(
            manager
                .admitted_query(
                    "window-a",
                    "dev.example.fixture",
                    "fixture.query",
                    Some(("1.2.4", "sha256:fixture")),
                )
                .is_none()
        );
        manager.revoke_authority("window-a", "dev.example.fixture");
        assert!(
            manager
                .admitted_query("window-a", "dev.example.fixture", "fixture.query", None)
                .is_none()
        );
    }

    #[test]
    fn package_authority_executes_declared_query_and_operation_without_host_catalog_entry() {
        let directory = tempfile::tempdir().unwrap();
        executable(directory.path(), "fixture-tool", "printf '%s\\n' \"$*\"");
        fs::write(
            directory.path().join("fixture.properties"),
            format!("tool.dir={}\n", directory.path().display()),
        )
        .unwrap();
        let executable = ProcessExecutableCandidate::WorkspaceProperty {
            path: "fixture.properties".into(),
            key: "tool.dir".into(),
            relative_path: "fixture-tool".into(),
        };
        let manager = PluginProcessQueryManager::default();
        manager
            .admit_authority(
                "window-a",
                "dev.example.fixture",
                "1.0.0",
                "sha256:fixture",
                &[ProcessQuery {
                    id: "fixture.query".into(),
                    args: vec!["query".into()],
                    timeout_ms: 1_000,
                    max_output_bytes: 1_024,
                    executables: vec![executable.clone()],
                }],
                &[ToolOperation {
                    id: "fixture.operation".into(),
                    intent: "query".into(),
                    args: vec![PackageToolArgument::Literal {
                        value: "operation".into(),
                    }],
                    parameters: vec![],
                    timeout_ms: 1_000,
                    max_output_bytes: 1_024,
                    executables: vec![executable],
                }],
            )
            .unwrap();

        let query = manager.execute_exact(
            "window-a",
            directory.path(),
            "dev.example.fixture",
            "1.0.0",
            "sha256:fixture",
            "fixture.query",
        );
        assert_eq!(query.status, PluginProcessQueryStatus::Succeeded);
        assert_eq!(query.stdout_base64, encode_output(b"query\n"));

        let operation = manager.execute_tool_operation(
            "window-a",
            directory.path(),
            "dev.example.fixture",
            "request-1",
            "fixture.operation",
            &HashMap::new(),
        );
        assert_eq!(operation.status, PluginProcessQueryStatus::Succeeded);
        assert_eq!(operation.stdout_base64, encode_output(b"operation\n"));
    }

    #[test]
    fn active_package_does_not_inherit_undeclared_bundled_authority() {
        let manager = PluginProcessQueryManager::default();
        manager
            .admit_authority(
                "window-a",
                "dev.asterlyn.android-gradle",
                "9.0.0",
                "sha256:fixture",
                &[],
                &[],
            )
            .unwrap();
        assert!(
            manager
                .admitted_tool_operation(
                    "window-a",
                    "dev.asterlyn.android-gradle",
                    "android.adb.install",
                )
                .is_none()
        );
    }

    #[test]
    fn bounded_query_captures_output_and_releases_registry() {
        let directory = tempfile::tempdir().unwrap();
        let tool = executable(directory.path(), "tool", "printf 'device-list\\n'");
        let manager = PluginProcessQueryManager::default();
        let query = AdmittedQuery {
            args: vec![],
            timeout: Duration::from_secs(1),
            max_output_bytes: MAX_OUTPUT_BYTES,
            executables: vec![],
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
            args: vec![],
            timeout: Duration::from_millis(50),
            max_output_bytes: MAX_OUTPUT_BYTES,
            executables: vec![],
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
            resolve_executable(directory.path(), &android_adb_candidates()).unwrap(),
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
            &ToolOperationParameterKind::WorkspaceArtifact(vec![".apk".into()]),
            outside.path().to_str().unwrap(),
        );
        assert!(rejected.is_err());
    }

    #[test]
    fn launch_parameters_reject_shell_injection() {
        assert!(
            validate_tool_parameter(
                Path::new("/"),
                &ToolOperationParameterKind::ExecutionTargetId,
                "emulator-5554;rm"
            )
            .is_err()
        );
        assert!(
            validate_tool_parameter(
                Path::new("/"),
                &ToolOperationParameterKind::AndroidComponent,
                "com.example.app/com.example.app.MainActivity"
            )
            .is_ok()
        );
        assert!(
            validate_tool_parameter(
                Path::new("/"),
                &ToolOperationParameterKind::AndroidComponent,
                "com.example.app/$(bad)"
            )
            .is_err()
        );
    }

    #[test]
    fn exact_device_install_contains_the_apk_and_serial() {
        let directory = tempfile::tempdir().unwrap();
        let operation =
            bundled_tool_operation("dev.asterlyn.android-gradle", "android.adb.install").unwrap();
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
            bundled_tool_operation("dev.asterlyn.android-gradle", "android.adb.uninstall").unwrap();
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
                &ToolOperationParameterKind::AndroidApplicationId,
                "com.example;rm"
            )
            .is_err()
        );
    }
}
