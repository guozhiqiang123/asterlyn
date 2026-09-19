# CM4 exact historical file foundation — 2026-09-19

## Outcome

H4 now has one native boundary for reading the exact historical version represented by a commit
detail file row. The caller supplies the complete `CommitFileChange`; Git reloads bounded commit
details and rejects any path, original-path, or status mismatch. Added, modified, renamed, copied,
and supported type-changed rows resolve after the selected commit. Deleted rows resolve from the
selected commit's first parent. The result pins the selected commit, actual source revision, blob
OID, logical and source paths, regular-file mode, and byte length.

The desktop adapter keeps raw bytes native-side. Supported static images pass through the existing
signature, animation, dimension, aggregate-pixel, and data-URL rules. Other content passes through
the workspace UTF-8/BOM codec with the existing 2 MiB text limit. The versioned protocol returns a
typed read-only text-or-image preview; it does not expose an arbitrary object ID reader.

## Safety and resource boundaries

- Commit, parent, and blob identities must be full SHA-1 or SHA-256 object IDs.
- Literal pathspecs and an exact `ls-tree -z` result prevent revision/path expression injection.
- Only `100644` and `100755` blob entries are supported; trees, symlinks, submodules, and unknown
  modes fail closed.
- Tree-entry output is capped at 64 KiB, blob reads at 16 MiB, and text at 2 MiB. Bounded reads must
  match the measured immutable blob size; partial data is rejected.
- The command is read-only and does not touch `HEAD`, refs, index, worktree, editor buffers, or the
  recovery journal.

## Verification

| Check | Result |
| --- | --- |
| Git exact after/deleted-before/rename/stale/limit regression | passed; Git suite 85 passed |
| Workspace metadata-free UTF-8/BOM/binary/limit codec regression | passed; workspace suite 41 passed |
| Protocol generation, valid/invalid payloads and native wiring | passed |
| Full frontend/delivery suite | 443 passed |
| TypeScript, Git/workspace Clippy and desktop check | passed |
| Production build | passed |
| Production startup JavaScript | 652,707 B raw / 148,391 B gzip |

The startup movement from the H3 checkpoint is 920 B raw / 213 B gzip. Native object parsing and
content transformation remain in Rust; the browser bundle adds only the bridge/demo route and
result validator. No persistent content cache, watcher, timer, database, or eager editor runtime is
introduced. Full Tauri compilation was attempted but remains blocked on this host by the missing
system `webkit2gtk-4.1`, `javascriptcoregtk-4.1`, and `libsoup-3.0` development packages; the
Tauri command registration is covered by source wiring and protocol tests.

## Known limits

- This checkpoint provides the safe read capability only. Read-only historical editor documents,
  comparison with current/unsaved content, and reviewed restoration arrive in subsequent H4
  checkpoints.
- Merge commits retain the existing first-parent policy.
- Symbolic links, submodules, unsupported binary formats, non-UTF-8 text, and files beyond their
  respective bounds are reported as unsupported rather than rendered approximately.
