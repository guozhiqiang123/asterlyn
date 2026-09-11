# Asterlyn Repository Instructions

These instructions apply to the whole repository.

1. Start discovery at `docs/README.md` and update the owning document with architecture, behavior, milestone, or workflow changes.
2. Preserve the dependency direction documented in `docs/architecture/overview.md`: product/domain code must not depend on Tauri or a concrete UI framework.
3. Treat Git as the source of truth. Never invent a parallel repository state database.
4. Invoke Git without a shell, use stable machine-readable output where available, and keep mutating operations explicit and auditable.
5. Keep branding in the presentation/configuration boundary. Core crate, protocol, and persisted-data names must remain product-neutral where practical.
6. Do not extract or copy source code, icons, fonts, or branded assets from Rebased, Android Studio, or another installed product. A standalone open-source dependency may be adopted only from its published distribution after its license, attribution, version, integrity, and package impact are recorded.
7. Every milestone closes only with recorded acceptance evidence, including functionality, performance, memory, accessibility, and known limitations.
8. Prefer focused tests first. Run `npm run check`, `npm run build`, and `cargo test -p asterlyn-git` for changes that touch their respective areas.
