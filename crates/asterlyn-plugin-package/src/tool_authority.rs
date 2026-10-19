use std::collections::BTreeSet;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

use super::{AdmissionError, contract, validate_identifier};

const MAX_PROCESS_QUERIES: usize = 32;
const MAX_TOOL_OPERATIONS: usize = 32;
const MAX_PROCESS_ARGUMENTS: usize = 64;
const MAX_PROCESS_ARGUMENT_LENGTH: usize = 1_024;
const MAX_PROCESS_ID_LENGTH: usize = 128;
const MAX_PROCESS_TIMEOUT_MS: u64 = 300_000;
const MAX_PROCESS_OUTPUT_BYTES: usize = 1_048_576;
const MAX_TOOL_PARAMETERS: usize = 16;
const MAX_PARAMETER_NAME_LENGTH: usize = 128;
const MAX_ARTIFACT_SUFFIXES: usize = 8;
const MAX_ARTIFACT_SUFFIX_LENGTH: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessQuery {
    pub id: String,
    pub args: Vec<String>,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
    pub executables: Vec<ProcessExecutableCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProcessExecutableCandidate {
    Environment {
        variable: String,
        #[serde(rename = "relativePath")]
        relative_path: String,
    },
    WorkspaceProperty {
        path: String,
        key: String,
        #[serde(rename = "relativePath")]
        relative_path: String,
    },
    AndroidSdkBuildTools {
        name: String,
    },
    Path {
        name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolOperation {
    pub id: String,
    pub intent: String,
    pub args: Vec<ToolOperationArgument>,
    pub parameters: Vec<ToolOperationParameter>,
    pub timeout_ms: u64,
    pub max_output_bytes: usize,
    pub executables: Vec<ProcessExecutableCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum ToolOperationArgument {
    Literal { value: String },
    Parameter { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolOperationParameter {
    pub name: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffixes: Option<Vec<String>>,
}

pub(super) fn validate_process_queries(queries: &[ProcessQuery]) -> Result<(), AdmissionError> {
    if queries.len() > MAX_PROCESS_QUERIES {
        return Err(contract("too many plugin process queries"));
    }
    let mut ids = BTreeSet::new();
    for query in queries {
        validate_process_id(&query.id, "process query ID")?;
        if !ids.insert(query.id.as_str()) {
            return Err(contract("duplicate plugin process query ID"));
        }
        validate_process_limits(
            &query.args,
            query.timeout_ms,
            query.max_output_bytes,
            &query.executables,
        )?;
    }
    Ok(())
}

pub(super) fn validate_tool_operations(operations: &[ToolOperation]) -> Result<(), AdmissionError> {
    if operations.len() > MAX_TOOL_OPERATIONS {
        return Err(contract("too many plugin tool operations"));
    }
    let mut ids = BTreeSet::new();
    for operation in operations {
        validate_process_id(&operation.id, "tool operation ID")?;
        if !ids.insert(operation.id.as_str()) {
            return Err(contract("duplicate plugin tool operation ID"));
        }
        if !matches!(operation.intent.as_str(), "query" | "mutation")
            || operation.args.len() > MAX_PROCESS_ARGUMENTS
            || operation.parameters.len() > MAX_TOOL_PARAMETERS
            || operation.timeout_ms == 0
            || operation.timeout_ms > MAX_PROCESS_TIMEOUT_MS
            || operation.max_output_bytes == 0
            || operation.max_output_bytes > MAX_PROCESS_OUTPUT_BYTES
        {
            return Err(contract("invalid plugin tool operation"));
        }
        let mut parameters = BTreeSet::new();
        for parameter in &operation.parameters {
            validate_bounded_identifier(
                &parameter.name,
                MAX_PARAMETER_NAME_LENGTH,
                "tool operation parameter",
            )?;
            if !parameters.insert(parameter.name.as_str()) {
                return Err(contract("duplicate tool operation parameter"));
            }
            match (parameter.kind.as_str(), parameter.suffixes.as_deref()) {
                ("executionTargetId" | "androidApplicationId" | "androidComponent", None) => {}
                ("workspaceArtifact", Some(suffixes))
                    if !suffixes.is_empty()
                        && suffixes.len() <= MAX_ARTIFACT_SUFFIXES
                        && suffixes.iter().all(|suffix| valid_artifact_suffix(suffix)) => {}
                _ => return Err(contract("invalid tool operation parameter")),
            }
        }
        let mut referenced = BTreeSet::new();
        for argument in &operation.args {
            match argument {
                ToolOperationArgument::Literal { value } => validate_process_argument(value)?,
                ToolOperationArgument::Parameter { name } => {
                    if !parameters.contains(name.as_str()) {
                        return Err(contract("unknown tool operation parameter"));
                    }
                    referenced.insert(name.as_str());
                }
            }
        }
        if referenced != parameters {
            return Err(contract("unused tool operation parameter"));
        }
        validate_executables(&operation.executables)?;
    }
    Ok(())
}

fn validate_process_limits(
    args: &[String],
    timeout_ms: u64,
    max_output_bytes: usize,
    executables: &[ProcessExecutableCandidate],
) -> Result<(), AdmissionError> {
    if args.len() > MAX_PROCESS_ARGUMENTS
        || timeout_ms == 0
        || timeout_ms > 60_000
        || max_output_bytes == 0
        || max_output_bytes > MAX_PROCESS_OUTPUT_BYTES
    {
        return Err(contract("invalid plugin process query"));
    }
    for argument in args {
        validate_process_argument(argument)?;
    }
    validate_executables(executables)
}

fn validate_executables(candidates: &[ProcessExecutableCandidate]) -> Result<(), AdmissionError> {
    if candidates.is_empty() {
        return Err(contract("plugin process executable is missing"));
    }
    let mut unique = BTreeSet::new();
    for candidate in candidates {
        let key = match candidate {
            ProcessExecutableCandidate::Environment {
                variable,
                relative_path,
            } => {
                if variable.is_empty()
                    || variable.len() > 128
                    || !variable.bytes().enumerate().all(|(index, byte)| {
                        byte.is_ascii_alphabetic()
                            || byte == b'_'
                            || (index > 0 && byte.is_ascii_digit())
                    })
                    || !valid_relative_path(relative_path, 512)
                {
                    return Err(contract("invalid environment executable candidate"));
                }
                format!("environment:{variable}:{relative_path}")
            }
            ProcessExecutableCandidate::WorkspaceProperty {
                path,
                key,
                relative_path,
            } => {
                if !valid_relative_path(path, 256)
                    || validate_bounded_identifier(key, 128, "workspace property key").is_err()
                    || !valid_relative_path(relative_path, 512)
                {
                    return Err(contract("invalid workspace-property executable candidate"));
                }
                format!("workspaceProperty:{path}:{key}:{relative_path}")
            }
            ProcessExecutableCandidate::Path { name } => {
                if !valid_relative_path(name, 128) || name.contains('/') {
                    return Err(contract("invalid PATH executable candidate"));
                }
                format!("path:{name}")
            }
            ProcessExecutableCandidate::AndroidSdkBuildTools { name } => {
                if !valid_relative_path(name, 128) || name.contains('/') {
                    return Err(contract("invalid Android SDK Build Tools candidate"));
                }
                format!("androidSdkBuildTools:{name}")
            }
        };
        if !unique.insert(key) {
            return Err(contract("duplicate process executable candidate"));
        }
    }
    Ok(())
}

fn validate_process_id(value: &str, kind: &str) -> Result<(), AdmissionError> {
    validate_bounded_identifier(value, MAX_PROCESS_ID_LENGTH, kind)
}

fn validate_bounded_identifier(
    value: &str,
    maximum: usize,
    kind: &str,
) -> Result<(), AdmissionError> {
    if value.len() > maximum {
        return Err(contract(format!("invalid {kind}")));
    }
    validate_identifier(value, kind)
}

fn validate_process_argument(value: &str) -> Result<(), AdmissionError> {
    if value.len() > MAX_PROCESS_ARGUMENT_LENGTH || value.contains('\0') {
        return Err(contract("invalid plugin process argument"));
    }
    Ok(())
}

fn valid_relative_path(value: &str, maximum: usize) -> bool {
    if value.is_empty() || value.len() > maximum || value.contains('\0') || value.contains('\\') {
        return false;
    }
    let path = Path::new(value);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn valid_artifact_suffix(value: &str) -> bool {
    value.len() > 1
        && value.len() <= MAX_ARTIFACT_SUFFIX_LENGTH
        && value.starts_with('.')
        && value[1..]
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}
