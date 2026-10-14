use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_ARGS: usize = 128;
pub const MAX_ARG_BYTES: usize = 16 * 1024;
pub const MAX_TOTAL_ARG_BYTES: usize = 512 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub fn encode_output(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrustState {
    Unknown,
    Trusted,
    Denied,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRequest {
    pub plugin_id: String,
    pub provider_id: String,
    pub task_id: String,
    pub label: String,
    pub executable_path: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreparedTask {
    pub protocol_version: u8,
    pub review_id: String,
    pub workspace_root: String,
    pub plugin_id: String,
    pub provider_id: String,
    pub task_id: String,
    pub label: String,
    pub executable_path: String,
    pub canonical_executable_path: String,
    pub cwd: String,
    pub args: Vec<String>,
    pub trust: TrustState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskStarted {
    pub protocol_version: u8,
    pub run_id: String,
    pub workspace_root: String,
    pub review_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TaskSessionEvent {
    #[serde(rename = "output")]
    Output {
        protocol_version: u8,
        run_id: String,
        workspace_root: String,
        stream: OutputStream,
        data_base64: String,
        sequence: u64,
    },
    #[serde(rename = "truncated")]
    Truncated {
        protocol_version: u8,
        run_id: String,
        workspace_root: String,
        stream: OutputStream,
        omitted_bytes: u64,
        sequence: u64,
    },
    #[serde(rename = "status")]
    Status {
        protocol_version: u8,
        run_id: String,
        workspace_root: String,
        sequence: u64,
        status: TaskStatus,
        message: Option<String>,
        exit_code: Option<i32>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Crashed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

pub fn validate_request(request: &TaskRequest) -> Result<(), String> {
    for (name, value) in [
        ("pluginId", &request.plugin_id),
        ("providerId", &request.provider_id),
        ("taskId", &request.task_id),
        ("label", &request.label),
        ("executablePath", &request.executable_path),
    ] {
        if value.is_empty() || value.len() > 1024 || value.contains('\0') {
            return Err(format!("{name} is invalid"));
        }
    }
    if request.args.len() > MAX_ARGS {
        return Err("too many task arguments".into());
    }
    if request
        .args
        .iter()
        .any(|arg| arg.len() > MAX_ARG_BYTES || arg.contains('\0'))
        || request.args.iter().map(String::len).sum::<usize>() > MAX_TOTAL_ARG_BYTES
    {
        return Err("task argument is too large".into());
    }
    if request.executable_path.starts_with('/')
        || request.executable_path.contains('\\')
        || request.executable_path.contains(':')
        || request
            .executable_path
            .split('/')
            .any(|part| part == ".." || part == "." || part.is_empty())
    {
        return Err("executablePath must be a normalized workspace-relative path".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escape_and_absolute_executables() {
        let mut r = TaskRequest {
            plugin_id: "p".into(),
            provider_id: "v".into(),
            task_id: "t".into(),
            label: "T".into(),
            executable_path: "../bin".into(),
            args: vec![],
        };
        assert!(validate_request(&r).is_err());
        r.executable_path = "/bin/sh".into();
        assert!(validate_request(&r).is_err());
        r.executable_path = "./bin".into();
        assert!(validate_request(&r).is_err());
        r.executable_path = "C:/bin".into();
        assert!(validate_request(&r).is_err());
        r.executable_path = "bin\0/sh".into();
        assert!(validate_request(&r).is_err());
    }
}
