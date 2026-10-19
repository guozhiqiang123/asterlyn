use asterlyn_plugin_package::ProcessExecutableCandidate;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_PROPERTIES_BYTES: u64 = 64 * 1024;
const MAX_REQUEST_ID_LENGTH: usize = 256;

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
    root: &Path,
    candidates: &[ProcessExecutableCandidate],
) -> Result<PathBuf, String> {
    for candidate in candidates {
        let paths = match candidate {
            ProcessExecutableCandidate::Environment {
                variable,
                relative_path,
            } => std::env::var_os(variable)
                .map(|base| vec![PathBuf::from(base).join(relative_path)])
                .unwrap_or_default(),
            ProcessExecutableCandidate::WorkspaceProperty {
                path,
                key,
                relative_path,
            } => workspace_property(root, path, key)
                .map(|base| vec![PathBuf::from(base).join(relative_path)])
                .unwrap_or_default(),
            ProcessExecutableCandidate::AndroidSdkBuildTools { name } => {
                android_sdk_build_tools_candidates(root, name)
            }
            ProcessExecutableCandidate::Path { name } => path_candidates(root, name),
        };
        if let Some(executable) = first_executable(paths) {
            return Ok(executable);
        }
    }
    Err("No admitted executable candidate is available for this workspace.".into())
}

fn path_candidates(root: &Path, name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|entry| entry.join(name)));
    }
    if name == executable_name("aapt") {
        candidates.extend(android_sdk_build_tools_candidates(root, name));
    }
    candidates
}

fn android_sdk_build_tools_candidates(root: &Path, name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for sdk in android_sdk_roots(root) {
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

fn first_executable(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    for candidate in candidates {
        let Ok(canonical) = std::fs::canonicalize(candidate) else {
            continue;
        };
        if canonical.is_file() && executable_file(&canonical) {
            return Some(canonical);
        }
    }
    None
}

fn android_sdk_roots(root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(sdk) = workspace_android_sdk(root) {
        candidates.push(sdk);
    }
    for variable in ["ANDROID_SDK_ROOT", "ANDROID_HOME"] {
        if let Some(value) = std::env::var_os(variable) {
            candidates.push(PathBuf::from(value));
        }
    }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        if cfg!(target_os = "macos") {
            candidates.push(home.join("Library/Android/sdk"));
        } else if cfg!(windows) {
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                candidates.push(PathBuf::from(local).join("Android/Sdk"));
            }
        } else {
            candidates.push(home.join("Android/Sdk"));
        }
    }
    candidates
}

fn workspace_property(root: &Path, relative_path: &str, property_key: &str) -> Option<String> {
    let file = std::fs::File::open(root.join(relative_path)).ok()?;
    if file.metadata().ok()?.len() > MAX_PROPERTIES_BYTES {
        return None;
    }
    let mut text = String::new();
    file.take(MAX_PROPERTIES_BYTES + 1)
        .read_to_string(&mut text)
        .ok()?;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
            continue;
        }
        let Some((key, value)) = line.split_once('=').or_else(|| line.split_once(':')) else {
            continue;
        };
        if key.trim() != property_key {
            continue;
        }
        let value = value.trim().replace("\\:", ":").replace("\\\\", "\\");
        if value.is_empty() || value.contains('\0') {
            return None;
        }
        return Some(value);
    }
    None
}

fn workspace_android_sdk(root: &Path) -> Option<PathBuf> {
    workspace_property(root, "local.properties", "sdk.dir").map(PathBuf::from)
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
