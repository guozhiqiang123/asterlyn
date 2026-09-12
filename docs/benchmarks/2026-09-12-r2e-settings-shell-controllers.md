# R2e Settings and Shell controllers evidence — 2026-09-12

## Scope

This independently revertible R2 slice preserves settings, typography and Diff preferences,
activity-rail ordering, tool-window layout, native window chrome selection, page navigation, and
repository/editor-tab menus while assigning their state and persistence to Settings and Shell
controllers. It completes the planned controller-ownership sequence but is not the R2 exit report;
view/CSS ownership, bounded mounting, lazy capability loading, and phase-closing acceptance remain.

## Ownership result

`SettingsController` owns the active settings section, validated preferences, no-op detection,
persistence, typed changes, and disposal. `ShellController` owns page navigation, workbench layout,
activity ordering, mutually exclusive menus, native chrome mode, persistence, typed changes, and
disposal. `AsterlynApp` now reads these feature states as a composition client and routes visible
effects without directly replacing their values.

The application file is 8,384 lines versus 8,381 in R2d, an increase of three lines (0.04%) caused
by controller wiring and therefore **no material change**. It remains 1,227 lines or 12.77% below
the original 9,611-line audit baseline. The Settings controller is 81 lines and the Shell
controller is 163 lines, both below the 800-line decomposition gate. View and event implementation
still accounts for most of `AsterlynApp`; the next slice must move presentation ownership rather
than treating state extraction alone as completion.

## Validation and interpretation

Three new tests cover bounded preference persistence, mutually exclusive menus, and independent
layout/activity persistence. All 213 frontend script tests, TypeScript checking, and the production
frontend build pass.

The main JavaScript chunk is 761.51 kB raw and 213.79 kB gzip, compared with 757.36 kB raw and
213.08 kB gzip in R2d. The increases are 4.15 kB raw (0.55%) and 0.71 kB gzip (0.33%), both **no
material change** under the one-percent threshold. R2 still fails its below-500-kB budget.

No installed-app interaction, native resource series, Rust rerun, or package build is claimed by
this interim slice. State ownership and persistence isolation are **improved**; source
concentration and artifact size show **no material change**; end-user performance remains
**inconclusive** until phase-closing acceptance.

## Next action

Move feature rendering and event binding behind stable hosts, split the global stylesheet by owning
capability, bound long History and tree mounts, and lazy-load editor/Diff implementation. Close R2
only after source, DOM, bundle, accessibility, native, and installed-package evidence all pass.
