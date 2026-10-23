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
  // yingfang#31（spec R1）：models / models-config / auth 三族随「模型」tab
  // 恢复，移出删除面（owner 推翻 yingfang#28 对应裁决）；terminal / worktrees /
  // web-auth 与 agent bash-output 维持删除。
  for (const path of [
    "/api/terminal", "/api/terminal/x/events", "/api/worktrees", "/api/web-auth", "/api/agent/abc/bash-output",
  ]) {
    assert.equal(passesThrough(proxy(req(path))), true, path);
  }
  // 相邻的、仍存在的面不被误放行。
  assert.equal(proxy(req("/api/modelsx")).status, 401);
  assert.equal(proxy(req("/api/agent/abc/events")).status, 401);
});

test("the removed /api/yf/llm-config answers 404 at the gate, anonymous or not (yingfang#31 verification B1)", () => {
  // 该路径落在 /api/yf/[...path] catch-all 的转发面里，放行（passesThrough）会把
  // 方法/cookie/body 逐字转发到 yingfang 的 /api/llm-config，并绕过登录门形成
  // 匿名入口。门层必须直接回 404、不转发，匿名与带 cookie 一致。
  for (const path of ["/api/yf/llm-config", "/api/yf/llm-config/sub", "/api/yf/llm-config?x=1"]) {
    const anonymous = proxy(req(path));
    assert.equal(anonymous.status, 404, `${path} anonymous`);
    assert.equal(passesThrough(anonymous), false, `${path} anonymous must not pass through`);
    const withCookie = proxy(req(path, "yf_session=t"));
    assert.equal(withCookie.status, 404, `${path} with cookie`);
    assert.equal(passesThrough(withCookie), false, `${path} with cookie must not pass through`);
  }
  // 相邻的、仍存在的 /api/yf/* 转发面不受影响（匿名 401、带 cookie 放行）。
  assert.equal(proxy(req("/api/yf/llm-configx")).status, 401);
  assert.equal(passesThrough(proxy(req("/api/yf/llm-configx", "yf_session=t"))), true);
});

test("restored models/auth families are behind the yf gate for anonymous access (yingfang#31)", () => {
  // 匿名在门层即 401；登录用户由路由内 requireOperator 管（普通用户 403）。
  for (const path of [
    "/api/models", "/api/models/default", "/api/models/enabled",
    "/api/models-config", "/api/models-config/discover", "/api/models-config/test",
    "/api/auth/providers", "/api/auth/api-key/openai",
  ]) {
    assert.equal(proxy(req(path)).status, 401, path);
  }
  // 会话在场则放行到路由（可见性归 requireOperator）。
  for (const path of ["/api/models", "/api/models-config", "/api/auth/providers"]) {
    assert.equal(passesThrough(proxy(req(path, "yf_session=t"))), true, path);
  }
});
