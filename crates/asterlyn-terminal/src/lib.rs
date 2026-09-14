use std::collections::HashMap;
use std::fmt;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};

pub const TERMINAL_PROTOCOL_VERSION: u8 = 1;
pub const DEFAULT_COLS: u16 = 80;
pub const DEFAULT_ROWS: u16 = 24;
pub const MIN_COLS: u16 = 2;
pub const MAX_COLS: u16 = 500;
pub const MIN_ROWS: u16 = 2;
pub const MAX_ROWS: u16 = 300;
pub const MAX_INPUT_BYTES: usize = 64 * 1024;
const OUTPUT_CHUNK_BYTES: usize = 16 * 1024;

pub type TerminalEventSink = Arc<dyn Fn(TerminalEvent) + Send + Sync + 'static>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalStarted {
    pub session_id: String,
    pub shell: String,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalEvent {
    Output {
        session_id: String,
        sequence: u64,
        bytes: Vec<u8>,
    },
    Exited {
        session_id: String,
        exit_code: u32,
        signal: Option<String>,
    },
    ReaderFailed {
        session_id: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalError {
    InvalidInput(String),
    AlreadyRunning,
    SessionNotFound,
    StaleSession,
    Io {
        operation: &'static str,
        message: String,
    },
}

impl fmt::Display for TerminalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(formatter, "{message}"),
            Self::AlreadyRunning => {
                write!(formatter, "a terminal is already running in this window")
            }
            Self::SessionNotFound => write!(formatter, "this window has no terminal session"),
            Self::StaleSession => write!(formatter, "the terminal session is no longer current"),
            Self::Io { operation, message } => write!(formatter, "{operation}: {message}"),
        }
    }
}

impl std::error::Error for TerminalError {}

struct TerminalSession {
    id: String,
    root: PathBuf,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>,
    alive: Arc<AtomicBool>,
}

impl TerminalSession {
    fn terminate(&self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(mut killer) = self.killer.lock() {
            let _ = killer.kill();
        }
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(killer) = self.killer.get_mut() {
            let _ = killer.kill();
        }
    }
}

#[derive(Default)]
pub struct TerminalSessions {
    sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
    sequence: AtomicU64,
}

impl TerminalSessions {
    pub fn start(
        &self,
        owner: &str,
        root: &Path,
        cols: u16,
        rows: u16,
        sink: TerminalEventSink,
    ) -> Result<TerminalStarted, TerminalError> {
        validate_owner(owner)?;
        let size = validated_size(cols, rows)?;
        let root = std::fs::canonicalize(root).map_err(|error| TerminalError::Io {
            operation: "resolve terminal working directory",
            message: error.to_string(),
        })?;
        if !root.is_dir() {
            return Err(TerminalError::InvalidInput(
                "the terminal working directory is not a directory".to_string(),
            ));
        }

        let mut sessions = self.sessions.lock().map_err(|_| lock_error())?;
        if let Some(current) = sessions.get(owner) {
            if current.alive.load(Ordering::Acquire) {
                return Err(TerminalError::AlreadyRunning);
            }
            sessions.remove(owner);
        }

        let shell = resolve_shell();
        let id = format!(
            "terminal-{}",
            self.sequence.fetch_add(1, Ordering::Relaxed) + 1
        );
        let session = spawn_session(&id, &root, &shell, size, sink)?;
        sessions.insert(owner.to_string(), Arc::new(session));
        Ok(TerminalStarted {
            session_id: id,
            shell: shell.display_name,
            cwd: root,
        })
    }

    pub fn write(&self, owner: &str, session_id: &str, bytes: &[u8]) -> Result<(), TerminalError> {
        if bytes.len() > MAX_INPUT_BYTES {
            return Err(TerminalError::InvalidInput(format!(
                "terminal input exceeds the {MAX_INPUT_BYTES}-byte limit"
            )));
        }
        if bytes.is_empty() {
            return Ok(());
        }
        let session = self.current(owner, session_id)?;
        if !session.alive.load(Ordering::Acquire) {
            return Err(TerminalError::SessionNotFound);
        }
        let mut writer = session.writer.lock().map_err(|_| lock_error())?;
        writer.write_all(bytes).map_err(|error| TerminalError::Io {
            operation: "write terminal input",
            message: error.to_string(),
        })?;
        writer.flush().map_err(|error| TerminalError::Io {
            operation: "flush terminal input",
            message: error.to_string(),
        })
    }

    pub fn resize(
        &self,
        owner: &str,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), TerminalError> {
        let size = validated_size(cols, rows)?;
        let session = self.current(owner, session_id)?;
        if !session.alive.load(Ordering::Acquire) {
            return Err(TerminalError::SessionNotFound);
        }
        session
            .master
            .lock()
            .map_err(|_| lock_error())?
            .resize(size)
            .map_err(|error| TerminalError::Io {
                operation: "resize terminal",
                message: error.to_string(),
            })
    }

    pub fn close(&self, owner: &str, session_id: &str) -> Result<bool, TerminalError> {
        let mut sessions = self.sessions.lock().map_err(|_| lock_error())?;
        let Some(current) = sessions.get(owner) else {
            return Ok(false);
        };
        if current.id != session_id {
            return Err(TerminalError::StaleSession);
        }
        let session = sessions.remove(owner).expect("current session was present");
        drop(sessions);
        session.terminate();
        Ok(true)
    }

    pub fn remove_owner(&self, owner: &str) {
        let session = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(owner));
        if let Some(session) = session {
            session.terminate();
        }
    }

    pub fn remove_owner_if_root_changed(&self, owner: &str, next_root: &Path) {
        let session = self.sessions.lock().ok().and_then(|mut sessions| {
            let should_remove = sessions
                .get(owner)
                .is_some_and(|session| session.root != next_root);
            should_remove.then(|| sessions.remove(owner)).flatten()
        });
        if let Some(session) = session {
            session.terminate();
        }
    }

    pub fn has_session(&self, owner: &str, session_id: &str) -> bool {
        self.sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(owner).cloned())
            .is_some_and(|session| {
                session.id == session_id && session.alive.load(Ordering::Acquire)
            })
    }

    fn current(
        &self,
        owner: &str,
        session_id: &str,
    ) -> Result<Arc<TerminalSession>, TerminalError> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| lock_error())?
            .get(owner)
            .cloned()
            .ok_or(TerminalError::SessionNotFound)?;
        if session.id != session_id {
            return Err(TerminalError::StaleSession);
        }
        Ok(session)
    }
}

#[derive(Debug)]
struct ShellProgram {
    program: PathBuf,
    args: Vec<&'static str>,
    display_name: String,
}

fn spawn_session(
    id: &str,
    root: &Path,
    shell: &ShellProgram,
    size: PtySize,
    sink: TerminalEventSink,
) -> Result<TerminalSession, TerminalError> {
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| TerminalError::Io {
            operation: "create pseudo-terminal",
            message: error.to_string(),
        })?;
    let mut command = CommandBuilder::new(&shell.program);
    command.cwd(root);
    command.args(&shell.args);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| TerminalError::Io {
            operation: "start terminal shell",
            message: error.to_string(),
        })?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| TerminalError::Io {
            operation: "open terminal output",
            message: error.to_string(),
        })?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| TerminalError::Io {
            operation: "open terminal input",
            message: error.to_string(),
        })?;
    let killer = child.clone_killer();
    let alive = Arc::new(AtomicBool::new(true));
    let reader_alive = Arc::clone(&alive);
    let event_id = id.to_string();
    let output_sink = Arc::clone(&sink);
    let output_thread = thread::Builder::new()
        .name(format!("{id}-output"))
        .spawn(move || {
            let mut sequence = 0_u64;
            let mut buffer = vec![0_u8; OUTPUT_CHUNK_BYTES];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        sequence += 1;
                        output_sink(TerminalEvent::Output {
                            session_id: event_id.clone(),
                            sequence,
                            bytes: buffer[..read].to_vec(),
                        });
                    }
                    Err(_error) if !reader_alive.load(Ordering::Acquire) => break,
                    Err(error) => {
                        output_sink(TerminalEvent::ReaderFailed {
                            session_id: event_id.clone(),
                            message: error.to_string(),
                        });
                        break;
                    }
                }
            }
        })
        .map_err(|error| TerminalError::Io {
            operation: "start terminal output reader",
            message: error.to_string(),
        })?;

    let exit_id = id.to_string();
    let exit_alive = Arc::clone(&alive);
    thread::Builder::new()
        .name(format!("{id}-wait"))
        .spawn(move || {
            let status = child.wait();
            exit_alive.store(false, Ordering::Release);
            let _ = output_thread.join();
            match status {
                Ok(status) => sink(TerminalEvent::Exited {
                    session_id: exit_id,
                    exit_code: status.exit_code(),
                    signal: status.signal().map(str::to_string),
                }),
                Err(error) => sink(TerminalEvent::ReaderFailed {
                    session_id: exit_id,
                    message: format!("wait for terminal shell: {error}"),
                }),
            }
        })
        .map_err(|error| TerminalError::Io {
            operation: "start terminal process monitor",
            message: error.to_string(),
        })?;

    Ok(TerminalSession {
        id: id.to_string(),
        root: root.to_path_buf(),
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
        alive,
    })
}

fn validated_size(cols: u16, rows: u16) -> Result<PtySize, TerminalError> {
    if !(MIN_COLS..=MAX_COLS).contains(&cols) || !(MIN_ROWS..=MAX_ROWS).contains(&rows) {
        return Err(TerminalError::InvalidInput(format!(
            "terminal dimensions must be {MIN_COLS}-{MAX_COLS} columns and {MIN_ROWS}-{MAX_ROWS} rows"
        )));
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn validate_owner(owner: &str) -> Result<(), TerminalError> {
    if owner.is_empty() || owner.len() > 128 || owner.contains('\0') {
        return Err(TerminalError::InvalidInput(
            "terminal owner identity is invalid".to_string(),
        ));
    }
    Ok(())
}

fn lock_error() -> TerminalError {
    TerminalError::Io {
        operation: "access terminal session",
        message: "terminal session lock was poisoned".to_string(),
    }
}

#[cfg(unix)]
fn resolve_shell() -> ShellProgram {
    let configured = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_file());
    let fallback = if cfg!(target_os = "macos") {
        PathBuf::from("/bin/zsh")
    } else if Path::new("/bin/bash").is_file() {
        PathBuf::from("/bin/bash")
    } else {
        PathBuf::from("/bin/sh")
    };
    let program = configured.unwrap_or(fallback);
    let display_name = program
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("shell")
        .to_string();
    ShellProgram {
        program,
        args: if cfg!(target_os = "macos") {
            vec!["-l"]
        } else {
            Vec::new()
        },
        display_name,
    }
}

#[cfg(windows)]
fn resolve_shell() -> ShellProgram {
    let program = std::env::var_os("COMSPEC")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_file())
        .unwrap_or_else(|| PathBuf::from("cmd.exe"));
    ShellProgram {
        display_name: program
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("cmd.exe")
            .to_string(),
        program,
        args: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn dimensions_and_input_are_bounded() {
        assert!(validated_size(MIN_COLS, MIN_ROWS).is_ok());
        assert!(validated_size(MAX_COLS, MAX_ROWS).is_ok());
        assert!(matches!(
            validated_size(MIN_COLS - 1, DEFAULT_ROWS),
            Err(TerminalError::InvalidInput(_))
        ));
        assert!(matches!(
            validated_size(DEFAULT_COLS, MAX_ROWS + 1),
            Err(TerminalError::InvalidInput(_))
        ));
    }

    #[test]
    fn invalid_owner_is_rejected_before_process_creation() {
        let sessions = TerminalSessions::default();
        let root = tempfile::tempdir().expect("temporary root");
        let error = sessions
            .start(
                "",
                root.path(),
                DEFAULT_COLS,
                DEFAULT_ROWS,
                Arc::new(|_| {}),
            )
            .expect_err("invalid owner must fail");
        assert!(matches!(error, TerminalError::InvalidInput(_)));
    }

    #[cfg(unix)]
    #[test]
    fn interactive_shell_starts_in_root_streams_output_and_exits() {
        let sessions = TerminalSessions::default();
        let root = tempfile::tempdir().expect("temporary root");
        let expected_root = std::fs::canonicalize(root.path()).expect("canonical root");
        let (sender, receiver) = mpsc::channel();
        let started = sessions
            .start(
                "window-a",
                root.path(),
                90,
                30,
                Arc::new(move |event| {
                    let _ = sender.send(event);
                }),
            )
            .expect("terminal starts");
        assert_eq!(started.cwd, expected_root);
        assert!(sessions.has_session("window-a", &started.session_id));
        sessions
            .write(
                "window-a",
                &started.session_id,
                b"printf '__ASTERLYN_PWD__:%s\\n' \"$PWD\"\nexit\n",
            )
            .expect("terminal input");

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut output = Vec::new();
        let mut exited = false;
        while Instant::now() < deadline && !exited {
            if let Ok(event) = receiver.recv_timeout(Duration::from_millis(200)) {
                match event {
                    TerminalEvent::Output { bytes, .. } => output.extend(bytes),
                    TerminalEvent::Exited { exit_code, .. } => {
                        assert_eq!(exit_code, 0);
                        exited = true;
                    }
                    TerminalEvent::ReaderFailed { message, .. } => {
                        panic!("terminal reader failed: {message}")
                    }
                }
            }
        }
        assert!(exited, "shell did not exit before timeout");
        let output = String::from_utf8_lossy(&output);
        assert!(
            output.contains(&format!("__ASTERLYN_PWD__:{}", expected_root.display())),
            "terminal output did not contain cwd marker: {output:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn close_releases_exact_session_and_rejects_stale_input() {
        let sessions = TerminalSessions::default();
        let root = tempfile::tempdir().expect("temporary root");
        let other_root = tempfile::tempdir().expect("other temporary root");
        let started = sessions
            .start(
                "window-a",
                root.path(),
                DEFAULT_COLS,
                DEFAULT_ROWS,
                Arc::new(|_| {}),
            )
            .expect("terminal starts");
        assert!(matches!(
            sessions.start(
                "window-a",
                root.path(),
                DEFAULT_COLS,
                DEFAULT_ROWS,
                Arc::new(|_| {})
            ),
            Err(TerminalError::AlreadyRunning)
        ));
        assert!(matches!(
            sessions.write(
                "window-a",
                &started.session_id,
                &vec![b'x'; MAX_INPUT_BYTES + 1]
            ),
            Err(TerminalError::InvalidInput(_))
        ));
        assert!(matches!(
            sessions.close("window-a", "terminal-obsolete"),
            Err(TerminalError::StaleSession)
        ));
        sessions.remove_owner_if_root_changed("window-a", root.path());
        assert!(sessions.has_session("window-a", &started.session_id));
        sessions.remove_owner_if_root_changed("window-a", other_root.path());
        assert!(!sessions.has_session("window-a", &started.session_id));

        let replacement = sessions
            .start(
                "window-a",
                root.path(),
                DEFAULT_COLS,
                DEFAULT_ROWS,
                Arc::new(|_| {}),
            )
            .expect("replacement terminal starts");
        assert!(
            sessions
                .close("window-a", &replacement.session_id)
                .expect("close")
        );
        assert!(!sessions.has_session("window-a", &replacement.session_id));
        assert!(matches!(
            sessions.write("window-a", &replacement.session_id, b"pwd\n"),
            Err(TerminalError::SessionNotFound)
        ));
    }
}
