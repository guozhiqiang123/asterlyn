# Changes composer minimum-height repair — 2026-09-28

## Outcome

Dragging the Changes/commit splitter to its lowest position no longer clips the validation message
above the Commit actions. The panel keeps its existing minimum geometry: the commit-message text
area remains the flexible element and absorbs vertical compression, while the one-line validation
message has an explicit 13-pixel minimum and cannot shrink below its matching line height.

This avoids increasing the entire Changes pane minimum size and preserves the existing amount of
space available to the changed-file list.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Focused stylesheet and splitter-layout tests | 17 passed |
| TypeScript check | passed |
| Full frontend/delivery suite | 668 passed |
| Production build | 466 modules transformed; passed |
| Native macOS package | `.artifacts/packages/Asterlyn-changes-composer-20260928.zip`, 8,606,581 bytes, SHA-256 `afa2324fd603097ae48a68fe0d475e8ff3a2c22b4301576e3d6799bc88c0bcff` |
| Local installation | bundle binary matched SHA-256 `3f2af661c176e4b0634f8a8c7af8c38bb9ff2fbcdfc05a0828418aa62f229eb7`; installed app relaunched successfully |

## Known limits

- Long validation text remains a single line and uses the existing horizontal ellipsis policy;
  this repair addresses the reported vertical clipping at the minimum splitter height.
