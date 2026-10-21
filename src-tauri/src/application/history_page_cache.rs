use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex};

use asterlyn_git::{GitError, HistoryPage, HistoryQuery};

const INITIAL_WINDOW: usize = 600;
const MAX_WINDOW: usize = 100_000;
const MAX_CACHED_QUERIES: usize = 8;

#[derive(Clone, Default)]
pub(crate) struct HistoryPageCacheRegistry {
    entries: Arc<Mutex<VecDeque<CachedHistoryWindow>>>,
}

struct CachedHistoryWindow {
    key: HistoryCacheKey,
    page: HistoryPage,
}

#[derive(Clone, PartialEq, Eq)]
struct HistoryCacheKey {
    owner: String,
    root: String,
    query: String,
}

impl HistoryPageCacheRegistry {
    pub(crate) fn read_page(
        &self,
        owner: &str,
        root: &Path,
        query: &HistoryQuery,
        offset: usize,
        limit: usize,
        load: impl FnOnce(usize) -> Result<HistoryPage, GitError>,
    ) -> Result<HistoryPage, GitError> {
        validate_window(offset, limit)?;
        let key = HistoryCacheKey {
            owner: owner.to_string(),
            root: root.to_string_lossy().into_owned(),
            query: serde_json::to_string(query).map_err(|error| GitError::Parse {
                context: "cache commit history query".into(),
                message: error.to_string(),
            })?,
        };
        let needed = offset.saturating_add(limit).min(MAX_WINDOW);
        let existing = if offset == 0 {
            self.remove(&key);
            None
        } else {
            self.cached_page(&key, offset, limit)
        };
        if let Some(page) = existing {
            return Ok(page);
        }
        let previous_len = self.cached_len(&key);
        let target = needed
            .max(INITIAL_WINDOW)
            .max(previous_len.saturating_mul(2))
            .min(MAX_WINDOW);
        let loaded = load(target)?;
        let result = slice_page(&loaded, offset, limit);
        self.store(key, loaded);
        Ok(result)
    }

    fn cached_page(
        &self,
        key: &HistoryCacheKey,
        offset: usize,
        limit: usize,
    ) -> Option<HistoryPage> {
        let entries = self.entries.lock().ok()?;
        let cached = entries.iter().find(|entry| &entry.key == key)?;
        let complete = !cached.page.has_more;
        let enough = cached.page.commits.len() >= offset.saturating_add(limit);
        (complete || enough).then(|| slice_page(&cached.page, offset, limit))
    }

    fn cached_len(&self, key: &HistoryCacheKey) -> usize {
        self.entries
            .lock()
            .ok()
            .and_then(|entries| {
                entries
                    .iter()
                    .find(|entry| &entry.key == key)
                    .map(|entry| entry.page.commits.len())
            })
            .unwrap_or(0)
    }

    fn remove(&self, key: &HistoryCacheKey) {
        if let Ok(mut entries) = self.entries.lock()
            && let Some(index) = entries.iter().position(|entry| &entry.key == key)
        {
            entries.remove(index);
        }
    }

    fn store(&self, key: HistoryCacheKey, page: HistoryPage) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        if let Some(index) = entries.iter().position(|entry| entry.key == key) {
            entries.remove(index);
        }
        entries.push_back(CachedHistoryWindow { key, page });
        while entries.len() > MAX_CACHED_QUERIES {
            entries.pop_front();
        }
    }
}

fn validate_window(offset: usize, limit: usize) -> Result<(), GitError> {
    if offset > MAX_WINDOW {
        return Err(GitError::InvalidInput {
            field: "history offset".into(),
            message: format!("must not exceed {MAX_WINDOW}"),
        });
    }
    if limit == 0 || limit > MAX_WINDOW {
        return Err(GitError::InvalidInput {
            field: "history page size".into(),
            message: format!("must be between 1 and {MAX_WINDOW}"),
        });
    }
    Ok(())
}

fn slice_page(page: &HistoryPage, offset: usize, limit: usize) -> HistoryPage {
    let commits = page
        .commits
        .iter()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    HistoryPage {
        has_more: page.has_more || offset.saturating_add(commits.len()) < page.commits.len(),
        commits,
        offset,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use asterlyn_git::CommitSummary;

    #[test]
    fn deep_pages_expand_geometrically_and_refresh_replaces_the_window() {
        let registry = HistoryPageCacheRegistry::default();
        let query = HistoryQuery::default();
        let root = Path::new("/repo");
        let mut loads = Vec::new();
        for offset in (0..1_500).step_by(150) {
            let page = registry
                .read_page("main", root, &query, offset, 150, |target| {
                    loads.push(target);
                    Ok(fixture_page(target, true))
                })
                .expect("history page");
            assert_eq!(page.offset, offset);
            assert_eq!(page.commits.len(), 150);
            assert_eq!(page.commits[0].subject, format!("commit-{offset}"));
        }
        assert_eq!(loads, [600, 1_200, 2_400]);

        let refreshed = registry
            .read_page("main", root, &query, 0, 150, |target| {
                loads.push(target);
                Ok(fixture_page(target, false))
            })
            .expect("refreshed history");
        assert_eq!(refreshed.commits.len(), 150);
        assert_eq!(loads, [600, 1_200, 2_400, 600]);
    }

    fn fixture_page(count: usize, has_more: bool) -> HistoryPage {
        HistoryPage {
            commits: (0..count)
                .map(|index| CommitSummary {
                    repository_id: ".".into(),
                    oid: format!("{index:040x}"),
                    short_oid: format!("{index:07x}"),
                    parents: Vec::new(),
                    author_name: "Author".into(),
                    author_email: "author@example.com".into(),
                    authored_at: index as i64,
                    decorations: Vec::new(),
                    subject: format!("commit-{index}"),
                    outgoing: false,
                })
                .collect(),
            offset: 0,
            has_more,
        }
    }
}
