import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const dataRoot = mkdtempSync(path.join(tmpdir(), "yf-route-policy-"));
process.env.YF_DATA_DIR = dataRoot;
process.env.YF_OPERATOR_USER_IDS = "f".repeat(32);

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const {
  OPERATOR_ONLY_ROUTE_PREFIXES,
  isOperatorOnlyRoute,
  requireOperator,
} = await jiti.import("./route-policy.ts");
const { writeSessionIndex } = await jiti.import("./session-index.ts");

const OPERATOR = "f".repeat(32);
const ORDINARY = "0".repeat(32);

test.after(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.YF_DATA_DIR;
  delete process.env.YF_OPERATOR_USER_IDS;
});

const requestWith = (cookie) =>
  new Request("http://localhost/api/skills", {
    headers: cookie ? { Cookie: cookie } : {},
  });

test("the operator-only table covers the wired route families (A5 实查清单)", () => {
  const expected = [
    "/api/skills", "/api/plugins", "/api/app-update", "/api/cwd", "/api/default-cwd",
    "/api/home", "/api/fs-manage", "/api/open-in-explorer", "/api/polyforge",
    "/api/project-trust", "/api/git", "/api/file-index", "/api/tools/settings",
    "/api/provider-usage", "/api/subagents", "/api/push",
  ];
  assert.deepEqual([...OPERATOR_ONLY_ROUTE_PREFIXES].sort(), [...expected].sort());
  // 全族前缀匹配：嵌套路由同样命中。
  assert.equal(isOperatorOnlyRoute("/api/skills"), true);
  assert.equal(isOperatorOnlyRoute("/api/skills/install"), true);
  assert.equal(isOperatorOnlyRoute("/api/skills/install/x"), true);
  assert.equal(isOperatorOnlyRoute("/api/polyforge/status"), true);
  assert.equal(isOperatorOnlyRoute("/api/git/status"), true);
  assert.equal(isOperatorOnlyRoute("/api/push/config"), true);
  assert.equal(isOperatorOnlyRoute("/api/push/subscribe"), true);
  // 非表内路由不命中（不误伤保留面）。
  assert.equal(isOperatorOnlyRoute("/api/sessions"), false);
  assert.equal(isOperatorOnlyRoute("/api/agent/new"), false);
  assert.equal(isOperatorOnlyRoute("/api/yf/llm-config"), false);
  assert.equal(isOperatorOnlyRoute("/api/skillsx"), false);
});

test("requireOperator: anonymous → 401 (yf 门兜底)", async () => {
  const denied = await requireOperator(requestWith(null));
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, "unauthorized");
});

test("requireOperator: ordinary user → 403 (A2: 权限不足，不用 404 反枚举)", async () => {
  writeSessionIndex(dataRoot, "tok-ordinary", { user_id: ORDINARY, expires_at: "2030-01-01T00:00:00Z" });
  const denied = await requireOperator(requestWith("yf_session=tok-ordinary"));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "forbidden");
});

test("requireOperator: operator → null (放行)", async () => {
  writeSessionIndex(dataRoot, "tok-operator", { user_id: OPERATOR, expires_at: "2030-01-01T00:00:00Z" });
  assert.equal(await requireOperator(requestWith("yf_session=tok-operator")), null);
});

test("requireOperator: forged token → 401 (fail closed)", async () => {
  assert.equal((await requireOperator(requestWith("yf_session=forged-token"))).status, 401);
});