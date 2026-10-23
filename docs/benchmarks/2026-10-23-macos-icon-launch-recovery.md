# macOS saved-icon launch recovery — 2026-10-23

Status: completed locally and manually accepted; icon entry repaired and fresh package accepted through quit/reopen. Grouped commit authorized on 2026-10-23.

## Cause and evidence

The installed `/Applications/Asterlyn.app` passed strict signature verification and reported package
kind `APPL`. LaunchServices and NSWorkspace resolved its bundle ID to the correct installed path.
However, Launchpad contained 15 Asterlyn entries. Resolving their saved bookmarks without UI or
mounting volumes showed that item **145**, the original icon, targeted:

```
~/Library/Application Support/Asterlyn Install Backups/legacy-applications-root-20261022/Asterlyn.app.backup-20261022-112829
```

The URL still resolved successfully and was not marked stale, but its resource type was a regular
folder, not an application. Opening that icon therefore opened Finder. One other entry (160) pointed
to the proper installation; the remaining entries mostly pointed to historical copies. Direct-path
launch acceptance did not exercise the icon's saved bookmark, so earlier installation checks missed
this failure. Copying backups elsewhere without repairing existing icon bookmarks was insufficient.

## Recovery

- A consistent SQLite backup of Launchpad was retained before a transaction changed Asterlyn rows.
- Item 145 was kept with its existing group/item identity and updated to the canonical application's
  bookmark. Fourteen duplicate Asterlyn items were removed using the database's existing cascade and
  ordering triggers. All 89 unrelated application entries retained their IDs/titles/bundle IDs.
- Dock was reloaded to discard cached bookmarks. No global LaunchServices reset, preference deletion
  or Launchpad layout reset was used. Afterwards one Asterlyn item remained and its bookmark resolved
  to `/Applications/Asterlyn.app` with `isApplication=true`.
- Opening the repaired saved bookmark successfully started the canonical installed executable.
- Seventy-seven managed backup registration paths were unregistered. Three managed backup roots
  (recent copies, historical install backups, and project-local backup artifacts) were archived.
  All 715 files / 2,670,112,282 source bytes were checked against the archives by SHA-256, in addition
  to full ZIP CRC checks. The unpacked roots were removed; the application data/profile was untouched.
- A Finder `.DS_Store` recreation briefly prevented removing one otherwise-empty backup root; the
  affected backup-only Finder window was closed and the metadata remainder removed. No unarchived
  application content was discarded.

## Durable installation workflow

`node scripts/install-macos-app.mjs --source <signed.app> --evidence <json>` now owns replacement.
It verifies the source's identity and complete signature, stops the installed process gracefully,
creates only a CRC/digest-verified ZIP backup, compares staged contents, and atomically exchanges
`Contents` through Darwin `RENAME_SWAP`. The installed `.app` root is never moved, renamed, or
removed/recreated. Failed verification restores old contents with the same root identity; failed
rollback retains a named recovery stage rather than deleting it.

After strict installed signature/digest checks, the helper refreshes only the Asterlyn registrations
and saved icon entry. Launchpad changes have a consistent backup and transaction guards that reject
schema drift rather than committing orphaned/duplicate icons. Unrelated entries are checked intact.
The helper starts through the stored icon bookmark, confirms `application.frontend_ready` from the
installed process log, quits, then repeats bookmark-based startup. Evidence includes root inode,
archive hash, icon entry identity and both startup sessions. It does not infer icon acceptance from
an explicit executable or application-path launch.

Repository instructions and the canonical build guide require this helper. Expanded `.app` and
`.app.backup-*` backups are forbidden. Historical acceptance documents retain their original paths
as history; those backup trees are now in the verified archives listed below.

## Verification

- Seven installer regressions passed: root identity preservation; failed verification rollback;
  copy/symlink rejection; recovery retention after failed rollback; targeted folder-bookmark repair;
  real SQLite transaction rollback on schema drift and preservation of unrelated rows; real Darwin
  atomic directory exchange.
- Complete script suite: 1,288 passed. Frontend type check and production build passed.
- No runtime UI, keyboard, focus or business state behavior changed. The installer adds no persistent
  runtime resources. Tests use temporary bundles/databases; native install validation uses persisted
  diagnostics rather than screenshots. Dock reload is a brief local repair step.
- This is macOS acceptance. No Windows/Linux installation behavior is inferred. If Launchpad data is
  unavailable, the installer explicitly records that icon-entry validation is unavailable; it never
  resets a different system database to compensate.

## Archive migration evidence

- `/Users/gzq/Library/Application Support/Asterlyn/archived-install-backups/20261023-150841-0-local-install-backups.zip` — 27 files verified; SHA-256 `a9d4b97de0c2ed0d6272478088951f0283e0835ad606a39b4fea565328f46a49`.
- `/Users/gzq/Library/Application Support/Asterlyn/archived-install-backups/20261023-150844-1-Asterlyn Install Backups.zip` — 660 files verified; SHA-256 `bc131564a0b0e700a326cbabd146134919e200a5f97319ec21b826a134392a27`.
- `/Users/gzq/Library/Application Support/Asterlyn/archived-install-backups/20261023-151616-2-local-app-backups.zip` — 28 files verified; SHA-256 `eeca952c8af1c247f8de2a24c3eb611b2d08dba48f0f0f8c0d896a2693ac1187`.

A prior signed installation was extracted from the recent-backup archive into a disposable hidden
`.noindex` directory and passed strict deep signature verification, then the disposable extraction
was removed. Three obsolete temporary installers were retired in favor of the repository helper.

## Final installed acceptance

- Fresh signed Tauri bundle and native rendered-shell smoke passed; version **0.1.19**.
- Accepted build: `5b3e03fb91894977523baa00300e053410b6547d-dirty-1792740246424`.
- Installed/source executable SHA-256: `be73a1558e92bae0dcc5aee49bacfdfdeabebeaa9b4a29659753b740963d34c5`; strict installed signature and byte comparison passed.
- `/Applications/Asterlyn.app` inode **203606126** before replacement and **203606126** after replacement (device `16777234`). The root identity was preserved by an actual atomic Contents exchange.
- Recoverable previous version: `/Users/gzq/Library/Application Support/Asterlyn/archived-install-backups/Asterlyn-1792740379447-ca067117-5ffb-4cd4-8dac-f3d2003e6cea.app.zip`; CRC/executable digest verified, archive SHA-256 `86da1709768dc5f4a7fe16baa9702e6e95c7090acad730dd2902e63bd5e92536`.
- Targeted Launchpad database backup: `/Users/gzq/Library/Application Support/Asterlyn/archived-install-backups/launchpad-1792740383270-0607f648-86ff-4994-b876-5434cc5937bc.sqlite`. Item **145** remained the sole Asterlyn entry, resolved to the installed application and was not stale; all **89** unrelated app entries were preserved.
- First icon-bookmark launch: PID **1821**, session `session-1792740384549-1821-0`, frontend ready.
- Graceful quit followed by second icon-bookmark launch: PID **1856**, session `session-1792740386170-1856-0`, frontend ready. This acceptance did not substitute a direct executable/path launch for the icon bookmark.
- The installed application was left running after the second launch. No application profile, recent-project data, repositories, user changes, or non-Asterlyn icons were deleted/reset. No commit, tag, push or publication performed.
- Fresh accepted archive: `target/release/bundle/macos/Asterlyn-0.1.19-20261023-icon-launch-fix-macos.app.zip`; SHA-256 `72f588c26ff113a91f667fcc63810aceb6f05b1042b004872e8e047f352bbb82`.
