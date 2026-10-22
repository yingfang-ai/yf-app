import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { proxy } = await jiti.import("../../proxy.ts");
const { NextRequest } = await jiti.import("next/server");

const req = (path, cookie) => new NextRequest(`http://localhost${path}`, {
  headers: { host: "localhost", ...(cookie ? { cookie } : {}) },
});
const passesThrough = (response) => response.headers.get("x-middleware-next") === "1";

test("anonymous: pages redirect to /login, APIs are 401, register/login stay reachable", () => {
  assert.equal(proxy(req("/")).status, 307);
  assert.equal(proxy(req("/api/sessions")).status, 401);
  assert.equal(passesThrough(proxy(req("/api/yf/register"))), true);
  assert.equal(passesThrough(proxy(req("/api/yf/login"))), true);
  assert.equal(passesThrough(proxy(req("/login"))), true);
});

test("a session cookie lets everything through to the routes", () => {
  assert.equal(passesThrough(proxy(req("/api/sessions", "yf_session=t"))), true);
});

test("deleted faces answer like any missing route, anonymous or not (no 401 disguise)", () => {
  for (const path of [
    "/api/terminal", "/api/terminal/x/events", "/api/worktrees", "/api/models", "/api/models/default",
    "/api/models-config/discover", "/api/auth/providers", "/api/web-auth", "/api/agent/abc/bash-output",
  ]) {
    assert.equal(passesThrough(proxy(req(path))), true, path);
  }
  // 相邻的、仍存在的面不被误放行。
  assert.equal(proxy(req("/api/modelsx")).status, 401);
  assert.equal(proxy(req("/api/agent/abc/events")).status, 401);
});
