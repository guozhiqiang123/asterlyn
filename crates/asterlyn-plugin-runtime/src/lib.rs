use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::io::{BufReader, BufWriter, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use asterlyn_plugin_runtime_protocol::{
    Activate, CapabilityRequest, ExpectedPluginIdentity, HelloAck, HostTheme, Invoke,
    OperationError, OperationResult, PluginHostMessage, ProtocolEnvelope, RemoteFailure,
    RuntimeContribution, Shutdown, ShutdownReason, read_frame, write_frame,
};
use serde_json::Value as JsonValue;

const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);
const MAX_STDERR_BYTES: usize = 256 * 1024;
const MAX_IN_FLIGHT_CALLS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SessionKey {
    owner: String,
    plugin_id: String,
}

#[derive(Debug, Clone)]
pub struct PluginRuntimeIdentity {
    pub plugin_id: String,
    pub plugin_version: String,
    pub package_digest: String,
    pub runtime_entry: String,
}

#[derive(Debug, Clone)]
pub struct PluginActivation {
    pub owner: String,
    pub plugin_root: PathBuf,
    pub identity: PluginRuntimeIdentity,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub workspace_root: String,
    pub evidence: JsonValue,
    pub locale: String,
    pub theme: HostTheme,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActivatedPlugin {
    pub session_id: String,
    pub contributions: Vec<RuntimeContribution>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginDiagnostics {
    pub stderr: String,
    pub stderr_truncated: bool,
    pub protocol_diagnostics: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CapabilityContext<'a> {
    pub owner: &'a str,
    pub plugin_id: &'a str,
    pub plugin_version: &'a str,
    pub package_digest: &'a str,
    pub workspace_id: &'a str,
    pub workspace_generation: u64,
    pub admitted_permissions: &'a BTreeSet<String>,
}

pub trait CapabilityHandler: Send + Sync + 'static {
    fn execute(
        &self,
        context: &CapabilityContext<'_>,
        request: &CapabilityRequest,
    ) -> Result<JsonValue, RemoteFailure>;
}

#[derive(Default)]
pub struct DenyAllCapabilities;

impl CapabilityHandler for DenyAllCapabilities {
    fn execute(
        &self,
        _context: &CapabilityContext<'_>,
        request: &CapabilityRequest,
    ) -> Result<JsonValue, RemoteFailure> {
        Err(RemoteFailure {
            code: "capability.unavailable".to_owned(),
            message: format!(
                "host capability is not connected: {} / {}",
                request.capability, request.operation
            ),
            retryable: false,
        })
    }
}

#[derive(Debug)]
pub enum PluginRuntimeError {
    InvalidConfiguration(String),
    Io(String),
    Protocol(String),
    Timeout(&'static str),
    NotActive(String),
    Remote(RemoteFailure),
    Crashed(String),
}

impl fmt::Display for PluginRuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConfiguration(message) => {
                write!(formatter, "invalid plugin runtime configuration: {message}")
            }
            Self::Io(message) => write!(formatter, "plugin runtime I/O failed: {message}"),
            Self::Protocol(message) => {
                write!(formatter, "plugin runtime protocol failed: {message}")
            }
            Self::Timeout(operation) => {
                write!(formatter, "plugin runtime timed out during {operation}")
            }
            Self::NotActive(plugin_id) => {
                write!(formatter, "plugin runtime is not active: {plugin_id}")
            }
            Self::Remote(error) => write!(
                formatter,
                "plugin runtime failed: {}: {}",
                error.code, error.message
            ),
            Self::Crashed(message) => write!(formatter, "plugin runtime crashed: {message}"),
        }
    }
}

impl std::error::Error for PluginRuntimeError {}

#[derive(Clone)]
pub struct PluginHostSupervisor {
    inner: Arc<SupervisorInner>,
}

struct SupervisorInner {
    helper: PathBuf,
    sessions: Mutex<HashMap<SessionKey, Arc<ManagedSession>>>,
    transition: Mutex<()>,
    sequence: AtomicU64,
    capabilities: Arc<dyn CapabilityHandler>,
}

struct ManagedSession {
    key: SessionKey,
    identity: PluginRuntimeIdentity,
    session_id: String,
    workspace_id: String,
    workspace_generation: u64,
    admitted_capabilities: BTreeSet<String>,
    admitted_permissions: BTreeSet<String>,
    contributions: Vec<RuntimeContribution>,
    writer: Mutex<BufWriter<ChildStdin>>,
    receiver: Mutex<Receiver<Result<ProtocolEnvelope, String>>>,
    request_gate: Mutex<()>,
    child: Arc<Mutex<Option<Child>>>,
    pid: u32,
    outgoing_sequence: AtomicU64,
    request_sequence: AtomicU64,
    in_flight: AtomicU64,
    stopping: AtomicBool,
    process_cleaned: AtomicBool,
    diagnostics: Arc<Mutex<DiagnosticBuffer>>,
    capabilities: Arc<dyn CapabilityHandler>,
}

#[derive(Default)]
struct DiagnosticBuffer {
    stderr: Vec<u8>,
    stderr_truncated: bool,
    protocol: Vec<String>,
}

impl PluginHostSupervisor {
    pub fn from_verified_helper(
        helper: impl AsRef<Path>,
        installation_root: impl AsRef<Path>,
    ) -> Result<Self, PluginRuntimeError> {
        Self::from_verified_helper_with_capabilities(
            helper,
            installation_root,
            Arc::new(DenyAllCapabilities),
        )
    }

    pub fn from_verified_helper_with_capabilities(
        helper: impl AsRef<Path>,
        installation_root: impl AsRef<Path>,
        capabilities: Arc<dyn CapabilityHandler>,
    ) -> Result<Self, PluginRuntimeError> {
        let installation_root = installation_root.as_ref().canonicalize().map_err(|error| {
            PluginRuntimeError::InvalidConfiguration(format!(
                "resolve helper installation root: {error}"
            ))
        })?;
        let helper = helper.as_ref().canonicalize().map_err(|error| {
            PluginRuntimeError::InvalidConfiguration(format!("resolve plugin helper: {error}"))
        })?;
        if !helper.starts_with(&installation_root) || !helper.is_file() {
            return Err(PluginRuntimeError::InvalidConfiguration(
                "plugin helper must be a regular file inside the trusted installation root"
                    .to_owned(),
            ));
        }
        Ok(Self {
            inner: Arc::new(SupervisorInner {
                helper,
                sessions: Mutex::new(HashMap::new()),
                transition: Mutex::new(()),
                sequence: AtomicU64::new(0),
                capabilities,
            }),
        })
    }

    pub fn activate(
        &self,
        activation: PluginActivation,
    ) -> Result<ActivatedPlugin, PluginRuntimeError> {
        let _transition = lock(&self.inner.transition, "runtime transition")?;
        validate_activation(&activation)?;
        let key = SessionKey {
            owner: activation.owner.clone(),
            plugin_id: activation.identity.plugin_id.clone(),
        };
        if let Some(previous) = lock(&self.inner.sessions, "runtime sessions")?.remove(&key) {
            previous.stop(ShutdownReason::Restart);
        }
        let number = self.inner.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let session_id = format!("plugin-session-{number}");
        let session = ManagedSession::spawn(
            &self.inner.helper,
            activation,
            session_id.clone(),
            self.inner.capabilities.clone(),
        )?;
        let activated = ActivatedPlugin {
            session_id,
            contributions: session.contributions.clone(),
        };
        lock(&self.inner.sessions, "runtime sessions")?.insert(key, Arc::new(session));
        Ok(activated)
    }

    pub fn invoke(
        &self,
        owner: &str,
        plugin_id: &str,
        callback_handle: &str,
        operation: &str,
        payload: JsonValue,
    ) -> Result<JsonValue, PluginRuntimeError> {
        let session = self.session(owner, plugin_id)?;
        let result = session.invoke(callback_handle, operation, payload);
        if matches!(
            result,
            Err(PluginRuntimeError::Timeout(_)
                | PluginRuntimeError::Protocol(_)
                | PluginRuntimeError::Crashed(_))
        ) && let Ok(mut sessions) = self.inner.sessions.lock()
        {
            sessions.remove(&SessionKey {
                owner: owner.to_owned(),
                plugin_id: plugin_id.to_owned(),
            });
        }
        result
    }

    pub fn diagnostics(
        &self,
        owner: &str,
        plugin_id: &str,
    ) -> Result<PluginDiagnostics, PluginRuntimeError> {
        self.session(owner, plugin_id)?.diagnostics()
    }

    pub fn stop_plugin(&self, owner: &str, plugin_id: &str, reason: ShutdownReason) {
        let key = SessionKey {
            owner: owner.to_owned(),
            plugin_id: plugin_id.to_owned(),
        };
        if let Ok(mut sessions) = self.inner.sessions.lock()
            && let Some(session) = sessions.remove(&key)
        {
            session.stop(reason);
        }
    }

    pub fn cancel_owner(&self, owner: &str, reason: ShutdownReason) {
        let sessions = if let Ok(mut sessions) = self.inner.sessions.lock() {
            let keys = sessions
                .keys()
                .filter(|key| key.owner == owner)
                .cloned()
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| sessions.remove(&key))
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        for session in sessions {
            session.stop(reason);
        }
    }

    pub fn cancel_all(&self, reason: ShutdownReason) {
        let sessions: Vec<Arc<ManagedSession>> = self
            .inner
            .sessions
            .lock()
            .map(|mut sessions| sessions.drain().map(|(_, session)| session).collect())
            .unwrap_or_default();
        for session in sessions {
            session.stop(reason);
        }
    }

    pub fn active_count(&self) -> usize {
        self.inner
            .sessions
            .lock()
            .map(|sessions| sessions.len())
            .unwrap_or(0)
    }

    fn session(
        &self,
        owner: &str,
        plugin_id: &str,
    ) -> Result<Arc<ManagedSession>, PluginRuntimeError> {
        let key = SessionKey {
            owner: owner.to_owned(),
            plugin_id: plugin_id.to_owned(),
        };
        lock(&self.inner.sessions, "runtime sessions")?
            .get(&key)
            .cloned()
            .ok_or_else(|| PluginRuntimeError::NotActive(plugin_id.to_owned()))
    }
}

impl Drop for PluginHostSupervisor {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            self.cancel_all(ShutdownReason::ApplicationExit);
        }
    }
}

impl ManagedSession {
    fn spawn(
        helper: &Path,
        activation: PluginActivation,
        session_id: String,
        capabilities: Arc<dyn CapabilityHandler>,
    ) -> Result<Self, PluginRuntimeError> {
        let plugin_root = activation.plugin_root.canonicalize().map_err(|error| {
            PluginRuntimeError::InvalidConfiguration(format!(
                "resolve admitted plugin root: {error}"
            ))
        })?;
        if !plugin_root.is_dir() {
            return Err(PluginRuntimeError::InvalidConfiguration(
                "admitted plugin root is not a directory".to_owned(),
            ));
        }
        let entry = plugin_root
            .join(&activation.identity.runtime_entry)
            .canonicalize()
            .map_err(|error| {
                PluginRuntimeError::InvalidConfiguration(format!(
                    "resolve admitted runtime entry: {error}"
                ))
            })?;
        if !entry.starts_with(&plugin_root) || !entry.is_file() {
            return Err(PluginRuntimeError::InvalidConfiguration(
                "admitted runtime entry escapes the plugin root or is not a regular file"
                    .to_owned(),
            ));
        }

        let mut command = Command::new(helper);
        command
            .args([
                "--plugin-root",
                plugin_root.to_string_lossy().as_ref(),
                "--plugin-id",
                &activation.identity.plugin_id,
                "--plugin-version",
                &activation.identity.plugin_version,
                "--package-digest",
                &activation.identity.package_digest,
                "--runtime-entry",
                &activation.identity.runtime_entry,
            ])
            .current_dir(&plugin_root)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
            command.creation_flags(CREATE_NEW_PROCESS_GROUP);
        }
        let mut child = command.spawn().map_err(|error| {
            PluginRuntimeError::Io(format!("start isolated plugin helper: {error}"))
        })?;
        let pid = child.id();
        let stdin = child.stdin.take().ok_or_else(|| {
            PluginRuntimeError::Io("plugin helper stdin was not piped".to_owned())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            PluginRuntimeError::Io("plugin helper stdout was not piped".to_owned())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            PluginRuntimeError::Io("plugin helper stderr was not piped".to_owned())
        })?;
        let child = Arc::new(Mutex::new(Some(child)));
        let diagnostics = Arc::new(Mutex::new(DiagnosticBuffer::default()));
        let receiver = spawn_protocol_reader(stdout);
        spawn_stderr_reader(stderr, diagnostics.clone());

        let mut session = Self {
            key: SessionKey {
                owner: activation.owner,
                plugin_id: activation.identity.plugin_id.clone(),
            },
            identity: activation.identity,
            session_id,
            workspace_id: activation.workspace_id,
            workspace_generation: activation.workspace_generation,
            admitted_capabilities: activation.capabilities.into_iter().collect(),
            admitted_permissions: activation.permissions.into_iter().collect(),
            contributions: Vec::new(),
            writer: Mutex::new(BufWriter::new(stdin)),
            receiver: Mutex::new(receiver),
            request_gate: Mutex::new(()),
            child,
            pid,
            outgoing_sequence: AtomicU64::new(1),
            request_sequence: AtomicU64::new(0),
            in_flight: AtomicU64::new(0),
            stopping: AtomicBool::new(false),
            process_cleaned: AtomicBool::new(false),
            diagnostics,
            capabilities,
        };

        let startup = session.establish(
            activation.evidence,
            activation.workspace_root,
            activation.locale,
            activation.theme,
        );
        match startup {
            Ok(contributions) => {
                session.contributions = contributions;
                Ok(session)
            }
            Err(error) => {
                session.force_stop();
                Err(error)
            }
        }
    }

    fn establish(
        &self,
        evidence: JsonValue,
        workspace_root: String,
        locale: String,
        theme: HostTheme,
    ) -> Result<Vec<RuntimeContribution>, PluginRuntimeError> {
        let deadline = Instant::now() + ACTIVATION_TIMEOUT;
        let hello = self.receive_until(deadline, "hello")?;
        let PluginHostMessage::Hello(hello) = hello.message else {
            return Err(PluginRuntimeError::Protocol(
                "expected hello as the first helper message".to_owned(),
            ));
        };
        hello
            .matches(&ExpectedPluginIdentity {
                plugin_id: &self.identity.plugin_id,
                plugin_version: &self.identity.plugin_version,
                package_digest: &self.identity.package_digest,
                runtime_entry: &self.identity.runtime_entry,
            })
            .map_err(|error| PluginRuntimeError::Protocol(error.to_string()))?;
        self.send(PluginHostMessage::HelloAck(HelloAck {
            session_id: self.session_id.clone(),
            capabilities: self.admitted_capabilities.iter().cloned().collect(),
            permissions: self.admitted_permissions.iter().cloned().collect(),
        }))?;
        self.send(PluginHostMessage::Activate(Activate {
            session_id: self.session_id.clone(),
            workspace_id: self.workspace_id.clone(),
            workspace_generation: self.workspace_generation,
            workspace_root,
            evidence,
            locale,
            theme,
        }))?;
        loop {
            let envelope = self.receive_until(deadline, "activation")?;
            match envelope.message {
                PluginHostMessage::ActivationReady(ready) => return Ok(ready.contributions),
                PluginHostMessage::ActivationFailed(error) => {
                    return Err(PluginRuntimeError::Remote(error));
                }
                PluginHostMessage::Diagnostic(diagnostic) => {
                    self.record_protocol_diagnostic(format!(
                        "{:?} {}: {}",
                        diagnostic.severity, diagnostic.code, diagnostic.message
                    ));
                }
                PluginHostMessage::CapabilityRequest(request) => {
                    self.answer_capability(request)?;
                }
                _ => {
                    return Err(PluginRuntimeError::Protocol(
                        "unexpected message while plugin activation was pending".to_owned(),
                    ));
                }
            }
        }
    }

    fn invoke(
        &self,
        callback_handle: &str,
        operation: &str,
        payload: JsonValue,
    ) -> Result<JsonValue, PluginRuntimeError> {
        if self.stopping.load(Ordering::Acquire) {
            return Err(PluginRuntimeError::NotActive(
                self.identity.plugin_id.clone(),
            ));
        }
        let current = self.in_flight.fetch_add(1, Ordering::AcqRel) + 1;
        if current as usize > MAX_IN_FLIGHT_CALLS {
            self.in_flight.fetch_sub(1, Ordering::AcqRel);
            return Err(PluginRuntimeError::Protocol(
                "plugin runtime in-flight request limit exceeded".to_owned(),
            ));
        }
        let result = self.invoke_serial(callback_handle, operation, payload);
        self.in_flight.fetch_sub(1, Ordering::AcqRel);
        if matches!(
            result,
            Err(PluginRuntimeError::Timeout(_)
                | PluginRuntimeError::Protocol(_)
                | PluginRuntimeError::Crashed(_))
        ) {
            self.force_stop();
        }
        result
    }

    fn invoke_serial(
        &self,
        callback_handle: &str,
        operation: &str,
        payload: JsonValue,
    ) -> Result<JsonValue, PluginRuntimeError> {
        let _gate = lock(&self.request_gate, "plugin request gate")?;
        let request_number = self.request_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let request_id = format!("request-{request_number}");
        self.send(PluginHostMessage::Invoke(Invoke {
            request_id: request_id.clone(),
            callback_handle: callback_handle.to_owned(),
            operation: operation.to_owned(),
            payload,
        }))?;
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        loop {
            let envelope = self.receive_until(deadline, "callback invocation")?;
            match envelope.message {
                PluginHostMessage::InvocationResult(result) if result.request_id == request_id => {
                    return Ok(result.payload);
                }
                PluginHostMessage::InvocationError(error) if error.request_id == request_id => {
                    return Err(PluginRuntimeError::Remote(error.error));
                }
                PluginHostMessage::CapabilityRequest(request) => self.answer_capability(request)?,
                PluginHostMessage::Diagnostic(diagnostic) => {
                    self.record_protocol_diagnostic(format!(
                        "{:?} {}: {}",
                        diagnostic.severity, diagnostic.code, diagnostic.message
                    ))
                }
                _ => {
                    return Err(PluginRuntimeError::Protocol(
                        "unexpected or mismatched message while callback was pending".to_owned(),
                    ));
                }
            }
        }
    }

    fn answer_capability(&self, request: CapabilityRequest) -> Result<(), PluginRuntimeError> {
        let result = if request.workspace_id != self.workspace_id
            || request.workspace_generation != self.workspace_generation
        {
            Err(RemoteFailure {
                code: "capability.workspace-stale".to_owned(),
                message: "capability request does not belong to the active workspace generation"
                    .to_owned(),
                retryable: false,
            })
        } else if !self.admitted_capabilities.contains(&request.capability) {
            Err(RemoteFailure {
                code: "capability.not-admitted".to_owned(),
                message: format!("capability is not admitted: {}", request.capability),
                retryable: false,
            })
        } else {
            self.capabilities.execute(
                &CapabilityContext {
                    owner: &self.key.owner,
                    plugin_id: &self.identity.plugin_id,
                    plugin_version: &self.identity.plugin_version,
                    package_digest: &self.identity.package_digest,
                    workspace_id: &self.workspace_id,
                    workspace_generation: self.workspace_generation,
                    admitted_permissions: &self.admitted_permissions,
                },
                &request,
            )
        };
        match result {
            Ok(payload) => self.send(PluginHostMessage::CapabilityResult(OperationResult {
                request_id: request.request_id,
                payload,
            })),
            Err(error) => self.send(PluginHostMessage::CapabilityError(OperationError {
                request_id: request.request_id,
                error,
            })),
        }
    }

    fn send(&self, message: PluginHostMessage) -> Result<(), PluginRuntimeError> {
        let sequence = self.outgoing_sequence.fetch_add(1, Ordering::Relaxed);
        let mut writer = lock(&self.writer, "plugin protocol writer")?;
        write_frame(&mut *writer, &ProtocolEnvelope::new(sequence, message))
            .map_err(|error| PluginRuntimeError::Protocol(error.to_string()))
    }

    fn receive_until(
        &self,
        deadline: Instant,
        operation: &'static str,
    ) -> Result<ProtocolEnvelope, PluginRuntimeError> {
        let timeout = deadline.saturating_duration_since(Instant::now());
        if timeout.is_zero() {
            return Err(PluginRuntimeError::Timeout(operation));
        }
        let receiver = lock(&self.receiver, "plugin protocol reader")?;
        match receiver.recv_timeout(timeout) {
            Ok(Ok(envelope)) => Ok(envelope),
            Ok(Err(error)) => Err(PluginRuntimeError::Protocol(error)),
            Err(RecvTimeoutError::Timeout) => Err(PluginRuntimeError::Timeout(operation)),
            Err(RecvTimeoutError::Disconnected) => Err(PluginRuntimeError::Crashed(
                "plugin helper closed its protocol pipe".to_owned(),
            )),
        }
    }

    fn diagnostics(&self) -> Result<PluginDiagnostics, PluginRuntimeError> {
        let diagnostics = lock(&self.diagnostics, "plugin diagnostics")?;
        Ok(PluginDiagnostics {
            stderr: String::from_utf8_lossy(&diagnostics.stderr).into_owned(),
            stderr_truncated: diagnostics.stderr_truncated,
            protocol_diagnostics: diagnostics.protocol.clone(),
        })
    }

    fn record_protocol_diagnostic(&self, message: String) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            if diagnostics.protocol.len() == 64 {
                diagnostics.protocol.remove(0);
            }
            diagnostics.protocol.push(message);
        }
    }

    fn stop(&self, reason: ShutdownReason) {
        if self.stopping.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(_gate) = self.request_gate.try_lock() {
            let _ = self.send(PluginHostMessage::Shutdown(Shutdown { reason }));
            let deadline = Instant::now() + SHUTDOWN_GRACE;
            let _ = self.receive_until(deadline, "shutdown").map(|envelope| {
                matches!(envelope.message, PluginHostMessage::ShutdownAck(ref ack) if ack.session_id == self.session_id)
            });
        }
        self.force_stop();
    }

    fn force_stop(&self) {
        if self.process_cleaned.swap(true, Ordering::AcqRel) {
            return;
        }
        terminate_process_tree(self.pid, &self.child);
    }
}

impl Drop for ManagedSession {
    fn drop(&mut self) {
        self.force_stop();
    }
}

fn validate_activation(activation: &PluginActivation) -> Result<(), PluginRuntimeError> {
    if activation.owner.is_empty() || activation.owner.len() > 256 {
        return Err(PluginRuntimeError::InvalidConfiguration(
            "owner must be a non-empty bounded identifier".to_owned(),
        ));
    }
    let envelope = ProtocolEnvelope::new(
        1,
        PluginHostMessage::HelloAck(HelloAck {
            session_id: "validation-session".to_owned(),
            capabilities: activation.capabilities.clone(),
            permissions: activation.permissions.clone(),
        }),
    );
    envelope
        .validate()
        .map_err(|error| PluginRuntimeError::InvalidConfiguration(error.to_string()))?;
    let expected = ExpectedPluginIdentity {
        plugin_id: &activation.identity.plugin_id,
        plugin_version: &activation.identity.plugin_version,
        package_digest: &activation.identity.package_digest,
        runtime_entry: &activation.identity.runtime_entry,
    };
    let hello = asterlyn_plugin_runtime_protocol::Hello {
        plugin_id: activation.identity.plugin_id.clone(),
        plugin_version: activation.identity.plugin_version.clone(),
        package_digest: activation.identity.package_digest.clone(),
        runtime_entry: activation.identity.runtime_entry.clone(),
    };
    hello
        .matches(&expected)
        .map_err(|error| PluginRuntimeError::InvalidConfiguration(error.to_string()))
}

fn spawn_protocol_reader(
    stdout: impl Read + Send + 'static,
) -> Receiver<Result<ProtocolEnvelope, String>> {
    let (sender, receiver) = mpsc::sync_channel(64);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut previous_sequence = 0_u64;
        loop {
            match read_frame(&mut reader) {
                Ok(Some(envelope)) => {
                    if envelope.sequence <= previous_sequence {
                        let _ = sender.send(Err(format!(
                            "incoming sequence must increase: previous {previous_sequence}, received {}",
                            envelope.sequence
                        )));
                        break;
                    }
                    previous_sequence = envelope.sequence;
                    if sender.send(Ok(envelope)).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    let _ = sender.send(Err(error.to_string()));
                    break;
                }
            }
        }
    });
    receiver
}

fn spawn_stderr_reader(stderr: impl Read + Send + 'static, buffer: Arc<Mutex<DiagnosticBuffer>>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut chunk = [0_u8; 8 * 1024];
        loop {
            let read = match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => read,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            };
            let Ok(mut diagnostics) = buffer.lock() else {
                break;
            };
            let remaining = MAX_STDERR_BYTES.saturating_sub(diagnostics.stderr.len());
            diagnostics
                .stderr
                .extend_from_slice(&chunk[..read.min(remaining)]);
            if read > remaining {
                diagnostics.stderr_truncated = true;
            }
        }
    });
}

fn terminate_process_tree(pid: u32, child: &Arc<Mutex<Option<Child>>>) {
    let process = child.lock().ok().and_then(|mut child| child.take());
    let Some(mut process) = process else {
        return;
    };
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
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
    let _ = process.kill();
    let _ = process.wait();
}

fn lock<'a, T>(
    mutex: &'a Mutex<T>,
    name: &'static str,
) -> Result<MutexGuard<'a, T>, PluginRuntimeError> {
    mutex
        .lock()
        .map_err(|_| PluginRuntimeError::Crashed(format!("{name} lock was poisoned")))
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn rejects_helper_outside_trusted_installation_root() {
        let trusted = TempDir::new().expect("trusted root");
        let untrusted = TempDir::new().expect("untrusted root");
        let helper = untrusted.path().join("helper");
        std::fs::write(&helper, b"fixture").expect("write helper");
        let error = PluginHostSupervisor::from_verified_helper(&helper, trusted.path())
            .err()
            .expect("outside helper rejected");
        assert!(error.to_string().contains("trusted installation root"));
    }
}
