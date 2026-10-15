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
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
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
    fn task_session_events_use_the_frontend_camel_case_contract() {
        let status = TaskSessionEvent::Status {
            protocol_version: PROTOCOL_VERSION,
            run_id: "run-1".into(),
            workspace_root: "/repo".into(),
            sequence: 1,
            status: TaskStatus::Running,
            message: None,
            exit_code: None,
        };
        let output = TaskSessionEvent::Output {
            protocol_version: PROTOCOL_VERSION,
            run_id: "run-1".into(),
            workspace_root: "/repo".into(),
            stream: OutputStream::Stdout,
            data_base64: "b2s=".into(),
            sequence: 2,
        };
        let truncated = TaskSessionEvent::Truncated {
            protocol_version: PROTOCOL_VERSION,
            run_id: "run-1".into(),
            workspace_root: "/repo".into(),
            stream: OutputStream::Stderr,
            omitted_bytes: 64,
            sequence: 3,
        };

        let status = serde_json::to_value(status).expect("serialize task status event");
        let output = serde_json::to_value(output).expect("serialize task output event");
        let truncated = serde_json::to_value(truncated).expect("serialize task truncation event");
        assert_eq!(status["kind"], "status");
        assert_eq!(status["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(status["runId"], "run-1");
        assert_eq!(status["workspaceRoot"], "/repo");
        assert_eq!(status["exitCode"], serde_json::Value::Null);
        assert_eq!(output["kind"], "output");
        assert_eq!(output["dataBase64"], "b2s=");
        assert_eq!(truncated["kind"], "truncated");
        assert_eq!(truncated["omittedBytes"], 64);
        for value in [&status, &output, &truncated] {
            assert!(value.get("protocol_version").is_none());
            assert!(value.get("run_id").is_none());
            assert!(value.get("workspace_root").is_none());
        }
        assert!(output.get("data_base64").is_none());
        assert!(truncated.get("omitted_bytes").is_none());
    }

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
