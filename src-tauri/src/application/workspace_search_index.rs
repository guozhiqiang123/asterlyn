use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use asterlyn_workspace::{SearchContentIndex, WorkspaceError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const STORED_INDEX_SCHEMA: u32 = 2;
const MAX_INDEX_BYTES: u64 = 128 * 1024 * 1024;
const MAX_INDEX_ENTRIES: usize = 100_000;
const MAX_RESIDENT_INDEXES: usize = 2;

#[derive(Clone, Default)]
pub(crate) struct WorkspaceSearchIndexRegistry {
    entries: Arc<Mutex<HashMap<PathBuf, Arc<Mutex<ResidentSearchIndex>>>>>,
}

struct ResidentSearchIndex {
    index: SearchContentIndex,
    failed_persistence_revision: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredWorkspaceSearchIndex {
    schema_version: u32,
    canonical_root: String,
    index: SearchContentIndex,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredWorkspaceSearchIndexRef<'a> {
    schema_version: u32,
    canonical_root: &'a str,
    index: &'a SearchContentIndex,
}

impl WorkspaceSearchIndexRegistry {
    pub(crate) fn with_index<T>(
        &self,
        cache_root: &Path,
        root: &Path,
        task: impl FnOnce(&mut SearchContentIndex) -> Result<T, WorkspaceError>,
    ) -> Result<T, WorkspaceError> {
        let cache_path = search_index_cache_path(cache_root, root);
        let handle = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| index_io("index registry lock was poisoned"))?;
            if let Some(existing) = entries.get(root) {
                existing.clone()
            } else {
                evict_idle_indexes(&mut entries, MAX_RESIDENT_INDEXES.saturating_sub(1), None);
                let loaded = ResidentSearchIndex {
                    index: load_workspace_search_index(&cache_path, root),
                    failed_persistence_revision: None,
                };
                let handle = Arc::new(Mutex::new(loaded));
                entries.insert(root.to_path_buf(), handle.clone());
                handle
            }
        };
        let mut resident = handle
            .lock()
            .map_err(|_| index_io("repository index lock was poisoned"))?;
        let result = task(&mut resident.index)?;
        let revision = resident.index.revision();
        if resident.index.is_dirty() && resident.failed_persistence_revision != Some(revision) {
            if save_workspace_search_index(&cache_path, root, &resident.index).is_ok() {
                resident.index.mark_clean();
                resident.failed_persistence_revision = None;
            } else {
                resident.failed_persistence_revision = Some(revision);
            }
        }
        drop(resident);
        drop(handle);
        if let Ok(mut entries) = self.entries.lock() {
            evict_idle_indexes(&mut entries, MAX_RESIDENT_INDEXES, Some(root));
        }
        Ok(result)
    }
}

fn evict_idle_indexes(
    entries: &mut HashMap<PathBuf, Arc<Mutex<ResidentSearchIndex>>>,
    maximum_len: usize,
    preserved_root: Option<&Path>,
) {
    while entries.len() > maximum_len {
        let Some(idle_root) = entries
            .iter()
            .find(|(root, index)| {
                preserved_root.is_none_or(|preserved| root.as_path() != preserved)
                    && Arc::strong_count(index) == 1
            })
            .map(|(root, _)| root.clone())
        else {
            break;
        };
        entries.remove(&idle_root);
    }
}

pub(crate) fn search_index_cache_path(cache_root: &Path, root: &Path) -> PathBuf {
    let digest = Sha256::digest(root.to_string_lossy().as_bytes());
    let name = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    cache_root.join(format!("{name}.json"))
}

pub(crate) fn load_workspace_search_index(path: &Path, root: &Path) -> SearchContentIndex {
    let Some(metadata) = fs::metadata(path)
        .ok()
        .filter(|value| value.len() <= MAX_INDEX_BYTES)
    else {
        return SearchContentIndex::empty();
    };
    if !metadata.is_file() {
        return SearchContentIndex::empty();
    }
    let Ok(file) = File::open(path) else {
        return SearchContentIndex::empty();
    };
    let Ok(stored) = serde_json::from_reader::<_, StoredWorkspaceSearchIndex>(BufReader::new(file))
    else {
        return SearchContentIndex::empty();
    };
    if stored.schema_version != STORED_INDEX_SCHEMA
        || stored.canonical_root != root.to_string_lossy()
        || !stored.index.is_valid(MAX_INDEX_ENTRIES)
    {
        return SearchContentIndex::empty();
    }
    stored.index
}

pub(crate) fn save_workspace_search_index(
    path: &Path,
    root: &Path,
    index: &SearchContentIndex,
) -> Result<(), WorkspaceError> {
    if !index.is_valid(MAX_INDEX_ENTRIES) {
        return Err(index_io(
            "workspace search index is outside its schema bounds",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| index_io("workspace search index has no parent directory"))?;
    fs::create_dir_all(parent).map_err(|error| index_io(error.to_string()))?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| index_io(error.to_string()))?;
    let canonical_root = root.to_string_lossy();
    {
        let mut writer = BufWriter::new(temporary.as_file_mut());
        serde_json::to_writer(
            &mut writer,
            &StoredWorkspaceSearchIndexRef {
                schema_version: STORED_INDEX_SCHEMA,
                canonical_root: canonical_root.as_ref(),
                index,
            },
        )
        .map_err(|error| index_io(error.to_string()))?;
        writer
            .flush()
            .map_err(|error| index_io(error.to_string()))?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| index_io(error.to_string()))?;
    if temporary
        .as_file()
        .metadata()
        .map_err(|error| index_io(error.to_string()))?
        .len()
        > MAX_INDEX_BYTES
    {
        return Err(index_io("workspace search index exceeds its disk budget"));
    }
    temporary
        .persist(path)
        .map_err(|error| index_io(error.error.to_string()))?;
    Ok(())
}

fn index_io(message: impl Into<String>) -> WorkspaceError {
    WorkspaceError::Io {
        operation: "persist workspace search index".to_string(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_round_trip_is_root_scoped_and_corruption_is_recoverable() {
        let directory = tempfile::tempdir().expect("cache");
        let root = directory.path().join("workspace");
        fs::create_dir(&root).expect("workspace");
        let path = search_index_cache_path(directory.path(), &root);
        let index = SearchContentIndex::empty();
        save_workspace_search_index(&path, &root, &index).expect("save");
        assert_eq!(load_workspace_search_index(&path, &root), index);

        let other_root = directory.path().join("other");
        assert_eq!(
            load_workspace_search_index(&path, &other_root),
            SearchContentIndex::empty()
        );
        fs::write(&path, "not-json").expect("corrupt");
        assert_eq!(
            load_workspace_search_index(&path, &root),
            SearchContentIndex::empty()
        );
    }

    #[test]
    fn oversized_and_unknown_schema_caches_are_recoverable_misses() {
        let directory = tempfile::tempdir().expect("cache");
        let root = directory.path().join("workspace");
        fs::create_dir(&root).expect("workspace");
        let path = search_index_cache_path(directory.path(), &root);

        let oversized = File::create(&path).expect("oversized cache");
        oversized
            .set_len(MAX_INDEX_BYTES + 1)
            .expect("sparse cache length");
        assert_eq!(
            load_workspace_search_index(&path, &root),
            SearchContentIndex::empty()
        );

        fs::write(
            &path,
            format!(
                r#"{{"schemaVersion":{},"canonicalRoot":{:?},"index":{{"schemaVersion":1,"entries":{{}}}}}}"#,
                STORED_INDEX_SCHEMA + 1,
                root.to_string_lossy()
            ),
        )
        .expect("unknown schema cache");
        assert_eq!(
            load_workspace_search_index(&path, &root),
            SearchContentIndex::empty()
        );
    }

    #[test]
    fn registry_retains_only_a_bounded_idle_working_set() {
        let directory = tempfile::tempdir().expect("cache");
        let registry = WorkspaceSearchIndexRegistry::default();
        for index in 0..(MAX_RESIDENT_INDEXES + 2) {
            let root = directory.path().join(format!("workspace-{index}"));
            fs::create_dir(&root).expect("workspace");
            registry
                .with_index(directory.path(), &root, |_| Ok(()))
                .expect("index access");
        }

        assert_eq!(
            registry.entries.lock().expect("registry").len(),
            MAX_RESIDENT_INDEXES
        );
    }
}
