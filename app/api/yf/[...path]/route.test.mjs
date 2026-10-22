import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// 契约桩（api-contract §2 形态的最小子集）：记录收到的请求，按脚本应答。
const upstreamRequests = [];
const stub = createServer((req, res) => {
  let chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    upstreamRequests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === "/api/login") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": "yf_session=tok123; HttpOnly; SameSite=Lax; Path=/",
      });
      return res.end(JSON.stringify({ user_id: "a".repeat(32), expires_at: "2030-01-01T00:00:00Z" }));
    }
    if (req.url === "/api/register") {
      // 契约错误信封原样透传（404 invite_not_found）。
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: { code: "invite_not_found", message: "邀请码不存在" } }));
    }
    if (req.url === "/api/logout") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": "yf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url === "/api/rounds/abc?x=1") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ state: "done" }));
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "资源不存在" } }));
  });
});
await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
const upstreamPort = stub.address().port;
process.env.YF_API_UPSTREAM = `http://127.0.0.1:${upstreamPort}`;
const dataRoot = mkdtempSync(path.join(tmpdir(), "yf-proxy-route-"));
process.env.YF_DATA_DIR = dataRoot;

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET, POST } = await jiti.import("./route.ts");
const {
  readSessionIndex,
  writeSessionIndex,
} = await jiti.import("../../../../lib/yf/session-index.ts");

const context = (segments) => ({ params: Promise.resolve({ path: segments }) });

test.after(() => {
  stub.closeAllConnections?.();
  stub.close();
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.YF_API_UPSTREAM;
  delete process.env.YF_DATA_DIR;
});

test("login passes through status/body/Set-Cookie verbatim and writes the session index", async () => {
  const { NextRequest } = await jiti.import("next/server");
  const response = await POST(
    new NextRequest("http://localhost/api/yf/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "other=1" },
      body: JSON.stringify({ user_id: "a".repeat(32), recovery: "recovery-1" }),
    }),
    context(["login"]),
  );
  assert.equal(response.status, 200);
  const setCookies = response.headers.getSetCookie();
  assert.equal(setCookies[0], "yf_session=tok123; HttpOnly; SameSite=Lax; Path=/");
  assert.equal((await response.json()).user_id, "a".repeat(32));
  // 上游收到逐字转发的 cookie 与请求体。
  assert.equal(upstreamRequests.at(-1).url, "/api/login");
  assert.equal(upstreamRequests.at(-1).headers.cookie, "other=1");
  assert.deepEqual(JSON.parse(upstreamRequests.at(-1).body), { user_id: "a".repeat(32), recovery: "recovery-1" });
  // 服务端顺手落了 session index（D2）。
  assert.deepEqual(readSessionIndex(dataRoot, "tok123"), {
    user_id: "a".repeat(32),
    expires_at: "2030-01-01T00:00:00Z",
  });
});

test("register (pre-auth, anonymous) passes the contract error envelope through unchanged", async () => {
  const { NextRequest } = await jiti.import("next/server");
  const response = await POST(
    new NextRequest("http://localhost/api/yf/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite_code: "no-such", recovery: "recovery-1" }),
    }),
    context(["register"]),
  );
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error.code, "invite_not_found");
  assert.equal(payload.error.message, "邀请码不存在");
});

test("logout deletes the session index for the request cookie", async () => {
  const { NextRequest } = await jiti.import("next/server");
  writeSessionIndex(dataRoot, "tok123", { user_id: "a".repeat(32), expires_at: "2030-01-01T00:00:00Z" });
  const response = await POST(
    new NextRequest("http://localhost/api/yf/logout", {
      method: "POST",
      headers: { Cookie: "yf_session=tok123" },
    }),
    context(["logout"]),
  );
  assert.equal(response.status, 200);
  assert.equal(readSessionIndex(dataRoot, "tok123"), null);
});

test("GET forwards the query string and method verbatim", async () => {
  const { NextRequest } = await jiti.import("next/server");
  const response = await GET(
    new NextRequest("http://localhost/api/yf/rounds/abc?x=1"),
    context(["rounds", "abc"]),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, "done");
  assert.equal(upstreamRequests.at(-1).method, "GET");
  assert.equal(upstreamRequests.at(-1).url, "/api/rounds/abc?x=1");
});