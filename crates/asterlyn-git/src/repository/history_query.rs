use std::collections::HashSet;
use std::ffi::OsString;

use super::*;

pub(super) struct HistoryQueryRoot {
    pub(super) repository_id: String,
    pub(super) repository: GitRepository,
    pub(super) selectors: Vec<String>,
    pub(super) paths: Vec<String>,
}

impl GitRepository {
    pub fn query_commit_history_count(&self, query: &HistoryQuery) -> Result<usize, GitError> {
        validate_history_query(query)?;
        let mut total = 0usize;
        for root in self.history_query_roots(query)? {
            if root.selectors.is_empty() {
                continue;
            }
            let count = root.repository.run_commit_history_count(
                "count filtered commit history",
                root.selectors.iter().map(OsString::from).collect(),
                query,
                &root.paths,
            )?;
            total = total.checked_add(count).ok_or_else(|| GitError::Parse {
                context: "count filtered commit history".to_string(),
                message: "the combined history count exceeds the supported range".to_string(),
            })?;
        }
        Ok(total)
    }

    pub(super) fn history_query_roots(
        &self,
        query: &HistoryQuery,
    ) -> Result<Vec<HistoryQueryRoot>, GitError> {
        let roots = self.discovered_roots()?;
        validate_query_roots(query, &roots)?;
        let selected_roots: HashSet<&str> =
            query.repository_ids.iter().map(String::as_str).collect();
        let eligible_roots = roots.into_iter().filter(|root| {
            let repository_id = root.descriptor.id.as_str();
            (selected_roots.is_empty() || selected_roots.contains(repository_id))
                && query
                    .start_commit
                    .as_ref()
                    .is_none_or(|start| start.repository_id == repository_id)
                && (query.refs.is_empty()
                    || query
                        .refs
                        .iter()
                        .any(|reference| reference.repository_id == repository_id))
                && (query.paths.is_empty()
                    || query
                        .paths
                        .iter()
                        .any(|path| path.repository_id == repository_id))
        });
        let mut result = Vec::new();
        for root in eligible_roots {
            let repository_id = root.descriptor.id;
            let refs: Vec<&HistoryRef> = query
                .refs
                .iter()
                .filter(|reference| reference.repository_id == repository_id)
                .collect();
            let paths = query
                .paths
                .iter()
                .filter(|path| path.repository_id == repository_id)
                .map(|path| path.path.clone())
                .collect();
            let selectors = if let Some(start) = &query.start_commit {
                root.repository.first_parent(&start.oid)?;
                vec![start.oid.clone()]
            } else if query.refs.is_empty() {
                root.repository.history_tip_oids()?
            } else {
                let mut oids = Vec::with_capacity(refs.len());
                for selected in refs {
                    let reference = validate_history_ref(&selected.full_name)?;
                    if !root.repository.ref_is_valid(reference)? {
                        return Err(GitError::InvalidInput {
                            field: "history refs".to_string(),
                            message: "select only existing refs from their owning repository"
                                .to_string(),
                        });
                    }
                    oids.push(root.repository.resolve_history_ref(reference)?);
                }
                oids.sort_unstable();
                oids.dedup();
                oids
            };
            result.push(HistoryQueryRoot {
                repository_id,
                repository: root.repository,
                selectors,
                paths,
            });
        }
        Ok(result)
    }

    fn run_commit_history_count(
        &self,
        operation: &str,
        selectors: Vec<OsString>,
        query: &HistoryQuery,
        paths: &[String],
    ) -> Result<usize, GitError> {
        let mut arguments = vec![
            OsString::from("--literal-pathspecs"),
            OsString::from("rev-list"),
            OsString::from("--count"),
        ];
        self.append_history_query_filters(&mut arguments, query)?;
        arguments.extend(selectors);
        arguments.push(OsString::from("--"));
        arguments.extend(paths.iter().map(OsString::from));
        let output = self.run_read_owned(operation, arguments)?;
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<usize>()
            .map_err(|error| GitError::Parse {
                context: operation.to_string(),
                message: error.to_string(),
            })
    }

    pub(super) fn append_history_query_filters(
        &self,
        arguments: &mut Vec<OsString>,
        query: &HistoryQuery,
    ) -> Result<(), GitError> {
        if query.first_parent {
            arguments.push(OsString::from("--first-parent"));
        }
        if query.exclude_merges {
            arguments.push(OsString::from("--no-merges"));
        }
        if let Some(since_epoch) = query.since_epoch {
            arguments.push(OsString::from(format!("--since=@{since_epoch}")));
        }
        let mut author_emails = query.author_emails.clone();
        if query.current_author {
            author_emails.push(self.current_author_email()?);
        }
        author_emails.sort_unstable();
        author_emails.dedup();
        for email in author_emails {
            arguments.push(OsString::from(format!(
                "--author=<{}>",
                escape_git_regexp(&email)
            )));
        }
        Ok(())
    }
}
