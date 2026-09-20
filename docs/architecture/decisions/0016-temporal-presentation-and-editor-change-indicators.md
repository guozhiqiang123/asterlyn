# ADR-0016: Consistent temporal presentation and shared editor change indicators

- **Status:** Implemented
- **Date:** 2026-09-20

## Context

Visible dates currently use several unrelated `Intl.DateTimeFormat` instances and one local relative
time helper. History, commit details, Push review, branch details, and Git Blame therefore disagree
about separators, relative thresholds, and whether an author or timestamp receives the stable
column. The product requires one predictable rule: recent events use human relative time, older
events use an exact local date and 24-hour clock, while Git Blame deliberately uses a dense exact
timestamp suitable for a line-by-line table.

The ordinary editor also lacks the worktree-change cues already visible in a Diff. Comparing only
the current buffer with its last save would make a marker disappear after saving even though Git
still reports the line as changed. Comparing against Git `HEAD` independently in every editor would
duplicate repository reads, race snapshot refresh, and couple CodeMirror to repository state.

## Decision

### One temporal presentation policy

A presentation-only formatter owns local-calendar and elapsed-time formatting. It accepts an
explicit clock for deterministic tests and exposes separate date, time, combined date/time, and
exact Git Blame forms:

- the calendar date is `Today` for the current local day and `yyyy/MM/dd` otherwise;
- elapsed time is `just now`, whole seconds, whole minutes, or whole hours for past values below 24
  hours, using localized unit copy;
- values at least 24 hours old use `yyyy/MM/dd HH:mm`, with a 24-hour local clock;
- invalid, missing, or future values use the caller's existing unknown-time fallback or the exact
  local date/time rather than producing a future-looking “ago” label; and
- Git Blame is the explicit compact-table exception and always uses `yyyy-MM-dd HH:mm`.

`Today`, `just now`, and the relative unit phrases belong to the locale catalog. Feature views do
not construct their own date formatters or relative thresholds.

The Git Blame gutter renders the exact timestamp in a left column and the author in a right-aligned
column. Uncommitted lines retain their localized Local changes label and no invented timestamp.

### Repository-derived change baselines

An editor change-baseline controller sits behind a narrow Git read port. For the active repository
snapshot it keys one bounded baseline by exact changed-file identity, deduplicates concurrent reads,
and rejects stale completions after repository replacement or status change. Supported tracked
files use their bounded `HEAD` text; an untracked file uses an empty baseline. A clean or unmodified
file falls back to its persisted editor content without issuing Git work.

The controller owns no writable file content and creates no repository database. Git remains the
source of truth, the editor session remains the only owner of the current buffer, and refresh may
replace a baseline decoration without replacing editor state, selection, undo history, or scroll.

### One lazy CodeMirror indicator extension

A shared editor extension compares a read-only baseline with the current CodeMirror document and
classifies each bounded change as added, deleted, or modified. It supplies:

1. colored left-gutter markers beside affected lines, including a deletion notch anchored at the
   nearest surviving line;
2. a right-side overview ruler with the same semantic colors; and
3. keyboard-focusable overview targets whose activation scrolls the matching change into view.

The ordinary text editor uses the repository-derived baseline. The editable current side of a
working Diff uses the exact repository source already supplied by that Diff read, so it does not
issue a second query. Indicator recalculation is document-local, debounced by CodeMirror updates,
bounded by the existing two-MiB text policy and a finite diff scan limit, and disposable with the
editor view.

The merge editor's existing per-chunk revert controls remain the rollback interaction for editable
Diff. A left-gutter local-Diff popover for the ordinary editor is deferred: gutter activation may
identify a change, but it must not perform an immediate destructive rollback or introduce a second
write path before a reviewed popover contract exists.

## Invariants

1. Feature views do not invent date separators, relative thresholds, or timezone behavior.
2. Git Blame's exact `yyyy-MM-dd HH:mm` form is an explicit exception, not a second global policy.
3. A save advances the file revision but does not erase markers for changes that still differ from
   `HEAD`.
4. Repository refresh updates decorations without rebuilding the active CodeMirror view.
5. Baseline reads are exact-identity checked, bounded, deduplicated, and stale-result safe.
6. Change indicators own no repository truth and never write the worktree or index.
7. Unsupported, binary, invalid-UTF-8, deleted, conflicted, or oversized files fail closed without
   fabricated line classifications.
8. Overview activation navigates only; rollback remains an explicit undoable editor operation.

## Delivery sequence

1. Introduce the localized temporal formatter and migrate all visible timestamp surfaces.
2. Correct Git Blame timestamp and two-column alignment.
3. Add the snapshot-aware editor baseline controller behind the existing working-Diff read port.
4. Add the shared gutter and overview-ruler extension to ordinary and editable Diff editors.
5. Close with focused formatter/controller/indicator tests, browser interaction, full validation,
   performance/resource evidence, and recorded platform limitations.

## Consequences

Temporal display becomes predictable and testable without leaking locale rules into domain code.
Editor markers survive ordinary saves because their baseline is Git truth, while unsaved edits are
still reflected immediately in the same comparison. The cost is one bounded on-demand baseline read
per changed open file identity plus a lazy visual diff calculation. The optional ordinary-editor
local-Diff/rollback popover remains a documented follow-up rather than an unsafe partial action.

Implementation and acceptance evidence is recorded in
[`2026-09-20 temporal presentation and editor change indicators`](../../benchmarks/2026-09-20-time-and-editor-change-indicators.md).
