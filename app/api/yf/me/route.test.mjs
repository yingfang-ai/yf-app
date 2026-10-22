import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const dataRoot = mkdtempSync(path.join(tmpdir(), "yf-me-route-"));
process.env.YF_DATA_DIR = dataRoot;
process.env.YF_OPERATOR_USER_IDS = "f".repeat(32);

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET } = await jiti.import("./route.ts");
const { writeSessionIndex } = await jiti.import("../../../../lib/yf/session-index.ts");

test.after(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.YF_DATA_DIR;
  delete process.env.YF_OPERATOR_USER_IDS;
});

const get = (cookie) => {
  const headers = cookie ? { Cookie: cookie } : {};
  return GET(new Request("http://localhost/api/yf/me", { headers }));
};

test("anonymous requests are 401 with the contract envelope", async () => {
  const response = await get();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "unauthorized");
});

test("a cookie whose token is not in the index is 401 (forged/expired sessions)", async () => {
  assert.equal((await get("yf_session=no-such-token")).status, 401);
});

test("a valid index entry answers {user_id, operator} without the roster itself", async () => {
  const userId = "0".repeat(32);
  writeSessionIndex(dataRoot, "tok-plain", { user_id: userId, expires_at: "2030-01-01T00:00:00Z" });
  const response = await get("yf_session=tok-plain");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user_id, userId);
  assert.equal(payload.operator, false);
  // 响应不携带名单本身。
  assert.equal(JSON.stringify(payload).includes("f".repeat(32)), false);
});

test("an operator user_id (env union) is reported as operator", async () => {
  const operatorId = "f".repeat(32);
  writeSessionIndex(dataRoot, "tok-operator", { user_id: operatorId, expires_at: "2030-01-01T00:00:00Z" });
  const response = await get("yf_session=tok-operator");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).operator, true);
});

test("an expired session is 401", async () => {
  writeSessionIndex(dataRoot, "tok-expired", { user_id: "0".repeat(32), expires_at: "2020-01-01T00:00:00Z" });
  assert.equal((await get("yf_session=tok-expired")).status, 401);
});