use serde::Serialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::{Duration, Instant};

use super::epoch_millis;

pub(super) const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const RETAINED_LOGS: usize = 5;
const NORMAL_CAPACITY: usize = 256;
const QUEUE_CAPACITY: usize = 320;
const RETRY_CAPACITY: usize = 64;
const RETAINED_SESSION_BYTES: u64 = 30 * 1024 * 1024;
const RETRY_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticHealth {
    pub queued: usize,
    pub retry_buffered: u64,
    pub written: u64,
    pub dropped: u64,
    pub write_failures: u64,
    pub recoveries: u64,
    pub truncated: u64,
    pub persistence_available: bool,
}

#[derive(Default)]
pub(super) struct Shared {
    queue: Mutex<Queue>,
    ready: Condvar,
    written: AtomicU64,
    dropped: AtomicU64,
    write_failures: AtomicU64,
    recoveries: AtomicU64,
    pub truncated: AtomicU64,
    persistence_available: AtomicBool,
    retry_buffered: AtomicU64,
}

#[derive(Default)]
struct Queue {
    items: VecDeque<Message>,
    closed: bool,
}
enum Message {
    Event(Value, bool),
    Flush(mpsc::SyncSender<bool>),
}

impl Shared {
    pub fn enqueue(&self, event: Value, critical: bool) {
        let mut queue = self.queue.lock().unwrap_or_else(|error| error.into_inner());
        let limit = if critical {
            QUEUE_CAPACITY
        } else {
            NORMAL_CAPACITY
        };
        if queue.closed || queue.items.len() >= limit {
            if critical && !queue.closed {
                if let Some(index) = queue
                    .items
                    .iter()
                    .position(|item| matches!(item, Message::Event(_, false)))
                {
                    queue.items.remove(index);
                } else {
                    self.dropped.fetch_add(1, Ordering::Relaxed);
                    return;
                }
            } else {
                self.dropped.fetch_add(1, Ordering::Relaxed);
                return;
            }
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
        queue.items.push_back(Message::Event(event, critical));
        self.ready.notify_one();
    }

    pub fn health(&self) -> DiagnosticHealth {
        DiagnosticHealth {
            queued: self
                .queue
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .items
                .len(),
            retry_buffered: self.retry_buffered.load(Ordering::Relaxed),
            written: self.written.load(Ordering::Relaxed),
            dropped: self.dropped.load(Ordering::Relaxed),
            write_failures: self.write_failures.load(Ordering::Relaxed),
            recoveries: self.recoveries.load(Ordering::Relaxed),
            truncated: self.truncated.load(Ordering::Relaxed),
            persistence_available: self.persistence_available.load(Ordering::Relaxed),
        }
    }

    pub fn flush(&self, timeout: Duration) -> bool {
        let (sent, received) = mpsc::sync_channel(1);
        {
            let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
            if queue.closed || queue.items.len() >= QUEUE_CAPACITY {
                return false;
            }
            queue.items.push_back(Message::Flush(sent));
            self.ready.notify_one();
        }
        received.recv_timeout(timeout).unwrap_or(false)
    }

    pub fn close(&self) {
        self.queue.lock().unwrap_or_else(|e| e.into_inner()).closed = true;
        self.ready.notify_one();
    }
}

pub(super) fn start(shared: Arc<Shared>, directory: Option<PathBuf>, session: String) {
    let emergency = shared.clone();
    if std::thread::Builder::new()
        .name("diagnostics-writer".into())
        .spawn(move || run(shared, directory, session))
        .is_err()
    {
        emergency.close();
        emergency.write_failures.fetch_add(1, Ordering::Relaxed);
        eprintln!("diagnostics: writer unavailable; diagnostic events will be counted as dropped");
    }
}

fn run(shared: Arc<Shared>, directory: Option<PathBuf>, session: String) {
    struct Lifetime(Arc<Shared>);
    impl Drop for Lifetime {
        fn drop(&mut self) {
            self.0.persistence_available.store(false, Ordering::Relaxed);
            self.0.close();
            let mut queue = self.0.queue.lock().unwrap_or_else(|e| e.into_inner());
            self.0.dropped.fetch_add(
                queue
                    .items
                    .iter()
                    .filter(|item| matches!(item, Message::Event(..)))
                    .count() as u64,
                Ordering::Relaxed,
            );
            queue.items.clear();
        }
    }
    let _lifetime = Lifetime(shared.clone());
    let mut writer = SessionWriter::new(directory, &session);
    let mut pending: VecDeque<Vec<u8>> = VecDeque::new();
    let mut sequence = 0;
    let mut failed = false;
    let mut last_attempt = Instant::now() - RETRY_INTERVAL;
    let mut last_health = (0, 0, 0);
    loop {
        let (message, closed) = {
            let mut queue = shared.queue.lock().unwrap_or_else(|e| e.into_inner());
            if queue.items.is_empty() && !queue.closed {
                queue = shared
                    .ready
                    .wait_timeout(queue, RETRY_INTERVAL)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
            (queue.items.pop_front(), queue.closed)
        };
        let mut flush = None;
        match message {
            Some(Message::Event(event, _)) => {
                if pending.len() >= RETRY_CAPACITY {
                    pending.pop_front();
                    shared.dropped.fetch_add(1, Ordering::Relaxed);
                }
                pending.push_back(encode(event, &mut sequence));
            }
            Some(Message::Flush(sent)) => flush = Some(sent),
            None => {}
        }
        if !pending.is_empty()
            && (!failed || last_attempt.elapsed() >= RETRY_INTERVAL || flush.is_some() || closed)
        {
            last_attempt = Instant::now();
            while let Some(line) = pending.front() {
                match writer.write(line) {
                    Ok(()) => {
                        pending.pop_front();
                        shared.written.fetch_add(1, Ordering::Relaxed);
                        shared.persistence_available.store(true, Ordering::Relaxed);
                        if failed {
                            shared.recoveries.fetch_add(1, Ordering::Relaxed);
                        }
                        failed = false;
                    }
                    Err(_) => {
                        shared.write_failures.fetch_add(1, Ordering::Relaxed);
                        shared.persistence_available.store(false, Ordering::Relaxed);
                        if !failed {
                            eprintln!(
                                "diagnostics: persistence unavailable; retaining bounded retry buffer"
                            );
                        }
                        failed = true;
                        break;
                    }
                }
            }
        }
        shared
            .retry_buffered
            .store(pending.len() as u64, Ordering::Relaxed);
        let counters = (
            shared.dropped.load(Ordering::Relaxed),
            shared.write_failures.load(Ordering::Relaxed),
            shared.recoveries.load(Ordering::Relaxed),
        );
        if !failed && pending.is_empty() && counters != last_health && flush.is_none() && !closed {
            // The writer owns all output sequence allocation, including health transitions.
            let event = json!({"schemaVersion": 1, "timestampEpochMs": epoch_millis(), "sessionId": session,
                "processId": std::process::id(), "buildId": option_env!("ASTERLYN_BUILD_ID").unwrap_or("unknown"), "level": "warning", "target": "diagnostics", "event": "health.changed",
                "thread": "diagnostics-writer", "fields": shared.health()});
            pending.push_back(encode(event, &mut sequence));
            last_health = counters;
        }
        if let Some(sent) = flush {
            let _ = sent.send(pending.is_empty() && !failed);
        }
        if closed && shared.health().queued == 0 {
            if !pending.is_empty() {
                shared
                    .dropped
                    .fetch_add(pending.len() as u64, Ordering::Relaxed);
            }
            break;
        }
    }
}

fn encode(mut value: Value, sequence: &mut u64) -> Vec<u8> {
    *sequence += 1;
    value["sequence"] = json!(sequence);
    let mut encoded = serde_json::to_vec(&value).expect("bounded JSON diagnostic serializes");
    encoded.push(b'\n');
    encoded
}

struct SessionWriter {
    base: Option<PathBuf>,
    directory: Option<PathBuf>,
    file: Option<File>,
    owner: Option<OwnerLock>,
    bytes: u64,
    limit: u64,
    repair_length: Option<u64>,
}

impl SessionWriter {
    fn new(base: Option<PathBuf>, session: &str) -> Self {
        Self {
            directory: base.as_ref().map(|base| base.join(session)),
            base,
            file: None,
            owner: None,
            bytes: 0,
            limit: MAX_LOG_BYTES,
            repair_length: None,
        }
    }

    fn ensure_open(&mut self) -> io::Result<()> {
        if self.file.is_some() {
            return Ok(());
        }
        let directory = self
            .directory
            .as_ref()
            .ok_or_else(|| io::Error::other("log location unavailable"))?;
        let base = self.base.as_ref().expect("session directory has a base");
        fs::create_dir_all(base)?;
        // Serialize registration with cleanup: a new session cannot be mistaken for an orphan
        // between creating its directory and acquiring its lifetime owner lock.
        let _registration = lock_owner(&base.join("retention.lock"))?;
        fs::create_dir_all(directory)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
        }
        if self.owner.is_none() {
            self.owner = Some(lock_owner(&directory.join("owner.lock"))?);
            if let Some(base) = &self.base {
                prune_sessions(base, directory);
            }
        }
        let file = open_log_file(&directory.join("asterlyn.jsonl"))?;
        if let Some(length) = self.repair_length {
            file.set_len(length)?;
            self.repair_length = None;
        }
        self.bytes = file.metadata()?.len();
        self.file = Some(file);
        Ok(())
    }

    fn write(&mut self, line: &[u8]) -> io::Result<()> {
        self.ensure_open()?;
        if self.bytes > 0 && self.bytes.saturating_add(line.len() as u64) > self.limit {
            let directory = self
                .directory
                .as_ref()
                .expect("open writer has a directory");
            self.file.take(); // Windows requires closing before rename. Reopen on every failure.
            if let Err(error) = rotate_files(directory) {
                let _ = self.ensure_open();
                return Err(error);
            }
            self.ensure_open()?;
        }
        let original = self.bytes;
        let file = self.file.as_mut().expect("ensure_open populated the file");
        if let Err(error) = file.write_all(line).and_then(|_| file.flush()) {
            // Do not leave a partial JSON line to corrupt the next retry.
            if file.set_len(original).is_err() {
                self.repair_length = Some(original);
                self.file.take();
            }
            return Err(error);
        }
        self.bytes = self.bytes.saturating_add(line.len() as u64);
        Ok(())
    }
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
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    Ok(file)
}

struct OwnerLock(File);
impl Drop for OwnerLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            // Explicit unlock also releases locks briefly inherited by concurrent fork/exec.
            // SAFETY: this guard still owns the valid descriptor.
            unsafe {
                libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
            }
        }
    }
}

fn lock_owner(path: &Path) -> io::Result<OwnerLock> {
    let mut options = OpenOptions::new();
    options.create(true).read(true).write(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        // SAFETY: the descriptor is owned by `file`; flock neither consumes nor dereferences it.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(OwnerLock(file))
}

fn rotate_files(directory: &Path) -> io::Result<()> {
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
    let active = directory.join("asterlyn.jsonl");
    if active.exists() {
        fs::rename(active, directory.join("asterlyn.1.jsonl"))?;
    }
    Ok(())
}

fn prune_sessions(base: &Path, current: &Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    let mut inactive = Vec::new();
    for entry in entries.take(1024).flatten() {
        let path = entry.path();
        if path == current
            || !entry.file_name().to_string_lossy().starts_with("session-")
            || !entry.file_type().is_ok_and(|kind| kind.is_dir())
        {
            continue;
        }
        let Ok(owner) = lock_owner(&path.join("owner.lock")) else {
            continue;
        };
        let bytes = fs::read_dir(&path)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| entry.metadata().ok())
            .filter(|meta| meta.is_file())
            .map(|meta| meta.len())
            .fold(0u64, u64::saturating_add);
        inactive.push((path, owner, bytes));
    }
    inactive.sort_by(|a, b| b.0.cmp(&a.0));
    let mut retained = 0u64;
    for (index, (path, owner, bytes)) in inactive.into_iter().enumerate() {
        retained = retained.saturating_add(bytes);
        if index >= RETAINED_LOGS || retained > RETAINED_SESSION_BYTES {
            #[cfg(windows)]
            drop(owner);
            let _ = fs::remove_dir_all(path);
        }
        #[cfg(not(windows))]
        drop(owner);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_failure_recovers_and_independent_writers_keep_their_files() {
        let root = tempfile::tempdir().unwrap();
        let mut first = SessionWriter::new(Some(root.path().into()), "session-first");
        let mut second = SessionWriter::new(Some(root.path().into()), "session-second");
        first.limit = 30;
        first.write(b"first\n").unwrap();
        second.write(b"second\n").unwrap();
        let directory = root.path().join("session-first");
        fs::create_dir(directory.join("asterlyn.5.jsonl")).unwrap();
        assert!(first.write(&[b'x'; 30]).is_err());
        fs::remove_dir(directory.join("asterlyn.5.jsonl")).unwrap();
        first.write(b"recovered\n").unwrap();
        for _ in 0..8 {
            first.write(&[b'x'; 30]).unwrap();
        }
        second.write(b"still-visible\n").unwrap();
        assert!(
            fs::read_to_string(root.path().join("session-second/asterlyn.jsonl"))
                .unwrap()
                .contains("still-visible")
        );
    }

    #[test]
    fn rotation_retains_exactly_the_five_newest_generations() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("asterlyn.jsonl"), "active").unwrap();
        for index in 1..=RETAINED_LOGS {
            fs::write(
                root.path().join(format!("asterlyn.{index}.jsonl")),
                format!("generation-{index}"),
            )
            .unwrap();
        }
        rotate_files(root.path()).unwrap();
        assert_eq!(
            fs::read_to_string(root.path().join("asterlyn.1.jsonl")).unwrap(),
            "active"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("asterlyn.5.jsonl")).unwrap(),
            "generation-4"
        );
        assert!(!root.path().join("asterlyn.jsonl").exists());
    }

    #[test]
    fn retention_skips_live_sessions_and_bounds_inactive_sessions() {
        let root = tempfile::tempdir().unwrap();
        let mut live = SessionWriter::new(Some(root.path().into()), "session-000");
        live.write(b"live\n").unwrap();
        for index in 1..10 {
            let mut writer =
                SessionWriter::new(Some(root.path().into()), &format!("session-{index:03}"));
            writer.write(b"closed\n").unwrap();
        }
        prune_sessions(root.path(), &root.path().join("session-unused"));
        assert!(root.path().join("session-000/asterlyn.jsonl").exists());
        assert!(
            fs::read_dir(root.path())
                .unwrap()
                .flatten()
                .filter(|entry| entry.file_type().unwrap().is_dir())
                .count()
                <= RETAINED_LOGS + 1
        );
    }

    #[test]
    fn queue_reserves_error_capacity_and_reports_loss() {
        let shared = Shared::default();
        for _ in 0..NORMAL_CAPACITY + 10 {
            shared.enqueue(json!({"level": "info"}), false);
        }
        for _ in 0..QUEUE_CAPACITY {
            shared.enqueue(json!({"level": "error"}), true);
        }
        assert_eq!(shared.health().queued, QUEUE_CAPACITY);
        assert!(shared.health().dropped > 0);
        let queue = shared.queue.lock().unwrap();
        assert!(
            queue
                .items
                .iter()
                .all(|item| matches!(item, Message::Event(_, true)))
        );
    }
}
