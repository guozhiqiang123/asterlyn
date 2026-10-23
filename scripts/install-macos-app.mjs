import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const BUNDLE_ID = "dev.asterlyn.desktop";
const APP_EXECUTABLE = "Contents/MacOS/asterlyn";
const nativeTool = fileURLToPath(new URL("./macos-app-tools.swift", import.meta.url));
const registrationTool = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const delay = (ms) => new Promise((accept) => setTimeout(accept, ms));

async function run(command, args) {
  return execute(command, args, { maxBuffer: 2 * 1024 * 1024 });
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function native(command, args = [], input = []) {
  const child = spawn("/usr/bin/swift", [nativeTool, command, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const completion = new Promise((accept, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? accept() : reject(new Error(stderr || `Native operation exited ${code}`)));
  });
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_384); });
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(input));
  await completion;
  return JSON.parse(stdout);
}

async function treeManifest(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    const path = join(root, relative);
    const mode = (await lstat(path)).mode & 0o777;
    if (entry.isSymbolicLink()) result.push([relative, "link", await readlink(path)]);
    else if (entry.isDirectory()) result.push([relative, "directory", mode], ...await treeManifest(root, relative));
    else if (entry.isFile()) result.push([relative, "file", mode, await hashFile(path)]);
    else throw new Error(`Unsupported bundle entry: ${relative}`);
  }
  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

/** Caller archives the old bundle first. Exchange only Contents; never move/delete a live .app root. */
export async function replaceBundleContents({ source, destination, copyContents, swapContents, verify }) {
  const previousRoot = await exists(destination);
  if ((await lstat(source)).isSymbolicLink() || (previousRoot && (await lstat(destination)).isSymbolicLink())) {
    throw new Error("Application roots must not be symlinks");
  }
  if (resolve(source) === resolve(destination)) throw new Error("Source and installed app must differ");
  const stage = await mkdtemp(join(dirname(destination), ".asterlyn-install-"));
  const candidate = join(stage, "Contents");
  const installed = join(destination, "Contents");
  const originalIdentity = previousRoot ? await stat(destination, { bigint: true }) : null;
  let swapped = false, promoted = false, keepRecovery = false;
  try {
    await copyContents(join(source, "Contents"), candidate);
    if (JSON.stringify(await treeManifest(candidate)) !== JSON.stringify(await treeManifest(join(source, "Contents")))) {
      throw new Error("Staged application contents do not match the accepted bundle");
    }
    if (!previousRoot) await mkdir(destination);
    if (await exists(installed)) {
      await swapContents(candidate, installed);
      swapped = true;
    } else { await rename(candidate, installed); }
    promoted = true;
    await verify(destination);
    const identity = await stat(destination, { bigint: true });
    if (originalIdentity && (identity.dev !== originalIdentity.dev || identity.ino !== originalIdentity.ino)) {
      throw new Error("Installed application root identity changed");
    }
    return { rootIdentityPreserved: previousRoot, inode: String(identity.ino), device: String(identity.dev) };
  } catch (error) {
    try {
      if (swapped) await swapContents(candidate, installed);
      else if (promoted) await rm(installed, { recursive: true });
      if (!previousRoot && await exists(destination)) await rm(destination, { recursive: true });
    } catch (rollback) {
      keepRecovery = true;
      throw new AggregateError([error, rollback], `Recovery contents retained at ${stage}`);
    }
    throw error;
  } finally {
    if (!keepRecovery) await rm(stage, { recursive: true, force: true });
  }
}

async function archiveExecutableHash(archive, member) {
  const child = spawn("/usr/bin/unzip", ["-p", archive, member], { stdio: ["ignore", "pipe", "pipe"] });
  const done = new Promise((accept, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? accept() : reject(new Error("Backup executable could not be read")));
  });
  child.stderr.resume();
  const hash = createHash("sha256");
  for await (const chunk of child.stdout) hash.update(chunk);
  await done;
  return hash.digest("hex");
}

async function archivePrevious(destination, archiveRoot) {
  if (!await exists(destination)) return null;
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  const archive = join(archiveRoot, `Asterlyn-${Date.now()}-${randomUUID()}.app.zip`);
  const before = await hashFile(join(destination, APP_EXECUTABLE));
  await run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", destination, archive]);
  await chmod(archive, 0o600);
  await run("/usr/bin/unzip", ["-tqq", archive]);
  if (await archiveExecutableHash(archive, `${basename(destination)}/${APP_EXECUTABLE}`) !== before) {
    throw new Error("Recoverable backup executable digest mismatch");
  }
  return { archive, sha256: await hashFile(archive), executableSha256: before };
}

export function planLaunchpadRepair(rows, resolved, canonicalPath) {
  const owned = rows.filter((row) => row.bundleid === BUNDLE_ID);
  if (owned.length > 128) throw new Error("Unexpected number of Asterlyn launch entries");
  if (owned.length === 0) return null;
  for (const row of owned) if (!Number.isSafeInteger(row.item_id)) throw new Error("Invalid launch entry identity");
  const byId = new Map(resolved.map((entry) => [entry.item_id, entry]));
  // Preserve the oldest icon's parent/order, including one whose bookmark points to a folder.
  const keep = [...owned].sort((a, b) => a.item_id - b.item_id)[0];
  return { keepId: keep.item_id, removeIds: owned.filter((row) => row.item_id !== keep.item_id).map((row) => row.item_id),
    staleIds: owned.filter((row) => {
      const value = byId.get(row.item_id);
      return !value?.isApplication || value.path !== canonicalPath || value.stale;
    }).map((row) => row.item_id) };
}

function sqlText(text) { return `'${text.replaceAll("'", "''")}'`; }
export function launchpadRepairSQL(plan, bookmarkHex, unrelatedCount) {
  if (!Number.isSafeInteger(plan.keepId) || !Number.isSafeInteger(unrelatedCount) || unrelatedCount < 0
      || bookmarkHex.length > 131_072 || !/^(?:[a-f0-9]{2})+$/iu.test(bookmarkHex)) throw new Error("Invalid launch repair input");
  return `CREATE TEMP TABLE repair_assertion (ok INTEGER CHECK(ok=1));
    BEGIN IMMEDIATE;
    UPDATE apps SET bookmark=X'${bookmarkHex}',title='Asterlyn' WHERE item_id=${plan.keepId} AND bundleid=${sqlText(BUNDLE_ID)};
    DELETE FROM items WHERE rowid IN (SELECT item_id FROM apps WHERE bundleid=${sqlText(BUNDLE_ID)} AND item_id<>${plan.keepId});
    INSERT INTO repair_assertion SELECT CASE WHEN
      (SELECT count(*) FROM apps WHERE bundleid=${sqlText(BUNDLE_ID)})=1 AND
      (SELECT count(*) FROM apps WHERE bundleid IS NOT ${sqlText(BUNDLE_ID)})=${unrelatedCount}
      THEN 1 ELSE 0 END;
    COMMIT;`;
}
async function sql(database, statement, readonly = false) {
  const result = await run("/usr/bin/sqlite3", [...(readonly ? ["-readonly"] : []), "-json", "-cmd", ".timeout 5000", database, statement]);
  return result.stdout.trim() ? JSON.parse(result.stdout) : [];
}
async function launchpadDatabase() {
  const { stdout } = await run("/usr/bin/getconf", ["DARWIN_USER_DIR"]);
  const database = join(stdout.trim(), "com.apple.dock.launchpad/db/db");
  return await exists(database) ? database : null;
}
async function launchEntries(database) {
  return sql(database, `SELECT item_id,title,bundleid,hex(bookmark) AS bookmarkHex FROM apps WHERE bundleid=${sqlText(BUNDLE_ID)} ORDER BY item_id`, true);
}

async function repairLaunchpad(destination, archiveRoot) {
  const database = await launchpadDatabase();
  const bookmark = await native("bookmark", [destination]);
  if (!database) return { database: null, bookmarkHex: bookmark.bookmarkHex, unavailable: true };
  const rows = await launchEntries(database);
  const resolved = rows.length ? await native("resolve", [], rows) : [];
  const plan = planLaunchpadRepair(rows, resolved, destination);
  if (!plan) return { database, bookmarkHex: bookmark.bookmarkHex, unlisted: true };
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  const backup = join(archiveRoot, `launchpad-${Date.now()}-${randomUUID()}.sqlite`);
  await sql(database, `VACUUM INTO ${sqlText(backup)}`);
  await chmod(backup, 0o600);
  const others = await sql(database, `SELECT item_id,title,bundleid FROM apps WHERE bundleid IS NOT ${sqlText(BUNDLE_ID)} ORDER BY item_id`, true);
  // One transaction; existing item-delete triggers maintain image caches and sibling ordering.
  await sql(database, launchpadRepairSQL(plan, bookmark.bookmarkHex, others.length));
  const after = await launchEntries(database);
  const othersAfter = await sql(database, `SELECT item_id,title,bundleid FROM apps WHERE bundleid IS NOT ${sqlText(BUNDLE_ID)} ORDER BY item_id`, true);
  if (after.length !== 1 || JSON.stringify(others) !== JSON.stringify(othersAfter)) {
    throw new Error(`Launch entry verification failed; database backup: ${backup}`);
  }
  if ((await sql(database, "PRAGMA quick_check", true))[0]?.quick_check !== "ok") throw new Error("Launchpad database integrity check failed");
  const verified = await native("resolve", [], after);
  if (verified[0]?.path !== destination || !verified[0]?.isApplication) throw new Error("Launchpad still resolves outside installed application");
  // Reload this process's cached icon bookmarks; never reset the Launchpad layout or LS database.
  await run("/usr/bin/killall", ["Dock"]);
  return { database, backup, ...plan, bookmarkHex: after[0].bookmarkHex, unrelatedEntriesPreserved: others.length };
}

async function installedProcesses(executable) {
  const { stdout } = await run("/bin/ps", ["-axo", "pid=,comm="]);
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    return match && match[2] === executable ? [Number(match[1])] : [];
  });
}
async function quitInstalled(destination) {
  const executable = join(destination, APP_EXECUTABLE);
  if (!(await installedProcesses(executable)).length) return;
  await run("/usr/bin/osascript", ["-e", `tell application id "${BUNDLE_ID}" to quit`]);
  const deadline = Date.now() + 15_000;
  while ((await installedProcesses(executable)).length && Date.now() < deadline) await delay(250);
  if ((await installedProcesses(executable)).length) throw new Error("App did not quit gracefully; installation unchanged");
}
async function launchAndVerify(destination, launchpad) {
  const entries = launchpad.database ? await launchEntries(launchpad.database) : [{ bookmarkHex: launchpad.bookmarkHex }];
  if (entries.length !== 1) throw new Error("Expected exactly one installed application icon");
  const opened = await native("open", [destination], entries);
  if (!opened[0]?.opened) throw new Error("Launchpad bookmark did not launch application");
  const logs = join(homedir(), "Library/Logs", BUNDLE_ID, "diagnostics");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const pid of await installedProcesses(join(destination, APP_EXECUTABLE))) {
      const directories = await readdir(logs).catch(() => []);
      for (const session of directories.filter((name) => name.startsWith("session-") && name.includes(`-${pid}-`))) {
        let events;
        try { events = (await readFile(join(logs, session, "asterlyn.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line)); }
        catch { continue; }
        if (events.some((event) => event.event === "application.frontend_ready")) return { pid, session, buildId: events[0].buildId, frontendReady: true, launchVia: "icon-bookmark" };
      }
    }
    await delay(250);
  }
  throw new Error("Installed app did not record frontend readiness after icon launch");
}

export async function installMacOSApp({ source, destination = "/Applications/Asterlyn.app", evidence }) {
  if (process.platform !== "darwin") throw new Error("Local application installer requires macOS");
  source = resolve(source); destination = resolve(destination);
  if (source === destination) throw new Error("Source and destination must differ");
  for (const path of [source, ...(await exists(destination) ? [destination] : [])]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Application roots must be real directories");
  }
  const archiveRoot = join(homedir(), "Library/Application Support/Asterlyn/archived-install-backups");
  const verifySignature = (path) => run("/usr/bin/codesign", ["--verify", "--deep", "--strict", path]);
  await verifySignature(source);
  const identity = await run("/usr/bin/codesign", ["-dvv", source]);
  if (!identity.stderr.includes(`Identifier=${BUNDLE_ID}`) || !identity.stderr.includes("Sealed Resources version=")) throw new Error("Accepted bundle identity/resources mismatch");
  const plist = join(source, "Contents/Info.plist");
  const bundleId = (await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist])).stdout.trim();
  if (bundleId !== BUNDLE_ID) throw new Error("Source bundle identifier mismatch");
  const version = (await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist])).stdout.trim();
  const executableSha256 = await hashFile(join(source, APP_EXECUTABLE));
  await quitInstalled(destination);
  const backup = await archivePrevious(destination, archiveRoot);
  const replacement = await replaceBundleContents({ source, destination,
    copyContents: (from, to) => run("/usr/bin/ditto", [from, to]),
    swapContents: (from, to) => native("swap", [from, to]),
    verify: async (path) => {
      await verifySignature(path);
      if (await hashFile(join(path, APP_EXECUTABLE)) !== executableSha256) throw new Error("Installed executable differs from accepted bundle");
    },
  });
  await run(registrationTool, ["-u", source]);
  await run(registrationTool, ["-f", destination]);
  const launchpad = await repairLaunchpad(destination, archiveRoot);
  const firstLaunch = await launchAndVerify(destination, launchpad);
  await quitInstalled(destination);
  const reopen = await launchAndVerify(destination, launchpad);
  const { bookmarkHex: _bookmark, ...launchEvidence } = launchpad;
  const result = { source, destination, version, executableSha256, backup, replacement, launchpad: launchEvidence, firstLaunch, reopen };
  if (evidence) await writeFile(resolve(evidence), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowed = new Set(["--source", "--destination", "--evidence"]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1]) throw new Error("Usage: node scripts/install-macos-app.mjs --source <signed.app> [--destination <installed.app>] [--evidence <json>]");
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.source) throw new Error("--source is required");
  console.log(JSON.stringify(await installMacOSApp(options), null, 2));
}
