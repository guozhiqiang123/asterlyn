use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Output;

use crate::error::GitError;
use crate::model::RemoteTransport;
use crate::process::{GitRunner, GitStdin};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemoteEndpoint {
    pub(crate) transport: RemoteTransport,
    pub(crate) host: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) username: Option<String>,
    pub(crate) suggested_ssh_url: Option<String>,
}

pub(crate) struct CredentialService<'a> {
    root: &'a Path,
    helper: Option<&'static str>,
}

impl<'a> CredentialService<'a> {
    pub(crate) fn discover(root: &'a Path) -> Result<Self, GitError> {
        Ok(Self {
            root,
            helper: discover_platform_credential_helper(root)?,
        })
    }

    pub(crate) fn helper(&self) -> Option<&'static str> {
        self.helper
    }

    pub(crate) fn credential_available(&self, endpoint: &RemoteEndpoint) -> Result<bool, GitError> {
        let Some(helper) = self.helper else {
            return Ok(false);
        };
        let mut input = credential_input(endpoint, endpoint.username.as_deref(), None);
        let output = self.run("read remote credential", "fill", &input, helper);
        input.fill(0);
        let mut output = output?;
        let available = output.status.success() && credential_output_has_secret(&output.stdout);
        output.stdout.fill(0);
        output.stderr.fill(0);
        Ok(available)
    }

    pub(crate) fn store(
        &self,
        endpoint: &RemoteEndpoint,
        username: &str,
        token: &str,
    ) -> Result<(), GitError> {
        let helper = self.helper.ok_or_else(|| GitError::InvalidInput {
            field: "credential helper".to_string(),
            message:
                "no supported secure Git credential manager is installed; install one or use SSH"
                    .to_string(),
        })?;
        let mut input = credential_input(endpoint, Some(username), Some(token));
        let output = self.run("store remote credential", "approve", &input, helper);
        input.fill(0);
        let mut output = output?;
        if !output.status.success() {
            let status = output.status.code();
            output.stdout.fill(0);
            output.stderr.fill(0);
            return Err(credential_rejection(status));
        }
        output.stdout.fill(0);
        output.stderr.fill(0);
        Ok(())
    }

    fn run(
        &self,
        operation: &str,
        action: &str,
        input: &[u8],
        helper: &str,
    ) -> Result<Output, GitError> {
        let runner = GitRunner::remote_with_credential_helper(self.root, helper);
        let mut child = runner
            .spawn(["credential", action], GitStdin::Piped)
            .map_err(|error| GitError::Io {
                operation: operation.to_string(),
                message: error.to_string(),
            })?;
        let mut stdin = child.stdin.take().ok_or_else(|| GitError::Io {
            operation: operation.to_string(),
            message: "Git credential stdin was unavailable".to_string(),
        })?;
        stdin.write_all(input).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: format!("could not send credential metadata to Git: {error}"),
        })?;
        drop(stdin);
        runner.wait(child).map_err(|error| GitError::Io {
            operation: operation.to_string(),
            message: error.to_string(),
        })
    }
}

fn credential_rejection(status: Option<i32>) -> GitError {
    GitError::CommandFailed {
        operation: "store remote credential".to_string(),
        status,
        message: "the supported system credential manager rejected the credential".to_string(),
    }
}

pub(crate) fn parse_remote_endpoint(url: &str) -> RemoteEndpoint {
    let value = url.trim();
    if value.is_empty() || value.contains(['\0', '\r', '\n']) {
        return remote_endpoint(RemoteTransport::Other, None, None, None, None);
    }
    if let Some(rest) = value.strip_prefix("https://") {
        let (authority, path) = split_remote_authority(rest);
        let (username, host) = split_remote_user(authority);
        let path = clean_remote_path(path);
        let suggested_ssh_url = suggested_ssh_url(host, path.as_deref());
        return remote_endpoint(
            RemoteTransport::Https,
            nonempty(host),
            path,
            username,
            suggested_ssh_url,
        );
    }
    if let Some(rest) = value.strip_prefix("ssh://") {
        let (authority, path) = split_remote_authority(rest);
        let (username, host) = split_remote_user(authority);
        return remote_endpoint(
            RemoteTransport::Ssh,
            nonempty(host),
            clean_remote_path(path),
            username,
            None,
        );
    }
    if value.starts_with("file://")
        || value.starts_with('/')
        || value.starts_with("./")
        || value.starts_with("../")
    {
        return remote_endpoint(RemoteTransport::Local, None, None, None, None);
    }
    if let Some((authority, path)) = value.split_once(':')
        && authority.len() > 1
        && !authority.contains(['/', '\\'])
        && !path.is_empty()
    {
        let (username, host) = split_remote_user(authority);
        return remote_endpoint(
            RemoteTransport::Ssh,
            nonempty(host),
            clean_remote_path(path),
            username,
            None,
        );
    }
    if Path::new(value).is_absolute() || value.contains(['/', '\\']) {
        return remote_endpoint(RemoteTransport::Local, None, None, None, None);
    }
    remote_endpoint(RemoteTransport::Other, None, None, None, None)
}

pub(crate) fn validate_credential_field(
    field: &str,
    value: &str,
    limit: usize,
) -> Result<(), GitError> {
    if value.is_empty()
        || value.len() > limit
        || value != value.trim()
        || value.contains(['\0', '\r', '\n'])
    {
        return Err(GitError::InvalidInput {
            field: field.to_string(),
            message: format!("enter a non-empty {field} without surrounding whitespace"),
        });
    }
    Ok(())
}

pub(crate) fn discover_platform_credential_helper(
    root: &Path,
) -> Result<Option<&'static str>, GitError> {
    #[cfg(target_os = "macos")]
    const CANDIDATES: &[&str] = &["osxkeychain"];
    #[cfg(target_os = "windows")]
    const CANDIDATES: &[&str] = &["manager", "manager-core"];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    const CANDIDATES: &[&str] = &["libsecret"];

    let output = GitRunner::new(root)
        .output(["--exec-path"])
        .map_err(|error| GitError::Io {
            operation: "locate Git credential helpers".to_string(),
            message: error.to_string(),
        })?;
    if !output.status.success() {
        return Err(GitError::CommandFailed {
            operation: "locate Git credential helpers".to_string(),
            status: output.status.code(),
            message: "Git could not locate its credential helpers".to_string(),
        });
    }
    let exec_path = output_path(&output, "Git executable path")?;
    let path_entries = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    Ok(CANDIDATES.iter().copied().find(|candidate| {
        credential_helper_file_exists(&exec_path, candidate)
            || path_entries
                .iter()
                .any(|entry| credential_helper_file_exists(entry, candidate))
    }))
}

pub(crate) fn ssh_identity_configured() -> bool {
    if std::env::var_os("SSH_AUTH_SOCK")
        .filter(|value| !value.is_empty())
        .is_some_and(|value| Path::new(&value).exists())
    {
        return true;
    }
    let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) else {
        return false;
    };
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .iter()
        .any(|name| Path::new(&home).join(".ssh").join(name).is_file())
}

fn remote_endpoint(
    transport: RemoteTransport,
    host: Option<String>,
    path: Option<String>,
    username: Option<String>,
    suggested_ssh_url: Option<String>,
) -> RemoteEndpoint {
    RemoteEndpoint {
        transport,
        host,
        path,
        username,
        suggested_ssh_url,
    }
}

fn split_remote_authority(value: &str) -> (&str, &str) {
    value
        .find('/')
        .map_or((value, ""), |index| (&value[..index], &value[index + 1..]))
}

fn split_remote_user(authority: &str) -> (Option<String>, &str) {
    let Some((userinfo, host)) = authority.rsplit_once('@') else {
        return (None, authority);
    };
    let username = userinfo.split_once(':').map_or(userinfo, |(name, _)| name);
    (nonempty(username), host)
}

fn clean_remote_path(path: &str) -> Option<String> {
    let path = path
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_start_matches('/');
    nonempty(path)
}

fn nonempty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

fn suggested_ssh_url(host: &str, path: Option<&str>) -> Option<String> {
    let path = path?;
    if host.is_empty() {
        return None;
    }
    if host.contains(':') {
        Some(format!("ssh://git@{host}/{path}"))
    } else {
        Some(format!("git@{host}:{path}"))
    }
}

fn credential_input(
    endpoint: &RemoteEndpoint,
    username: Option<&str>,
    password: Option<&str>,
) -> Vec<u8> {
    let mut input = Vec::new();
    input.extend_from_slice(b"protocol=https\n");
    if let Some(host) = endpoint.host.as_deref() {
        input.extend_from_slice(b"host=");
        input.extend_from_slice(host.as_bytes());
        input.push(b'\n');
    }
    if let Some(path) = endpoint.path.as_deref() {
        input.extend_from_slice(b"path=");
        input.extend_from_slice(path.as_bytes());
        input.push(b'\n');
    }
    if let Some(username) = username {
        input.extend_from_slice(b"username=");
        input.extend_from_slice(username.as_bytes());
        input.push(b'\n');
    }
    if let Some(password) = password {
        input.extend_from_slice(b"password=");
        input.extend_from_slice(password.as_bytes());
        input.push(b'\n');
    }
    input.push(b'\n');
    input
}

fn credential_output_has_secret(output: &[u8]) -> bool {
    output.split(|byte| *byte == b'\n').any(|line| {
        line.strip_prefix(b"password=")
            .is_some_and(|password| !password.is_empty())
    })
}

fn credential_helper_file_exists(directory: &Path, helper: &str) -> bool {
    let executable = directory.join(format!("git-credential-{helper}"));
    executable.is_file()
        || cfg!(target_os = "windows") && executable.with_extension("exe").is_file()
}

fn output_path(output: &Output, context: &str) -> Result<PathBuf, GitError> {
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        Err(GitError::Parse {
            context: context.to_string(),
            message: "Git returned an empty path".to_string(),
        })
    } else {
        Ok(PathBuf::from(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_without_retaining_embedded_password() {
        let endpoint = parse_remote_endpoint(
            "https://octocat:discard-me@example.invalid/owner/repository.git?ignored=true",
        );
        assert_eq!(endpoint.transport, RemoteTransport::Https);
        assert_eq!(endpoint.host.as_deref(), Some("example.invalid"));
        assert_eq!(endpoint.username.as_deref(), Some("octocat"));
        assert_eq!(endpoint.path.as_deref(), Some("owner/repository.git"));
        assert!(!format!("{endpoint:?}").contains("discard-me"));
    }

    #[test]
    fn rejection_never_contains_helper_output_or_submitted_secret() {
        let error = credential_rejection(Some(1));
        let rendered = error.to_string();
        assert!(!rendered.contains("submitted-secret"));
        assert!(!rendered.contains("helper-echo"));
        assert!(rendered.contains("credential manager rejected"));
    }

    #[cfg(unix)]
    #[test]
    fn helper_stderr_cannot_echo_the_submitted_secret_out_of_the_service() {
        let root = tempfile::tempdir().unwrap();
        let service = CredentialService {
            root: root.path(),
            helper: Some("!f() { cat >&2; exit 1; }; f"),
        };
        let endpoint = parse_remote_endpoint("https://example.invalid/owner/repository.git");
        let result = service.store(&endpoint, "developer", "submitted-secret");
        let rendered = format!("{result:?}");
        assert!(!rendered.contains("submitted-secret"));
        assert!(!rendered.contains("developer"));
    }
}
