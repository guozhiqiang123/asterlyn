use std::collections::{BTreeMap, HashSet};
use std::fs::Metadata;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::{SearchMode, SearchSkipReason};

pub const SEARCH_INDEX_SCHEMA_VERSION: u32 = 1;
const BLOOM_WORDS: usize = 64;
const BLOOM_BITS: u64 = (BLOOM_WORDS * u64::BITS as usize) as u64;
const HASH_SEEDS: [u64; 3] = [
    0x9e37_79b9_7f4a_7c15,
    0xbf58_476d_1ce4_e5b9,
    0x94d0_49bb_1331_11eb,
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchContentIndex {
    schema_version: u32,
    entries: BTreeMap<String, SearchContentIndexEntry>,
    #[serde(skip)]
    dirty: bool,
}

impl Default for SearchContentIndex {
    fn default() -> Self {
        Self::empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SearchContentIndexEntry {
    identity: SearchFileIdentity,
    bloom: Vec<u64>,
    skip_reason: Option<SearchSkipReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SearchFileIdentity {
    length: u64,
    modified_nanos: Option<u128>,
    read_only: bool,
    unix_device: Option<u64>,
    unix_inode: Option<u64>,
    unix_mode: Option<u32>,
    unix_change_seconds: Option<i64>,
    unix_change_nanos: Option<i64>,
    windows_creation_time: Option<u64>,
    windows_last_write_time: Option<u64>,
    windows_attributes: Option<u32>,
}

pub(crate) struct SearchIndexQuery {
    bloom: Vec<u64>,
}

impl SearchContentIndex {
    pub fn empty() -> Self {
        Self {
            schema_version: SEARCH_INDEX_SCHEMA_VERSION,
            entries: BTreeMap::new(),
            dirty: false,
        }
    }

    pub fn is_valid(&self, max_entries: usize) -> bool {
        self.schema_version == SEARCH_INDEX_SCHEMA_VERSION
            && self.entries.len() <= max_entries
            && self.entries.iter().all(|(path, entry)| {
                valid_workspace_path(path)
                    && if entry.skip_reason.is_some() {
                        entry.bloom.is_empty()
                    } else {
                        entry.bloom.len() == BLOOM_WORDS
                    }
            })
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn mark_clean(&mut self) {
        self.dirty = false;
    }

    pub fn retain_paths<'a>(&mut self, paths: impl Iterator<Item = &'a str>) {
        let retained = paths.collect::<HashSet<_>>();
        let previous = self.entries.len();
        self.entries
            .retain(|workspace_path, _| retained.contains(workspace_path.as_str()));
        self.dirty |= previous != self.entries.len();
    }

    pub(crate) fn can_prune(
        &self,
        workspace_path: &str,
        metadata: &Metadata,
        query: &SearchIndexQuery,
    ) -> bool {
        self.entries.get(workspace_path).is_some_and(|entry| {
            entry.identity == SearchFileIdentity::from_metadata(metadata)
                && entry.skip_reason.is_none()
                && !bloom_contains(&entry.bloom, &query.bloom)
        })
    }

    pub(crate) fn cached_skip(
        &self,
        workspace_path: &str,
        metadata: &Metadata,
    ) -> Option<SearchSkipReason> {
        self.entries.get(workspace_path).and_then(|entry| {
            (entry.identity == SearchFileIdentity::from_metadata(metadata))
                .then_some(entry.skip_reason)
                .flatten()
        })
    }

    pub(crate) fn update(
        &mut self,
        workspace_path: &str,
        metadata: &Metadata,
        normalized_content: &str,
    ) {
        self.schema_version = SEARCH_INDEX_SCHEMA_VERSION;
        let entry = SearchContentIndexEntry {
            identity: SearchFileIdentity::from_metadata(metadata),
            bloom: bloom_signature(normalized_content.as_bytes()),
            skip_reason: None,
        };
        if self.entries.get(workspace_path) != Some(&entry) {
            self.entries.insert(workspace_path.to_string(), entry);
            self.dirty = true;
        }
    }

    pub(crate) fn update_skip(
        &mut self,
        workspace_path: &str,
        metadata: &Metadata,
        reason: SearchSkipReason,
    ) {
        self.schema_version = SEARCH_INDEX_SCHEMA_VERSION;
        let entry = SearchContentIndexEntry {
            identity: SearchFileIdentity::from_metadata(metadata),
            bloom: Vec::new(),
            skip_reason: Some(reason),
        };
        if self.entries.get(workspace_path) != Some(&entry) {
            self.entries.insert(workspace_path.to_string(), entry);
            self.dirty = true;
        }
    }

    pub(crate) fn remove(&mut self, workspace_path: &str) {
        self.dirty |= self.entries.remove(workspace_path).is_some();
    }
}

pub(crate) fn index_query(effective_query: &str, mode: SearchMode) -> Option<SearchIndexQuery> {
    (mode == SearchMode::Literal && effective_query.is_ascii() && effective_query.len() >= 3).then(
        || SearchIndexQuery {
            bloom: bloom_signature(effective_query.as_bytes()),
        },
    )
}

impl SearchFileIdentity {
    fn from_metadata(metadata: &Metadata) -> Self {
        let modified_nanos = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos());
        let mut identity = Self {
            length: metadata.len(),
            modified_nanos,
            read_only: metadata.permissions().readonly(),
            unix_device: None,
            unix_inode: None,
            unix_mode: None,
            unix_change_seconds: None,
            unix_change_nanos: None,
            windows_creation_time: None,
            windows_last_write_time: None,
            windows_attributes: None,
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            identity.unix_device = Some(metadata.dev());
            identity.unix_inode = Some(metadata.ino());
            identity.unix_mode = Some(metadata.mode());
            identity.unix_change_seconds = Some(metadata.ctime());
            identity.unix_change_nanos = Some(metadata.ctime_nsec());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            identity.windows_creation_time = Some(metadata.creation_time());
            identity.windows_last_write_time = Some(metadata.last_write_time());
            identity.windows_attributes = Some(metadata.file_attributes());
        }
        identity
    }
}

fn bloom_signature(bytes: &[u8]) -> Vec<u64> {
    let mut bloom = vec![0; BLOOM_WORDS];
    for trigram in bytes.windows(3) {
        let lowered = [
            trigram[0].to_ascii_lowercase(),
            trigram[1].to_ascii_lowercase(),
            trigram[2].to_ascii_lowercase(),
        ];
        for seed in HASH_SEEDS {
            let bit = trigram_hash(lowered, seed) % BLOOM_BITS;
            bloom[bit as usize / u64::BITS as usize] |= 1 << (bit % u64::BITS as u64);
        }
    }
    bloom
}

fn bloom_contains(source: &[u64], required: &[u64]) -> bool {
    source
        .iter()
        .zip(required)
        .all(|(source, required)| source & required == *required)
}

fn trigram_hash(trigram: [u8; 3], seed: u64) -> u64 {
    let mut value = seed;
    for byte in trigram {
        value ^= u64::from(byte);
        value = value.wrapping_mul(0x100_0000_01b3);
    }
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn valid_workspace_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4_096
        && !path.starts_with(['/', '\\'])
        && !path.contains(['\\', '\0'])
        && path
            .split('/')
            .all(|component| !component.is_empty() && component != "." && component != "..")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn bloom_never_rejects_an_exact_ascii_literal() {
        let content = "class KotlinHelper {\n  val displayName = \"Searchable\"\n}\n";
        let source = bloom_signature(content.as_bytes());
        for query in [
            "class",
            "KotlinHelper",
            "displayName",
            "searchable",
            "\n  val",
        ] {
            let required = bloom_signature(query.as_bytes());
            assert!(bloom_contains(&source, &required), "query {query}");
        }
    }

    #[test]
    fn index_prunes_only_a_current_definite_miss() {
        let directory = tempfile::tempdir().expect("workspace");
        let path = directory.path().join("App.kt");
        fs::write(&path, "class App").expect("fixture");
        let metadata = fs::metadata(&path).expect("metadata");
        let mut index = SearchContentIndex::empty();
        index.update("App.kt", &metadata, "class App");

        let absent = index_query("missing", SearchMode::Literal).expect("query");
        let present = index_query("class", SearchMode::Literal).expect("query");
        assert!(index.can_prune("App.kt", &metadata, &absent));
        assert!(!index.can_prune("App.kt", &metadata, &present));

        fs::write(&path, "missing!").expect("change fixture");
        let changed = fs::metadata(&path).expect("changed metadata");
        assert!(!index.can_prune("App.kt", &changed, &absent));
    }

    #[test]
    fn short_non_ascii_and_regex_queries_fall_back() {
        assert!(index_query("ab", SearchMode::Literal).is_none());
        assert!(index_query("搜索词", SearchMode::Literal).is_none());
        assert!(index_query("literal", SearchMode::Regex).is_none());
    }

    #[test]
    fn invalid_persisted_shapes_are_rejected() {
        let mut index = SearchContentIndex::empty();
        index.entries.insert(
            "../escape.kt".to_string(),
            SearchContentIndexEntry {
                identity: SearchFileIdentity {
                    length: 0,
                    modified_nanos: None,
                    read_only: false,
                    unix_device: None,
                    unix_inode: None,
                    unix_mode: None,
                    unix_change_seconds: None,
                    unix_change_nanos: None,
                    windows_creation_time: None,
                    windows_last_write_time: None,
                    windows_attributes: None,
                },
                bloom: vec![0; BLOOM_WORDS],
                skip_reason: None,
            },
        );
        assert!(!index.is_valid(100));
    }

    #[test]
    fn a_saturated_signature_never_prunes_a_candidate() {
        let directory = tempfile::tempdir().expect("workspace");
        let path = directory.path().join("App.kt");
        fs::write(&path, "class App").expect("fixture");
        let metadata = fs::metadata(&path).expect("metadata");
        let mut index = SearchContentIndex::empty();
        index.entries.insert(
            "App.kt".to_string(),
            SearchContentIndexEntry {
                identity: SearchFileIdentity::from_metadata(&metadata),
                bloom: vec![u64::MAX; BLOOM_WORDS],
                skip_reason: None,
            },
        );

        let query = index_query("definitely absent", SearchMode::Literal).expect("query");
        assert!(!index.can_prune("App.kt", &metadata, &query));
    }
}
