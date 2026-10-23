use serde_json::{Value as JsonValue, json};
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

mod privacy;
mod writer;
use privacy::{bounded_text, sanitize_fields, sanitize_text};
pub(crate) use writer::DiagnosticHealth;

const MAX_EVENT_BYTES: usize = 32 * 1024;
static SESSION_NONCE: AtomicU64 = AtomicU64::new(0);
thread_local! {
    static CURRENT_TRACE_ID: RefCell<Option<String>> = const { RefCell::new(None) };
}

#[derive(Clone)]
pub(crate) struct DiagnosticsLog {
    inner: Arc<DiagnosticsLogInner>,
}
struct DiagnosticsLogInner {
    directory: Option<PathBuf>,
    session_id: String,
    trace_sequence: AtomicU64,
    home: Option<String>,
    shared: Arc<writer::Shared>,
}
impl Drop for DiagnosticsLogInner {
    fn drop(&mut self) {
        self.shared.close();
    }
}

impl DiagnosticsLog {
    /// Creation never makes product startup depend on a writable log directory.
    pub(crate) fn open(directory: PathBuf) -> Self {
        Self::start(Some(directory))
    }
    pub(crate) fn memory_only() -> Self {
        Self::start(None)
    }
    fn start(directory: Option<PathBuf>) -> Self {
        let session_id = format!(
            "session-{}-{}-{}",
            epoch_millis(),
            std::process::id(),
            SESSION_NONCE.fetch_add(1, Ordering::Relaxed)
        );
        let shared = Arc::new(writer::Shared::default());
        writer::start(shared.clone(), directory.clone(), session_id.clone());
        Self {
            inner: Arc::new(DiagnosticsLogInner {
                directory,
                session_id,
                trace_sequence: AtomicU64::new(0),
                home: std::env::var("HOME").ok().filter(|value| !value.is_empty()),
                shared,
            }),
        }
    }
    pub(crate) fn directory(&self) -> Option<&Path> {
        self.inner.directory.as_deref()
    }
    #[cfg(test)]
    pub(crate) fn session_id(&self) -> &str {
        &self.inner.session_id
    }
    pub(crate) fn health(&self) -> DiagnosticHealth {
        self.inner.shared.health()
    }
    pub(crate) fn flush(&self, timeout: Duration) -> bool {
        self.inner.shared.flush(timeout)
    }
    pub(crate) fn shutdown(&self, timeout: Duration) -> bool {
        self.record(
            "info",
            "diagnostics",
            "health.snapshot",
            None,
            json!(self.health()),
        );
        let drained = self.flush(timeout);
        self.inner.shared.close();
        drained
    }
    pub(crate) fn next_trace_id(&self, prefix: &str) -> String {
        format!(
            "{}-{}-{}",
            bounded_text(prefix, 64),
            self.inner.session_id,
            self.inner.trace_sequence.fetch_add(1, Ordering::Relaxed) + 1
        )
    }
    pub(crate) fn command_trace(&self, supplied: Option<&str>, prefix: &str) -> String {
        supplied
            .filter(|value| {
                value.starts_with("ui-")
                    && value.len() <= 128
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
            .map(str::to_owned)
            .unwrap_or_else(|| self.next_trace_id(prefix))
    }
    pub(crate) fn operation(
        &self,
        target: &'static str,
        name: &'static str,
        trace_id: String,
        fields: JsonValue,
    ) -> DiagnosticOperation {
        self.info(
            target,
            &format!("{name}.started"),
            Some(&trace_id),
            fields.clone(),
        );
        DiagnosticOperation {
            log: self.clone(),
            target,
            name,
            trace_id,
            fields,
            started: Instant::now(),
            finished: false,
        }
    }
    pub(crate) fn hash_identifier(&self, value: impl AsRef<[u8]>) -> String {
        format!("{:x}", Sha256::digest(value.as_ref()))[..16].to_owned()
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
        let (fields, truncated) = sanitize_fields(&fields, self.inner.home.as_deref());
        let mut value = json!({
            "schemaVersion": 1, "timestampEpochMs": epoch_millis(), "sessionId": self.inner.session_id,
            "processId": std::process::id(), "buildId": option_env!("ASTERLYN_BUILD_ID").unwrap_or("unknown"), "level": bounded_text(level, 16),
            "target": bounded_text(target, 128), "event": bounded_text(event, 128),
            "thread": bounded_text(std::thread::current().name().unwrap_or("unnamed"), 128),
            "fields": fields, "fieldsTruncated": truncated,
        });
        if let Some(trace) = trace_id {
            value["traceId"] = json!(bounded_text(trace, 160));
        }
        if truncated {
            self.inner.shared.truncated.fetch_add(1, Ordering::Relaxed);
        }
        // Preparation is already bounded; this final cap also covers JSON escape expansion.
        if serde_json::to_vec(&value)
            .expect("JSON value serializes")
            .len()
            > MAX_EVENT_BYTES - 128
        {
            value["target"] = json!("diagnostics");
            value["event"] = json!("event_truncated");
            value["fields"] = json!({"originalTarget": bounded_text(target, 128), "originalEvent": bounded_text(event, 128)});
            value["fieldsTruncated"] = json!(true);
            self.inner.shared.truncated.fetch_add(1, Ordering::Relaxed);
        }
        self.inner.shared.enqueue(value, level == "error");
    }
    pub(crate) fn safe_message(&self, value: impl AsRef<str>) -> String {
        sanitize_text(value.as_ref(), self.inner.home.as_deref())
    }
    pub(crate) fn install_panic_hook(&self) {
        let previous = std::panic::take_hook();
        let diagnostics = self.clone();
        std::panic::set_hook(Box::new(move |info| {
            if std::thread::current().name() == Some("diagnostics-writer") {
                eprintln!("diagnostics: writer panicked; persistence unavailable");
                previous(info);
                return;
            }
            let message = info
                .payload()
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
                .unwrap_or("non-string panic payload");
            diagnostics.error("host", "panic", current_trace_id().as_deref(), json!({
                "message": diagnostics.safe_message(message),
                "file": info.location().map(|location| diagnostics.safe_message(location.file())),
                "line": info.location().map(|location| location.line()),
                "column": info.location().map(|location| location.column()),
            }));
            diagnostics.flush(Duration::from_millis(200));
            previous(info);
        }));
    }
}

/// Owns a terminal event even when a future is cancelled or a validation branch returns early.
pub(crate) struct DiagnosticOperation {
    log: DiagnosticsLog,
    target: &'static str,
    name: &'static str,
    trace_id: String,
    fields: JsonValue,
    started: Instant,
    finished: bool,
}
impl DiagnosticOperation {
    pub(crate) fn finish(&mut self, result: Result<(), &str>, extra: JsonValue) {
        if self.finished {
            return;
        }
        self.finished = true;
        let mut fields = self.fields.clone();
        if let (Some(fields), Some(extra)) = (fields.as_object_mut(), extra.as_object()) {
            fields.extend(extra.clone());
        }
        fields["durationMs"] = json!(self.started.elapsed().as_millis());
        let (level, outcome) = match result {
            Ok(()) => ("info", "completed"),
            Err(error) => {
                fields["error"] = json!(self.log.safe_message(error));
                ("error", "failed")
            }
        };
        self.log.record(
            level,
            self.target,
            &format!("{}.{outcome}", self.name),
            Some(&self.trace_id),
            fields,
        );
    }
}
impl Drop for DiagnosticOperation {
    fn drop(&mut self) {
        if !self.finished {
            self.finish(
                Err("operation scope ended before completion"),
                json!({"outcome": "abandoned"}),
            );
        }
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
    use std::fs;
    fn events(log: &DiagnosticsLog) -> Vec<JsonValue> {
        assert!(log.flush(Duration::from_secs(2)));
        let path = log
            .directory()
            .unwrap()
            .join(log.session_id())
            .join("asterlyn.jsonl");
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
    #[test]
    fn concurrent_events_are_valid_redacted_bounded_and_output_ordered() {
        let root = tempfile::tempdir().unwrap();
        let log = DiagnosticsLog::open(root.path().into());
        std::thread::scope(|scope| {
            for _ in 0..4 {
                let log = &log;
                scope.spawn(move || { for _ in 0..30 {
                    log.info("test", "record", Some("trace-1"), json!({"message": "Authorization: Basic credential", "password": "hidden"}));
                }});
            }
        });
        let values = events(&log);
        assert_eq!(values.len(), 120);
        let encoded = serde_json::to_string(&values).unwrap();
        assert!(!encoded.contains("credential"));
        assert!(!encoded.contains("hidden"));
        for (index, value) in values.iter().enumerate() {
            assert_eq!(value["sequence"], index as u64 + 1);
            assert_eq!(value["traceId"], "trace-1");
            assert!(value.to_string().len() <= MAX_EVENT_BYTES);
        }
    }
    #[test]
    fn failed_directory_does_not_block_creation_and_recovers_buffered_events() {
        let root = tempfile::tempdir().unwrap();
        let location = root.path().join("blocked");
        fs::write(&location, "obstruction").unwrap();
        let log = DiagnosticsLog::open(location.clone());
        log.error("test", "before_recovery", None, json!({}));
        assert!(!log.flush(Duration::from_secs(1)));
        assert!(log.health().write_failures > 0);
        fs::remove_file(&location).unwrap();
        fs::create_dir(&location).unwrap();
        // A barrier forces a retry, without waiting for a UI action or restart.
        let _ = log.flush(Duration::from_secs(1));
        let values = events(&log);
        assert!(
            values
                .iter()
                .any(|value| value["event"] == "before_recovery")
        );
        assert!(log.health().persistence_available);
        assert!(log.health().recoveries > 0);
    }
    #[test]
    fn trace_scope_restores_after_return_and_panic() {
        assert_eq!(current_trace_id(), None);
        with_trace("outer", || {
            let _ = std::panic::catch_unwind(|| with_trace("inner", || panic!("fixture")));
            assert_eq!(current_trace_id().as_deref(), Some("outer"));
        });
        assert_eq!(current_trace_id(), None);
    }

    #[test]
    fn operation_lifecycle_covers_validation_delivery_errors_and_abandoned_scopes() {
        let root = tempfile::tempdir().unwrap();
        let log = DiagnosticsLog::open(root.path().into());
        let mut validation = log.operation(
            "plugin.runtime",
            "activation",
            "ui-validation".into(),
            json!({"pluginId": "fixture"}),
        );
        validation.finish(
            Err("workspace generation must be greater than zero"),
            json!({}),
        );
        validation.finish(Ok(()), json!({})); // A second finish must not turn failure into success.
        let mut callback = log.operation(
            "plugin.runtime",
            "callback",
            "ui-delivery".into(),
            json!({}),
        );
        callback.finish(
            Err("publish plugin runtime event failed"),
            json!({"phase": "delivery"}),
        );
        drop(log.operation(
            "plugin.runtime",
            "activation",
            "ui-abandoned".into(),
            json!({}),
        ));
        let values = events(&log);
        assert_eq!(values.len(), 6);
        assert!(
            values
                .iter()
                .all(|value| value["event"] != "callback.completed")
        );
        assert_eq!(values[1]["event"], "activation.failed");
        assert_eq!(values[3]["event"], "callback.failed");
        assert_eq!(values[5]["fields"]["outcome"], "abandoned");
    }

    #[test]
    fn bounded_shutdown_drains_and_rejects_late_records() {
        let root = tempfile::tempdir().unwrap();
        let log = DiagnosticsLog::open(root.path().into());
        log.info("test", "before_exit", None, json!({}));
        assert!(log.shutdown(Duration::from_secs(2)));
        let before = log.health().dropped;
        log.info("test", "too_late", None, json!({}));
        assert_eq!(log.health().dropped, before + 1);
        assert_eq!(
            log.command_trace(Some("ui-valid-123"), "test"),
            "ui-valid-123"
        );
        assert_ne!(
            log.command_trace(Some("Bearer secret"), "test"),
            "Bearer secret"
        );
    }

    #[test]
    fn failure_burst_is_bounded_and_recovers_without_restart() {
        let root = tempfile::tempdir().unwrap();
        let location = root.path().join("unavailable");
        fs::write(&location, "obstruction").unwrap();
        let log = DiagnosticsLog::open(location.clone());
        let started = Instant::now();
        for index in 0..2_000 {
            log.info(
                "probe",
                "burst",
                None,
                json!({"index": index, "status": "queued"}),
            );
        }
        let elapsed = started.elapsed();
        assert!(!log.flush(Duration::from_secs(1)));
        let health = log.health();
        assert!(health.queued <= 320);
        assert!(health.retry_buffered <= 64);
        assert!(health.dropped > 0);
        fs::remove_file(&location).unwrap();
        log.error("probe", "recovery_sentinel", None, json!({}));
        assert!(log.flush(Duration::from_secs(2)));
        let values = events(&log);
        assert!(
            values
                .iter()
                .any(|value| value["event"] == "recovery_sentinel")
        );
        assert!(log.health().recoveries > 0);
        eprintln!(
            "diagnostics burst: 2000 events enqueued in {:.2} ms; dropped={}, retry_buffered={}",
            elapsed.as_secs_f64() * 1000.0,
            health.dropped,
            health.retry_buffered
        );
    }
}
