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

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskArtifact {
    pub(crate) workspace_path: String,
    pub(crate) kind: String,
    pub(crate) byte_length: u64,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskArtifactDiscovery {
    pub(crate) protocol_version: u32,
    pub(crate) workspace_root: String,
    pub(crate) artifacts: Vec<TaskArtifact>,
    pub(crate) truncated: bool,
}

pub(crate) fn scan_task_artifacts(
    root: &Path,
    hints: &[String],
) -> Result<TaskArtifactDiscovery, String> {
    if hints.len() > MAX_HINTS {
        return Err(format!("at most {MAX_HINTS} artifact hints are allowed"));
    }
    let mut artifacts = BTreeMap::new();
    let mut state = DiscoveryState::default();
    for hint in hints {
        let relative = validate_hint(hint)?;
        let Some(directory) = resolve_hint(root, &relative) else {
            continue;
        };
        walk_directory(root, &directory, 0, &mut state, &mut artifacts)?;
        if state.truncated {
            break;
        }
    }
    Ok(TaskArtifactDiscovery {
        protocol_version: 1,
        workspace_root: root.to_string_lossy().into_owned(),
        artifacts: artifacts.into_values().collect(),
        truncated: state.truncated,
    })
}

#[derive(Default)]
struct DiscoveryState {
    directories: usize,
    total_bytes: u64,
    truncated: bool,
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
                walk_directory(root, &path, depth + 1, state, artifacts)?;
            }
        } else if metadata.is_file() {
            add_file(root, &path, metadata.len(), state, artifacts);
        }
        if state.truncated {
            break;
        }
    }
    Ok(())
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
    let Ok(relative) = path.strip_prefix(root) else {
        return;
    };
    let workspace_path = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
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
        let result = scan_task_artifacts(dir.path(), &hints).unwrap();
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
            assert!(scan_task_artifacts(dir.path(), &[hint.into()]).is_err());
        }
        assert!(scan_task_artifacts(dir.path(), &vec!["a/build/outputs/apk".into(); 9]).is_err());
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
        let result = scan_task_artifacts(dir.path(), &["app/build/outputs/apk".into()]).unwrap();
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
        let result = scan_task_artifacts(dir.path(), &["app/build/outputs/apk".into()]).unwrap();
        assert!(result.truncated);
        assert_eq!(result.artifacts.len(), 64);
    }
}
