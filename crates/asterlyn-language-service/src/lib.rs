//! Host-owned language-service transport primitives.
//!
//! This crate deliberately contains no editor or Tauri dependencies.  The transport is a
//! bounded Content-Length JSON-RPC stream suitable for a supervised stdio child; callers own
//! the child process and must perform approval/resource checks before constructing a session.

use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_HEADER_BYTES: usize = 8 * 1024;
pub const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_PENDING_REQUESTS: usize = 128;

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
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub fn complete(&mut self, id: u64) -> bool {
        self.pending.remove(&id).is_some()
    }
    pub fn cancel(&mut self, id: u64) -> bool {
        self.complete(id)
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
}

pub struct LanguageServiceSession<W: Write> {
    writer: W,
    pending: PendingRequests,
    closed: bool,
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
            id,
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
        self.pending.complete(response.id)
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
}
