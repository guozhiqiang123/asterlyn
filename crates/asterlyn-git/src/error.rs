use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteFailureKind {
    Authentication,
    Network,
    Rejected,
    Unknown,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum GitError {
    InvalidRepository {
        path: String,
        message: String,
    },
    CommandFailed {
        operation: String,
        status: Option<i32>,
        message: String,
    },
    Io {
        operation: String,
        message: String,
    },
    Parse {
        context: String,
        message: String,
    },
    InvalidInput {
        field: String,
        message: String,
    },
    UnsafeOperation {
        operation: String,
        message: String,
        blockers: Vec<String>,
    },
    RemoteFailed {
        operation: String,
        remote: String,
        reason: RemoteFailureKind,
    },
    RemoteCancelled {
        operation: String,
        #[serde(rename = "repositoryStateMayHaveChanged")]
        repository_state_may_have_changed: bool,
        #[serde(rename = "remoteStateMayHaveChanged")]
        remote_state_may_have_changed: bool,
    },
    Cancelled {
        operation: String,
    },
}

impl Display for GitError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidRepository { path, message } => {
                write!(
                    formatter,
                    "'{path}' is not a readable Git repository: {message}"
                )
            }
            Self::CommandFailed {
                operation,
                status,
                message,
            } => write!(
                formatter,
                "Git operation '{operation}' failed with status {}: {message}",
                status.map_or_else(|| "unknown".to_string(), |value| value.to_string())
            ),
            Self::Io { operation, message } => {
                write!(formatter, "I/O failure during '{operation}': {message}")
            }
            Self::Parse { context, message } => {
                write!(formatter, "Could not parse {context}: {message}")
            }
            Self::InvalidInput { field, message } => {
                write!(formatter, "Invalid {field}: {message}")
            }
            Self::UnsafeOperation {
                operation,
                message,
                blockers,
            } => {
                write!(
                    formatter,
                    "Unsafe Git operation '{operation}' was blocked: {message}"
                )?;
                if !blockers.is_empty() {
                    write!(formatter, " ({} blocking paths)", blockers.len())?;
                }
                Ok(())
            }
            Self::RemoteFailed {
                operation,
                remote,
                reason,
            } => write!(
                formatter,
                "Remote Git operation '{operation}' failed for '{remote}': {reason:?}"
            ),
            Self::RemoteCancelled {
                operation,
                repository_state_may_have_changed,
                remote_state_may_have_changed,
            } => write!(
                formatter,
                "Remote Git operation '{operation}' was cancelled (repository state may have changed: {repository_state_may_have_changed}, remote state may have changed: {remote_state_may_have_changed})"
            ),
            Self::Cancelled { operation } => {
                write!(formatter, "Git operation '{operation}' was cancelled")
            }
        }
    }
}

impl std::error::Error for GitError {}
