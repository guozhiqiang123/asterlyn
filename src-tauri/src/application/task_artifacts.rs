use asterlyn_task::encode_output;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub(crate) const MAX_HINTS: usize = 8;
pub(crate) const MAX_HINT_BYTES: usize = 4096;
const MAX_DEPTH: usize = 8;
const MAX_DIRECTORIES: usize = 512;
const MAX_ARTIFACTS: usize = 64;
const MAX_FILE_BYTES: u64 = 1 << 30;
const MAX_TOTAL_BYTES: u64 = 2 << 30;
const MAX_SIDECAR_NAMES: usize = 4;
const MAX_SIDECARS: usize = 64;
const MAX_SIDECAR_BYTES: u64 = 64 * 1024;
const MAX_SIDECAR_TOTAL_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskArtifact {
    pub(crate) workspace_path: String,
    pub(crate) kind: String,
    pub(crate) byte_length: u64,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskArtifactSidecar {
    pub(crate) workspace_path: String,
    pub(crate) byte_length: u64,
    pub(crate) data_base64: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskArtifactDiscovery {
    pub(crate) protocol_version: u32,
    pub(crate) workspace_root: String,
    pub(crate) artifacts: Vec<TaskArtifact>,
    pub(crate) sidecars: Vec<TaskArtifactSidecar>,
    pub(crate) truncated: bool,
}

pub(crate) fn scan_task_artifacts(
    root: &Path,
    hints: &[String],
    sidecar_names: &[String],
) -> Result<TaskArtifactDiscovery, String> {
    if hints.len() > MAX_HINTS {
        return Err(format!("at most {MAX_HINTS} artifact hints are allowed"));
    }
    let sidecar_names = validate_sidecar_names(sidecar_names)?;
    let mut artifacts = BTreeMap::new();
    let mut sidecars = BTreeMap::new();
    let mut state = DiscoveryState::default();
    for hint in hints {
        let relative = validate_hint(hint)?;
        let Some(directory) = resolve_hint(root, &relative) else {
            continue;
        };
        walk_directory(
            root,
            &directory,
            0,
            &mut state,
            &mut artifacts,
            &sidecar_names,
            &mut sidecars,
        )?;
        if state.truncated {
            break;
        }
    }
    Ok(TaskArtifactDiscovery {
        protocol_version: 2,
        workspace_root: root.to_string_lossy().into_owned(),
        artifacts: artifacts.into_values().collect(),
        sidecars: sidecars.into_values().collect(),
        truncated: state.truncated,
    })
}

#[derive(Default)]
struct DiscoveryState {
    directories: usize,
    total_bytes: u64,
    sidecar_total_bytes: u64,
    truncated: bool,
}

fn validate_sidecar_names(values: &[String]) -> Result<Vec<String>, String> {
    if values.len() > MAX_SIDECAR_NAMES {
        return Err(format!(
            "at most {MAX_SIDECAR_NAMES} artifact sidecar names are allowed"
        ));
    }
    let mut values = values.to_vec();
    values.sort();
    values.dedup();
    if values.iter().any(|value| {
        value.is_empty()
            || value.len() > 64
            || !value.bytes().enumerate().all(|(index, byte)| {
                byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
            })
    }) {
        return Err("artifact sidecar names must be simple bounded filenames".into());
    }
    Ok(values)
}

fn validate_hint(hint: &str) -> Result<PathBuf, String> {
    if hint.is_empty() || hint.len() > MAX_HINT_BYTES || hint.contains('\0') {
        return Err("artifact hint must be non-empty, NUL-free, and at most 4096 bytes".into());
    }
    let bytes = hint.as_bytes();
    if hint.starts_with('/')
        || hint.starts_with('\\')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
    {
        return Err("artifact hint must be workspace-relative".into());
    }
    if hint.split(['/', '\\']).any(|part| part.is_empty()) {
        return Err("artifact hint contains an empty path component".into());
    }
    let path = Path::new(hint);
    if path.components().any(|component| {
        matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::CurDir | Component::ParentDir
        )
    }) {
        return Err("artifact hint must be workspace-relative and cannot contain . or ..".into());
    }
    let components: Vec<_> = hint.split(['/', '\\']).collect();
    if components.len() < 3
        || components[components.len() - 3] != "build"
        || components[components.len() - 2] != "outputs"
        || !matches!(components[components.len() - 1], "apk" | "bundle")
    {
        return Err("artifact hint must end in build/outputs/apk or build/outputs/bundle".into());
    }
    Ok(components.iter().collect())
}

fn resolve_hint(root: &Path, relative: &Path) -> Option<PathBuf> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return None;
        };
        current.push(name);
        let metadata = fs::symlink_metadata(&current).ok()?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return None;
        }
    }
    Some(current)
}

fn walk_directory(
    root: &Path,
    directory: &Path,
    depth: usize,
    state: &mut DiscoveryState,
    artifacts: &mut BTreeMap<String, TaskArtifact>,
    sidecar_names: &[String],
    sidecars: &mut BTreeMap<String, TaskArtifactSidecar>,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        state.truncated = true;
        return Ok(());
    }
    state.directories += 1;
    if state.directories > MAX_DIRECTORIES {
        state.truncated = true;
        return Ok(());
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("read artifact directory {}: {error}", directory.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read artifact entry: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("stat artifact entry {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if depth == MAX_DEPTH {
                state.truncated = true;
            } else {
                walk_directory(
                    root,
                    &path,
                    depth + 1,
                    state,
                    artifacts,
                    sidecar_names,
                    sidecars,
                )?;
            }
        } else if metadata.is_file() {
            if path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| sidecar_names.iter().any(|name| name == value))
            {
                add_sidecar(root, &path, metadata.len(), state, sidecars)?;
            } else {
                add_file(root, &path, metadata.len(), state, artifacts);
            }
        }
        if state.truncated {
            break;
        }
    }
    Ok(())
}

fn add_sidecar(
    root: &Path,
    path: &Path,
    byte_length: u64,
    state: &mut DiscoveryState,
    sidecars: &mut BTreeMap<String, TaskArtifactSidecar>,
) -> Result<(), String> {
    if byte_length > MAX_SIDECAR_BYTES {
        state.truncated = true;
        return Ok(());
    }
    let Some(workspace_path) = normalized_workspace_path(root, path) else {
        return Ok(());
    };
    if sidecars.contains_key(&workspace_path) {
        return Ok(());
    }
    if sidecars.len() >= MAX_SIDECARS
        || state.sidecar_total_bytes.saturating_add(byte_length) > MAX_SIDECAR_TOTAL_BYTES
    {
        state.truncated = true;
        return Ok(());
    }
    let bytes = fs::read(path)
        .map_err(|error| format!("read artifact sidecar {}: {error}", path.display()))?;
    if bytes.len() as u64 != byte_length {
        return Err(format!(
            "artifact sidecar changed while reading: {}",
            path.display()
        ));
    }
    state.sidecar_total_bytes = state.sidecar_total_bytes.saturating_add(byte_length);
    sidecars.insert(
        workspace_path.clone(),
        TaskArtifactSidecar {
            workspace_path,
            byte_length,
            data_base64: encode_output(&bytes),
        },
    );
    Ok(())
}

fn normalized_workspace_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    Some(
        relative
            .components()
            .filter_map(|component| match component {
                Component::Normal(value) => Some(value.to_string_lossy()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("/"),
    )
}

fn add_file(
    root: &Path,
    path: &Path,
    byte_length: u64,
    state: &mut DiscoveryState,
    artifacts: &mut BTreeMap<String, TaskArtifact>,
) {
    if byte_length > MAX_FILE_BYTES {
        return;
    }
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return;
    };
    let kind = match extension.to_ascii_lowercase().as_str() {
        "apk" => "apk",
        "aab" => "aab",
        _ => return,
    };
    let Some(workspace_path) = normalized_workspace_path(root, path) else {
        return;
    };
    if artifacts.contains_key(&workspace_path) {
        return;
    }
    if artifacts.len() >= MAX_ARTIFACTS
        || state.total_bytes.saturating_add(byte_length) > MAX_TOTAL_BYTES
    {
        state.truncated = true;
        return;
    }
    state.total_bytes = state.total_bytes.saturating_add(byte_length);
    artifacts.insert(
        workspace_path.clone(),
        TaskArtifact {
            workspace_path,
            kind: kind.into(),
            byte_length,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    fn file(root: &Path, path: &str, bytes: usize) {
        let path = root.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![0_u8; bytes]).unwrap();
    }

    #[test]
    fn discovers_sorted_and_deduplicates() {
        let dir = tempdir().unwrap();
        file(dir.path(), "app/build/outputs/apk/release/z.apk", 3);
        file(dir.path(), "app/build/outputs/apk/debug/a.aab", 5);
        let hints = vec![
            "app/build/outputs/apk".into(),
            "app/build/outputs/apk".into(),
        ];
        let result = scan_task_artifacts(dir.path(), &hints, &[]).unwrap();
        assert_eq!(
            result
                .artifacts
                .iter()
                .map(|item| item.workspace_path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "app/build/outputs/apk/debug/a.aab",
                "app/build/outputs/apk/release/z.apk"
            ]
        );
    }

    #[test]
    fn rejects_unsafe_hints() {
        let dir = tempdir().unwrap();
        for hint in [
            "/tmp/build/outputs/apk",
            "../build/outputs/apk",
            "app//build/outputs/apk",
            "app/src",
        ] {
            assert!(scan_task_artifacts(dir.path(), &[hint.into()], &[]).is_err());
        }
        assert!(
            scan_task_artifacts(dir.path(), &vec!["a/build/outputs/apk".into(); 9], &[]).is_err()
        );
    }

    #[test]
    #[cfg(unix)]
    fn skips_symlinks_and_non_artifacts() {
        let dir = tempdir().unwrap();
        file(dir.path(), "app/build/outputs/apk/release/app.apk", 1);
        file(dir.path(), "outside.apk", 1);
        symlink(
            dir.path().join("app/build/outputs/apk/release"),
            dir.path().join("app/build/outputs/apk/link"),
        )
        .unwrap();
        file(dir.path(), "app/build/outputs/apk/release/readme.txt", 1);
        let result =
            scan_task_artifacts(dir.path(), &["app/build/outputs/apk".into()], &[]).unwrap();
        assert_eq!(result.artifacts.len(), 1);
    }

    #[test]
    fn marks_artifact_limit() {
        let dir = tempdir().unwrap();
        for index in 0..65 {
            file(
                dir.path(),
                &format!("app/build/outputs/apk/{index:03}.apk"),
                1,
            );
        }
        let result =
            scan_task_artifacts(dir.path(), &["app/build/outputs/apk".into()], &[]).unwrap();
        assert!(result.truncated);
        assert_eq!(result.artifacts.len(), 64);
    }

    #[test]
    fn transports_requested_bounded_sidecars_without_interpreting_them() {
        let dir = tempdir().unwrap();
        file(dir.path(), "app/build/outputs/apk/debug/app.apk", 1);
        let metadata = br#"{"variantName":"debug","elements":[]}"#;
        let path = dir
            .path()
            .join("app/build/outputs/apk/debug/output-metadata.json");
        fs::write(&path, metadata).unwrap();
        file(dir.path(), "app/build/outputs/apk/debug/ignored.json", 4);
        let result = scan_task_artifacts(
            dir.path(),
            &["app/build/outputs/apk".into()],
            &["output-metadata.json".into()],
        )
        .unwrap();
        assert_eq!(result.protocol_version, 2);
        assert_eq!(result.sidecars.len(), 1);
        assert_eq!(
            result.sidecars[0].workspace_path,
            "app/build/outputs/apk/debug/output-metadata.json"
        );
        assert_eq!(result.sidecars[0].data_base64, encode_output(metadata));
    }
}
