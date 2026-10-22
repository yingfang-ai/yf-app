import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const dataRoot = mkdtempSync(path.join(tmpdir(), "yf-isolation-"));
process.env.YF_DATA_DIR = dataRoot;
process.env.YF_OPERATOR_USER_IDS = "0".repeat(32);
test.after(() => rmSync(dataRoot, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const dirs = await jiti.import("./user-dirs.ts");
const access = await jiti.import("./session-access.ts");
const { ownFileRoots } = await jiti.import("./file-roots.ts");
const { writeSessionIndex } = await jiti.import("./session-index.ts");
const { GET: filesGet } = await jiti.import("../../app/api/files/[...path]/route.ts");
const { NextRequest } = await jiti.import("next/server");

const U = "a".repeat(32);
const V = "b".repeat(32);
writeSessionIndex(dataRoot, "tok-u", { user_id: U, expires_at: "2030-01-01T00:00:00Z" });

test("user ids are single safe path segments", () => {
  assert.equal(dirs.isSafeUserId(U), true);
  for (const bad of ["", "../x", "a/b", "a b", "x".repeat(65)]) assert.equal(dirs.isSafeUserId(bad), false);
  assert.throws(() => dirs.userDataDir("../x"));
  assert.equal(dirs.userDataDir(U), path.join(dataRoot, "users", U));
  assert.equal(dirs.userGalleryDir(U), path.join(dataRoot, "gallery", U));
});

test("ensureUserDataDir creates the directory idempotently", () => {
  const first = dirs.ensureUserDataDir(U);
  assert.equal(dirs.ensureUserDataDir(U), first);
});

test("cwd ownership: own dir yes, another user's no, users root itself no", () => {
  const own = dirs.ensureUserDataDir(U);
  const other = dirs.ensureUserDataDir(V);
  assert.equal(dirs.isOwnDataCwd(U, own), true);
  assert.equal(dirs.isOwnDataCwd(U, path.join(own, "sub")), true);
  assert.equal(dirs.isOwnDataCwd(U, other), false);
  assert.equal(dirs.isUserDataCwd(other), true);
  assert.equal(dirs.isUserDataCwd(dirs.usersRoot()), false);
  assert.equal(dirs.isUserDataCwd(dataRoot), false);
  assert.equal(dirs.isUserDataCwd(tmpdir()), false);
});

test("session visibility: operator sees all, a user only sessions in their own dir", () => {
  const user = { userId: U, operator: false };
  const operator = { userId: "0".repeat(32), operator: true };
  const sessions = [
    { id: "mine", cwd: dirs.ensureUserDataDir(U) },
    { id: "theirs", cwd: dirs.ensureUserDataDir(V) },
    { id: "elsewhere", cwd: tmpdir() },
    { id: "nocwd" },
  ];
  assert.deepEqual(access.filterSessionsFor(user, sessions).map((s) => s.id), ["mine"]);
  assert.deepEqual(access.filterSessionsFor(operator, sessions).map((s) => s.id), ["mine", "theirs", "elsewhere", "nocwd"]);
});

test("files roots for a user are only their data dir and gallery", () => {
  const roots = [...ownFileRoots(U)].sort();
  assert.equal(roots.length, 2);
  assert.ok(roots.some((r) => r.endsWith(`/users/${U}`)));
  assert.ok(roots.some((r) => r.endsWith(`/gallery/${U}`)));
});

function filesRequest(filePath, cookie) {
  const encoded = filePath.split("/").filter(Boolean).map(encodeURIComponent);
  return [
    new NextRequest(`http://localhost/api/files/${encoded.join("/")}?type=list`, {
      headers: { host: "localhost", ...(cookie ? { cookie } : {}) },
    }),
    { params: Promise.resolve({ path: encoded.map(decodeURIComponent) }) },
  ];
}

test("files API: a user lists their own dir, not another user's, not the host; anonymous is 401", async () => {
  const own = dirs.ensureUserDataDir(U);
  const other = dirs.ensureUserDataDir(V);
  writeFileSync(path.join(other, "secret.txt"), "x");
  mkdirSync(path.join(dataRoot, "gallery", U), { recursive: true });
  assert.equal((await filesGet(...filesRequest(own, "yf_session=tok-u"))).status, 200);
  assert.equal((await filesGet(...filesRequest(path.join(dataRoot, "gallery", U), "yf_session=tok-u"))).status, 200);
  assert.equal((await filesGet(...filesRequest(other, "yf_session=tok-u"))).status, 403);
  assert.equal((await filesGet(...filesRequest(tmpdir(), "yf_session=tok-u"))).status, 403);
  assert.equal((await filesGet(...filesRequest(own))).status, 401);
});
