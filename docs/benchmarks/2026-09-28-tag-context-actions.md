# Tag context-action acceptance — 2026-09-28

## Outcome

The Branches Tag rows now expose the supported Android Studio-aligned operations without adding a
Working Tree comparison entry:

- Check Out Tag opens an explicit confirmation and checks out the reviewed Tag commit in detached
  `HEAD` state only when the working tree is clean;
- Merge routes the canonical `refs/tags/*` target into the existing reviewed Merge lifecycle;
- Push lists every push-capable remote and publishes only the selected exact Tag object, treating an
  identical remote Tag as an idempotent success and rejecting different remote content;
- Delete Local Tag and Delete from each remote reuse the existing exact-object Tag confirmation and
  remote lease protections. Remote deletion retains the local Tag.

The context target now admits Tag identities while retaining top-level single-root write scope.
Logical multi-root and nested-root Tags stay read-only. Local Tag decoration changes keep the
History list identity, scroll position, and selection through slice-stable incremental refresh;
checkout alone performs a complete reconciliation because `HEAD` changes.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Branch target, menu policy/routing, dialog, and incremental History tests | 20 passed |
| Native `asterlyn-git` suite, including clean checkout and exact remote Tag races | 109 passed |
| TypeScript check | passed |
| Full frontend/delivery suite | 667 passed |
| Production build | 466 modules transformed; passed |
| Native macOS package | `.artifacts/packages/Asterlyn-tag-context-20260928.zip`, 8,606,626 bytes, SHA-256 `a0fa968fe723a6faddc1a6d39aad3ee676200b94ffb6819355b115f671f151d9` |
| Local installation | bundle binary matched SHA-256 `8cf0b790c6c8e18b188b03535403f571019b047ca41ace4c47916e0a0d59fba7`; installed app relaunched successfully |

## Safety evidence

- Checkout revalidates the local Tag against the reviewed commit and rejects any staged, tracked,
  or untracked working-tree change before invoking detached checkout.
- Push reads the exact remote Tag and peeled object first. It pushes the immutable reviewed local
  Tag object ID as the refspec source, so a concurrent local Tag move cannot change what is sent;
  a concurrent remote creation is rejected by normal non-force Tag semantics.
- Remote delete retains the existing exact remote-object `force-with-lease`; local delete uses an
  exact old-object `update-ref` lease.
- Menu construction performs no Git or network work, and the shared context-menu focus/keyboard
  lifecycle remains unchanged.

## Known limits

- Detached checkout intentionally does not create a branch. Users must switch to or create a local
  branch before ordinary commit, Merge, Rebase, Pull, or current-branch Push workflows.
- The menu does not compare a Tag with Working Tree; that product capability remains out of scope.
- Tag force-push is intentionally absent. Replacing an existing remote Tag requires a separately
  designed, explicitly reviewed force-with-lease workflow.
