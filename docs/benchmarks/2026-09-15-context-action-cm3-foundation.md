# CM3 reviewed Git mutation foundation — 2026-09-15

## Scope

This checkpoint completes the native and desktop-protocol foundation needed by the Branches and
single-commit context menus. It does not claim that those menus are visible yet.

- reviewed single-commit Revert shares the existing Git-operation lifecycle, including exact
  target/HEAD plans, restart recovery, Continue, and Abort;
- branch Switch, Create, remote Checkout, Rename, and safe Delete use a typed
  prepare/revalidate/execute plan rather than display names or open revision expressions;
- plans bind the repository root, canonical source ref and object, current symbolic HEAD and
  object, destination, upstream, merge relationship, and a review token;
- arbitrary-ref Create starts at the reviewed object without inheriting an upstream;
- remote Checkout creates a local branch at the reviewed object and explicitly records the remote
  tracking ref;
- Rename and Delete only mutate local refs; Delete requires the selected object to be merged into
  current HEAD and deletes with an exact old-object lease;
- current branches, stale refs, destination collisions, active Git operations, dirty worktrees
  where relevant, and branches checked out by linked worktrees are rejected at the Git boundary;
- Tauri commands, the generated desktop command allowlist, runtime result validation, demo bridge,
  and malformed-result tests cover the new plan contract.

## Acceptance evidence

- `cargo test -p asterlyn-git`: 79 passed.
- Four repository integration scenarios cover arbitrary-object Create, remote tracking Checkout,
  local-only Rename/Delete, stale refs, unmerged deletion, and linked-worktree protection.
- `cargo clippy -p asterlyn-git --all-targets -- -D warnings`: passed.
- `cargo check -p asterlyn-desktop`: passed.
- Frontend protocol/demo suite: 416 tests passed in the full frontend run.
- `npm run check`, protocol generation drift checks, formatting, and whitespace validation passed.

## Known limits

- The Linux host lacks the WebKit/GTK development packages required to compile the complete Tauri
  shell, so this checkpoint validates the product-neutral desktop adapter crate and frontend
  protocol but does not claim a full `cargo check -p asterlyn` on this host.
- Remote publication, remote branch deletion, forced local deletion, detached checkout, automatic
  stash, and linked-worktree lifecycle management remain deliberately unsupported.
- Menu-provider, dialog, browser interaction, performance, memory, and accessibility evidence will
  close with the visible CM3 surface.
