use std::ffi::OsStr;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use crate::error::GitError;

const STANDARD_OUTPUT_LIMIT_BYTES: usize = 64 * 1024 * 1024;
const DIAGNOSTIC_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(2);

#[derive(Clone, Copy)]
enum GitProcessProfile {
    Standard,
    Operation,
    Remote,
}

#[derive(Clone, Copy)]
pub(crate) enum GitStdin {
    Inherit,
    Null,
    Piped,
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn refers_to(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }
}

pub(crate) enum CancellableOutput {
    Completed(Output),
    Cancelled,
}

pub(crate) struct BoundedOutput {
    pub(crate) output: Output,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr_truncated: bool,
}

/// Constructs Git subprocesses with one stable, non-interactive process policy.
///
/// Callers retain ownership of operation-specific arguments, input, cancellation, and result
/// interpretation. This boundary owns executable selection, repository scoping, inherited
/// environment hardening, and common output bounds.
pub(crate) struct GitRunner<'a> {
    repository_root: &'a Path,
    profile: GitProcessProfile,
}

impl<'a> GitRunner<'a> {
    pub(crate) fn new(repository_root: &'a Path) -> Self {
        Self {
            repository_root,
            profile: GitProcessProfile::Standard,
        }
    }

    pub(crate) fn remote(repository_root: &'a Path) -> Self {
        Self {
            repository_root,
            profile: GitProcessProfile::Remote,
        }
    }

    pub(crate) fn operation(repository_root: &'a Path) -> Self {
        Self {
            repository_root,
            profile: GitProcessProfile::Operation,
        }
    }

    fn command(&self) -> Command {
        let mut command = Command::new("git");
        command
            .arg("-C")
            .arg(self.repository_root)
            .arg("--no-pager")
            .env("LC_ALL", "C")
            .env("LANG", "C")
            // Background reads must not refresh the index and trigger our own watcher. Git still
            // takes all locks required by explicit mutations.
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0");

        match self.profile {
            GitProcessProfile::Standard => {}
            GitProcessProfile::Operation => {
                command
                    .env("GIT_EDITOR", "true")
                    .env("GIT_SEQUENCE_EDITOR", "true");
            }
            GitProcessProfile::Remote => harden_remote_command(&mut command),
        }
        command
    }

    pub(crate) fn output<I, S>(&self, args: I) -> std::io::Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let child = self.spawn(args, GitStdin::Inherit)?;
        self.wait(child)
    }

    pub(crate) fn wait(&self, child: Child) -> std::io::Result<Output> {
        match self.profile {
            GitProcessProfile::Standard | GitProcessProfile::Operation => {
                wait_with_bounded_output(child)
            }
            GitProcessProfile::Remote => wait_with_remote_output(child),
        }
    }

    pub(crate) fn spawn<I, S>(&self, args: I, stdin: GitStdin) -> std::io::Result<Child>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut command = self.command();
        command.args(args);
        match stdin {
            GitStdin::Inherit => {}
            GitStdin::Null => {
                command.stdin(Stdio::null());
            }
            GitStdin::Piped => {
                command.stdin(Stdio::piped());
            }
        }
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    }

    pub(crate) fn cancellable_output<I, S>(
        &self,
        args: I,
        stdin: GitStdin,
        cancellation: &CancellationToken,
    ) -> std::io::Result<CancellableOutput>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        if cancellation.is_cancelled() {
            return Ok(CancellableOutput::Cancelled);
        }

        let mut child = self.spawn(args, stdin)?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| std::io::Error::other("Git stdout was unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| std::io::Error::other("Git stderr was unavailable"))?;
        let bounded = matches!(self.profile, GitProcessProfile::Remote);
        let stdout_reader = thread::spawn(move || {
            if bounded {
                read_stream_bounded(stdout)
            } else {
                read_stream(stdout)
            }
        });
        let stderr_reader = thread::spawn(move || {
            if bounded {
                read_stream_bounded(stderr)
            } else {
                read_stream(stderr)
            }
        });

        let status = loop {
            if !matches!(self.profile, GitProcessProfile::Remote) && cancellation.is_cancelled() {
                let _ = terminate_child(&mut child, false);
                let _ = join_output_reader(stdout_reader, "stdout");
                let _ = join_output_reader(stderr_reader, "stderr");
                return Ok(CancellableOutput::Cancelled);
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if cancellation.is_cancelled() => {
                    let _ = terminate_child(
                        &mut child,
                        matches!(self.profile, GitProcessProfile::Remote),
                    );
                    let _ = join_output_reader(stdout_reader, "stdout");
                    let _ = join_output_reader(stderr_reader, "stderr");
                    return Ok(CancellableOutput::Cancelled);
                }
                Ok(None) => thread::sleep(CANCELLATION_POLL_INTERVAL),
                Err(error) => {
                    let _ = terminate_child(
                        &mut child,
                        matches!(self.profile, GitProcessProfile::Remote),
                    );
                    let _ = join_output_reader(stdout_reader, "stdout");
                    let _ = join_output_reader(stderr_reader, "stderr");
                    return Err(error);
                }
            }
        };

        Ok(CancellableOutput::Completed(Output {
            status,
            stdout: join_output_reader(stdout_reader, "stdout")?,
            stderr: join_output_reader(stderr_reader, "stderr")?,
        }))
    }

    pub(crate) fn bounded_output<I, S>(
        &self,
        args: I,
        stdin: GitStdin,
        stdout_limit: usize,
        stderr_limit: usize,
    ) -> std::io::Result<BoundedOutput>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut child = self.spawn(args, stdin)?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| std::io::Error::other("Git stdout was unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| std::io::Error::other("Git stderr was unavailable"))?;
        let (limit_sender, limit_receiver) = std::sync::mpsc::sync_channel(1);
        let stdout_reader = thread::spawn(move || {
            read_stream_limited_with_signal(stdout, stdout_limit, Some(limit_sender))
        });
        let stderr_reader = thread::spawn(move || read_stream_limited(stderr, stderr_limit));
        let mut terminated_at_limit = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if limit_receiver.try_recv().is_ok() => {
                    terminated_at_limit = true;
                    break terminate_child(
                        &mut child,
                        matches!(self.profile, GitProcessProfile::Remote),
                    )?;
                }
                Ok(None) => thread::sleep(CANCELLATION_POLL_INTERVAL),
                Err(error) => {
                    let _ = terminate_child(
                        &mut child,
                        matches!(self.profile, GitProcessProfile::Remote),
                    );
                    let _ = join_limited_output_reader(stdout_reader, "stdout");
                    let _ = join_limited_output_reader(stderr_reader, "stderr");
                    return Err(error);
                }
            }
        };
        let (stdout, stdout_truncated) = join_limited_output_reader(stdout_reader, "stdout")?;
        let (stderr, stderr_truncated) = join_limited_output_reader(stderr_reader, "stderr")?;
        Ok(BoundedOutput {
            output: Output {
                status,
                stdout,
                stderr,
            },
            stdout_truncated: terminated_at_limit || stdout_truncated,
            stderr_truncated,
        })
    }
}

fn harden_remote_command(command: &mut Command) {
    command
        .arg("-c")
        .arg("credential.interactive=never")
        .arg("-c")
        .arg("core.askPass=")
        .env("GCM_INTERACTIVE", "Never")
        .env("SSH_ASKPASS_REQUIRE", "never")
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS")
        .env_remove("GIT_CONFIG_PARAMETERS")
        .stdin(Stdio::null());
    for (key, _) in std::env::vars_os() {
        if should_remove_remote_environment(key.as_os_str()) {
            command.env_remove(key);
        }
    }
    #[cfg(unix)]
    command.process_group(0);
}

fn should_remove_remote_environment(key: &OsStr) -> bool {
    let name = key.to_string_lossy();
    name.starts_with("GIT_TRACE")
        || name == "GIT_CURL_VERBOSE"
        || name == "GIT_CONFIG_COUNT"
        || name == "GIT_CONFIG_GLOBAL"
        || name == "GIT_CONFIG_SYSTEM"
        || name == "GIT_CONFIG_NOSYSTEM"
        || name == "GIT_EXEC_PATH"
        || name.starts_with("GIT_CONFIG_KEY_")
        || name.starts_with("GIT_CONFIG_VALUE_")
}

fn wait_with_bounded_output(mut child: Child) -> std::io::Result<Output> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("Git stdout was unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| std::io::Error::other("Git stderr was unavailable"))?;
    let stdout_reader = thread::spawn(move || read_stream(stdout));
    let stderr_reader = thread::spawn(move || read_stream_bounded(stderr));
    let status = child.wait();
    let stdout = stdout_reader
        .join()
        .map_err(|_| std::io::Error::other("Git stdout reader failed"))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| std::io::Error::other("Git stderr reader failed"))?;
    Ok(Output {
        status: status?,
        stdout: stdout?,
        stderr: stderr?,
    })
}

fn wait_with_remote_output(mut child: Child) -> std::io::Result<Output> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("Git stdout was unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| std::io::Error::other("Git stderr was unavailable"))?;
    let stdout_reader = thread::spawn(move || read_stream_bounded(stdout));
    let stderr_reader = thread::spawn(move || read_stream_bounded(stderr));
    let status = child.wait();
    let stdout = stdout_reader
        .join()
        .map_err(|_| std::io::Error::other("Git stdout reader failed"))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| std::io::Error::other("Git stderr reader failed"))?;
    Ok(Output {
        status: status?,
        stdout: stdout?,
        stderr: stderr?,
    })
}

fn terminate_process_tree(child: &mut Child) -> std::io::Result<ExitStatus> {
    #[cfg(unix)]
    {
        let process_group = -(child.id() as i32);
        // SAFETY: remote children are placed in their own process group before spawn. Signals
        // target only that group, and failures fall back to Child::kill below.
        unsafe {
            libc::kill(process_group, libc::SIGTERM);
        }
        for _ in 0..25 {
            if child.try_wait().ok().flatten().is_some() {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(4));
        }
        // SAFETY: same dedicated process-group invariant as above. Sending SIGKILL even after the
        // direct child exits also removes a descendant that ignored SIGTERM.
        unsafe {
            libc::kill(process_group, libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    child.wait()
}

fn terminate_child(child: &mut Child, process_tree: bool) -> std::io::Result<ExitStatus> {
    if process_tree {
        terminate_process_tree(child)
    } else {
        let _ = child.kill();
        child.wait()
    }
}

pub(crate) fn read_stream(stream: impl Read) -> std::io::Result<Vec<u8>> {
    let (bytes, truncated) = read_stream_limited(stream, STANDARD_OUTPUT_LIMIT_BYTES)?;
    if truncated {
        return Err(std::io::Error::other(
            "Git output exceeded the 64 MiB limit; verify repository state before retrying a mutation",
        ));
    }
    Ok(bytes)
}

pub(crate) fn read_stream_bounded(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    read_stream_limited(&mut stream, DIAGNOSTIC_OUTPUT_LIMIT_BYTES).map(|(bytes, _)| bytes)
}

fn read_stream_limited(stream: impl Read, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    read_stream_limited_with_signal(stream, limit, None)
}

pub(crate) fn read_stream_limited_with_signal(
    mut stream: impl Read,
    limit: usize,
    limit_reached: Option<std::sync::mpsc::SyncSender<()>>,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::new();
    let mut truncated = false;
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(retained.len());
        retained.extend_from_slice(&buffer[..count.min(remaining)]);
        if count > remaining && !truncated {
            truncated = true;
            if let Some(sender) = limit_reached.as_ref() {
                let _ = sender.try_send(());
            }
        }
    }
    Ok((retained, truncated))
}

pub(crate) fn join_stream(
    reader: thread::JoinHandle<std::io::Result<Vec<u8>>>,
    operation: &str,
    stream: &str,
) -> Result<Vec<u8>, GitError> {
    reader
        .join()
        .map_err(|_| GitError::Io {
            operation: operation.to_string(),
            message: format!("Git {stream} reader stopped unexpectedly"),
        })?
        .map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: format!("could not read Git {stream}: {error}"),
        })
}

fn join_output_reader(
    reader: thread::JoinHandle<std::io::Result<Vec<u8>>>,
    stream: &str,
) -> std::io::Result<Vec<u8>> {
    reader
        .join()
        .map_err(|_| std::io::Error::other(format!("Git {stream} reader stopped unexpectedly")))?
        .map_err(|error| std::io::Error::other(format!("could not read Git {stream}: {error}")))
}

fn join_limited_output_reader(
    reader: thread::JoinHandle<std::io::Result<(Vec<u8>, bool)>>,
    stream: &str,
) -> std::io::Result<(Vec<u8>, bool)> {
    reader
        .join()
        .map_err(|_| std::io::Error::other(format!("Git {stream} reader stopped unexpectedly")))?
        .map_err(|error| std::io::Error::other(format!("could not read Git {stream}: {error}")))
}

#[cfg(test)]
mod tests {
    use std::ffi::{OsStr, OsString};
    use std::path::Path;

    use super::{
        CancellableOutput, CancellationToken, GitRunner, GitStdin, read_stream_limited,
        should_remove_remote_environment,
    };

    #[test]
    fn standard_runner_has_stable_non_interactive_policy() {
        let command = GitRunner::new(Path::new("repo")).command();
        let args = command
            .get_args()
            .map(OsStr::to_os_string)
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            ["-C", "repo", "--no-pager"]
                .into_iter()
                .map(OsString::from)
                .collect::<Vec<_>>()
        );
        assert_eq!(environment_value(&command, "LC_ALL"), Some(Some("C")));
        assert_eq!(environment_value(&command, "LANG"), Some(Some("C")));
        assert_eq!(
            environment_value(&command, "GIT_OPTIONAL_LOCKS"),
            Some(Some("0"))
        );
        assert_eq!(
            environment_value(&command, "GIT_TERMINAL_PROMPT"),
            Some(Some("0"))
        );
    }

    #[test]
    fn remote_runner_disables_interactive_credentials_and_untrusted_configuration() {
        let command = GitRunner::remote(Path::new("repo")).command();
        let args = command
            .get_args()
            .map(OsStr::to_os_string)
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            [
                "-C",
                "repo",
                "--no-pager",
                "-c",
                "credential.interactive=never",
                "-c",
                "core.askPass=",
            ]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            environment_value(&command, "GCM_INTERACTIVE"),
            Some(Some("Never"))
        );
        assert_eq!(
            environment_value(&command, "SSH_ASKPASS_REQUIRE"),
            Some(Some("never"))
        );
        assert_eq!(environment_value(&command, "GIT_ASKPASS"), Some(None));
        assert_eq!(environment_value(&command, "SSH_ASKPASS"), Some(None));
        assert_eq!(
            environment_value(&command, "GIT_CONFIG_PARAMETERS"),
            Some(None)
        );
    }

    #[test]
    fn remote_environment_filter_covers_trace_and_config_injection_families() {
        for key in [
            "GIT_TRACE",
            "GIT_TRACE_PACKET",
            "GIT_CURL_VERBOSE",
            "GIT_CONFIG_COUNT",
            "GIT_CONFIG_GLOBAL",
            "GIT_CONFIG_SYSTEM",
            "GIT_CONFIG_NOSYSTEM",
            "GIT_EXEC_PATH",
            "GIT_CONFIG_KEY_0",
            "GIT_CONFIG_VALUE_0",
        ] {
            assert!(should_remove_remote_environment(OsStr::new(key)), "{key}");
        }
        assert!(!should_remove_remote_environment(OsStr::new("GIT_DIR")));
        assert!(!should_remove_remote_environment(OsStr::new("PATH")));
    }

    #[test]
    fn operation_runner_disables_editor_prompts() {
        let command = GitRunner::operation(Path::new("repo")).command();
        assert_eq!(
            environment_value(&command, "GIT_EDITOR"),
            Some(Some("true"))
        );
        assert_eq!(
            environment_value(&command, "GIT_SEQUENCE_EDITOR"),
            Some(Some("true"))
        );
    }

    #[test]
    fn limited_reader_drains_input_but_retains_only_the_budget() {
        let (bytes, truncated) = read_stream_limited(&b"0123456789"[..], 4).unwrap();
        assert_eq!(bytes, b"0123");
        assert!(truncated);
    }

    #[test]
    fn pre_cancelled_execution_does_not_start_git() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let outcome = GitRunner::new(Path::new("a root that need not exist"))
            .cancellable_output(["status"], GitStdin::Null, &cancellation)
            .unwrap();
        assert!(matches!(outcome, CancellableOutput::Cancelled));
    }

    fn environment_value<'a>(
        command: &'a std::process::Command,
        key: &str,
    ) -> Option<Option<&'a str>> {
        command
            .get_envs()
            .find(|(name, _)| *name == OsStr::new(key))
            .map(|(_, value)| value.and_then(OsStr::to_str))
    }
}
