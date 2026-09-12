# R2h frontend style ownership evidence — 2026-09-12

## Scope

This independently revertible R2 slice replaces the 6,338-line global stylesheet with explicit
Shell, Settings, Changes, Files/Editor, Git History/Branches/Details, Remote/Push, and shared
foundation layers. It changes source ownership only; selectors, declarations, responsive rules,
and the entry-point load contract remain behaviorally equivalent.

## Ownership result

`main.ts` installs every stylesheet explicitly. Capability-specific rules live beside their owning
feature, while tokens, workbench geometry, reusable controls, common content surfaces, overlays,
and responsive/motion policy live under `src/shared`. The largest resulting sheet is 790 lines,
below the 800-line decomposition trigger. A source test checks both the limit and complete
entry-point registration so a new unowned sheet cannot silently disappear from production.

The global `styles.css` falls from 6,338 lines to 198 lines (96.88%). Total declarations are retained
across the owned sheets; this is a structural **improvement**, not a CSS-size reduction claim.

## Validation and interpretation

TypeScript checking and the production build pass. Browser interaction verifies that the workbench,
Changes tree, project tree, Git log/details, Markdown source editor, and split Diff remain visible
and operable after the cascade was regrouped. The first source editor and first Diff also load their
lazy chunks successfully.

The main JavaScript chunk is 410.82 kB raw and 99.77 kB gzip, compared with 410.51 kB and 99.72 kB
in R2g. The 0.31 kB raw (0.08%) and 0.05 kB gzip (0.05%) changes are **no material change**. CSS
ownership is **improved**; installed native rendering remains to be checked in phase-closing
acceptance.

## Next action

Move remaining pure feature presentation out of `AsterlynApp`, run the complete R2 acceptance set,
and produce the single phase-boundary DEB and remote push.
