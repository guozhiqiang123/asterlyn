# Movable and resizable dialog plan

- **Status:** Implemented
- **Date:** 2026-09-28

## Objective

Make every application-owned modal surface movable and resizable without coupling dialog geometry
to Git, workspace, editor, or remote-operation state. The behavior covers ordinary dialogs,
destructive alert dialogs, the command surface, nested Push dialogs, the native HTML worktree
recovery dialog, and application-owned confirmations.

Context menus, dropdown menus, filter popovers, tooltips, toasts, and the operating system's native
directory chooser are outside this contract. Those surfaces either follow an anchor or are owned by
the platform and must not behave like free-standing windows.

## Current state

- Sixteen top-level dialog hosts and two nested dialogs are rendered through several independent
  feature bindings.
- Most dialogs share only `.dialog` and `.dialog-backdrop` presentation rules. Their controllers
  independently own state, focus restoration, Escape handling, and rerendering.
- Push review and Push Diff have separate eight-direction resize implementations. Push review
  persists geometry; Push Diff retains it only for the current session. Neither supports title-bar
  movement.
- Four confirmation flows use `window.confirm`, whose position, size, appearance, and accessibility
  cannot be controlled by the application.

## Interaction contract

- Dragging a dialog title bar moves that dialog without allowing it to become unreachable.
- Eight edge and corner handles resize the dialog. The southeast handle is keyboard focusable and
  supports arrow-key resizing.
- A focused title bar supports arrow-key movement. Shift increases the movement or resize step.
- Every geometry is clamped to the current viewport or containing modal layer and is repaired after
  a host-window resize.
- Position and size are persisted per logical dialog identity. Different phases of one workflow may
  share geometry, while Update and Push retain separate geometry despite sharing a DOM host.
- Double-clicking a title bar clears saved geometry and returns the surface to its CSS-defined
  default placement and size.
- Dialog-specific minimum and default sizes remain presentation policy expressed through CSS custom
  properties. Small viewports take precedence over those minimums.
- Interactive controls inside a title bar never initiate a drag.
- Business controllers retain opening, closing, focus, validation, and operation ownership. The
  geometry layer does not mutate product state.

## Architecture

1. Add one shared presentation controller that discovers `.dialog` and command-surface elements,
   installs handles, and uses delegated pointer/keyboard behavior across rerenders.
2. Keep geometry math as pure functions for clamping, moving, resizing, loading, and persistence.
3. Identify surfaces by their stable host ID, with semantic keys for Update versus Push and for
   nested dialogs.
4. Replace the two Push-specific outer-window resize controllers with the shared controller. Keep
   the Push commit/file splitter as a separate feature-owned control.
5. Replace `window.confirm` with one queued application confirmation dialog. Callers provide
   localized title, message, action label, and destructive intent.
6. Preserve the native directory chooser as an explicit platform-owned exception.

## Implementation sequence

1. Introduce shared geometry math, persistence, discovery, pointer/keyboard bindings, and common
   resize-handle styling.
2. Register the controller at application startup and dispose it with the application lifecycle.
3. Remove Push-specific resize handles and bindings while retaining the internal preview splitter.
4. Add the application confirmation surface and migrate every `window.confirm` call site.
5. Add localization, responsive sizing policy, pure geometry tests, source-boundary tests, and
   update existing view/style ownership tests.
6. Run the complete frontend test, type-check, production-build, and whitespace gates; then record
   acceptance evidence here.

## Acceptance matrix

- Every application-owned `.dialog`, `alertdialog`, and command surface receives a movable title
  bar and eight resize directions, including dynamically created and nested dialogs.
- Moving and resizing cannot strand the title bar or overflow the available containing layer.
- Saved geometry survives dialog rerenders and application restart, and is safely clamped when the
  window becomes smaller.
- Push review keeps its established large default and persisted geometry while Push Diff gains the
  same persistent behavior.
- Application confirmations replace all `window.confirm` usage and inherit the same geometry,
  focus, Escape, localization, and destructive-action styling.
- Context menus and anchored popovers keep their existing positioning behavior.
- The native directory chooser remains platform-owned.

## Validation record

- Shared geometry coverage is installed once per application window and discovers ordinary,
  destructive, command-surface, nested, dynamically created, and native HTML dialogs after each
  feature rerender. Context menus and anchored popovers remain outside its selector.
- Pure geometry coverage verifies viewport fitting, minimum sizes, movement, every resize edge,
  persistence, reset, corrupt-state fallback, and migration from the former Push geometry key.
- The discovery controller marks a new dialog as initialized before adding its managed class and
  resize handles. Regression coverage verifies that the controller's own observed mutations
  converge after one initialization instead of creating an unbounded microtask scan loop when the
  Push dialog first opens.
- Source-boundary coverage rejects any production `window.confirm` call. The four former native
  confirmation paths now use one queued, localized application alert dialog.
- `npm run test:scripts`: passed all 658 tests.
- `npm run check`: passed TypeScript type-checking.
- `npm run build`: passed; Vite transformed 461 modules and produced the production bundle.
- `git diff --check`: passed.
- macOS arm64 native build: passed. The local preview bundle was ad-hoc signed with hardened runtime
  and passed `codesign --verify --deep --strict`.
- Acceptance archive: `target/release/bundle/macos/Asterlyn.app.zip`, 8,563,445 bytes, SHA-256
  `951f2d363a31d1f4404aafc9bb927a009ad4abf6f1c841207e1997c180eae275`.
- The rebuilt bundle replaced `/Applications/Asterlyn.app`; the installed executable matched the
  accepted bundle byte-for-byte with SHA-256
  `902a2e53efb306099d7d3a2bb77643195ca6cddef1cdeb3947f4e412f6690871` and remained alive through
  the six-second launch observation.
- The package is a local ad-hoc preview and is not notarized for distribution. Pointer interaction
  across the complete dialog inventory remains an installed-app manual acceptance activity.
