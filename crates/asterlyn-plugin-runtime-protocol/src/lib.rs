use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::io::{self, Read, Write};
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

pub const PROTOCOL_VERSION: u32 = 1;
/// Maximum size of one physical pipe frame. Larger bounded protocol messages are segmented.
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// Maximum size of one reassembled protocol message, including its envelope.
pub const MAX_MESSAGE_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_IDENTIFIER_BYTES: usize = 128;
pub const MAX_DIAGNOSTIC_BYTES: usize = 4 * 1024;
pub const MAX_CONTRIBUTIONS: usize = 64;
pub const MAX_CALLBACKS_PER_CONTRIBUTION: usize = 32;
pub const MAX_CALLBACKS_PER_RESULT: usize = 64;
pub const MAX_RUNTIME_VALUE_DEPTH: usize = 32;
pub const REMOTE_CALLBACK_MARKER: &str = "$asterlynCallback";
pub const REMOTE_LISTENER_MARKER: &str = "$asterlynListener";
pub const MAX_LIST_ITEMS: usize = 64;
const MAX_VERSION_BYTES: usize = 64;
const MAX_RUNTIME_ENTRY_BYTES: usize = 512;
const MAX_STANDARD_PAYLOAD_BYTES: usize = 512 * 1024;
/// Workspace catalogs can legitimately contain tens of thousands of bounded relative paths.
/// Keep activation below the reassembled message ceiling while allowing the host catalog limit.
pub const MAX_ACTIVATION_EVIDENCE_BYTES: usize = 16 * 1024 * 1024;
/// Covers a 16 MiB decoded task-cache entry after base64 encoding plus result metadata.
const MAX_OPERATION_PAYLOAD_BYTES: usize = 24 * 1024 * 1024;
const MAX_CONTRIBUTION_PAYLOAD_BYTES: usize = 256 * 1024;
const FRAME_CONTINUATION_BIT: u32 = 1 << 31;
const FRAME_LENGTH_MASK: u32 = !FRAME_CONTINUATION_BIT;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolEnvelope {
    pub protocol: u32,
    pub sequence: u64,
    pub message: PluginHostMessage,
}

impl ProtocolEnvelope {
    pub fn new(sequence: u64, message: PluginHostMessage) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            sequence,
            message,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.protocol != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedProtocol(self.protocol));
        }
        if self.sequence == 0 {
            return Err(ProtocolError::InvalidField(
                "sequence must be greater than zero".to_owned(),
            ));
        }
        self.message.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PluginHostMessage {
    Hello(Hello),
    HelloAck(HelloAck),
    Activate(Activate),
    ActivationReady(ActivationReady),
    ActivationFailed(RemoteFailure),
    Invoke(Invoke),
    InvocationResult(OperationResult),
    InvocationError(OperationError),
    CapabilityRequest(CapabilityRequest),
    CapabilityResult(OperationResult),
    CapabilityError(OperationError),
    Event(Event),
    Cancel(Cancel),
    Diagnostic(Diagnostic),
    Shutdown(Shutdown),
    ShutdownAck(ShutdownAck),
}

impl PluginHostMessage {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Hello(message) => message.validate(),
            Self::HelloAck(message) => message.validate(),
            Self::Activate(message) => message.validate(),
            Self::ActivationReady(message) => message.validate(),
            Self::ActivationFailed(message) => message.validate(),
            Self::Invoke(message) => message.validate(),
            Self::InvocationResult(message) => message.validate(true),
            Self::CapabilityResult(message) => message.validate(false),
            Self::InvocationError(message) | Self::CapabilityError(message) => message.validate(),
            Self::CapabilityRequest(message) => message.validate(),
            Self::Event(message) => message.validate(),
            Self::Cancel(message) => message.validate(),
            Self::Diagnostic(message) => message.validate(),
            Self::Shutdown(message) => message.validate(),
            Self::ShutdownAck(message) => message.validate(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hello {
    pub plugin_id: String,
    pub plugin_version: String,
    pub package_digest: String,
    pub runtime_entry: String,
}

impl Hello {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_plugin_id(&self.plugin_id)?;
        validate_version(&self.plugin_version)?;
        validate_sha256(&self.package_digest)?;
        validate_runtime_entry(&self.runtime_entry)
    }

    pub fn matches(&self, expected: &ExpectedPluginIdentity<'_>) -> Result<(), ProtocolError> {
        self.validate()?;
        if self.plugin_id != expected.plugin_id
            || self.plugin_version != expected.plugin_version
            || self.package_digest != expected.package_digest
            || self.runtime_entry != expected.runtime_entry
        {
            return Err(ProtocolError::IdentityMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExpectedPluginIdentity<'a> {
    pub plugin_id: &'a str,
    pub plugin_version: &'a str,
    pub package_digest: &'a str,
    pub runtime_entry: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelloAck {
    pub session_id: String,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
}

impl HelloAck {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("sessionId", &self.session_id)?;
        validate_unique_names("capabilities", &self.capabilities)?;
        validate_unique_names("permissions", &self.permissions)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Activate {
    pub session_id: String,
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub workspace_root: String,
    pub evidence: JsonValue,
    pub locale: String,
    pub theme: HostTheme,
}

impl Activate {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("sessionId", &self.session_id)?;
        validate_identifier("workspaceId", &self.workspace_id)?;
        if self.workspace_generation == 0 {
            return Err(ProtocolError::InvalidField(
                "workspaceGeneration must be greater than zero".to_owned(),
            ));
        }
        validate_short_text("workspaceRoot", &self.workspace_root, 4 * 1024)?;
        validate_json_size(
            "activation evidence",
            &self.evidence,
            MAX_ACTIVATION_EVIDENCE_BYTES,
        )?;
        validate_short_text("locale", &self.locale, 32)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostTheme {
    Light,
    Dark,
    HighContrast,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivationReady {
    pub contributions: Vec<RuntimeContribution>,
}

impl ActivationReady {
    fn validate(&self) -> Result<(), ProtocolError> {
        if self.contributions.len() > MAX_CONTRIBUTIONS {
            return Err(ProtocolError::LimitExceeded("contributions"));
        }
        let mut contribution_ids = BTreeSet::new();
        let mut callback_handles = BTreeSet::new();
        for contribution in &self.contributions {
            contribution.validate()?;
            if !contribution_ids.insert(contribution.id.as_str()) {
                return Err(ProtocolError::DuplicateIdentifier(contribution.id.clone()));
            }
            for handle in contribution.callbacks.values() {
                if !callback_handles.insert(handle.as_str()) {
                    return Err(ProtocolError::DuplicateIdentifier(handle.clone()));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeContribution {
    pub kind: ContributionKind,
    pub id: String,
    pub payload: JsonValue,
    pub callbacks: BTreeMap<String, String>,
}

impl RuntimeContribution {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("contribution.id", &self.id)?;
        if self.callbacks.len() > MAX_CALLBACKS_PER_CONTRIBUTION {
            return Err(ProtocolError::LimitExceeded("contribution callbacks"));
        }
        for (operation, handle) in &self.callbacks {
            validate_name("callback operation", operation)?;
            validate_identifier("callback handle", handle)?;
        }
        validate_runtime_value(&self.payload, false, false)?;
        validate_json_size(
            "contribution payload",
            &self.payload,
            MAX_CONTRIBUTION_PAYLOAD_BYTES,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContributionKind {
    Command,
    TaskProvider,
    ExecutionTargetProvider,
    RunConfigurationProvider,
    LanguageService,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Invoke {
    pub request_id: String,
    pub callback_handle: String,
    pub operation: String,
    pub payload: JsonValue,
}

impl Invoke {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("requestId", &self.request_id)?;
        validate_identifier("callbackHandle", &self.callback_handle)?;
        validate_name("operation", &self.operation)?;
        validate_runtime_value(&self.payload, false, true)?;
        validate_json_size("invoke payload", &self.payload, MAX_OPERATION_PAYLOAD_BYTES)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityRequest {
    pub request_id: String,
    pub workspace_id: String,
    pub workspace_generation: u64,
    pub capability: String,
    pub operation: String,
    pub payload: JsonValue,
}

impl CapabilityRequest {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("requestId", &self.request_id)?;
        validate_identifier("workspaceId", &self.workspace_id)?;
        if self.workspace_generation == 0 {
            return Err(ProtocolError::InvalidField(
                "workspaceGeneration must be greater than zero".to_owned(),
            ));
        }
        validate_name("capability", &self.capability)?;
        validate_name("operation", &self.operation)?;
        validate_runtime_value(&self.payload, false, false)?;
        validate_json_size(
            "capability payload",
            &self.payload,
            MAX_OPERATION_PAYLOAD_BYTES,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationResult {
    pub request_id: String,
    pub payload: JsonValue,
}

impl OperationResult {
    fn validate(&self, allow_remote_callbacks: bool) -> Result<(), ProtocolError> {
        validate_identifier("requestId", &self.request_id)?;
        validate_runtime_value(&self.payload, allow_remote_callbacks, false)?;
        validate_json_size("result payload", &self.payload, MAX_OPERATION_PAYLOAD_BYTES)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteCallbackReference {
    pub handle: String,
    pub operation: String,
}

pub fn remote_callback_value(handle: String, operation: String) -> JsonValue {
    serde_json::json!({
        REMOTE_CALLBACK_MARKER: RemoteCallbackReference { handle, operation }
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteListenerReference {
    pub subscription_handle: String,
}

pub fn remote_listener_value(subscription_handle: String) -> JsonValue {
    serde_json::json!({
        REMOTE_LISTENER_MARKER: RemoteListenerReference { subscription_handle }
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationError {
    pub request_id: String,
    pub error: RemoteFailure,
}

impl OperationError {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("requestId", &self.request_id)?;
        self.error.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub subscription_handle: String,
    pub payload: JsonValue,
}

impl Event {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("subscriptionHandle", &self.subscription_handle)?;
        validate_runtime_value(&self.payload, false, false)?;
        validate_json_size("event payload", &self.payload, MAX_STANDARD_PAYLOAD_BYTES)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cancel {
    pub request_id: String,
}

impl Cancel {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("requestId", &self.request_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diagnostic {
    pub severity: DiagnosticSeverity,
    pub code: String,
    pub message: String,
}

impl Diagnostic {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_name("diagnostic code", &self.code)?;
        validate_short_text("diagnostic message", &self.message, MAX_DIAGNOSTIC_BYTES)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    Debug,
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl RemoteFailure {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_name("error code", &self.code)?;
        validate_short_text("error message", &self.message, MAX_DIAGNOSTIC_BYTES)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shutdown {
    pub reason: ShutdownReason,
}

impl Shutdown {
    fn validate(&self) -> Result<(), ProtocolError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShutdownReason {
    Disabled,
    WorkspaceReplaced,
    WindowClosed,
    ApplicationExit,
    Restart,
    ProtocolViolation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShutdownAck {
    pub session_id: String,
}

impl ShutdownAck {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_identifier("sessionId", &self.session_id)
    }
}

#[derive(Debug)]
pub enum ProtocolError {
    Io(io::Error),
    EmptyFrame,
    FrameTooLarge(usize),
    MessageTooLarge(usize),
    TruncatedFrame { expected: usize, actual: usize },
    InvalidJson(String),
    UnsupportedProtocol(u32),
    InvalidField(String),
    LimitExceeded(&'static str),
    DuplicateIdentifier(String),
    IdentityMismatch,
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "plugin runtime protocol I/O failed: {error}"),
            Self::EmptyFrame => write!(formatter, "plugin runtime protocol frame is empty"),
            Self::FrameTooLarge(size) => write!(
                formatter,
                "plugin runtime protocol frame exceeds {MAX_FRAME_BYTES} bytes: {size}"
            ),
            Self::MessageTooLarge(size) => write!(
                formatter,
                "plugin runtime protocol message exceeds {MAX_MESSAGE_BYTES} bytes: {size}"
            ),
            Self::TruncatedFrame { expected, actual } => write!(
                formatter,
                "plugin runtime protocol frame is truncated: expected {expected} bytes, read {actual}"
            ),
            Self::InvalidJson(message) => {
                write!(formatter, "invalid plugin runtime protocol JSON: {message}")
            }
            Self::UnsupportedProtocol(version) => {
                write!(formatter, "unsupported plugin runtime protocol: {version}")
            }
            Self::InvalidField(message) => {
                write!(
                    formatter,
                    "invalid plugin runtime protocol field: {message}"
                )
            }
            Self::LimitExceeded(field) => {
                write!(formatter, "plugin runtime protocol limit exceeded: {field}")
            }
            Self::DuplicateIdentifier(identifier) => {
                write!(
                    formatter,
                    "duplicate plugin runtime identifier: {identifier}"
                )
            }
            Self::IdentityMismatch => write!(formatter, "plugin runtime identity mismatch"),
        }
    }
}

impl std::error::Error for ProtocolError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

pub fn write_frame(
    writer: &mut impl Write,
    envelope: &ProtocolEnvelope,
) -> Result<(), ProtocolError> {
    envelope.validate()?;
    let payload = serde_json::to_vec(envelope)
        .map_err(|error| ProtocolError::InvalidJson(error.to_string()))?;
    if payload.is_empty() {
        return Err(ProtocolError::EmptyFrame);
    }
    if payload.len() > MAX_MESSAGE_BYTES {
        return Err(ProtocolError::MessageTooLarge(payload.len()));
    }
    let chunk_count = payload.len().div_ceil(MAX_FRAME_BYTES);
    for (index, chunk) in payload.chunks(MAX_FRAME_BYTES).enumerate() {
        let mut length =
            u32::try_from(chunk.len()).map_err(|_| ProtocolError::FrameTooLarge(chunk.len()))?;
        if index + 1 < chunk_count {
            length |= FRAME_CONTINUATION_BIT;
        }
        writer
            .write_all(&length.to_be_bytes())
            .map_err(ProtocolError::Io)?;
        writer.write_all(chunk).map_err(ProtocolError::Io)?;
    }
    writer.flush().map_err(ProtocolError::Io)
}

pub fn read_frame(reader: &mut impl Read) -> Result<Option<ProtocolEnvelope>, ProtocolError> {
    let Some(mut header) = read_frame_header(reader, true)? else {
        return Ok(None);
    };
    let mut payload = Vec::new();
    loop {
        let continued = header & FRAME_CONTINUATION_BIT != 0;
        let length = (header & FRAME_LENGTH_MASK) as usize;
        if length == 0 {
            return Err(ProtocolError::EmptyFrame);
        }
        if length > MAX_FRAME_BYTES {
            return Err(ProtocolError::FrameTooLarge(length));
        }
        let next_size = payload
            .len()
            .checked_add(length)
            .ok_or(ProtocolError::MessageTooLarge(usize::MAX))?;
        if next_size > MAX_MESSAGE_BYTES {
            return Err(ProtocolError::MessageTooLarge(next_size));
        }
        let offset = payload.len();
        payload.resize(next_size, 0);
        read_exact_counted(reader, &mut payload[offset..], length, 0)?;
        if !continued {
            break;
        }
        header = read_frame_header(reader, false)?.expect("required continuation header");
    }
    let envelope: ProtocolEnvelope = serde_json::from_slice(&payload)
        .map_err(|error| ProtocolError::InvalidJson(error.to_string()))?;
    envelope.validate()?;
    Ok(Some(envelope))
}

fn read_frame_header(
    reader: &mut impl Read,
    allow_clean_end: bool,
) -> Result<Option<u32>, ProtocolError> {
    let mut length_bytes = [0_u8; 4];
    loop {
        match reader.read(&mut length_bytes[..1]) {
            Ok(0) if allow_clean_end => return Ok(None),
            Ok(0) => {
                return Err(ProtocolError::TruncatedFrame {
                    expected: 4,
                    actual: 0,
                });
            }
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(ProtocolError::Io(error)),
        }
    }
    read_exact_counted(reader, &mut length_bytes[1..], 4, 1)?;
    Ok(Some(u32::from_be_bytes(length_bytes)))
}

fn read_exact_counted(
    reader: &mut impl Read,
    buffer: &mut [u8],
    expected: usize,
    already_read: usize,
) -> Result<(), ProtocolError> {
    let mut offset = 0;
    while offset < buffer.len() {
        match reader.read(&mut buffer[offset..]) {
            Ok(0) => {
                return Err(ProtocolError::TruncatedFrame {
                    expected,
                    actual: already_read + offset,
                });
            }
            Ok(count) => offset += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(ProtocolError::Io(error)),
        }
    }
    Ok(())
}

fn validate_plugin_id(value: &str) -> Result<(), ProtocolError> {
    validate_short_text("pluginId", value, MAX_IDENTIFIER_BYTES)?;
    if !value.contains('.')
        || value.starts_with('.')
        || value.ends_with('.')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(ProtocolError::InvalidField(
            "pluginId has an invalid format".to_owned(),
        ));
    }
    Ok(())
}

fn validate_version(value: &str) -> Result<(), ProtocolError> {
    validate_short_text("pluginVersion", value, MAX_VERSION_BYTES)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
    {
        return Err(ProtocolError::InvalidField(
            "pluginVersion has an invalid format".to_owned(),
        ));
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<(), ProtocolError> {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return Err(ProtocolError::InvalidField(
            "packageDigest must use sha256".to_owned(),
        ));
    };
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ProtocolError::InvalidField(
            "packageDigest must contain 64 hexadecimal characters".to_owned(),
        ));
    }
    Ok(())
}

fn validate_runtime_entry(value: &str) -> Result<(), ProtocolError> {
    validate_short_text("runtimeEntry", value, MAX_RUNTIME_ENTRY_BYTES)?;
    let path = Path::new(value);
    if path.is_absolute()
        || value.contains('\\')
        || value.contains(':')
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ProtocolError::InvalidField(
            "runtimeEntry must be a normalized relative path".to_owned(),
        ));
    }
    Ok(())
}

fn validate_identifier(field: &str, value: &str) -> Result<(), ProtocolError> {
    validate_short_text(field, value, MAX_IDENTIFIER_BYTES)?;
    if !value.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':' | b'/')
    }) {
        return Err(ProtocolError::InvalidField(format!(
            "{field} has an invalid format"
        )));
    }
    Ok(())
}

fn validate_name(field: &str, value: &str) -> Result<(), ProtocolError> {
    validate_short_text(field, value, MAX_IDENTIFIER_BYTES)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(ProtocolError::InvalidField(format!(
            "{field} has an invalid format"
        )));
    }
    Ok(())
}

fn validate_unique_names(field: &'static str, values: &[String]) -> Result<(), ProtocolError> {
    if values.len() > MAX_LIST_ITEMS {
        return Err(ProtocolError::LimitExceeded(field));
    }
    let mut unique = BTreeSet::new();
    for value in values {
        validate_name(field, value)?;
        if !unique.insert(value.as_str()) {
            return Err(ProtocolError::DuplicateIdentifier(value.clone()));
        }
    }
    Ok(())
}

fn validate_short_text(field: &str, value: &str, max_bytes: usize) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > max_bytes || value.chars().any(char::is_control) {
        return Err(ProtocolError::InvalidField(format!(
            "{field} must contain 1 to {max_bytes} non-control UTF-8 bytes"
        )));
    }
    Ok(())
}

fn validate_json_size(
    field: &'static str,
    value: &JsonValue,
    max_bytes: usize,
) -> Result<(), ProtocolError> {
    let size = serde_json::to_vec(value)
        .map_err(|error| ProtocolError::InvalidJson(error.to_string()))?
        .len();
    if size > max_bytes {
        return Err(ProtocolError::LimitExceeded(field));
    }
    Ok(())
}

fn validate_runtime_value(
    value: &JsonValue,
    allow_remote_callbacks: bool,
    allow_remote_listeners: bool,
) -> Result<(), ProtocolError> {
    let mut callback_handles = BTreeSet::new();
    let mut listener_handles = BTreeSet::new();
    validate_runtime_value_at_depth(
        value,
        allow_remote_callbacks,
        allow_remote_listeners,
        0,
        &mut callback_handles,
        &mut listener_handles,
    )
}

fn validate_runtime_value_at_depth(
    value: &JsonValue,
    allow_remote_callbacks: bool,
    allow_remote_listeners: bool,
    depth: usize,
    callback_handles: &mut BTreeSet<String>,
    listener_handles: &mut BTreeSet<String>,
) -> Result<(), ProtocolError> {
    if depth > MAX_RUNTIME_VALUE_DEPTH {
        return Err(ProtocolError::LimitExceeded("runtime value depth"));
    }
    match value {
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => {
            Ok(())
        }
        JsonValue::Array(items) => {
            for item in items {
                validate_runtime_value_at_depth(
                    item,
                    allow_remote_callbacks,
                    allow_remote_listeners,
                    depth + 1,
                    callback_handles,
                    listener_handles,
                )?;
            }
            Ok(())
        }
        JsonValue::Object(object) => {
            if let Some(reference) = object.get(REMOTE_CALLBACK_MARKER) {
                if !allow_remote_callbacks {
                    return Err(ProtocolError::InvalidField(
                        "remote callback references are not allowed in this payload".to_owned(),
                    ));
                }
                if object.len() != 1 {
                    return Err(ProtocolError::InvalidField(
                        "remote callback reference must not contain sibling fields".to_owned(),
                    ));
                }
                let reference: RemoteCallbackReference = serde_json::from_value(reference.clone())
                    .map_err(|error| {
                        ProtocolError::InvalidField(format!(
                            "remote callback reference is invalid: {error}"
                        ))
                    })?;
                validate_identifier("remote callback handle", &reference.handle)?;
                validate_name("remote callback operation", &reference.operation)?;
                if callback_handles.len() >= MAX_CALLBACKS_PER_RESULT {
                    return Err(ProtocolError::LimitExceeded("result callbacks"));
                }
                if !callback_handles.insert(reference.handle.clone()) {
                    return Err(ProtocolError::DuplicateIdentifier(reference.handle));
                }
                return Ok(());
            }
            if let Some(reference) = object.get(REMOTE_LISTENER_MARKER) {
                if !allow_remote_listeners {
                    return Err(ProtocolError::InvalidField(
                        "remote listener references are not allowed in this payload".to_owned(),
                    ));
                }
                if object.len() != 1 {
                    return Err(ProtocolError::InvalidField(
                        "remote listener reference must not contain sibling fields".to_owned(),
                    ));
                }
                let reference: RemoteListenerReference = serde_json::from_value(reference.clone())
                    .map_err(|error| {
                        ProtocolError::InvalidField(format!(
                            "remote listener reference is invalid: {error}"
                        ))
                    })?;
                validate_identifier("remote listener handle", &reference.subscription_handle)?;
                if !listener_handles.insert(reference.subscription_handle.clone()) {
                    return Err(ProtocolError::DuplicateIdentifier(
                        reference.subscription_handle,
                    ));
                }
                return Ok(());
            }
            for item in object.values() {
                validate_runtime_value_at_depth(
                    item,
                    allow_remote_callbacks,
                    allow_remote_listeners,
                    depth + 1,
                    callback_handles,
                    listener_handles,
                )?;
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn hello() -> ProtocolEnvelope {
        ProtocolEnvelope::new(
            1,
            PluginHostMessage::Hello(Hello {
                plugin_id: "dev.asterlyn.fixture".to_owned(),
                plugin_version: "1.2.3".to_owned(),
                package_digest: format!("sha256:{}", "a".repeat(64)),
                runtime_entry: "runtime/plugin.js".to_owned(),
            }),
        )
    }

    #[test]
    fn frame_round_trip_is_length_prefixed_and_validated() {
        let expected = hello();
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &expected).expect("write frame");

        let declared = u32::from_be_bytes(bytes[..4].try_into().expect("length")) as usize;
        assert_eq!(declared, bytes.len() - 4);
        let actual = read_frame(&mut Cursor::new(bytes))
            .expect("read frame")
            .expect("frame");
        assert_eq!(actual, expected);
    }

    #[test]
    fn large_operation_messages_are_segmented_without_expanding_physical_frames() {
        let cache_payload = "a".repeat(2 * 1024 * 1024);
        let expected = ProtocolEnvelope::new(
            7,
            PluginHostMessage::CapabilityResult(OperationResult {
                request_id: "capability-1".to_owned(),
                payload: serde_json::json!({"payloadBase64": cache_payload}),
            }),
        );
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &expected).expect("write segmented message");

        let mut offset = 0;
        let mut frame_count = 0;
        while offset < bytes.len() {
            let header = u32::from_be_bytes(
                bytes[offset..offset + 4]
                    .try_into()
                    .expect("physical frame header"),
            );
            offset += 4;
            let continued = header & FRAME_CONTINUATION_BIT != 0;
            let length = (header & FRAME_LENGTH_MASK) as usize;
            assert!(length <= MAX_FRAME_BYTES);
            offset += length;
            frame_count += 1;
            assert_eq!(continued, offset < bytes.len());
        }
        assert_eq!(offset, bytes.len());
        assert!(frame_count > 1);

        let actual = read_frame(&mut Cursor::new(bytes))
            .expect("read segmented message")
            .expect("segmented message");
        assert_eq!(actual, expected);
    }

    #[test]
    fn activation_evidence_has_a_catalog_specific_budget() {
        let activation = Activate {
            session_id: "session-1".to_owned(),
            workspace_id: "workspace-1".to_owned(),
            workspace_generation: 1,
            workspace_root: "/workspace".to_owned(),
            evidence: serde_json::json!({
                "files": ["a".repeat(MAX_STANDARD_PAYLOAD_BYTES + 1)]
            }),
            locale: "en-US".to_owned(),
            theme: HostTheme::Dark,
        };
        activation
            .validate()
            .expect("a catalog larger than a standard event remains valid");

        let oversized = Activate {
            evidence: serde_json::json!({
                "files": ["a".repeat(MAX_ACTIVATION_EVIDENCE_BYTES + 1)]
            }),
            ..activation
        };
        assert!(matches!(
            oversized.validate(),
            Err(ProtocolError::LimitExceeded("activation evidence"))
        ));
    }

    #[test]
    fn large_payload_allowance_is_limited_to_operation_messages() {
        let payload = serde_json::json!({
            "payloadBase64": "a".repeat(MAX_STANDARD_PAYLOAD_BYTES + 1)
        });
        CapabilityRequest {
            request_id: "capability-1".to_owned(),
            workspace_id: "workspace-1".to_owned(),
            workspace_generation: 1,
            capability: "taskCache".to_owned(),
            operation: "write".to_owned(),
            payload: payload.clone(),
        }
        .validate()
        .expect("bounded task-cache operation payload");

        let event = Event {
            subscription_handle: "subscription-1".to_owned(),
            payload,
        };
        assert!(matches!(
            event.validate(),
            Err(ProtocolError::LimitExceeded("event payload"))
        ));
    }

    #[test]
    fn clean_end_of_stream_is_not_a_truncated_frame() {
        assert!(
            read_frame(&mut Cursor::new(Vec::<u8>::new()))
                .expect("clean end")
                .is_none()
        );
    }

    #[test]
    fn rejects_oversized_length_before_allocating_payload() {
        let bytes = ((MAX_FRAME_BYTES + 1) as u32).to_be_bytes();
        assert!(matches!(
            read_frame(&mut Cursor::new(bytes)),
            Err(ProtocolError::FrameTooLarge(size)) if size == MAX_FRAME_BYTES + 1
        ));
    }

    #[test]
    fn rejects_zero_and_truncated_frames() {
        assert!(matches!(
            read_frame(&mut Cursor::new(0_u32.to_be_bytes())),
            Err(ProtocolError::EmptyFrame)
        ));

        let mut bytes = 10_u32.to_be_bytes().to_vec();
        bytes.extend_from_slice(b"short");
        assert!(matches!(
            read_frame(&mut Cursor::new(bytes)),
            Err(ProtocolError::TruncatedFrame {
                expected: 10,
                actual: 5
            })
        ));

        let continued = (1_u32 | FRAME_CONTINUATION_BIT).to_be_bytes();
        let mut bytes = continued.to_vec();
        bytes.push(b'{');
        assert!(matches!(
            read_frame(&mut Cursor::new(bytes)),
            Err(ProtocolError::TruncatedFrame {
                expected: 4,
                actual: 0
            })
        ));
    }

    #[test]
    fn rejects_unknown_fields_and_message_types() {
        let unknown_field = br#"{"protocol":1,"sequence":1,"message":{"type":"shutdownAck","data":{"sessionId":"session-1","extra":true}}}"#;
        let mut bytes = (unknown_field.len() as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(unknown_field);
        assert!(matches!(
            read_frame(&mut Cursor::new(bytes)),
            Err(ProtocolError::InvalidJson(_))
        ));

        let unknown_type =
            br#"{"protocol":1,"sequence":1,"message":{"type":"executeAnything","data":{}}}"#;
        let mut bytes = (unknown_type.len() as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(unknown_type);
        assert!(matches!(
            read_frame(&mut Cursor::new(bytes)),
            Err(ProtocolError::InvalidJson(_))
        ));
    }

    #[test]
    fn rejects_wrong_protocol_and_zero_sequence() {
        let mut wrong_protocol = hello();
        wrong_protocol.protocol = 2;
        assert!(matches!(
            wrong_protocol.validate(),
            Err(ProtocolError::UnsupportedProtocol(2))
        ));

        let mut zero_sequence = hello();
        zero_sequence.sequence = 0;
        assert!(matches!(
            zero_sequence.validate(),
            Err(ProtocolError::InvalidField(_))
        ));
    }

    #[test]
    fn hello_requires_exact_supervisor_identity() {
        let PluginHostMessage::Hello(message) = hello().message else {
            panic!("expected hello")
        };
        message
            .matches(&ExpectedPluginIdentity {
                plugin_id: "dev.asterlyn.fixture",
                plugin_version: "1.2.3",
                package_digest: &format!("sha256:{}", "a".repeat(64)),
                runtime_entry: "runtime/plugin.js",
            })
            .expect("matching identity");
        assert!(matches!(
            message.matches(&ExpectedPluginIdentity {
                plugin_id: "dev.asterlyn.other",
                plugin_version: "1.2.3",
                package_digest: &format!("sha256:{}", "a".repeat(64)),
                runtime_entry: "runtime/plugin.js",
            }),
            Err(ProtocolError::IdentityMismatch)
        ));
    }

    #[test]
    fn activation_rejects_duplicate_contributions_and_callback_handles() {
        let contribution = RuntimeContribution {
            kind: ContributionKind::Command,
            id: "fixture.command".to_owned(),
            payload: serde_json::json!({"title": "Fixture"}),
            callbacks: BTreeMap::from([("execute".to_owned(), "callback-1".to_owned())]),
        };
        let duplicate_id = ActivationReady {
            contributions: vec![contribution.clone(), contribution.clone()],
        };
        assert!(matches!(
            duplicate_id.validate(),
            Err(ProtocolError::DuplicateIdentifier(identifier)) if identifier == "fixture.command"
        ));

        let duplicate_handle = ActivationReady {
            contributions: vec![
                contribution,
                RuntimeContribution {
                    kind: ContributionKind::TaskProvider,
                    id: "fixture.tasks".to_owned(),
                    payload: serde_json::json!({}),
                    callbacks: BTreeMap::from([("snapshot".to_owned(), "callback-1".to_owned())]),
                },
            ],
        };
        assert!(matches!(
            duplicate_handle.validate(),
            Err(ProtocolError::DuplicateIdentifier(identifier)) if identifier == "callback-1"
        ));
    }

    #[test]
    fn activation_enforces_contribution_and_callback_limits() {
        let excessive_contributions = ActivationReady {
            contributions: (0..=MAX_CONTRIBUTIONS)
                .map(|index| RuntimeContribution {
                    kind: ContributionKind::Command,
                    id: format!("fixture.command.{index}"),
                    payload: JsonValue::Null,
                    callbacks: BTreeMap::new(),
                })
                .collect(),
        };
        assert!(matches!(
            excessive_contributions.validate(),
            Err(ProtocolError::LimitExceeded("contributions"))
        ));

        let excessive_callbacks = ActivationReady {
            contributions: vec![RuntimeContribution {
                kind: ContributionKind::Command,
                id: "fixture.command".to_owned(),
                payload: JsonValue::Null,
                callbacks: (0..=MAX_CALLBACKS_PER_CONTRIBUTION)
                    .map(|index| (format!("operation{index}"), format!("callback-{index}")))
                    .collect(),
            }],
        };
        assert!(matches!(
            excessive_callbacks.validate(),
            Err(ProtocolError::LimitExceeded("contribution callbacks"))
        ));
    }

    #[test]
    fn invocation_results_accept_only_exact_bounded_remote_callback_references() {
        let result = OperationResult {
            request_id: "request-1".to_owned(),
            payload: serde_json::json!({
                "plan": {
                    "apply": remote_callback_value("callback-9".to_owned(), "apply".to_owned())
                }
            }),
        };
        result.validate(true).expect("valid remote callback");
        assert!(matches!(
            result.validate(false),
            Err(ProtocolError::InvalidField(message))
                if message.contains("not allowed")
        ));

        let duplicate = OperationResult {
            request_id: "request-2".to_owned(),
            payload: serde_json::json!([
                remote_callback_value("callback-9".to_owned(), "apply".to_owned()),
                remote_callback_value("callback-9".to_owned(), "dispose".to_owned())
            ]),
        };
        assert!(matches!(
            duplicate.validate(true),
            Err(ProtocolError::DuplicateIdentifier(identifier)) if identifier == "callback-9"
        ));

        let sibling = OperationResult {
            request_id: "request-3".to_owned(),
            payload: serde_json::json!({
                REMOTE_CALLBACK_MARKER: { "handle": "callback-1", "operation": "apply" },
                "unexpected": true
            }),
        };
        assert!(matches!(
            sibling.validate(true),
            Err(ProtocolError::InvalidField(message))
                if message.contains("sibling")
        ));
    }

    #[test]
    fn runtime_values_reject_excessive_nesting() {
        let mut payload = JsonValue::Null;
        for _ in 0..=MAX_RUNTIME_VALUE_DEPTH {
            payload = serde_json::json!([payload]);
        }
        let result = OperationResult {
            request_id: "request-1".to_owned(),
            payload,
        };
        assert!(matches!(
            result.validate(true),
            Err(ProtocolError::LimitExceeded("runtime value depth"))
        ));
    }

    #[test]
    fn invoke_arguments_accept_only_exact_remote_listener_references() {
        let request = Invoke {
            request_id: "request-1".to_owned(),
            callback_handle: "callback-1".to_owned(),
            operation: "subscribe".to_owned(),
            payload: serde_json::json!({
                "arguments": [remote_listener_value("subscription-1".to_owned())]
            }),
        };
        request.validate().expect("valid listener reference");

        let event = Event {
            subscription_handle: "subscription-1".to_owned(),
            payload: remote_listener_value("subscription-2".to_owned()),
        };
        assert!(matches!(
            event.validate(),
            Err(ProtocolError::InvalidField(message)) if message.contains("not allowed")
        ));
    }

    #[test]
    fn shutdown_round_trip_retains_lifecycle_reason() {
        let expected = ProtocolEnvelope::new(
            9,
            PluginHostMessage::Shutdown(Shutdown {
                reason: ShutdownReason::WorkspaceReplaced,
            }),
        );
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &expected).expect("write shutdown");
        assert_eq!(
            read_frame(&mut Cursor::new(bytes)).expect("read shutdown"),
            Some(expected)
        );
    }
}
