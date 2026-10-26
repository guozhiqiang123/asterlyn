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

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_HEADER_BYTES: usize = 8 * 1024;
pub const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_PENDING_REQUESTS: usize = 128;
pub const TYPESCRIPT_SERVER_ENTRY: &str = "servers/typescript/server.mjs";
pub const TYPESCRIPT_IMPL_ENTRY: &str = "servers/typescript/typescript/lib/tsserver.js";

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

#[derive(Debug, Default)]
pub struct PendingRequests {
    next_id: AtomicU64,
    pending: BTreeMap<u64, ()>,
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
        self.pending.insert(id, ());
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
    pub fn len(&self) -> usize {
        self.pending.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    LimitExceeded(&'static str),
    InvalidMessage(String),
    Cancelled,
    Closed,
    Process(String),
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
    session: LanguageServiceSession<ChildStdin>,
    stdout: ChildStdout,
}

impl LanguageServiceProcess {
    pub fn start(profile: &TypeScriptServerProfile) -> Result<Self, SessionError> {
        profile.validate()?;
        let mut child = Command::new(&profile.node)
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
        Ok(Self {
            child,
            session: LanguageServiceSession::new(stdin),
            stdout,
        })
    }

    pub fn initialize(&mut self, root_uri: &str) -> Result<u64, SessionError> {
        let params = serde_json::json!({"processId": null, "rootUri": root_uri, "capabilities": {"textDocument": {"hover": {}, "completion": {}, "definition": {}}, "workspace": {}}, "initializationOptions": {"typescript": {"tsdk": TYPESCRIPT_IMPL_ENTRY}, "disableAutomaticTypingAcquisition": true, "disableSuggestions": false}});
        self.session.request("initialize", Some(params))
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
    pub fn read_message(&mut self) -> Result<Option<JsonRpcMessage>, SessionError> {
        let Some(body) = read_frame(&mut self.stdout)
            .map_err(|error| SessionError::Process(format!("read language server: {error:?}")))?
        else {
            return Ok(None);
        };
        let message = serde_json::from_slice(&body)
            .map_err(|error| SessionError::InvalidMessage(error.to_string()))?;
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
    pub fn stop(&mut self) -> Result<(), SessionError> {
        self.session.close();
        let _ = self.child.kill();
        self.child
            .wait()
            .map_err(|error| SessionError::Process(format!("wait language server: {error}")))?;
        Ok(())
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
        // Apply in reverse order so a transaction's ranges are anchored to one prior snapshot.
        for change in changes.iter().rev() {
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
        self.version = self
            .version
            .checked_add(1)
            .ok_or(SessionError::LimitExceeded("document versions"))?;
        Ok(self.version)
    }

    pub fn accepts_result(&self, identity: &DocumentIdentity, version: i64) -> bool {
        self.identity == *identity && self.version == version
    }
}

fn utf16_offset(text: &str, position: &TextPosition) -> Result<usize, SessionError> {
    let line = usize::try_from(position.line)
        .map_err(|_| SessionError::InvalidMessage("invalid line".into()))?;
    let character = usize::try_from(position.character)
        .map_err(|_| SessionError::InvalidMessage("invalid character".into()))?;
    let start = text
        .split_inclusive('\n')
        .take(line)
        .map(str::len)
        .sum::<usize>();
    if line > 0 && start == text.len() && !text.ends_with('\n') {
        return Err(SessionError::InvalidMessage("line outside document".into()));
    }
    let line_text = text
        .get(start..)
        .ok_or_else(|| SessionError::InvalidMessage("line outside document".into()))?;
    let line_text = line_text
        .split_once('\n')
        .map_or(line_text, |(line, _)| line);
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
