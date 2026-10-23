import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceBundleContents, planLaunchpadRepair, launchpadRepairSQL } from "./install-macos-app.mjs";

const execute = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "asterlyn-install-test-"));
  const source = join(root, "accepted.app"), destination = join(root, "Asterlyn.app");
  for (const [bundle, text] of [[source, "new"], [destination, "old"]]) {
    await mkdir(join(bundle, "Contents"), { recursive: true });
    await writeFile(join(bundle, "Contents/executable"), text);
  }
  const copyContents = (from, to) => cp(from, to, { recursive: true });
  // Portable exchange simulation; the macOS test below exercises the actual atomic syscall.
  const swapContents = async (from, to) => {
    const temporary = `${from}.swap`;
    await rename(from, temporary); await rename(to, from); await rename(temporary, to);
  };
  return { root, source, destination, copyContents, swapContents, verify: async () => {} };
}

test("replacement preserves the .app identity and existing icon position while changing Contents", async () => {
  const f = await fixture();
  try {
    const inode = (await lstat(f.destination)).ino;
    const result = await replaceBundleContents(f);
    assert.equal(result.rootIdentityPreserved, true);
    assert.equal((await lstat(f.destination)).ino, inode);
    assert.equal(await readFile(join(f.destination, "Contents/executable"), "utf8"), "new");
    assert.ok(!(await readdir(f.root)).some((name) => name.startsWith(".asterlyn-install-")));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("failed verification restores previous Contents without changing the application root", async () => {
  const f = await fixture();
  try {
    const inode = (await lstat(f.destination)).ino;
    await assert.rejects(replaceBundleContents({ ...f, verify: async () => { throw Error("signature failure"); } }), /signature failure/);
    assert.equal((await lstat(f.destination)).ino, inode);
    assert.equal(await readFile(join(f.destination, "Contents/executable"), "utf8"), "old");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("copy failure and symlink destinations cannot damage the installed app", async () => {
  const f = await fixture();
  try {
    await assert.rejects(replaceBundleContents({ ...f, copyContents: async () => { throw Error("disk failure"); } }), /disk failure/);
    assert.equal(await readFile(join(f.destination, "Contents/executable"), "utf8"), "old");
    const alias = join(f.root, "alias.app");
    await symlink(f.destination, alias, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(replaceBundleContents({ ...f, destination: alias }), /symlink/);
    await assert.rejects(replaceBundleContents({ ...f, destination: f.source }), /must differ/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("failed rollback retains recoverable old Contents instead of deleting them", async () => {
  const f = await fixture();
  let swaps = 0;
  try {
    await assert.rejects(replaceBundleContents({ ...f,
      swapContents: async (...args) => { if (++swaps === 2) throw Error("rollback blocked"); await f.swapContents(...args); },
      verify: async () => { throw Error("bad replacement"); },
    }), /Recovery contents retained/);
    const stages = (await readdir(f.root)).filter((name) => name.startsWith(".asterlyn-install-"));
    assert.equal(stages.length, 1);
    assert.equal(await readFile(join(f.root, stages[0], "Contents/executable"), "utf8"), "old");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("launch repair replaces a folder bookmark and removes only duplicate Asterlyn entries", () => {
  const rows = [
    { item_id: 145, bundleid: "dev.asterlyn.desktop" },
    { item_id: 160, bundleid: "dev.asterlyn.desktop" },
    { item_id: 12, bundleid: "another.application" },
  ];
  const plan = planLaunchpadRepair(rows, [
    { item_id: 145, path: "/backups/Asterlyn.app.backup-old", isApplication: false },
    { item_id: 160, path: "/Applications/Asterlyn.app", isApplication: true, stale: false },
  ], "/Applications/Asterlyn.app");
  assert.deepEqual(plan, { keepId: 145, removeIds: [160], staleIds: [145] });
  assert.equal(planLaunchpadRepair([rows[2]], [], "/Applications/Asterlyn.app"), null);
  assert.throws(() => launchpadRepairSQL({ keepId: "1;DELETE FROM apps" }, "00", 1), /Invalid/);
});

test("launch SQL is transactional, preserves unrelated icons, and fails closed on schema drift", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "asterlyn-launch-db-test-"));
  const database = join(root, "db");
  const sql = (text) => execute("/usr/bin/sqlite3", ["-json", database, text]);
  const schema = `CREATE TABLE items(rowid INTEGER PRIMARY KEY, ordering INTEGER);
    CREATE TABLE apps(item_id INTEGER PRIMARY KEY,title TEXT,bundleid TEXT,bookmark BLOB);
    INSERT INTO items VALUES(145,1),(160,2),(200,3);
    INSERT INTO apps VALUES(145,'Asterlyn','dev.asterlyn.desktop',X'01'),(160,'Asterlyn','dev.asterlyn.desktop',X'02'),(200,'Other','another.app',X'03');`;
  try {
    await sql(schema);
    await assert.rejects(sql(launchpadRepairSQL({ keepId: 145 }, "AABB", 1)), /CHECK constraint/);
    assert.equal(JSON.parse((await sql("SELECT hex(bookmark) AS value FROM apps WHERE item_id=145")).stdout)[0].value, "01");
    await sql("CREATE TRIGGER item_deleted AFTER DELETE ON items BEGIN DELETE FROM apps WHERE item_id=old.rowid; END;");
    await sql(launchpadRepairSQL({ keepId: 145 }, "AABB", 1));
    const rows = JSON.parse((await sql("SELECT item_id,hex(bookmark) AS value FROM apps ORDER BY item_id")).stdout);
    assert.deepEqual(rows, [{ item_id: 145, value: "AABB" }, { item_id: 200, value: "03" }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("macOS exchanges Contents atomically while retaining the bundle root inode", { skip: process.platform !== "darwin" }, async () => {
  const f = await fixture();
  try {
    await replaceBundleContents({ ...f, swapContents: (from, to) => execute("/usr/bin/swift", [new URL("./macos-app-tools.swift", import.meta.url).pathname, "swap", from, to]) });
    assert.equal(await readFile(join(f.destination, "Contents/executable"), "utf8"), "new");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
