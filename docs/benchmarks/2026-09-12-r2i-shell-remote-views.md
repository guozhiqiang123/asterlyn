# R2i shell and Remote/Push view ownership

## Scope

This R2 checkpoint moves the stable application shell, Settings page presentation, Remote toolbar,
Update confirmation, Push review, and pushed-file Diff presentation out of `AsterlynApp`. The
activity rail now owns its pointer and keyboard binding lifecycle and explicitly removes global
listeners during disposal. Existing controllers remain the only owners of serializable feature
state and asynchronous request identity.

## Evidence

- Comparison context: Linux browser-demo build from the same worktree, before and after this slice.
- Source concentration: `src/app.ts` decreased from 8,304 lines after controller extraction to
  7,508 lines. The new shell, Settings, Remote/Push, and activity-binding files are each below the
  800-line decomposition trigger.
- Production build: the main startup chunk is 408.84 kB uncompressed and 100.72 kB gzip. The prior
  style-ownership checkpoint measured 410.82 kB and 99.77 kB gzip.
- Focused behavior: three deterministic view tests cover activity ordering and stable hosts,
  Settings selection and bounded controls, plus Update/Push safety copy.
- Broader behavior: all 222 pre-existing script tests passed before the focused tests were added;
  TypeScript checking and the production build also passed.
- Browser acceptance: the browser demo opened the Push review from the top bar, rendered its local
  and remote route, outgoing commits, aggregate file tree, tag controls, Push mode action, and close
  control without console errors.

## Interpretation

The result is **improved**. Presentation ownership and global-listener disposal are narrower, the
main chunk remains below its 500 kB gate, and visible behavior is preserved. The small gzip increase
is not material and accompanies a lower uncompressed chunk. `AsterlynApp` is still above the source
decomposition trigger, so this is an interim R2 checkpoint rather than phase acceptance.

## Limitations and next action

The browser demo cannot validate native credentials, real remote writes, or platform window
controls. Continue by moving Git History/branch presentation and editor presentation behind their
feature boundaries, then run native and packaging acceptance at the R2 boundary.

## 2026-09-21 Push split-action visual correction

The Push confirmation retains separate activation and mode-selection semantics, but now presents
them as one aligned 31-pixel control. The mode affordance uses a CSS-drawn, current-color chevron
instead of relying on the shared SVG's inline layout, so native-scale WebViews cannot reduce the
right segment to an apparently empty accent block. Browser acceptance measured contiguous main and
mode segments with no gap, a centered visible chevron, and the existing accessible mode label.

### 2026-09-21 specificity follow-up

An installed-package report showed the same split action rendering as two separated pills with a
single collapsed chevron stroke. The cause was stylesheet evaluation order, not the markup: the
shared `main-*.css` chunk (which owns the equal-specificity `.primary-button` radius and padding)
is injected **after** the lazily loaded feature stylesheets, so `.push-primary-action` and
`.push-mode-toggle` were losing every conflicting declaration. Both segments therefore inherited
`border-radius: 5px`, and the toggle's `padding: 0` lost to the shared `padding: 0 13px`, which
reduced the toggle's content box to zero and let the flex item shrink the chevron to a 1-pixel
border fragment.

The three split rules are now scoped as `.push-split-action …` so they outrank the shared surface
independently of load order. A two-order Chromium harness that links the production
`main-*.css`/feature stylesheet in both sequences reports identical geometry for each order: main
segment 54.27 × 31 with radius `5px 0 0 5px`, mode segment 27 × 31 with radius `0 5px 5px 0`, a
0.00-pixel junction gap, and a 7 × 7 chevron box with right/bottom borders. A live `dist/` load in
Chromium confirmed the real document order is five feature stylesheets followed by
`main-*.css`, and `scripts/style-ownership.test.mjs` now fails if the split declarations stop being
scoped. The underlying order fragility is recorded as a follow-up: any other feature rule that
competes with a shared rule at equal specificity will silently lose the same way until stylesheet
injection order or rule ownership is normalized.
