use crate::error::GitError;
use crate::model::{BranchKind, BranchState, BranchSummary, ChangeKind, CommitSummary, FileChange};

pub(crate) fn parse_status(input: &[u8]) -> Result<(BranchState, Vec<FileChange>), GitError> {
    let records: Vec<&[u8]> = input.split(|byte| *byte == 0).collect();
    let mut branch = BranchState::default();
    let mut changes = Vec::new();
    let mut index = 0;

    while index < records.len() {
        let record = records[index];
        if record.is_empty() {
            index += 1;
            continue;
        }

        let text = String::from_utf8_lossy(record);
        if let Some(value) = text.strip_prefix("# branch.oid ") {
            if value == "(initial)" {
                branch.unborn = true;
            } else {
                branch.oid = Some(value.to_string());
            }
        } else if let Some(value) = text.strip_prefix("# branch.head ") {
            if value == "(detached)" {
                branch.detached = true;
            } else {
                branch.head = Some(value.to_string());
            }
        } else if let Some(value) = text.strip_prefix("# branch.upstream ") {
            branch.upstream = Some(value.to_string());
        } else if let Some(value) = text.strip_prefix("# branch.ab ") {
            for token in value.split_ascii_whitespace() {
                if let Some(ahead) = token.strip_prefix('+') {
                    branch.ahead = ahead.parse().unwrap_or(0);
                } else if let Some(behind) = token.strip_prefix('-') {
                    branch.behind = behind.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = text.strip_prefix("1 ") {
            changes.push(parse_ordinary(rest)?);
        } else if let Some(rest) = text.strip_prefix("2 ") {
            let mut change = parse_rename(rest)?;
            index += 1;
            let original = records.get(index).ok_or_else(|| GitError::Parse {
                context: "porcelain v2 rename record".to_string(),
                message: "missing original path".to_string(),
            })?;
            change.original_path = Some(String::from_utf8_lossy(original).into_owned());
            changes.push(change);
        } else if let Some(rest) = text.strip_prefix("u ") {
            changes.push(parse_unmerged(rest)?);
        } else if let Some(path) = text.strip_prefix("? ") {
            changes.push(FileChange {
                path: path.to_string(),
                original_path: None,
                index_status: ChangeKind::Unmodified,
                worktree_status: ChangeKind::Untracked,
                conflicted: false,
                submodule: false,
            });
        } else if let Some(path) = text.strip_prefix("! ") {
            changes.push(FileChange {
                path: path.to_string(),
                original_path: None,
                index_status: ChangeKind::Ignored,
                worktree_status: ChangeKind::Ignored,
                conflicted: false,
                submodule: false,
            });
        }

        index += 1;
    }

    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok((branch, changes))
}

fn parse_ordinary(rest: &str) -> Result<FileChange, GitError> {
    let fields: Vec<&str> = rest.splitn(8, ' ').collect();
    if fields.len() != 8 {
        return Err(status_record_error("ordinary", fields.len()));
    }

    let (index_status, worktree_status) = parse_xy(fields[0]);
    Ok(FileChange {
        path: fields[7].to_string(),
        original_path: None,
        index_status,
        worktree_status,
        conflicted: false,
        submodule: fields[1] != "N...",
    })
}

fn parse_rename(rest: &str) -> Result<FileChange, GitError> {
    let fields: Vec<&str> = rest.splitn(9, ' ').collect();
    if fields.len() != 9 {
        return Err(status_record_error("rename/copy", fields.len()));
    }

    let (index_status, worktree_status) = parse_xy(fields[0]);
    Ok(FileChange {
        path: fields[8].to_string(),
        original_path: None,
        index_status,
        worktree_status,
        conflicted: false,
        submodule: fields[1] != "N...",
    })
}

fn parse_unmerged(rest: &str) -> Result<FileChange, GitError> {
    let fields: Vec<&str> = rest.splitn(10, ' ').collect();
    if fields.len() != 10 {
        return Err(status_record_error("unmerged", fields.len()));
    }
    Ok(FileChange {
        path: fields[9].to_string(),
        original_path: None,
        index_status: ChangeKind::Unmerged,
        worktree_status: ChangeKind::Unmerged,
        conflicted: true,
        submodule: fields[1] != "N...",
    })
}

fn status_record_error(kind: &str, actual: usize) -> GitError {
    GitError::Parse {
        context: format!("porcelain v2 {kind} record"),
        message: format!("expected the stable field layout, received {actual} fields"),
    }
}

fn parse_xy(value: &str) -> (ChangeKind, ChangeKind) {
    let mut chars = value.chars();
    (
        chars
            .next()
            .map(parse_change)
            .unwrap_or(ChangeKind::Unknown),
        chars
            .next()
            .map(parse_change)
            .unwrap_or(ChangeKind::Unknown),
    )
}

fn parse_change(value: char) -> ChangeKind {
    match value {
        '.' | ' ' => ChangeKind::Unmodified,
        'A' => ChangeKind::Added,
        'M' => ChangeKind::Modified,
        'D' => ChangeKind::Deleted,
        'R' => ChangeKind::Renamed,
        'C' => ChangeKind::Copied,
        'T' => ChangeKind::TypeChanged,
        'U' => ChangeKind::Unmerged,
        '?' => ChangeKind::Untracked,
        '!' => ChangeKind::Ignored,
        _ => ChangeKind::Unknown,
    }
}

pub(crate) fn parse_commits(input: &[u8]) -> Result<Vec<CommitSummary>, GitError> {
    let text = String::from_utf8_lossy(input);
    let mut commits = Vec::new();

    for raw_record in text.split('\u{1e}') {
        let record = raw_record.trim_matches(['\n', '\r']);
        if record.is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.split('\u{1f}').collect();
        if fields.len() != 8 {
            return Err(GitError::Parse {
                context: "git log record".to_string(),
                message: format!("expected 8 fields, received {}", fields.len()),
            });
        }

        commits.push(CommitSummary {
            repository_id: ".".to_string(),
            oid: fields[0].to_string(),
            short_oid: fields[1].to_string(),
            parents: fields[2]
                .split_ascii_whitespace()
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect(),
            author_name: fields[3].to_string(),
            author_email: fields[4].to_string(),
            authored_at: fields[5].parse().unwrap_or(0),
            decorations: fields[6]
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect(),
            subject: fields[7].to_string(),
        });
    }

    Ok(commits)
}

pub(crate) fn parse_branches(input: &[u8]) -> Result<Vec<BranchSummary>, GitError> {
    let text = String::from_utf8_lossy(input);
    let mut branches = Vec::new();

    for line in text.lines().filter(|line| !line.is_empty()) {
        let fields: Vec<&str> = line.split('\0').collect();
        if fields.len() != 8 {
            return Err(GitError::Parse {
                context: "for-each-ref record".to_string(),
                message: format!("expected 8 fields, received {}", fields.len()),
            });
        }
        let kind = if fields[0].starts_with("refs/heads/") {
            BranchKind::Local
        } else if fields[0].starts_with("refs/remotes/") {
            BranchKind::Remote
        } else {
            BranchKind::Tag
        };

        branches.push(BranchSummary {
            repository_id: ".".to_string(),
            full_name: fields[0].to_string(),
            name: fields[1].to_string(),
            oid: fields[2].to_string(),
            current: fields[3] == "*",
            kind,
            upstream: non_empty(fields[4]),
            tracking: non_empty(fields[5]),
            committed_at: fields[6].parse().unwrap_or(0),
            subject: fields[7].to_string(),
        });
    }

    branches.sort_by(|left, right| {
        right
            .current
            .cmp(&left.current)
            .then(left.kind_rank().cmp(&right.kind_rank()))
            .then(left.name.cmp(&right.name))
    });
    Ok(branches)
}

fn non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

trait BranchKindRank {
    fn kind_rank(&self) -> u8;
}

impl BranchKindRank for BranchSummary {
    fn kind_rank(&self) -> u8 {
        match self.kind {
            BranchKind::Local => 0,
            BranchKind::Remote => 1,
            BranchKind::Tag => 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_headers_and_status_kinds() {
        let input = b"# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 aaaaaaa aaaaaaa docs/read me.md\0\
1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb src/main.rs\0\
? notes/new.txt\0";

        let (branch, changes) = parse_status(input).expect("status should parse");
        assert_eq!(branch.head.as_deref(), Some("main"));
        assert_eq!(branch.upstream.as_deref(), Some("origin/main"));
        assert_eq!(branch.ahead, 2);
        assert_eq!(branch.behind, 1);
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].path, "docs/read me.md");
        assert_eq!(changes[0].worktree_status, ChangeKind::Modified);
        assert_eq!(changes[1].path, "notes/new.txt");
        assert_eq!(changes[1].worktree_status, ChangeKind::Untracked);
    }

    #[test]
    fn parses_rename_and_original_path() {
        let input = b"2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new name.rs\0src/old name.rs\0";
        let (_, changes) = parse_status(input).expect("rename should parse");
        assert_eq!(changes[0].path, "src/new name.rs");
        assert_eq!(changes[0].original_path.as_deref(), Some("src/old name.rs"));
        assert_eq!(changes[0].index_status, ChangeKind::Renamed);
    }

    #[test]
    fn parses_unmerged_and_detached_states() {
        let input = b"# branch.oid abc123\0# branch.head (detached)\0\
u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc src/conflict.rs\0";
        let (branch, changes) = parse_status(input).expect("unmerged should parse");
        assert!(branch.detached);
        assert!(changes[0].conflicted);
        assert_eq!(changes[0].index_status, ChangeKind::Unmerged);
    }

    #[test]
    fn parses_commit_records() {
        let input = b"012345\x1f012345\x1faaaa bbbb\x1fAda\x1fada@example.com\x1f42\x1fHEAD -> main, tag: v1\x1fInitial work\x1e";
        let commits = parse_commits(input).expect("commits should parse");
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].parents, ["aaaa", "bbbb"]);
        assert_eq!(commits[0].decorations, ["HEAD -> main", "tag: v1"]);
    }
}
