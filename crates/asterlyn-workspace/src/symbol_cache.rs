use super::*;
use crate::{Workspace, search_index::SearchFileIdentity};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::{Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
pub struct SymbolQuery<'a> {
    pub workspace: &'a Workspace,
    pub paths: &'a [String],
    pub rules: &'a SymbolRuleSet,
    pub scopes: &'a [SymbolScope],
    pub overlays: &'a [SymbolOverlay],
    pub query: &'a str,
    pub cancel: &'a AtomicBool,
}
const MAX_CACHE_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILES: usize = 5000;
const MAX_FACTS: usize = 50_000;
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    identity: SearchFileIdentity,
    revision: String,
    profile: String,
    facts: Vec<SymbolFact>,
    partial: bool,
    used: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolCache {
    schema: u32,
    identity: String,
    entries: BTreeMap<String, Entry>,
    clock: u64,
}
#[derive(Clone, Debug)]
pub struct SymbolScope {
    pub profile: String,
    pub roots: Option<Vec<String>>,
}
pub fn source_revision(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn valid_path(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 4096
        && !s.chars().any(char::is_control)
        && s.split('/').all(|v| !v.is_empty() && v != "." && v != "..")
        && !Path::new(s).is_absolute()
}
fn contained(roots: &[String], path: &str) -> bool {
    roots.iter().any(|root| {
        path == root
            || path
                .strip_prefix(root)
                .is_some_and(|tail| tail.starts_with('/'))
    })
}
fn valid_fact(f: &SymbolFact) -> bool {
    !f.name.is_empty()
        && f.name.len() <= 128
        && !f.name.chars().any(char::is_control)
        && f.range.start.line == f.range.end.line
        && f.range.end.character > f.range.start.character
}
/// Cache files contain derived facts only. A source read still validates every positive result.
impl SymbolCache {
    pub fn empty(identity: String) -> Self {
        Self {
            schema: 1,
            identity,
            entries: BTreeMap::new(),
            clock: 0,
        }
    }
    pub fn identity(workspace: &Workspace, rules: &[u8], provider: &str) -> Result<String, String> {
        let mut hash = Sha256::new();
        hash.update(ENGINE_VERSION);
        hash.update(provider);
        hash.update(rules);
        hash.update(workspace.root().to_string_lossy().as_bytes());
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let m = fs::metadata(workspace.root()).map_err(|_| "symbol-root-unavailable")?;
            hash.update(m.dev().to_le_bytes());
            hash.update(m.ino().to_le_bytes());
        }
        Ok(format!("{:x}", hash.finalize()))
    }
    pub fn load(path: &Path, identity: String) -> Self {
        let loaded = (|| {
            let meta = fs::symlink_metadata(path).ok()?;
            if !meta.is_file() || meta.len() > MAX_CACHE_BYTES as u64 {
                return None;
            }
            let mut file = fs::File::open(path).ok()?;
            let mut bytes = Vec::new();
            Read::by_ref(&mut file)
                .take(MAX_CACHE_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .ok()?;
            if bytes.len() > MAX_CACHE_BYTES {
                return None;
            }
            let value: Self = serde_json::from_slice(&bytes).ok()?;
            if value.schema != 1
                || value.identity != identity
                || value.entries.len() > MAX_FILES
                || value.clock == u64::MAX
                || value.entries.values().map(|e| e.facts.len()).sum::<usize>() > MAX_FACTS
                || value.entries.iter().any(|(p, e)| {
                    !valid_path(p)
                        || e.revision.len() > 256
                        || e.profile.len() > 128
                        || e.facts.len() > MAX_SYMBOLS_PER_FILE
                        || !e.facts.iter().all(valid_fact)
                })
            {
                return None;
            }
            Some(value)
        })();
        loaded.unwrap_or_else(|| Self::empty(identity))
    }
    pub fn save(&mut self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("symbol-cache-path")?;
        if fs::symlink_metadata(parent).is_err() {
            fs::create_dir_all(parent).map_err(|_| "symbol-cache-create")?;
        }
        if fs::symlink_metadata(parent)
            .map_err(|_| "symbol-cache-directory")?
            .file_type()
            .is_symlink()
        {
            return Err("symbol-cache-symlink".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|_| "symbol-cache-permissions")?;
        }
        loop {
            let bytes = serde_json::to_vec(self).map_err(|_| "symbol-cache-encode")?;
            if bytes.len() <= MAX_CACHE_BYTES {
                let mut temp = tempfile::NamedTempFile::new_in(parent)
                    .map_err(|_| "symbol-cache-temporary")?;
                temp.write_all(&bytes).map_err(|_| "symbol-cache-write")?;
                temp.persist(path).map_err(|_| "symbol-cache-persist")?;
                return Ok(());
            }
            if !self.evict() {
                return Err("symbol-cache-capacity".into());
            }
        }
    }
    fn evict(&mut self) -> bool {
        let oldest = self
            .entries
            .iter()
            .min_by_key(|(_, e)| e.used)
            .map(|(p, _)| p.clone());
        if let Some(path) = oldest {
            self.entries.remove(&path);
            true
        } else {
            false
        }
    }
    pub fn query(&mut self, input: SymbolQuery<'_>) -> Result<SymbolQueryReport, String> {
        let SymbolQuery {
            workspace,
            paths,
            rules,
            scopes,
            overlays,
            query,
            cancel,
        } = input;
        rules.validate()?;
        if query.len() > 128
            || overlays.len() > 128
            || overlays
                .iter()
                .filter_map(|o| o.text.as_ref())
                .map(String::len)
                .sum::<usize>()
                > 8 * 1024 * 1024
            || overlays.iter().any(|v| {
                !valid_path(&v.workspace_path)
                    || v.text.as_ref().is_some_and(|s| s.len() > MAX_SOURCE_BYTES)
            })
        {
            return Err("symbol-query-limit".into());
        }
        let mut unique = HashSet::new();
        if overlays.iter().any(|v| !unique.insert(&v.workspace_path)) {
            return Err("symbol-duplicate-overlay".into());
        }
        let overlays: BTreeMap<_, _> = overlays
            .iter()
            .map(|v| (v.workspace_path.as_str(), v.text.as_deref()))
            .collect();
        let needle = query.to_lowercase();
        let started = Instant::now();
        let mut report = SymbolQueryReport {
            identity: self.identity.clone(),
            matches: vec![],
            files_scanned: 0,
            files_total: 0,
            reused_files: 0,
            skipped_files: 0,
            partial: false,
            reasons: vec![],
            scope_token: None,
        };
        let mut allowed = HashSet::new();
        for path in paths {
            if !valid_path(path) || !allowed.insert(path) {
                continue;
            }
            let Some(profile) = rules
                .profiles
                .iter()
                .find(|p| p.extensions.iter().any(|ext| path.ends_with(ext)))
            else {
                continue;
            };
            let scope = scopes.iter().find(|s| s.profile == profile.id);
            let admitted =
                scope.is_some_and(|s| s.roots.as_ref().is_none_or(|roots| contained(roots, path)));
            if !admitted {
                continue;
            }
            report.files_total += 1;
        }
        for path in paths {
            if cancel.load(Ordering::Relaxed) {
                return Err("symbol-query-cancelled".into());
            }
            if report.files_scanned >= MAX_FILES || started.elapsed() > Duration::from_secs(2) {
                report.partial = true;
                report.reasons.push("budget".into());
                break;
            }
            let Some(profile) = rules
                .profiles
                .iter()
                .find(|p| p.extensions.iter().any(|ext| path.ends_with(ext)))
            else {
                continue;
            };
            let Some(scope) = scopes.iter().find(|s| s.profile == profile.id) else {
                continue;
            };
            if scope
                .roots
                .as_ref()
                .is_some_and(|roots| !contained(roots, path))
            {
                continue;
            }
            if !valid_path(path) {
                continue;
            }
            report.files_scanned += 1;
            let overlay = overlays.get(path.as_str());
            let (facts, revision, text, partial) = if let Some(content) = overlay {
                let Some(text) = content else {
                    report.skipped_files += 1;
                    continue;
                };
                let (facts, partial) = extract_symbols(text, profile);
                (
                    facts,
                    source_revision(text),
                    Some((*text).to_owned()),
                    partial,
                )
            } else {
                let Ok((_, meta)) = workspace.resolve_regular_file(path) else {
                    self.entries.remove(path);
                    report.skipped_files += 1;
                    continue;
                };
                if meta.len() > MAX_SOURCE_BYTES as u64 {
                    self.entries.remove(path);
                    report.skipped_files += 1;
                    continue;
                }
                let identity = SearchFileIdentity::from_metadata(&meta);
                self.clock = self.clock.saturating_add(1);
                let cached = self.entries.get_mut(path).filter(|e| {
                    identity.may_reuse_symbols()
                        && e.identity == identity
                        && e.profile == profile.id
                });
                if let Some(entry) = cached {
                    entry.used = self.clock;
                    report.reused_files += 1;
                    (
                        entry.facts.clone(),
                        entry.revision.clone(),
                        None,
                        entry.partial,
                    )
                } else {
                    let Ok(snapshot) = workspace.read_symbol_source(path) else {
                        report.skipped_files += 1;
                        continue;
                    };
                    let Ok((_, after)) = workspace.resolve_regular_file(path) else {
                        report.skipped_files += 1;
                        continue;
                    };
                    if SearchFileIdentity::from_metadata(&after) != identity {
                        report.skipped_files += 1;
                        continue;
                    }
                    let (facts, partial) = extract_symbols(&snapshot.content, profile);
                    self.entries.insert(
                        path.clone(),
                        Entry {
                            identity,
                            revision: snapshot.revision.clone(),
                            profile: profile.id.clone(),
                            facts: facts.clone(),
                            partial,
                            used: self.clock,
                        },
                    );
                    (facts, snapshot.revision, Some(snapshot.content), partial)
                }
            };
            report.partial |= partial;
            let positives: Vec<_> = facts
                .into_iter()
                .filter(|f| needle.is_empty() || f.name.to_lowercase().contains(&needle))
                .collect();
            if positives.is_empty() {
                continue;
            }
            // Cached positives always re-read and compare revision before exposing a location.
            let text = if let Some(text) = text {
                text
            } else {
                let Ok(snapshot) = workspace.read_symbol_source(path) else {
                    report.skipped_files += 1;
                    continue;
                };
                if snapshot.revision != revision {
                    self.entries.remove(path);
                    report.partial = true;
                    report.reasons.push("source-changed".into());
                    continue;
                }
                snapshot.content
            };
            for f in positives {
                if !fact_matches(&text, &f) {
                    self.entries.remove(path);
                    report.partial = true;
                    continue;
                }
                if report.matches.len() == 512 {
                    report.partial = true;
                    break;
                }
                report.matches.push(SymbolCandidate {
                    name: f.name,
                    kind: f.kind,
                    range: f.range,
                    workspace_path: path.clone(),
                    revision: revision.clone(),
                    overlay: overlay.is_some(),
                    extractor_id: profile.id.clone(),
                });
            }
        }
        self.entries.retain(|path, _| allowed.contains(path));
        while self.entries.len() > MAX_FILES
            || self.entries.values().map(|e| e.facts.len()).sum::<usize>() > MAX_FACTS
        {
            if !self.evict() {
                break;
            }
        }
        report.partial |= report.skipped_files > 0;
        report.matches.sort_by(|a, b| {
            (
                !a.name.to_lowercase().starts_with(&needle),
                &a.name,
                &a.workspace_path,
                a.range.start.line,
            )
                .cmp(&(
                    !b.name.to_lowercase().starts_with(&needle),
                    &b.name,
                    &b.workspace_path,
                    b.range.start.line,
                ))
        });
        report.reasons.sort();
        report.reasons.dedup();
        Ok(report)
    }
}
pub fn fact_matches(text: &str, f: &SymbolFact) -> bool {
    let Some(line) = text.lines().nth(f.range.start.line as usize) else {
        return false;
    };
    let units: Vec<_> = line.encode_utf16().collect();
    let start = f.range.start.character as usize;
    let end = f.range.end.character as usize;
    units
        .get(start..end)
        .is_some_and(|s| s == f.name.encode_utf16().collect::<Vec<_>>())
}

impl Workspace {
    pub fn read_symbol_source(&self, path: &str) -> Result<crate::TextFileSnapshot, String> {
        let (resolved, meta) = self
            .resolve_regular_file(path)
            .map_err(|_| "symbol-source-unavailable")?;
        if meta.len() > MAX_SOURCE_BYTES as u64 {
            return Err("symbol-source-limit".into());
        }
        let mut file = fs::File::open(&resolved).map_err(|_| "symbol-source-unavailable")?;
        let opened = file.metadata().map_err(|_| "symbol-source-unavailable")?;
        if !crate::file_identity::opened_file_matches_path(&resolved, &meta, &file, &opened)
            .unwrap_or(false)
        {
            return Err("symbol-source-changed".into());
        }
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(MAX_SOURCE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "symbol-source-unavailable")?;
        let (after_path, after) = self
            .resolve_regular_file(path)
            .map_err(|_| "symbol-source-changed")?;
        if after_path != resolved
            || SearchFileIdentity::from_metadata(&meta) != SearchFileIdentity::from_metadata(&after)
            || !crate::file_identity::opened_file_matches_path(
                &resolved,
                &after,
                &file,
                &file.metadata().map_err(|_| "symbol-source-unavailable")?,
            )
            .unwrap_or(false)
        {
            return Err("symbol-source-changed".into());
        }
        crate::decode_snapshot(path, bytes, &after, MAX_SOURCE_BYTES)
            .map_err(|_| "symbol-source-invalid".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_capacity_evicts_oldest_and_unknown_identity_rebuilds() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.ts");
        fs::write(&source, "class X{}").unwrap();
        let identity = SearchFileIdentity::from_metadata(&fs::metadata(source).unwrap());
        let mut cache = SymbolCache::empty("known".into());
        for n in 0..80 {
            cache.entries.insert(
                format!("{n}.ts"),
                Entry {
                    identity: identity.clone(),
                    revision: "a".repeat(64),
                    profile: "profile".into(),
                    facts: (0..512)
                        .map(|i| SymbolFact {
                            name: format!("{}{}", "x".repeat(115), i),
                            kind: SymbolKind::Class,
                            range: SymbolRange {
                                start: SymbolPosition {
                                    line: i,
                                    character: 0,
                                },
                                end: SymbolPosition {
                                    line: i,
                                    character: 1,
                                },
                            },
                        })
                        .collect(),
                    partial: false,
                    used: n,
                },
            );
        }
        let path = directory.path().join("derived/facts.json");
        cache.save(&path).unwrap();
        assert!(fs::metadata(&path).unwrap().len() <= MAX_CACHE_BYTES as u64);
        assert!(cache.entries.len() < 80);
        assert!(!cache.entries.contains_key("0.ts"));
        assert!(cache.entries.contains_key("79.ts"));
        assert!(
            SymbolCache::load(&path, "changed".into())
                .entries
                .is_empty()
        );
    }
}
