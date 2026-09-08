use std::fmt::{Display, Formatter};

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
        }
    }
}

impl std::error::Error for GitError {}
