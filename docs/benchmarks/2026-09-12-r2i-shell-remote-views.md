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
