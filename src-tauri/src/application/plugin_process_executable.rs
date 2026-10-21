use asterlyn_plugin_package::ProcessExecutableCandidate;
use std::path::{Path, PathBuf};

const MAX_REQUEST_ID_LENGTH: usize = 256;

#[derive(Debug)]
pub(super) struct ApprovedExecutableRoots {
    android_sdk: Vec<PathBuf>,
}

impl Default for ApprovedExecutableRoots {
    fn default() -> Self {
        Self::from_host_environment()
    }
}

impl ApprovedExecutableRoots {
    pub(super) fn from_host_environment() -> Self {
        let mut android_sdk = Vec::new();
        for variable in ["ANDROID_SDK_ROOT", "ANDROID_HOME"] {
            let Some(value) = std::env::var_os(variable) else {
                continue;
            };
            let Ok(root) = std::fs::canonicalize(value) else {
                continue;
            };
            if root.is_dir() && !android_sdk.contains(&root) {
                android_sdk.push(root);
            }
        }
        Self { android_sdk }
    }

    #[cfg(test)]
    pub(super) fn for_android_sdk(root: &Path) -> Self {
        Self {
            android_sdk: vec![std::fs::canonicalize(root).unwrap()],
        }
    }
}

#[derive(Debug, Clone)]
pub(super) enum ToolOperationParameterKind {
    ExecutionTargetId,
    AndroidApplicationId,
    AndroidComponent,
    WorkspaceArtifact(Vec<String>),
}

pub(super) fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

pub(super) fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_LENGTH
        && value.bytes().all(|value| {
            value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'-' | b':')
        })
}

pub(super) fn validate_tool_parameter(
    root: &Path,
    kind: &ToolOperationParameterKind,
    value: &str,
) -> Result<String, String> {
    if value.is_empty() || value.len() > 4_096 || value.contains('\0') {
        return Err("invalid tool-operation parameter value".into());
    }
    match kind {
        ToolOperationParameterKind::ExecutionTargetId => {
            if value.len() <= 512
                && value.bytes().all(|value| {
                    value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b'-' | b':')
                })
            {
                Ok(value.to_string())
            } else {
                Err("invalid Android execution target".into())
            }
        }
        ToolOperationParameterKind::AndroidComponent => {
            let Some((package, activity)) = value.split_once('/') else {
                return Err("invalid Android launch component".into());
            };
            let activity = activity.strip_prefix('.').unwrap_or(activity);
            if valid_android_name(package) && valid_android_name(activity) {
                Ok(value.to_string())
            } else {
                Err("invalid Android launch component".into())
            }
        }
        ToolOperationParameterKind::AndroidApplicationId => {
            if valid_android_name(value) {
                Ok(value.to_string())
            } else {
                Err("invalid Android application ID".into())
            }
        }
        ToolOperationParameterKind::WorkspaceArtifact(suffixes) => {
            let relative = Path::new(value);
            if relative.is_absolute() {
                return Err("workspace artifact must use a relative path".into());
            }
            let canonical_root = std::fs::canonicalize(root)
                .map_err(|error| format!("resolve active workspace: {error}"))?;
            let canonical = std::fs::canonicalize(canonical_root.join(relative))
                .map_err(|error| format!("resolve workspace artifact: {error}"))?;
            if !canonical.starts_with(&canonical_root)
                || !canonical.is_file()
                || !canonical
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| suffixes.iter().any(|suffix| name.ends_with(suffix)))
            {
                return Err("workspace artifact does not match an admitted suffix".into());
            }
            Ok(canonical.to_string_lossy().into_owned())
        }
    }
}

fn valid_android_name(value: &str) -> bool {
    value.len() <= 512
        && value.split('.').all(|part| {
            !part.is_empty()
                && part.bytes().enumerate().all(|(index, value)| {
                    value.is_ascii_alphabetic()
                        || value == b'_'
                        || (index > 0 && (value.is_ascii_digit() || value == b'$'))
                })
        })
}

pub(super) fn resolve_executable(
    approved: &ApprovedExecutableRoots,
    candidates: &[ProcessExecutableCandidate],
) -> Result<PathBuf, String> {
    for candidate in candidates {
        let paths = match candidate {
            ProcessExecutableCandidate::Environment {
                variable,
                relative_path,
            } if matches!(variable.as_str(), "ANDROID_SDK_ROOT" | "ANDROID_HOME") => approved
                .android_sdk
                .iter()
                .map(|base| base.join(relative_path))
                .collect(),
            ProcessExecutableCandidate::AndroidSdkBuildTools { name } => {
                android_sdk_build_tools_candidates(approved, name)
            }
            ProcessExecutableCandidate::Environment { .. }
            | ProcessExecutableCandidate::WorkspaceProperty { .. }
            | ProcessExecutableCandidate::Path { .. } => Vec::new(),
        };
        if let Some(executable) = first_executable(approved, paths) {
            return Ok(executable);
        }
    }
    Err("No admitted executable candidate is available for this workspace.".into())
}

fn android_sdk_build_tools_candidates(
    approved: &ApprovedExecutableRoots,
    name: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for sdk in &approved.android_sdk {
        let Ok(entries) = std::fs::read_dir(sdk.join("build-tools")) else {
            continue;
        };
        let mut versions = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>();
        versions.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
        candidates.extend(versions.into_iter().map(|version| version.join(name)));
    }
    candidates
}

fn first_executable(
    approved: &ApprovedExecutableRoots,
    candidates: Vec<PathBuf>,
) -> Option<PathBuf> {
    for candidate in candidates {
        let Ok(canonical) = std::fs::canonicalize(candidate) else {
            continue;
        };
        if approved
            .android_sdk
            .iter()
            .any(|root| canonical.starts_with(root))
            && canonical.is_file()
            && executable_file(&canonical)
        {
            return Some(canonical);
        }
    }
    None
}

#[cfg(unix)]
fn executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn executable_file(_path: &Path) -> bool {
    true
}
