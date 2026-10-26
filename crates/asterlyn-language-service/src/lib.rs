//! Host-owned language-service transport primitives.
//!
//! This crate deliberately contains no editor or Tauri dependencies.  The transport is a
//! bounded Content-Length JSON-RPC stream suitable for a supervised stdio child; callers own
//! the child process and must perform approval/resource checks before constructing a session.

use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, sync_channel};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_HEADER_BYTES: usize = 8 * 1024;
pub const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_PENDING_REQUESTS: usize = 128;
pub const TYPESCRIPT_SERVER_ENTRY: &str = "servers/typescript/server.mjs";
pub const TYPESCRIPT_IMPL_ENTRY: &str = "servers/typescript/typescript/lib/tsserver.js";
pub const MAX_EVENTS: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    Io(String),
    InvalidHeader,
    MissingLength,
    InvalidLength,
    Oversized(usize),
    UnexpectedEof,
}

impl From<io::Error> for FrameError {
    fn from(value: io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

pub fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, FrameError> {
    let mut headers = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        let read = reader.read(&mut byte)?;
        if read == 0 {
            return if headers.is_empty() {
                Ok(None)
            } else {
                Err(FrameError::UnexpectedEof)
            };
        }
        headers.push(byte[0]);
        if headers.len() > MAX_HEADER_BYTES {
            return Err(FrameError::InvalidHeader);
        }
        if headers.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let header = std::str::from_utf8(&headers[..headers.len() - 4])
        .map_err(|_| FrameError::InvalidHeader)?;
    let mut length = None;
    for line in header.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            return Err(FrameError::InvalidHeader);
        };
        if name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err(FrameError::InvalidHeader);
            }
            length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| FrameError::InvalidLength)?,
            );
        }
    }
    let length = length.ok_or(FrameError::MissingLength)?;
    if length > MAX_MESSAGE_BYTES {
        return Err(FrameError::Oversized(length));
    }
    let mut body = vec![0_u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|_| FrameError::UnexpectedEof)?;
    Ok(Some(body))
}

pub fn write_frame<W: Write>(writer: &mut W, body: &[u8]) -> Result<(), FrameError> {
    if body.len() > MAX_MESSAGE_BYTES {
        return Err(FrameError::Oversized(body.len()));
    }
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(body)?;
    writer.flush()?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum JsonRpcMessage {
    Request(JsonRpcRequest),
    Response(JsonRpcResponse),
    Notification(JsonRpcNotification),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: JsonRpcId,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: JsonRpcId,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(untagged)]
pub enum JsonRpcId {
    Number(u64),
    String(String),
}

#[derive(Debug)]
pub struct PendingRequests {
    next_id: AtomicU64,
    pending: BTreeMap<u64, Instant>,
}

impl Default for PendingRequests {
    fn default() -> Self {
        Self::new()
    }
}

impl PendingRequests {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            pending: BTreeMap::new(),
        }
    }
    pub fn reserve(&mut self) -> Result<u64, SessionError> {
        if self.pending.len() >= MAX_PENDING_REQUESTS {
            return Err(SessionError::LimitExceeded("pending requests"));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.pending.insert(id, Instant::now());
        Ok(id)
    }
    pub fn complete(&mut self, id: &JsonRpcId) -> bool {
        match id {
            JsonRpcId::Number(value) => self.pending.remove(value).is_some(),
            JsonRpcId::String(_) => false,
        }
    }
    pub fn cancel(&mut self, id: u64) -> bool {
        self.complete(&JsonRpcId::Number(id))
    }
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
    pub fn len(&self) -> usize {
        self.pending.len()
    }
    pub fn expire_older_than(&mut self, age: Duration) -> Vec<u64> {
        let now = Instant::now();
        let expired = self
            .pending
            .iter()
            .filter(|(_, started)| now.duration_since(**started) >= age)
            .map(|(id, _)| *id)
            .collect::<Vec<_>>();
        for id in &expired {
            self.pending.remove(id);
        }
        expired
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    LimitExceeded(&'static str),
    InvalidMessage(String),
    Cancelled,
    Closed,
    Process(String),
    Timeout,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ServerEvent {
    Message(JsonRpcMessage),
    Eof,
    Io(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeScriptServerProfile {
    pub package_root: PathBuf,
    pub node: PathBuf,
}

impl TypeScriptServerProfile {
    pub fn validate(&self) -> Result<(), SessionError> {
        if !self.node.is_absolute() || !self.package_root.is_absolute() {
            return Err(SessionError::Process(
                "language-service paths must be absolute".into(),
            ));
        }
        if !self.node.is_file() {
            return Err(SessionError::Process(
                "trusted Node executable is missing".into(),
            ));
        }
        let server = self.package_root.join(TYPESCRIPT_SERVER_ENTRY);
        let typescript = self.package_root.join(TYPESCRIPT_IMPL_ENTRY);
        if !server.is_file() || !typescript.is_file() {
            return Err(SessionError::Process(
                "admitted TypeScript server assets are incomplete".into(),
            ));
        }
        Ok(())
    }
}

pub struct LanguageServiceProcess {
    child: Child,
    session: LanguageServiceSession<QueuedWriter>,
    events: Receiver<ServerEvent>,
    buffered: Vec<JsonRpcMessage>,
    tsdk: PathBuf,
    stopped: bool,
}

impl LanguageServiceProcess {
    pub fn start(profile: &TypeScriptServerProfile) -> Result<Self, SessionError> {
        profile.validate()?;
        let mut command = Command::new(&profile.node);
        command.env_clear();
        for key in ["HOME", "USERPROFILE", "TMPDIR", "TEMP", "SystemRoot"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        if let Some(parent) = profile.node.parent() {
            command.env("PATH", parent);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .arg(profile.package_root.join(TYPESCRIPT_SERVER_ENTRY))
            .arg("--stdio")
            .current_dir(&profile.package_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| SessionError::Process(format!("start language server: {error}")))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SessionError::Process("language server stdin unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SessionError::Process("language server stdout unavailable".into()))?;
        let (sender, events) = sync_channel(MAX_EVENTS);
        spawn_reader(stdout, sender, child.id());
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || drain_stderr(stderr));
        }
        let tsdk = profile.package_root.join(TYPESCRIPT_IMPL_ENTRY);
        Ok(Self {
            child,
            session: LanguageServiceSession::new(QueuedWriter::new(stdin)),
            events,
            buffered: Vec::new(),
            tsdk,
            stopped: false,
        })
    }

    pub fn initialize(&mut self, root_uri: &str) -> Result<(), SessionError> {
        let tsdk = self.session_tsdk_path();
        let params = serde_json::json!({
            "processId": null, "rootUri": root_uri,
            "capabilities": {
                "general": {"positionEncodings": ["utf-16"]},
                "textDocument": {"publishDiagnostics": {"versionSupport": true},
                    "hover": {"contentFormat": ["plaintext"]},
                    "completion": {"completionItem": {"snippetSupport": false}},
                    "definition": {"linkSupport": false}},
                "workspace": {"applyEdit": false, "configuration": false,
                    "workspaceEdit": {"documentChanges": false}}
            },
            "initializationOptions": {"tsserver": {"path": tsdk, "useSyntaxServer": "never"},
                "plugins": [], "disableAutomaticTypingAcquisition": true,
                "maxTsServerMemory": 512}
        });
        let response = self.request_wait("initialize", Some(params), Duration::from_secs(10))?;
        if response.error.is_some()
            || response
                .result
                .as_ref()
                .and_then(|v| v.pointer("/capabilities/positionEncoding"))
                .and_then(Value::as_str)
                .is_some_and(|v| v != "utf-16")
        {
            return Err(SessionError::InvalidMessage(
                "language server initialization failed".into(),
            ));
        }
        self.notify("initialized", Some(serde_json::json!({})))
    }

    fn session_tsdk_path(&self) -> String {
        self.tsdk.to_string_lossy().into_owned()
    }

    pub fn request(&mut self, method: &str, params: Option<Value>) -> Result<u64, SessionError> {
        self.session.request(method, params)
    }
    pub fn notify(&mut self, method: &str, params: Option<Value>) -> Result<(), SessionError> {
        self.session.notify(method, params)
    }
    pub fn cancel(&mut self, id: u64) -> Result<bool, SessionError> {
        self.session.cancel(id)
    }
    pub fn pid(&self) -> u32 {
        self.child.id()
    }
    pub fn poll_event(&mut self) -> Result<Option<ServerEvent>, SessionError> {
        if !self.buffered.is_empty() {
            return Ok(Some(ServerEvent::Message(self.buffered.remove(0))));
        }
        match self.events.try_recv() {
            Ok(event) => Ok(Some(event)),
            Err(std::sync::mpsc::TryRecvError::Empty) => Ok(None),
            Err(std::sync::mpsc::TryRecvError::Disconnected) => Err(SessionError::Closed),
        }
    }
    pub fn accept_response(&mut self, response: &JsonRpcResponse) -> bool {
        self.session.accept_response(response)
    }
    pub fn reject_request(&mut self, request: &JsonRpcRequest) -> Result<(), SessionError> {
        let bytes = serde_json::to_vec(&serde_json::json!({"jsonrpc":"2.0", "id":request.id,
            "error":{"code":-32601,"message":"Unsupported client request"}}))
        .map_err(|_| SessionError::InvalidMessage("invalid request".into()))?;
        write_frame(self.session.writer_mut(), &bytes)
            .map_err(|e| SessionError::Process(format!("{e:?}")))
    }
    pub fn read_message(&mut self) -> Result<Option<JsonRpcMessage>, SessionError> {
        let message = match self.next_event(Duration::from_secs(30))? {
            ServerEvent::Message(message) => message,
            ServerEvent::Eof => return Ok(None),
            ServerEvent::Io(error) => return Err(SessionError::Process(error)),
        };
        let protocol = match &message {
            JsonRpcMessage::Request(value) => &value.jsonrpc,
            JsonRpcMessage::Response(value) => &value.jsonrpc,
            JsonRpcMessage::Notification(value) => &value.jsonrpc,
        };
        if protocol != "2.0" {
            return Err(SessionError::InvalidMessage(
                "unsupported JSON-RPC version".into(),
            ));
        }
        match &message {
            JsonRpcMessage::Response(response) => {
                self.session.accept_response(response);
            }
            JsonRpcMessage::Request(request) => {
                if request.method == "workspace/applyEdit"
                    || request.method == "workspace/executeCommand"
                    || request.method == "workspace/willRenameFiles"
                {
                    let response = JsonRpcResponse {
                        jsonrpc: "2.0".into(),
                        id: request.id.clone(),
                        result: None,
                        error: Some(JsonRpcError {
                            code: -32601,
                            message: "workspace mutation is disabled".into(),
                            data: None,
                        }),
                    };
                    let bytes = serde_json::to_vec(&response)
                        .map_err(|error| SessionError::InvalidMessage(error.to_string()))?;
                    write_frame(self.session.writer_mut(), &bytes).map_err(|error| {
                        SessionError::Process(format!("write rejection: {error:?}"))
                    })?;
                }
            }
            JsonRpcMessage::Notification(_) => {}
        }
        Ok(Some(message))
    }
    pub fn next_event(&mut self, timeout: Duration) -> Result<ServerEvent, SessionError> {
        if let Some(message) = self.buffered.pop() {
            return Ok(ServerEvent::Message(message));
        }
        self.events
            .recv_timeout(timeout)
            .map_err(|error| match error {
                std::sync::mpsc::RecvTimeoutError::Timeout => SessionError::InvalidMessage(
                    "language server response deadline exceeded".into(),
                ),
                std::sync::mpsc::RecvTimeoutError::Disconnected => SessionError::Closed,
            })
    }
    pub fn request_wait(
        &mut self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
    ) -> Result<JsonRpcResponse, SessionError> {
        let id = self.request(method, params)?;
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                let _ = self.cancel(id);
                return Err(SessionError::InvalidMessage(
                    "language server response deadline exceeded".into(),
                ));
            }
            if let Some(index) = self.buffered.iter().position(|message| matches!(message, JsonRpcMessage::Response(response) if response.id == JsonRpcId::Number(id)))
                && let JsonRpcMessage::Response(response) = self.buffered.remove(index) { self.session.accept_response(&response); return Ok(response); }
            match self
                .events
                .recv_timeout(remaining)
                .map_err(|error| match error {
                    std::sync::mpsc::RecvTimeoutError::Timeout => SessionError::InvalidMessage(
                        "language server response deadline exceeded".into(),
                    ),
                    std::sync::mpsc::RecvTimeoutError::Disconnected => SessionError::Closed,
                })? {
                ServerEvent::Message(JsonRpcMessage::Response(response))
                    if response.id == JsonRpcId::Number(id) =>
                {
                    self.session.accept_response(&response);
                    return Ok(response);
                }
                ServerEvent::Message(JsonRpcMessage::Request(request)) => {
                    self.reject_request(&request)?
                }
                ServerEvent::Message(message) => {
                    if self.buffered.len() >= MAX_EVENTS {
                        return Err(SessionError::LimitExceeded("startup events"));
                    }
                    self.buffered.push(message);
                }
                ServerEvent::Eof => return Err(SessionError::Closed),
                ServerEvent::Io(error) => return Err(SessionError::Process(error)),
            }
        }
    }
    pub fn stop(&mut self) -> Result<(), SessionError> {
        if self.stopped {
            return Ok(());
        }
        self.stopped = true;
        self.session.close();
        terminate_process_tree(self.child.id());
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(error) => return Err(SessionError::Process(error.to_string())),
            }
        }
        let _ = self.child.kill();
        Ok(())
    }
}

impl Drop for LanguageServiceProcess {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// The writer never blocks the actor on a server that stops consuming stdin.
struct QueuedWriter {
    bytes: Vec<u8>,
    queue: SyncSender<Vec<u8>>,
}
impl QueuedWriter {
    fn new(mut stdin: ChildStdin) -> Self {
        let (queue, rx) = sync_channel::<Vec<u8>>(8);
        std::thread::spawn(move || {
            while let Ok(bytes) = rx.recv() {
                if stdin.write_all(&bytes).and_then(|_| stdin.flush()).is_err() {
                    break;
                }
            }
        });
        Self {
            bytes: Vec::new(),
            queue,
        }
    }
}
impl Write for QueuedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.bytes.len() + bytes.len() > MAX_MESSAGE_BYTES + MAX_HEADER_BYTES {
            return Err(io::Error::other("outbound frame exceeds bound"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.queue
            .try_send(std::mem::take(&mut self.bytes))
            .map_err(|_| io::Error::other("language server output queue unavailable"))
    }
}

pub fn terminate_process_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        if let Some(root) = std::env::var_os("SystemRoot") {
            let _ = Command::new(PathBuf::from(root).join("System32/taskkill.exe"))
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
    }
}

fn decode_message(body: &[u8]) -> Result<JsonRpcMessage, String> {
    let value: Value =
        serde_json::from_slice(body).map_err(|_| "invalid JSON-RPC JSON".to_owned())?;
    let object = value
        .as_object()
        .ok_or("JSON-RPC message must be an object")?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err("invalid JSON-RPC version".into());
    }
    if object.contains_key("method") {
        if object.contains_key("result") || object.contains_key("error") {
            return Err("mixed JSON-RPC request/response".into());
        }
    } else if !object.contains_key("id")
        || object.contains_key("result") == object.contains_key("error")
    {
        return Err("invalid JSON-RPC response shape".into());
    }
    if object
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|id| id.len() > 128)
    {
        return Err("JSON-RPC request identity exceeds bound".into());
    }
    serde_json::from_value(value).map_err(|_| "invalid JSON-RPC fields".into())
}

fn spawn_reader(mut stdout: ChildStdout, sender: SyncSender<ServerEvent>, pid: u32) {
    std::thread::spawn(move || {
        loop {
            match read_frame(&mut stdout) {
                Ok(Some(body)) => match decode_message(&body) {
                    Ok(message) => {
                        let valid = match &message {
                            JsonRpcMessage::Request(v) => v.jsonrpc == "2.0",
                            JsonRpcMessage::Response(v) => {
                                v.jsonrpc == "2.0" && !(v.error.is_some() && v.result.is_some())
                            }
                            JsonRpcMessage::Notification(v) => v.jsonrpc == "2.0",
                        };
                        if !valid || sender.try_send(ServerEvent::Message(message)).is_err() {
                            terminate_process_tree(pid);
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender
                            .send(ServerEvent::Io(format!("invalid server JSON-RPC: {error}")));
                        break;
                    }
                },
                Ok(None) => {
                    let _ = sender.send(ServerEvent::Eof);
                    break;
                }
                Err(error) => {
                    let _ =
                        sender.send(ServerEvent::Io(format!("server framing error: {error:?}")));
                    break;
                }
            }
        }
    });
}

fn drain_stderr<R: Read>(mut stderr: R) {
    let mut buffer = [0_u8; 4096];
    loop {
        match stderr.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentIdentity {
    pub window_id: String,
    pub worktree_root: String,
    pub generation: u64,
    pub uri: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentState {
    pub identity: DocumentIdentity,
    pub text: String,
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextRange {
    pub start: TextPosition,
    pub end: TextPosition,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextChange {
    pub range: Option<TextRange>,
    pub text: String,
}

impl DocumentState {
    pub fn new(identity: DocumentIdentity, text: String) -> Self {
        Self {
            identity,
            text,
            version: 1,
        }
    }

    pub fn apply(&mut self, changes: &[TextChange]) -> Result<i64, SessionError> {
        let mut next = self.text.clone();
        // LSP changes are sequential: each range addresses the preceding change result.
        let next_version = self
            .version
            .checked_add(1)
            .ok_or(SessionError::LimitExceeded("document versions"))?;
        for change in changes {
            let (start, end) = match &change.range {
                None => (0, next.len()),
                Some(range) => (
                    utf16_offset(&next, &range.start)?,
                    utf16_offset(&next, &range.end)?,
                ),
            };
            if start > end
                || end > next.len()
                || !next.is_char_boundary(start)
                || !next.is_char_boundary(end)
            {
                return Err(SessionError::InvalidMessage(
                    "invalid UTF-16 text range".into(),
                ));
            }
            next.replace_range(start..end, &change.text);
        }
        self.text = next;
        self.version = next_version;
        Ok(self.version)
    }

    pub fn accepts_result(&self, identity: &DocumentIdentity, version: i64) -> bool {
        self.identity == *identity && self.version == version
    }
}

pub fn utf16_offset(text: &str, position: &TextPosition) -> Result<usize, SessionError> {
    let line = usize::try_from(position.line)
        .map_err(|_| SessionError::InvalidMessage("invalid line".into()))?;
    let character = usize::try_from(position.character)
        .map_err(|_| SessionError::InvalidMessage("invalid character".into()))?;
    let mut start = 0;
    for _ in 0..line {
        let length = text[start..]
            .find('\n')
            .ok_or_else(|| SessionError::InvalidMessage("line outside document".into()))?;
        start += length + 1;
    }
    let line_text = text
        .get(start..)
        .ok_or_else(|| SessionError::InvalidMessage("line outside document".into()))?;
    let line_text = line_text
        .split_once('\n')
        .map_or(line_text, |(line, _)| line);
    let line_text = line_text.strip_suffix('\r').unwrap_or(line_text);
    let mut units = 0;
    for (offset, ch) in line_text.char_indices() {
        if units == character {
            return Ok(start + offset);
        }
        units += ch.len_utf16();
        if units > character {
            return Err(SessionError::InvalidMessage(
                "UTF-16 position splits a scalar".into(),
            ));
        }
    }
    if units == character {
        Ok(start + line_text.len())
    } else {
        Err(SessionError::InvalidMessage(
            "character outside line".into(),
        ))
    }
}

pub struct LanguageServiceSession<W: Write> {
    writer: W,
    pending: PendingRequests,
    closed: bool,
}

impl<W: Write> LanguageServiceSession<W> {
    fn writer_mut(&mut self) -> &mut W {
        &mut self.writer
    }
}

impl<W: Write> LanguageServiceSession<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            pending: PendingRequests::new(),
            closed: false,
        }
    }
    pub fn request(
        &mut self,
        method: impl Into<String>,
        params: Option<Value>,
    ) -> Result<u64, SessionError> {
        if self.closed {
            return Err(SessionError::Closed);
        }
        let id = self.pending.reserve()?;
        let message = serde_json::to_vec(&JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: JsonRpcId::Number(id),
            method: method.into(),
            params,
        })
        .map_err(|error| SessionError::InvalidMessage(error.to_string()))?;
        if let Err(error) = write_frame(&mut self.writer, &message) {
            self.pending.cancel(id);
            return Err(SessionError::InvalidMessage(format!(
                "write request: {error:?}"
            )));
        }
        Ok(id)
    }
    pub fn notify(&mut self, method: &str, params: Option<Value>) -> Result<(), SessionError> {
        if self.closed {
            return Err(SessionError::Closed);
        }
        let message = serde_json::to_vec(&JsonRpcNotification {
            jsonrpc: "2.0".into(),
            method: method.to_owned(),
            params,
        })
        .map_err(|error| SessionError::InvalidMessage(error.to_string()))?;
        write_frame(&mut self.writer, &message)
            .map_err(|error| SessionError::InvalidMessage(format!("write notification: {error:?}")))
    }
    pub fn cancel(&mut self, id: u64) -> Result<bool, SessionError> {
        if self.closed {
            return Err(SessionError::Closed);
        }
        let removed = self.pending.cancel(id);
        if removed {
            let message = serde_json::to_vec(&JsonRpcNotification {
                jsonrpc: "2.0".into(),
                method: "$/cancelRequest".into(),
                params: Some(serde_json::json!({"id": id})),
            })
            .map_err(|error| SessionError::InvalidMessage(error.to_string()))?;
            write_frame(&mut self.writer, &message).map_err(|error| {
                SessionError::InvalidMessage(format!("write cancellation: {error:?}"))
            })?;
        }
        Ok(removed)
    }
    pub fn accept_response(&mut self, response: &JsonRpcResponse) -> bool {
        self.pending.complete(&response.id)
    }
    pub fn close(&mut self) {
        self.closed = true;
        self.pending.pending.clear();
    }
    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_mixed_or_incomplete_json_rpc_and_accepts_null_result() {
        for body in [
            r#"{"jsonrpc":"2.0","id":1}"#,
            r#"{"jsonrpc":"1.0","id":1,"result":null}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":null,"error":{"code":1,"message":"bad"}}"#,
            r#"{"jsonrpc":"2.0","method":"x","result":null}"#,
        ] {
            assert!(decode_message(body.as_bytes()).is_err());
        }
        assert!(matches!(
            decode_message(br#"{"jsonrpc":"2.0","id":1,"result":null}"#).unwrap(),
            JsonRpcMessage::Response(_)
        ));
        assert!(matches!(
            decode_message(br#"{"jsonrpc":"2.0","id":"server","method":"workspace/applyEdit"}"#)
                .unwrap(),
            JsonRpcMessage::Request(_)
        ));
    }
    #[test]
    fn framing_rejects_duplicate_headers_and_truncation() {
        assert!(matches!(
            read_frame(&mut &b"Content-Length: 1\r\ncontent-length: 1\r\n\r\nx"[..]),
            Err(FrameError::InvalidHeader)
        ));
        assert!(matches!(
            read_frame(&mut &b"Content-Length: 2\r\n\r\nx"[..]),
            Err(FrameError::UnexpectedEof)
        ));
        assert!(read_frame(&mut &b""[..]).unwrap().is_none());
    }
    #[test]
    fn line_bounds_and_document_updates_fail_atomically() {
        assert!(
            utf16_offset(
                "x\n",
                &TextPosition {
                    line: 100,
                    character: 0
                }
            )
            .is_err()
        );
        assert_eq!(
            utf16_offset(
                "x\r\n",
                &TextPosition {
                    line: 0,
                    character: 1
                }
            )
            .unwrap(),
            1
        );
        assert!(
            utf16_offset(
                "😀",
                &TextPosition {
                    line: 0,
                    character: 1
                }
            )
            .is_err()
        );
        let identity = DocumentIdentity {
            window_id: "w".into(),
            worktree_root: "/r".into(),
            generation: 1,
            uri: "file:///r/a.ts".into(),
        };
        let mut doc = DocumentState::new(identity, "x".into());
        doc.version = i64::MAX;
        assert!(
            doc.apply(&[TextChange {
                range: None,
                text: "changed".into()
            }])
            .is_err()
        );
        assert_eq!(doc.text, "x");
        doc.version = 1;
        assert!(
            doc.apply(&[
                TextChange {
                    range: None,
                    text: "valid first edit".into()
                },
                TextChange {
                    range: Some(TextRange {
                        start: TextPosition {
                            line: 9,
                            character: 0
                        },
                        end: TextPosition {
                            line: 9,
                            character: 0
                        }
                    }),
                    text: "invalid".into()
                }
            ])
            .is_err()
        );
        assert_eq!(doc.text, "x");
        assert_eq!(doc.version, 1);
    }
    #[test]
    fn utf8_content_length_is_bytes() {
        let body = "{\"jsonrpc\":\"2.0\",\"method\":\"x\",\"params\":{\"text\":\"😀\"}}".as_bytes();
        let mut bytes = Vec::new();
        write_frame(&mut bytes, body).unwrap();
        assert_eq!(
            read_frame(&mut bytes.as_slice()).unwrap(),
            Some(body.to_vec())
        );
        assert!(String::from_utf8(body.to_vec()).unwrap().contains('😀'));
    }
    #[test]
    fn malformed_and_oversized_frames_fail_closed() {
        assert!(matches!(
            read_frame(&mut &b"Content-Length: nope\r\n\r\n"[..]),
            Err(FrameError::InvalidLength)
        ));
        assert!(matches!(
            write_frame(&mut Vec::new(), &vec![0; MAX_MESSAGE_BYTES + 1]),
            Err(FrameError::Oversized(_))
        ));
    }
    #[test]
    fn cancellation_releases_pending_slot_without_waiting_for_response() {
        let mut session = LanguageServiceSession::new(Vec::new());
        let id = session.request("textDocument/hover", None).unwrap();
        assert_eq!(session.pending_len(), 1);
        assert!(session.cancel(id).unwrap());
        assert_eq!(session.pending_len(), 0);
    }

    #[test]
    fn expired_requests_are_removed_without_waiting_for_server() {
        let mut pending = PendingRequests::new();
        let id = pending.reserve().unwrap();
        assert_eq!(pending.expire_older_than(Duration::ZERO), vec![id]);
        assert_eq!(pending.len(), 0);
    }

    #[test]
    fn document_versions_and_utf16_positions_are_monotonic_and_exact() {
        let identity = DocumentIdentity {
            window_id: "w1".into(),
            worktree_root: "/repo".into(),
            generation: 2,
            uri: "file:///repo/a.ts".into(),
        };
        let mut document = DocumentState::new(identity.clone(), "const 😀 = 1;\n".into());
        let version = document
            .apply(&[TextChange {
                range: Some(TextRange {
                    start: TextPosition {
                        line: 0,
                        character: 6,
                    },
                    end: TextPosition {
                        line: 0,
                        character: 8,
                    },
                }),
                text: "x".into(),
            }])
            .unwrap();
        assert_eq!(version, 2);
        assert_eq!(document.text, "const x = 1;\n");
        assert!(document.accepts_result(&identity, 2));
        assert!(!document.accepts_result(&identity, 1));
        assert!(!document.accepts_result(
            &DocumentIdentity {
                generation: 3,
                ..identity
            },
            2
        ));
    }
}
