# Hybrid workspace content-index plan

**Status:** Implemented and locally accepted on 2026-10-13; see
[acceptance evidence](../benchmarks/2026-10-13-hybrid-workspace-content-index.md)

**Owner:** Workspace search

**Related:** [ADR-0005](../architecture/decisions/0005-bounded-navigation-search.md),
[extension-coverage evidence](../benchmarks/2026-10-13-workspace-search-extension-coverage.md)

## Problem

The existing workspace-text search reads authorized files lazily and keeps memory bounded, but its
5,000-candidate ceiling makes a broad search incomplete in repositories such as Flutter. Extension-
balanced sampling reduces obvious starvation but cannot guarantee that an arbitrary file in a
dominant language was examined. Simply removing every bound would restore coverage at the cost of
repeated disk reads and long cold searches.

The product needs all three properties:

1. a broad ordinary search must not silently omit a file because of its path or extension;
2. repeated searches must avoid rereading the complete repository;
3. memory, disk, cancellation, authorization, and stale-data behavior must remain explicit.

## Decision

Asterlyn will use a **hybrid, verification-first content index**. The index is an accelerator, never
repository truth and never read authorization.

- The current authorized project catalog remains the only candidate authority.
- A cold or unusable-index query performs the ordinary bounded, cancellable, one-file-at-a-time scan.
- That same pass records a fixed-size lowercase ASCII trigram Bloom signature and a metadata identity
  for every safely decoded text file it read. It does not retain source text or result snippets.
- A later eligible literal query uses those signatures only to discard files that definitely cannot
  contain all query trigrams. Every remaining candidate is reread and matched by the existing exact
  search engine before a result is returned.
- Missing, invalid, saturated, or metadata-stale entries are scanned normally and refreshed. Index
  corruption discards the cache and falls back to a cold scan.
- Queries shorter than three ASCII bytes, non-ASCII literal queries, and regular expressions use the
  complete scan path. This avoids false negatives from Unicode case folding or regex inference.
- Include/Exclude rules are evaluated before index lookup. Ignored-file authority remains exactly the
  selected catalog policy.

The 5,000-file search ceiling is removed. The authorized catalog remains capped at 100,000 entries,
individual text reads remain capped at 2 MiB, and retained UI matches remain capped at 500 with an
explicit partial-result reason. The aggregate-byte guard is raised to a cold-search safety ceiling,
not treated as an allocation budget: the scanner retains at most one file body plus the bounded
report in memory.

## Index format and ownership

The desktop application owns persistence under its private cache directory. The product-neutral
workspace crate owns only the versioned index data model and the safe lookup/update algorithm.

Each repository index contains:

- a schema version and exact canonical-root identity;
- at most one entry per catalogued workspace-relative path;
- file length, modification timestamp, read-only state, and platform file identity/change metadata;
- a fixed 4,096-bit Bloom signature; and
- no source text, preview, author, Git object, or search history.

Files are written atomically with owner-only permissions where the platform supports them. An index
file has a strict size and entry-count limit. A canonical-root hash selects its cache filename, while
the root stored inside the file prevents accidental cross-repository reuse.

## Lifecycle and consistency

Index creation is lazy and never blocks project activation. The first relevant search builds or
repairs entries as part of work it already performs, then atomically persists the merged snapshot.
Subsequent searches still stat authorized candidates before trusting an entry. A path event, branch
switch, recreated inode, changed length/timestamp, watcher overflow, or unsupported metadata causes
the affected entry—or all uncertain entries—to be treated as stale and scanned.

The first implementation does not require a second background directory traversal: this avoids
duplicating cold I/O and keeps project opening unchanged. Native watcher hints may later evict hot
in-memory entries earlier, but query-time identity validation remains mandatory because watcher
events are hints rather than authority.

Cancellation stops matching and index work together. A cancelled or failed search does not publish a
partially rewritten cache. Repository switching and window cleanup retain no source content in
memory beyond the existing search lifetime.

## Search/report behavior

Reports add the number of eligible files excluded by a valid index signature. Presentation uses:

`live files read + index-pruned files / eligible files`

A report is complete when every eligible file was either safely rejected by the index or read and
matched, and no catalog, byte, match, or unsupported-file boundary was reached. Index pruning is not
an incomplete-coverage reason.

The current request identity, cancellation, revision-qualified match positions, stale-open checks,
and replacement transaction remain unchanged. Replacement planning may use the index to narrow
definite misses, but it must still reject any genuinely partial report before mutation.

## Delivery sequence

### HSI-1 — Complete cold path

- Remove the 5,000-candidate cutoff from the application search limits.
- Preserve one-file-at-a-time reading and cancellation.
- Keep explicit catalog, aggregate-byte, match, and skipped-file coverage evidence.

### HSI-2 — Safe index core

- Add the versioned metadata identity and fixed-size Bloom signature.
- Accelerate eligible ASCII literal queries only.
- Add false-positive, no-false-negative, stale-entry, saturation, newline-normalization, and
  cancellation tests.

### HSI-3 — Private persistence and telemetry

- Load, validate, merge, prune, and atomically save the per-root cache.
- Add protocol/report fields and localized coverage text for index-pruned candidates.
- Treat malformed, oversized, mismatched-root, and unknown-version caches as recoverable misses.

### HSI-4 — Acceptance and delivery

- Benchmark a cold search and two warm searches in `/Users/gzq/flutter`.
- Record files read, index-pruned files, bytes read, wall time, peak index size, and known fallbacks.
- Run focused frontend/Rust tests, complete checks and production build.
- Build a fresh native package, replace `/Applications/Asterlyn.app`, relaunch, and record hashes.

## Acceptance gates

1. A literal located after the former 5,000-file boundary is found without an Include rule.
2. A warm literal search returns the same exact matches and revisions as a forced cold search.
3. Edited, replaced, deleted, renamed, ignored-policy-changed, and newly catalogued files cannot be
   hidden by a stale entry.
4. Regex, short, and non-ASCII queries demonstrably scan the fallback path.
5. A corrupt/oversized index cannot crash search or authorize a path.
6. Index memory and disk use are measured on Flutter; source text is absent from the cache.
7. Cancellation and a newer request still make obsolete work unobservable.

## Known limits

- The first search remains a disk-bound cold scan; the index optimizes repeated searches.
- A query with more than 500 retained matches remains visibly partial until result paging is added.
- Files larger than the existing per-file text limit and unsupported encodings remain typed skips.
- Progressive result streaming is a separate protocol slice. It should be added only if the measured
  cold-search latency still fails the interaction budget after the complete scan and index land.
