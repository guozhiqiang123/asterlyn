use std::collections::BTreeMap;

use super::{SearchCancellationToken, SearchCandidate, WorkspaceError, check_cancelled};

pub(super) struct CandidateSelection {
    pub(super) indices: Vec<usize>,
    pub(super) eligible_candidates: usize,
}

pub(super) fn select_candidate_indices(
    candidates: &[SearchCandidate],
    limit: usize,
    cancellation: &SearchCancellationToken,
    matches: impl Fn(&str) -> bool,
) -> Result<CandidateSelection, WorkspaceError> {
    let mut by_extension = BTreeMap::<String, Vec<usize>>::new();
    for (index, candidate) in candidates.iter().enumerate() {
        check_cancelled(cancellation)?;
        if matches(&candidate.workspace_path) {
            by_extension
                .entry(extension_bucket(&candidate.workspace_path))
                .or_default()
                .push(index);
        }
    }
    let eligible_candidates = by_extension.values().map(Vec::len).sum();
    if eligible_candidates <= limit {
        let mut indices = by_extension.into_values().flatten().collect::<Vec<_>>();
        indices.sort_unstable();
        return Ok(CandidateSelection {
            indices,
            eligible_candidates,
        });
    }

    let mut buckets = by_extension.into_iter().collect::<Vec<_>>();
    buckets.sort_by(|left, right| {
        left.1
            .len()
            .cmp(&right.1.len())
            .then_with(|| left.0.cmp(&right.0))
    });
    let mut indices = Vec::with_capacity(limit);
    for (_, bucket) in buckets {
        let remaining = limit.saturating_sub(indices.len());
        if remaining == 0 {
            break;
        }
        if bucket.len() <= remaining {
            indices.extend(bucket);
        } else {
            indices.extend(evenly_sample(&bucket, remaining));
        }
    }
    Ok(CandidateSelection {
        indices,
        eligible_candidates,
    })
}

fn extension_bucket(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.')
        .filter(|(stem, extension)| !stem.is_empty() && !extension.is_empty())
        .map_or_else(
            || "<none>".to_string(),
            |(_, extension)| extension.to_ascii_lowercase(),
        )
}

fn evenly_sample(values: &[usize], count: usize) -> Vec<usize> {
    if count == 0 {
        return Vec::new();
    }
    if count == 1 {
        return vec![values[values.len() / 2]];
    }
    (0..count)
        .map(|slot| values[slot * (values.len() - 1) / (count - 1)])
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rare_kotlin_files_are_not_starved_by_an_earlier_dominant_extension() {
        let mut candidates = (0..20)
            .map(|index| SearchCandidate {
                workspace_path: format!("early/{index:02}.dart"),
            })
            .collect::<Vec<_>>();
        candidates.push(SearchCandidate {
            workspace_path: "late/src/main/kotlin/App.kt".to_string(),
        });

        let selection =
            select_candidate_indices(&candidates, 2, &SearchCancellationToken::new(), |_| true)
                .expect("candidate selection");

        assert_eq!(selection.eligible_candidates, 21);
        assert!(selection.indices.contains(&20));
    }

    #[test]
    fn filtering_happens_before_the_candidate_limit() {
        let candidates = (0..20)
            .map(|index| SearchCandidate {
                workspace_path: if index == 19 {
                    "late/App.kt".to_string()
                } else {
                    format!("early/{index:02}.dart")
                },
            })
            .collect::<Vec<_>>();
        let selection =
            select_candidate_indices(&candidates, 1, &SearchCancellationToken::new(), |path| {
                path.ends_with(".kt")
            })
            .expect("filtered candidate selection");

        assert_eq!(selection.eligible_candidates, 1);
        assert_eq!(selection.indices, [19]);
    }
}
