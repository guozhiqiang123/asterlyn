# 0017: Editable Git-ignored files with explicit ignored identity

## Status

Accepted on 2026-09-23. This decision supersedes the read-only capability assigned to ignored
files by decision 0010. Decision 0010 remains the source for bounded ignored-file enumeration and
watcher containment.

## Decision

The project catalog represents Git ignore state independently from write capability. A catalogued
ignored file carries `ignored: true` and `readOnly: false`. The ignored identity continues to drive
default quick-open filtering, History and Git Blame availability, bulk-search policy, tree status,
and native watcher planning. It no longer prevents opening an editor buffer, becoming dirty,
saving, renaming, moving, or entering a reviewed Trash operation.

Reads and saves use the exact file identity already installed in the active window session. Before
either operation, Git revalidates that an ignored identity still belongs to the same repository and
is still ignored; the workspace boundary then repeats non-link traversal, file-kind, revision, and
atomic-save checks. If ignore policy changes, the stale identity fails closed until the catalog is
reconciled.

Ignored directories remain derived from the separately bounded ignored-file catalog. They do not
become watcher roots merely because their files are writable; only an explicitly open ignored
document adds the required parent directories to the active watch plan.

## Consequences

- Ignored text files can be edited and saved with the same revision-conflict protection as other
  project files.
- Ignored files and directories can use ordinary reviewed Files mutations, including Trash.
- Default quick open and workspace search continue to exclude ignored files unless the user asks
  to include them. Bulk replacement remains limited to its independently authorized catalog.
- `readOnly` is reserved for an actual capability restriction and must not be inferred from Git
  status.
