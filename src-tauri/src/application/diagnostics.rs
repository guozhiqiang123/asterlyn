use std::cell::RefCell;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value as JsonValue, json};
use sha2::{Digest, Sha256};

const ACTIVE_LOG_NAME: &str = "asterlyn.jsonl";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const RETAINED_LOGS: usize = 5;
const MAX_EVENT_BYTES: usize = 32 * 1024;
const MAX_STRING_BYTES: usize = 16 * 1024;

thread_local! {
    static CURRENT_TRACE_ID: RefCell<Option<String>> = const { RefCell::new(None) };
}

#[derive(Clone)]
pub(crate) struct DiagnosticsLog {
    inner: Arc<DiagnosticsLogInner>,
}

struct DiagnosticsLogInner {
    directory: PathBuf,
    active_path: PathBuf,
    writer: Mutex<WriterState>,
    sequence: AtomicU64,
    session_id: String,
    process_id: u32,
    home: Option<String>,
}

struct WriterState {
    file: Option<File>,
    bytes: u64,
}

impl DiagnosticsLog {
    pub(crate) fn open(directory: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&directory)?;
        let active_path = directory.join(ACTIVE_LOG_NAME);
        if active_path
            .metadata()
            .is_ok_and(|metadata| metadata.len() >= MAX_LOG_BYTES)
        {
            rotate_files(&directory, &active_path)?;
        }
        let file = open_log_file(&active_path)?;
        let bytes = file.metadata()?.len();
        let process_id = std::process::id();
        Ok(Self {
            inner: Arc::new(DiagnosticsLogInner {
                directory,
                active_path,
                writer: Mutex::new(WriterState {
                    file: Some(file),
                    bytes,
                }),
                sequence: AtomicU64::new(0),
                session_id: format!("session-{}-{process_id}", epoch_millis()),
                process_id,
                home: std::env::var("HOME").ok().filter(|value| !value.is_empty()),
            }),
        })
    }

    pub(crate) fn directory(&self) -> &Path {
        &self.inner.directory
    }

    pub(crate) fn next_trace_id(&self, prefix: &str) -> String {
        let sequence = self.inner.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        format!("{prefix}-{}-{sequence}", epoch_millis())
    }

    pub(crate) fn hash_identifier(&self, value: impl AsRef<[u8]>) -> String {
        let digest = format!("{:x}", Sha256::digest(value.as_ref()));
        digest[..16].to_owned()
    }

    pub(crate) fn info(
        &self,
        target: &str,
        event: &str,
        trace_id: Option<&str>,
        fields: JsonValue,
    ) {
        self.record("info", target, event, trace_id, fields);
    }

    pub(crate) fn error(
        &self,
        target: &str,
        event: &str,
        trace_id: Option<&str>,
        fields: JsonValue,
    ) {
        self.record("error", target, event, trace_id, fields);
    }

    pub(crate) fn record(
        &self,
        level: &str,
        target: &str,
        event: &str,
        trace_id: Option<&str>,
        fields: JsonValue,
    ) {
        let sequence = self.inner.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let mut value = json!({
            "schemaVersion": 1,
            "timestampEpochMs": epoch_millis(),
            "sequence": sequence,
            "sessionId": self.inner.session_id,
            "processId": self.inner.process_id,
            "level": bounded_text(level, 16),
            "target": bounded_text(target, 128),
            "event": bounded_text(event, 128),
            "thread": std::thread::current().name().unwrap_or("unnamed"),
            "fields": fields,
        });
        if let Some(trace_id) = trace_id {
            value
                .as_object_mut()
                .expect("diagnostic event is an object")
                .insert(
                    "traceId".to_owned(),
                    JsonValue::String(bounded_text(trace_id, 160)),
                );
        }
        sanitize_value(&mut value, self.inner.home.as_deref());
        let mut encoded = serde_json::to_vec(&value).unwrap_or_else(|_| {
            br#"{"schemaVersion":1,"level":"error","target":"diagnostics","event":"serialization_failed","fields":{}}"#.to_vec()
        });
        if encoded.len() > MAX_EVENT_BYTES {
            encoded = serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "timestampEpochMs": epoch_millis(),
                "sequence": sequence,
                "sessionId": self.inner.session_id,
                "processId": self.inner.process_id,
                "level": "warning",
                "target": "diagnostics",
                "event": "event_truncated",
                "fields": {
                    "originalTarget": bounded_text(target, 128),
                    "originalEvent": bounded_text(event, 128),
                    "originalBytes": encoded.len(),
                }
            }))
            .expect("bounded diagnostic fallback serializes");
        }
        encoded.push(b'\n');
        let _ = self.write_line(&encoded);
    }

    pub(crate) fn safe_message(&self, value: impl AsRef<str>) -> String {
        sanitize_text(value.as_ref(), self.inner.home.as_deref())
    }

    pub(crate) fn install_panic_hook(&self) {
        let previous = std::panic::take_hook();
        let diagnostics = self.clone();
        std::panic::set_hook(Box::new(move |info| {
            let message = info
                .payload()
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
                .unwrap_or("non-string panic payload");
            diagnostics.error(
                "host",
                "panic",
                current_trace_id().as_deref(),
                json!({
                    "message": diagnostics.safe_message(message),
                    "file": info.location().map(|location| diagnostics.safe_message(location.file())),
                    "line": info.location().map(|location| location.line()),
                    "column": info.location().map(|location| location.column()),
                }),
            );
            previous(info);
        }));
    }

    fn write_line(&self, line: &[u8]) -> io::Result<()> {
        let mut writer = self
            .inner
            .writer
            .lock()
            .map_err(|_| io::Error::other("diagnostics writer lock was poisoned"))?;
        if writer.bytes.saturating_add(line.len() as u64) > MAX_LOG_BYTES {
            writer.file.take();
            rotate_files(&self.inner.directory, &self.inner.active_path)?;
            writer.file = Some(open_log_file(&self.inner.active_path)?);
            writer.bytes = 0;
        }
        let file = writer
            .file
            .as_mut()
            .ok_or_else(|| io::Error::other("diagnostics log is unavailable"))?;
        file.write_all(line)?;
        file.flush()?;
        writer.bytes = writer.bytes.saturating_add(line.len() as u64);
        Ok(())
    }
}

pub(crate) fn with_trace<T>(trace_id: &str, operation: impl FnOnce() -> T) -> T {
    struct RestoreTrace(Option<String>);
    impl Drop for RestoreTrace {
        fn drop(&mut self) {
            CURRENT_TRACE_ID.with(|current| current.replace(self.0.take()));
        }
    }
    let previous = CURRENT_TRACE_ID.with(|current| current.replace(Some(trace_id.to_owned())));
    let _restore = RestoreTrace(previous);
    operation()
}

pub(crate) fn current_trace_id() -> Option<String> {
    CURRENT_TRACE_ID.with(|current| current.borrow().clone())
}

fn open_log_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(file)
}

fn rotate_files(directory: &Path, active_path: &Path) -> io::Result<()> {
    let oldest = directory.join(format!("asterlyn.{RETAINED_LOGS}.jsonl"));
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }
    for index in (1..RETAINED_LOGS).rev() {
        let source = directory.join(format!("asterlyn.{index}.jsonl"));
        if source.exists() {
            fs::rename(
                source,
                directory.join(format!("asterlyn.{}.jsonl", index + 1)),
            )?;
        }
    }
    if active_path.exists() {
        fs::rename(active_path, directory.join("asterlyn.1.jsonl"))?;
    }
    Ok(())
}

fn sanitize_value(value: &mut JsonValue, home: Option<&str>) {
    match value {
        JsonValue::String(text) => *text = sanitize_text(text, home),
        JsonValue::Array(values) => {
            for value in values {
                sanitize_value(value, home);
            }
        }
        JsonValue::Object(values) => {
            for value in values.values_mut() {
                sanitize_value(value, home);
            }
        }
        _ => {}
    }
}

fn sanitize_text(value: &str, home: Option<&str>) -> String {
    let mut text = bounded_text(value, MAX_STRING_BYTES);
    if let Some(home) = home {
        text = text.replace(home, "~");
    }
    for marker in ["Bearer ", "Authorization: ", "access_token=", "token="] {
        redact_after_marker(&mut text, marker);
    }
    text
}

fn redact_after_marker(text: &mut String, marker: &str) {
    let mut search_from = 0;
    while let Some(relative) = text[search_from..].find(marker) {
        let start = search_from + relative + marker.len();
        let end = text[start..]
            .find(|character: char| {
                character.is_whitespace() || matches!(character, '&' | ',' | ';')
            })
            .map_or(text.len(), |relative| start + relative);
        text.replace_range(start..end, "[REDACTED]");
        search_from = start + "[REDACTED]".len();
    }
}

fn bounded_text(value: &str, maximum_bytes: usize) -> String {
    if value.len() <= maximum_bytes {
        return value.to_owned();
    }
    let mut end = maximum_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

fn epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_bounded_redacted_json_lines() {
        let directory = tempfile::tempdir().unwrap();
        let diagnostics = DiagnosticsLog::open(directory.path().to_path_buf()).unwrap();
        diagnostics.info(
            "plugin.runtime",
            "callback.completed",
            Some("trace-1"),
            json!({"message": "Authorization: secret-value token=another-value"}),
        );
        let line = fs::read_to_string(directory.path().join(ACTIVE_LOG_NAME)).unwrap();
        let value: JsonValue = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(value["event"], "callback.completed");
        assert_eq!(value["traceId"], "trace-1");
        assert!(value["sessionId"].as_str().unwrap().starts_with("session-"));
        assert_eq!(value["processId"], std::process::id());
        assert_eq!(
            value["fields"]["message"],
            "Authorization: [REDACTED] token=[REDACTED]"
        );
    }

    #[test]
    fn trace_scope_restores_the_previous_trace() {
        assert_eq!(current_trace_id(), None);
        with_trace("outer", || {
            assert_eq!(current_trace_id().as_deref(), Some("outer"));
            with_trace("inner", || {
                assert_eq!(current_trace_id().as_deref(), Some("inner"))
            });
            assert_eq!(current_trace_id().as_deref(), Some("outer"));
        });
        assert_eq!(current_trace_id(), None);
    }

    #[test]
    fn rotation_retains_the_five_newest_generations() {
        let directory = tempfile::tempdir().unwrap();
        let active = directory.path().join(ACTIVE_LOG_NAME);
        fs::write(&active, "active").unwrap();
        for index in 1..=RETAINED_LOGS {
            fs::write(
                directory.path().join(format!("asterlyn.{index}.jsonl")),
                format!("generation-{index}"),
            )
            .unwrap();
        }
        rotate_files(directory.path(), &active).unwrap();
        assert!(!active.exists());
        assert_eq!(
            fs::read_to_string(directory.path().join("asterlyn.1.jsonl")).unwrap(),
            "active"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("asterlyn.5.jsonl")).unwrap(),
            "generation-4"
        );
    }
}
