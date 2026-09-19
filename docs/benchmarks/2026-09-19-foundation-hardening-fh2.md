# Foundation hardening FH2 startup-boundary acceptance

## Scope

FH2 separates the deterministic browser demo from the native production bridge without changing
the `DesktopBridge` contract or product behavior. `src/bridge.ts` now statically selects the Tauri
implementation for a native runtime and dynamically loads the browser demo otherwise. Vite rejects
an application chunk above 500,000 bytes and rejects demo modules inside the chunk that contains
`src/app.ts`.

The build also emits capability-owned feature chunks. Those feature chunks are statically imported
by the application and are therefore not described as lazy or removed startup transfer. This stage
closes the oversized single application chunk and removes demo implementation code from the native
loaded graph; FH4 remains responsible for measuring and reducing aggregate startup work through
real feature activation boundaries.

## Functional and architecture evidence

- TypeScript checking and the production build pass with the hard gate enabled.
- The application sourcemap contains no `src/demo.ts` or `src/adapters/demo/*` source.
- The deterministic browser workbench reaches its ready state through the new dynamic bridge,
  renders Files, Branches, History, commit details, remote actions, and status, and reports no
  browser console warnings or errors.
- Existing protocol and feature behavior remain covered by the complete frontend script suite.
- The bridge contract and the 79-command native protocol are unchanged.

## Build-size evidence

Local production build on the project Linux host with Node 24.19.0 and Vite 8.2.2:

| Artifact | Before FH2 | After FH2 | Interpretation |
| --- | ---: | ---: | --- |
| application/main JavaScript | 685,945 B / 153,928 B gzip | 357,725 B / 78,263 B gzip | application chunk now passes the enforced 500,000-byte gate |
| static feature JavaScript | included in main | 100,541 B + 189,722 B | capability-owned chunks, but still startup dependencies |
| dynamic demo bridge JavaScript | included in main | 48,441 B / 13,937 B gzip | absent from the native loaded path; loaded for browser demo |
| main CSS | 126,665 B | 62,302 B | feature CSS was split with its owning JavaScript groups |
| static feature CSS | included in main | 24,641 B + 42,713 B | still startup styling; no aggregate CSS reduction claim |

The main-chunk result is **improved** and the build now fails closed above its budget. Aggregate
startup transfer is **improved only by the removed demo path and otherwise inconclusive from chunk
sizes alone**, because the new feature chunks remain static dependencies.

## Validation

- `npm run check`
- `npm run test:scripts`
- `npm run build`
- local browser demo load and DOM inspection at `http://127.0.0.1:1420/`
- browser console warning/error inspection: none
- source-map module inspection for demo sources: none in the application chunk

## Known limits and next action

- The deterministic demo adapter remains a reviewed 2,375-line fixture. It may not gain new behavior
  without first splitting along `DesktopBridge` capability boundaries.
- Static feature chunks reduce the size and blast radius of the central application artifact but do
  not defer feature initialization. FH3 closes dependency inversions; FH4 then moves remaining state
  owners and introduces measured activation boundaries where lifecycle semantics allow them.
- Native installed-package behavior is unchanged by protocol, but Windows and macOS package startup
  remain platform acceptance items for the next release checkpoint.
