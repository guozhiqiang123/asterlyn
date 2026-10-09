use std::collections::BTreeMap;
use std::ffi::OsString;

use super::{parse_error, run_checked, validate_oid, validate_operation_path};
use crate::{GitConflictFile, GitError, GitRepository};

pub(super) fn stage_commits(
    repository: &GitRepository,
    conflict: &GitConflictFile,
) -> Result<(Option<String>, Option<String>), GitError> {
    let operation = repository.operation_snapshot()?;
    let current = operation
        .as_ref()
        .and_then(|snapshot| snapshot.current_head_oid.clone())
        .or(repository.resolve_optional_commit("HEAD")?);
    let original = operation
        .as_ref()
        .and_then(|snapshot| snapshot.original_head_oid.clone());
    let targets = operation
        .as_ref()
        .map(|snapshot| snapshot.target_oids.clone())
        .unwrap_or_default();
    let mut marker_commits = Vec::new();
    for reference in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REBASE_HEAD",
        "REVERT_HEAD",
        "refs/stash",
        "refs/stash^1",
        "refs/stash^2",
        "refs/stash^3",
    ] {
        if let Some(oid) = repository.resolve_optional_commit(reference)? {
            push_unique(&mut marker_commits, oid);
        }
    }

    let mut ours_candidates = Vec::new();
    extend_unique(&mut ours_candidates, current.clone());
    extend_unique(&mut ours_candidates, original.clone());
    extend_all_unique(&mut ours_candidates, &targets);
    extend_all_unique(&mut ours_candidates, &marker_commits);

    let mut theirs_candidates = Vec::new();
    extend_all_unique(&mut theirs_candidates, &marker_commits);
    extend_all_unique(&mut theirs_candidates, &targets);
    extend_unique(&mut theirs_candidates, original);
    extend_unique(&mut theirs_candidates, current);

    Ok((
        match_stage_commit(
            repository,
            &conflict.path,
            conflict.ours_oid.as_deref(),
            &ours_candidates,
        )?,
        match_stage_commit(
            repository,
            &conflict.path,
            conflict.theirs_oid.as_deref(),
            &theirs_candidates,
        )?,
    ))
}

fn match_stage_commit(
    repository: &GitRepository,
    path: &str,
    stage_oid: Option<&str>,
    candidates: &[String],
) -> Result<Option<String>, GitError> {
    let Some(stage_oid) = stage_oid else {
        return Ok(None);
    };
    validate_oid(stage_oid)?;
    let mut matched = None;
    for candidate in candidates {
        if commit_path_blob_oid(repository, candidate, path)?.as_deref() == Some(stage_oid) {
            if matched.is_some() {
                return Ok(None);
            }
            matched = Some(candidate.clone());
        }
    }
    Ok(matched)
}

fn commit_path_blob_oid(
    repository: &GitRepository,
    commit_oid: &str,
    path: &str,
) -> Result<Option<String>, GitError> {
    validate_oid(commit_oid)?;
    validate_operation_path(path)?;
    let output = run_checked(
        repository.root(),
        "match conflict stage provenance",
        &[
            OsString::from("--literal-pathspecs"),
            OsString::from("ls-tree"),
            OsString::from("-z"),
            OsString::from(commit_oid),
            OsString::from("--"),
            OsString::from(path),
        ],
        None,
    )?;
    let mut records = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|row| !row.is_empty());
    let Some(record) = records.next() else {
        return Ok(None);
    };
    if records.next().is_some() {
        return Err(parse_error(
            "conflict provenance resolved multiple tree entries",
        ));
    }
    let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
        return Err(parse_error(
            "conflict provenance tree entry has no path separator",
        ));
    };
    let header = String::from_utf8_lossy(&record[..tab]);
    let mut fields = header.split_ascii_whitespace();
    let (mode, kind, oid) = (fields.next(), fields.next(), fields.next());
    if !matches!(mode, Some("100644" | "100755")) || kind != Some("blob") || fields.next().is_some()
    {
        return Ok(None);
    }
    let Some(oid) = oid else {
        return Ok(None);
    };
    validate_oid(oid)?;
    Ok(Some(oid.to_string()))
}

pub(super) fn parse_conflicts(bytes: &[u8]) -> Result<Vec<GitConflictFile>, GitError> {
    let mut conflicts: BTreeMap<String, GitConflictFile> = BTreeMap::new();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
            return Err(parse_error("conflict index record has no path separator"));
        };
        let header = String::from_utf8_lossy(&record[..tab]);
        let path = String::from_utf8_lossy(&record[tab + 1..]).into_owned();
        let mut fields = header.split_ascii_whitespace();
        let (_mode, oid, stage) = (
            fields.next(),
            fields.next().unwrap_or_default(),
            fields.next().unwrap_or_default(),
        );
        validate_oid(oid)?;
        let conflict = conflicts.entry(path.clone()).or_insert(GitConflictFile {
            path,
            base_oid: None,
            ours_oid: None,
            theirs_oid: None,
        });
        match stage {
            "1" => conflict.base_oid = Some(oid.to_string()),
            "2" => conflict.ours_oid = Some(oid.to_string()),
            "3" => conflict.theirs_oid = Some(oid.to_string()),
            _ => return Err(parse_error("conflict index contains an unknown stage")),
        }
    }
    Ok(conflicts.into_values().collect())
}

fn extend_unique(values: &mut Vec<String>, value: Option<String>) {
    if let Some(value) = value {
        push_unique(values, value);
    }
}

fn extend_all_unique(values: &mut Vec<String>, additions: &[String]) {
    for value in additions {
        push_unique(values, value.clone());
    }
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.contains(&value) {
        values.push(value);
    }
}
