// yf-behavior.mjs — e2e-authored BEHAVIOR bar for yingfang#28 (wi_EAgzJttOcVUv).
//
// Authored by the e2e-author lane against `artifacts/spec.md` (R3/R5/R7/R8/R9/R10
// + R17's four new-form faces) BEFORE the implementation ("code") step ran.
// Every scenario encodes a spec acceptance criterion for NEW behaviour; the
// regression guards for behaviour the merge reintroduces stay in
// e2e/yf-acceptance.mjs (see artifacts/e2e-scenarios.md for the split).
//
// Run (from repos/yf-app, after `npm ci`):
//   node e2e/yf-behavior.mjs
//
// Style follows e2e/yf-acceptance.mjs: self-managed Next dev server on a free
// loopback port, fixtures in temp dirs, no credentials. The yingfang contract
// (api-contract §2) is stubbed IN-TEST (spec R17: 测试内自带的契约桩) — the
// suite never talks to a running yingfang. The stub listens on an ephemeral
// port; the dev server reaches it through the `YF_API_UPSTREAM` test seam.
//
// Test seams this bar REQUIRES of the implementation (defaults per plan D1/D3):
//   YF_API_UPSTREAM        — /api/yf/[...path] proxy target (default http://127.0.0.1:9701)
//   YF_OPERATOR_USER_IDS   — comma list of operator user_ids, union with config/operators.json
//   YF_DATA_DIR            — data root (plan D3; gallery + per-user dirs live under it)
//
// Expected result on the pre-implementation tree: RED at the assertion level
// for every scenario below (that is the bar the baseline lays down). Scenario
// IDs (S-Bxx) are keyed 1:1 to artifacts/e2e-scenarios.md.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, rmSync, statSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "test-results", "e2e-yf-behavior");
mkdirSync(artifacts, { recursive: true });

// Fixed operator user_id: the contract stub returns it deterministically for
// the operator invite, so the suite can name it in YF_OPERATOR_USER_IDS up
// front (32 hex chars, contract §2.1 id shape).
const OPERATOR_INVITE = "e2e-operator-invite";
const OPERATOR_USER_ID = "e2ee0a00" + "0".repeat(22) + "aa";
const GUIDE_MARKER = "YF-GUIDE-SKILL";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
  "0000000d4944415478da63fcffff3f0300050201f104a2c9d0000000049454e44ae426082",
  "hex",
);
const hexId = () => createHash("sha256").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 32);
const INVITES = new Map([
  [OPERATOR_INVITE, 5],
  ["e2e-invite-a", 5], ["e2e-invite-b", 5], ["e2e-invite-c", 5],
  ["e2e-invite-d", 5], ["e2e-invite-e", 5], ["e2e-invite-f", 5], ["e2e-invite-g", 5],
]);

const results = [];
async function record(id, title, fn) {
  try {
    await fn();
    results.push({ id, title, ok: true });
    console.log(`PASS ${id} ${title}`);
  } catch (error) {
    results.push({ id, title, ok: false });
    console.log(`FAIL ${id} ${title}\n     ${error?.message ?? error}`);
  }
}

// ---------------------------------------------------------------------------
// yingfang contract stub (api-contract §2, JSON-only, closed error envelope)
// ---------------------------------------------------------------------------
function contractStub() {
  const users = new Map(); // user_id -> { recovery }
  const inviteUses = new Map([...INVITES].map(([code]) => [code, 0]));
  const sessions = new Map(); // token -> user_id
  const convs = new Map(); // conv_id -> user_id
  const rounds = new Map(); // round_id -> { convId, userId, state, n, polls, terminal }
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, message) => send(res, status, { error: { code, message } });
  const auth = (req) => {
    const token = /(?:^|;\s*)yf_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    return token ? sessions.get(token) ?? null : null;
  };
  const now = () => new Date().toISOString();

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://stub");
      const path = url.pathname;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      if (raw) {
        try { body = JSON.parse(raw); } catch { return fail(res, 400, "invalid_json", "请求体不是合法 JSON"); }
      }
      if (path === "/api/register" && req.method === "POST") {
        const code = body?.invite_code;
        if (typeof code !== "string" || !INVITES.has(code)) {
          return fail(res, 404, "invite_not_found", "邀请码不存在");
        }
        if ((inviteUses.get(code) ?? 0) >= INVITES.get(code)) {
          return fail(res, 409, "invite_exhausted", "邀请码名额已满");
        }
        if (typeof body?.recovery !== "string" || body.recovery.length < 8) {
          return fail(res, 400, "bad_request", "recovery 至少 8 字符");
        }
        inviteUses.set(code, (inviteUses.get(code) ?? 0) + 1);
        const userId = code === OPERATOR_INVITE ? OPERATOR_USER_ID : hexId();
        users.set(userId, { recovery: body.recovery });
        return send(res, 201, { user_id: userId });
      }
      if (path === "/api/login" && req.method === "POST") {
        const user = users.get(body?.user_id);
        if (!user || user.recovery !== body?.recovery) {
          return fail(res, 401, "unauthorized", "登录凭据不正确");
        }
        const token = hexId();
        sessions.set(token, body.user_id);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": `yf_session=${token}; HttpOnly; SameSite=Lax; Path=/`,
        });
        return res.end(JSON.stringify({ user_id: body.user_id, expires_at: now() }));
      }
      if (path === "/api/logout" && req.method === "POST") {
        const token = /(?:^|;\s*)yf_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
        if (token) sessions.delete(token);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": "yf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        });
        return res.end(JSON.stringify({ ok: true }));
      }
      const userId = auth(req);
      if (path === "/api/convs" && req.method === "POST") {
        if (!userId) return fail(res, 401, "unauthorized", "未登录");
        const convId = hexId();
        convs.set(convId, userId);
        return send(res, 201, { conv_id: convId });
      }
      let match = /^\/api\/convs\/([0-9a-f]{32})\/rounds$/.exec(path);
      if (match && req.method === "POST") {
        if (!userId) return fail(res, 401, "unauthorized", "未登录");
        if (convs.get(match[1]) !== userId) return fail(res, 404, "not_found", "资源不存在");
        if (body?.backend_id !== "zimage-turbo") {
          return send(res, 400, { error: { code: "bad_request", message: "入队闸拒绝", details: [
            { kind: "submit", field: "backend_id", detail: "未知 backend_id" },
          ] } });
        }
        if (!Number.isInteger(body?.n) || body.n < 1 || body.n > 8) {
          return send(res, 400, { error: { code: "bad_request", message: "入队闸拒绝", details: [
            { kind: "submit", field: "n", detail: "n 越界" },
          ] } });
        }
        const roundId = hexId();
        rounds.set(roundId, {
          convId: match[1], userId, state: "queued", n: body.n, polls: 0,
          terminal: typeof body?.prompt === "string" && body.prompt.includes("E2E-FAIL") ? "failed" : "done",
        });
        return send(res, 202, {
          round_id: roundId, backend_id: "zimage-turbo", n: body.n,
          unit_price_micros: 1_000_000, hold_micros: 1_000_000 * body.n, enqueued_at: now(),
        });
      }
      match = /^\/api\/rounds\/([0-9a-f]{32})$/.exec(path);
      if (match && req.method === "GET") {
        if (!userId) return fail(res, 401, "unauthorized", "未登录");
        const round = rounds.get(match[1]);
        if (!round || round.userId !== userId) return fail(res, 404, "not_found", "资源不存在");
        round.polls += 1;
        if (round.polls >= 2) round.state = round.terminal;
        else if (round.polls >= 1) round.state = "running";
        return send(res, 200, {
          conv_id: round.convId, parent_round_id: null, branch_kind: "refine",
          state: round.state, n: round.n, backend_id: "zimage-turbo",
          hold_micros: 1_000_000 * round.n, enqueued_at: now(),
          ...(round.polls >= 2 ? { finished_at: now() } : {}),
        });
      }
      match = /^\/api\/rounds\/([0-9a-f]{32})\/images\/(\d+)\/(\d+)\/presign$/.exec(path);
      if (match && req.method === "POST") {
        if (!userId) return fail(res, 401, "unauthorized", "未登录");
        const round = rounds.get(match[1]);
        if (!round || round.userId !== userId || round.state !== "done" || Number(match[2]) >= round.n) {
          return fail(res, 404, "not_found", "资源不存在");
        }
        return send(res, 200, {
          round_id: match[1], idx: Number(match[2]), epoch: Number(match[3]),
          url: `http://127.0.0.1:${server.address().port}/images/${match[1]}/${match[2]}.png`,
          expires_at: now(),
        });
      }
      match = /^\/images\/([0-9a-f]{32})\/(\d+)\.png$/.exec(path);
      if (match && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end(PNG);
      }
      return fail(res, 404, "not_found", "资源不存在");
    })().catch(() => fail(res, 500, "internal", "桩内部错误"));
  });
  return server;
}

// LLM stub: records every POST body (the guide-skill marker is observed here),
// answers with an OpenAI-shaped completion (streaming only if asked).
function llmStub() {
  const requests = [];
  const server = createServer((req, res) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method, url: req.url, body });
      if (req.method !== "POST") {
        res.writeHead(405); return res.end();
      }
      let wantsStream = false;
      try { wantsStream = JSON.parse(body)?.stream === true; } catch { /* 忽略 */ }
      const message = { role: "assistant", content: "（引导桩回复）这是一段测试回复。" };
      if (wantsStream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: message.content } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-e2e", object: "chat.completion", created: Date.now() / 1000, model: "e2e-model",
        choices: [{ index: 0, message, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    })().catch(() => { res.writeHead(500); res.end(); });
  });
  return { server, requests };
}

async function main() {
  if (!existsSync(join(root, "node_modules", "next"))) {
    console.error("node_modules missing — run `npm ci` in repos/yf-app first");
    process.exit(1);
  }
  if (existsSync(join(root, ".next/dev/lock"))) {
    console.error("An active dev server holds .next/dev/lock — run in a checkout without one");
    process.exit(1);
  }

  const dataDir = mkdtempSync(join(tmpdir(), "yf-behavior-data-"));
  const agentDir = mkdtempSync(join(tmpdir(), "yf-behavior-agent-"));

  // Contract + LLM stubs on ephemeral loopback ports.
  const contract = contractStub();
  await new Promise((resolve, reject) => {
    contract.once("error", reject);
    contract.listen(0, "127.0.0.1", resolve);
  });
  const contractUrl = `http://127.0.0.1:${contract.address().port}`;
  const { server: llm, requests: llmRequests } = llmStub();
  await new Promise((resolve, reject) => {
    llm.once("error", reject);
    llm.listen(0, "127.0.0.1", resolve);
  });
  const llmUrl = `http://127.0.0.1:${llm.address().port}`;

  // Dev server on a free port (same lifecycle as e2e/yf-acceptance.mjs).
  const serverLog = createWriteStream(join(artifacts, "server.log"));
  let server;
  let serverError;
  let base;
  for (let attempt = 0; ; attempt++) {
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: root,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_WEB_PASSWORD: "",
        NEXT_TELEMETRY_DISABLED: "1",
        YF_DATA_DIR: dataDir,
        YF_API_UPSTREAM: contractUrl,
        YF_OPERATOR_USER_IDS: OPERATOR_USER_ID,
        // yingfang#31：S-B02/S-B03 经「模型」面配默认模型，运营者 cwd 走登记前缀
        // （/api/models/default 的 cwd 守卫与 /api/agent/new 同一事实）。
        PI_WEB_ALLOWED_ROOT_PREFIXES: root,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.once("error", (error) => { serverError = error; });
    server.stdout.pipe(serverLog, { end: false });
    server.stderr.pipe(serverLog, { end: false });
    const deadline = Date.now() + 240_000;
    let responded = false;
    while (true) {
      if (serverError) throw serverError;
      if (server.exitCode !== null) break;
      const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (response) { responded = true; break; }
      if (Date.now() > deadline) throw new Error("server readiness timed out; see test-results/e2e-yf-behavior/server.log");
      await delay(500);
    }
    if (responded) break;
    assert.ok(attempt < 4, `server kept exiting before readiness; see test-results/e2e-yf-behavior/server.log`);
  }

  try {
    // -- helpers -------------------------------------------------------------
    async function call(method, path, body, cookie) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* 非 JSON（如 Next 的 404 页）：保留文本 */ }
      const cookies = response.headers.getSetCookie?.() ?? [];
      return { status: response.status, text, json, cookies };
    }
    const yf = (method, path, body, cookie) => call(method, `/api/yf${path}`, body, cookie);
    const cookieOf = (login) => {
      const line = login.cookies.find((c) => c.startsWith("yf_session=")) ?? "";
      const token = line.split("=")[1]?.split(";")[0];
      assert.ok(token, `login did not set a yf_session cookie: ${JSON.stringify(login.cookies)}`);
      return `yf_session=${token}`;
    };
    async function register(invite, recovery) {
      const reg = await yf("POST", "/register", { invite_code: invite, recovery });
      assert.equal(reg.status, 201, `register(${invite}) -> ${reg.status}: ${reg.text.slice(0, 200)}`);
      assert.match(String(reg.json?.user_id), /^[0-9a-f]{32}$/);
      return reg.json.user_id;
    }
    async function login(userId, recovery) {
      const login = await yf("POST", "/login", { user_id: userId, recovery });
      assert.equal(login.status, 200, `login -> ${login.status}: ${login.text.slice(0, 200)}`);
      return cookieOf(login);
    }
    async function poll(roundId, cookie) {
      for (let i = 0; i < 20; i++) {
        const poll = await yf("GET", `/rounds/${roundId}`, undefined, cookie);
        assert.equal(poll.status, 200, `GET /rounds/${roundId} -> ${poll.status}`);
        if (["done", "failed", "cancelled"].includes(poll.json?.state)) return poll.json;
        await delay(100);
      }
      assert.fail(`round ${roundId} did not reach a terminal state`);
    }

    // -- S-B01 账号面 ----------------------------------------------------------
    await record("S-B01", "邀请码注册与登录建立 yf_session 会话", async () => {
      const badInvite = await yf("POST", "/register", { invite_code: "no-such-invite", recovery: "recovery-0000" });
      assert.equal(badInvite.status, 404, `unknow invite -> ${badInvite.status}`);
      assert.equal(badInvite.json?.error?.code, "invite_not_found");
      const shortRecovery = await yf("POST", "/register", { invite_code: "e2e-invite-a", recovery: "short" });
      assert.equal(shortRecovery.status, 400);
      assert.equal(shortRecovery.json?.error?.code, "bad_request");
      const userId = await register("e2e-invite-a", "recovery-sb01");
      const wrong = await yf("POST", "/login", { user_id: "0".repeat(32), recovery: "recovery-sb01" });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.json?.error?.code, "unauthorized");
      const login = await yf("POST", "/login", { user_id: userId, recovery: "recovery-sb01" });
      assert.equal(login.status, 200);
      assert.equal(login.json?.user_id, userId);
      const setCookie = login.cookies.find((c) => c.startsWith("yf_session=")) ?? "";
      assert.ok(/(^|;\s)HttpOnly(;|$)/.test(setCookie), `yf_session cookie not HttpOnly: ${setCookie}`);
      const cookie = cookieOf(login);
      const me = await yf("GET", "/me", undefined, cookie);
      assert.equal(me.status, 200, `GET /api/yf/me -> ${me.status}`);
      assert.equal(me.json?.user_id, userId);
      assert.equal(me.json?.operator, false);
      assert.equal((await yf("GET", "/me")).status, 401);
      assert.equal((await yf("POST", "/logout", undefined, cookie)).status, 200);
      assert.equal((await yf("GET", "/me", undefined, cookie)).status, 401, "登出后旧会话仍有效");
    });

    // -- S-B02 「模型」面（yingfang#31 改写：原单一通道已删，断言改指新面） --------
    await record("S-B02", "「模型」面仅运营者可配、key 只写不回显、默认模型可设", async () => {
      const opId = await register(OPERATOR_INVITE, "recovery-sb02");
      assert.equal(opId, OPERATOR_USER_ID, "运营者邀请没有返回固定 user_id");
      const opCookie = await login(OPERATOR_USER_ID, "recovery-sb02");
      const me = await yf("GET", "/me", undefined, opCookie);
      assert.equal(me.json?.operator, true, "固定运营者 user_id 未被判定为运营者");
      // 旧通道已整体移除（AC1）：直访一律 404，不再有降级路径。
      assert.equal((await yf("GET", "/llm-config", undefined, opCookie)).status, 404);
      assert.equal((await yf("PUT", "/llm-config",
        { base_url: llmUrl, key: "x", model_id: "y" }, opCookie)).status, 404);
      // 运营者经「模型」面配置自定义 provider（models-config PUT/GET）。
      const put = await call("PUT", "/api/models-config", {
        providers: {
          "e2e-sb": {
            baseUrl: llmUrl, api: "openai-completions", apiKey: "e2e-key-xyz",
            models: [{ id: "e2e-model", name: "E2E 模型" }],
          },
        },
      }, opCookie);
      assert.ok(put.status >= 200 && put.status < 300, `PUT /api/models-config -> ${put.status}: ${put.text.slice(0, 200)}`);
      const got = await call("GET", "/api/models-config", undefined, opCookie);
      assert.equal(got.status, 200, `GET /api/models-config -> ${got.status}`);
      const entry = got.json?.providers?.["e2e-sb"];
      assert.ok(entry, `models-config 读回缺 e2e-sb: ${got.text.slice(0, 200)}`);
      assert.equal(entry.baseUrl, llmUrl);
      assert.equal(entry.key_configured, true, "读回缺「已配置」标记");
      assert.ok(!got.text.includes("e2e-key-xyz"), "models-config 读回出现了 key 字节");
      // 全站默认模型写入（「设为默认」）。
      const def = await call("PUT", "/api/models/default",
        { cwd: root, provider: "e2e-sb", modelId: "e2e-model" }, opCookie);
      assert.ok(def.status >= 200 && def.status < 300, `PUT /api/models/default -> ${def.status}: ${def.text.slice(0, 200)}`);
      // 可见性边界（AC5 的代表探针；全族见 yf-models-behavior S-M07）。
      const userId = await register("e2e-invite-b", "recovery-sb02u");
      const userCookie = await login(userId, "recovery-sb02u");
      assert.equal((await call("GET", "/api/models-config", undefined, userCookie)).status, 403);
      assert.equal((await call("PUT", "/api/models-config", {}, userCookie)).status, 403);
      assert.equal((await call("PUT", "/api/models/default", {}, userCookie)).status, 403);
      assert.equal((await call("GET", "/api/models-config")).status, 401);
    });

    // -- S-B03 新对话默认进入引导 skill ----------------------------------------
    await record("S-B03", "新对话默认进入引导 skill", async () => {
      const skillPath = join(root, "config", "guide-skill", "SKILL.md");
      const skill = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";
      assert.ok(skill, "config/guide-skill/SKILL.md 不存在");
      assert.ok(skill.includes(GUIDE_MARKER), `SKILL.md 缺少稳定标记 ${GUIDE_MARKER}（e2e 观测锚）`);
      assert.ok(skill.includes("草案"), "SKILL.md 未定义草案产出");
      const opCookie = await login(OPERATOR_USER_ID, "recovery-sb02");
      // yingfang#31：S-B02 已配好 provider 与全站默认模型，这里只需确认新会话的
      // LLM 请求带引导 skill 标记（模型经默认模型解析，不再有单独通道）。
      const put = await call("PUT", "/api/models/default",
        { cwd: root, provider: "e2e-sb", modelId: "e2e-model" }, opCookie);
      assert.ok(put.status >= 200 && put.status < 300, `PUT /api/models/default -> ${put.status}: ${put.text.slice(0, 200)}`);
      const userId = await register("e2e-invite-c", "recovery-sb03");
      const cookie = await login(userId, "recovery-sb03");
      llmRequests.length = 0;
      const userDir = join(dataDir, "users", userId);
      const created = await call("POST", "/api/agent/new", { cwd: userDir, type: "ensure_session" }, cookie);
      assert.equal(created.status, 200, `POST /api/agent/new -> ${created.status}: ${created.text.slice(0, 200)}`);
      const sessionId = created.json?.sessionId;
      assert.ok(typeof sessionId === "string" && sessionId.length > 0, "agent/new did not return a sessionId");
      const sent = await call("POST", `/api/agent/${encodeURIComponent(sessionId)}`,
        { type: "prompt", message: "我想画一张测试图" }, cookie);
      assert.ok(sent, "prompt dispatch failed before any LLM call");
      const deadline = Date.now() + 30_000;
      let hit = null;
      while (Date.now() < deadline && !hit) {
        hit = llmRequests.find((r) => r.body.includes(GUIDE_MARKER)) ?? null;
        if (!hit) await delay(250);
      }
      assert.ok(hit, "新会话的 LLM 请求里没有引导 skill 标记（默认进入未成立或会话模型未走通道）");
    });

    // -- S-B04 下单到终态 -------------------------------------------------------
    await record("S-B04", "下单到终态：以登录用户身份提交并 GET-only 轮询", async () => {
      const userId = await register("e2e-invite-d", "recovery-sb04");
      const cookie = await login(userId, "recovery-sb04");
      const conv = await yf("POST", "/convs", undefined, cookie);
      assert.equal(conv.status, 201, `POST /api/yf/convs -> ${conv.status}`);
      const convId = conv.json?.conv_id;
      assert.match(String(convId), /^[0-9a-f]{32}$/);
      const payload = { conv_id: convId, branch_kind: "refine", backend_id: "zimage-turbo", prompt: "一只测试猫", n: 2, seed: 7 };
      const submit = await yf("POST", `/convs/${convId}/rounds`, payload, cookie);
      assert.equal(submit.status, 202, `submit -> ${submit.status}: ${submit.text.slice(0, 200)}`);
      assert.match(String(submit.json?.round_id), /^[0-9a-f]{32}$/);
      assert.equal(typeof submit.json?.hold_micros, "number");
      assert.ok(submit.json.hold_micros > 0, "下单响应缺 hold_micros（冻结额度）");
      const round = await poll(submit.json.round_id, cookie);
      assert.equal(round.state, "done", `round state: ${round.state}`);
      assert.ok(round.finished_at, "done 轮缺 finished_at");
      const presign = await yf("POST", `/rounds/${submit.json.round_id}/images/0/0/presign`, undefined, cookie);
      assert.equal(presign.status, 200, `presign -> ${presign.status}`);
      assert.ok(typeof presign.json?.url === "string" && presign.json.url.length > 0);
      const bad = await yf("POST", `/convs/${convId}/rounds`,
        { ...payload, backend_id: "no-such-backend" }, cookie);
      assert.equal(bad.status, 400);
      assert.equal(bad.json?.error?.code, "bad_request");
      assert.ok(Array.isArray(bad.json?.error?.details) && bad.json.error.details.length > 0,
        "入队闸拒绝缺 details 逐条成因");
      const anon = await yf("POST", `/convs/${convId}/rounds`, payload);
      assert.equal(anon.status, 401, "未登录下单未被拒");
    });

    // -- S-B05 画廊落盘与隔离 ---------------------------------------------------
    await record("S-B05", "画廊落盘与用户隔离（done 落真实文件、not_found、failed 不落）", async () => {
      const uid = await register("e2e-invite-e", "recovery-sb05");
      const cookie = await login(uid, "recovery-sb05");
      const convId = (await yf("POST", "/convs", undefined, cookie)).json?.conv_id;
      const submit = await yf("POST", `/convs/${convId}/rounds`,
        { conv_id: convId, branch_kind: "refine", backend_id: "zimage-turbo", prompt: "一只画廊测试猫", n: 2, seed: 1 }, cookie);
      assert.equal(submit.status, 202);
      const roundId = submit.json?.round_id;
      assert.equal((await poll(roundId, cookie)).state, "done");
      const land = await yf("POST", "/land", { round_id: roundId }, cookie);
      assert.equal(land.status, 200, `POST /api/yf/land -> ${land.status}: ${land.text.slice(0, 200)}`);
      assert.equal(land.json?.landed, 2, `landed: ${JSON.stringify(land.json)}`);
      const dir = join(dataDir, "gallery", uid, convId, roundId);
      assert.deepEqual(readdirSync(dir).sort(), ["0.png", "1.png"], "画廊目录布局与 D3 不符");
      assert.equal(readFileSync(join(dir, "0.png")).toString("hex"), PNG.toString("hex"), "落盘文件不是桩图片字节");
      assert.equal((await yf("POST", "/land", { round_id: roundId }, cookie)).status, 200, "落盘不幂等");
      assert.deepEqual(readdirSync(dir).sort(), ["0.png", "1.png"], "幂等重落产生了重复文件");
      const otherId = await register("e2e-invite-f", "recovery-sb05v");
      const otherCookie = await login(otherId, "recovery-sb05v");
      const seen = await yf("GET", `/rounds/${roundId}`, undefined, otherCookie);
      assert.equal(seen.status, 404, "别人的轮不是 not_found（反枚举被破坏）");
      assert.equal(seen.json?.error?.code, "not_found");
      assert.equal((await yf("POST", "/land", { round_id: roundId }, otherCookie)).status, 404, "别人能落自己的盘");
      assert.ok(!existsSync(join(dataDir, "gallery", otherId, convId)), "V 的画廊里出现了 U 的会话目录");
      const conv2 = (await yf("POST", "/convs", undefined, cookie)).json?.conv_id;
      const failSubmit = await yf("POST", `/convs/${conv2}/rounds`,
        { conv_id: conv2, branch_kind: "refine", backend_id: "zimage-turbo", prompt: "E2E-FAIL 一只猫", n: 1, seed: 1 }, cookie);
      assert.equal(failSubmit.status, 202);
      assert.equal((await poll(failSubmit.json?.round_id, cookie)).state, "failed");
      const failLand = await yf("POST", "/land", { round_id: failSubmit.json.round_id }, cookie);
      assert.equal(failLand.status, 200);
      assert.equal(failLand.json?.landed, 0, "failed 轮不能落文件");
      assert.ok(!existsSync(join(dataDir, "gallery", uid, conv2, failSubmit.json.round_id)), "failed 轮落了文件");
    });

    // -- S-B06 运营者面 403 ------------------------------------------------------
    await record("S-B06", "运营者面仅运营者可用：普通用户直访被拒（403）", async () => {
      const userId = await register("e2e-invite-g", "recovery-sb06");
      const cookie = await login(userId, "recovery-sb06");
      // 方法按基线树 2481a70 实查（A5）：GET 面用 GET、POST-only 面带空 JSON。
      const probes = [
        ["GET", "/api/skills"], ["POST", "/api/skills/install"], ["GET", "/api/plugins"],
        ["GET", "/api/app-update"], ["GET", "/api/cwd/browse"], ["POST", "/api/cwd/validate"],
        ["GET", "/api/default-cwd"], ["GET", "/api/home"], ["POST", "/api/fs-manage"],
        ["GET", "/api/open-in-explorer"], ["GET", "/api/file-index"], ["GET", "/api/project-trust"],
        ["GET", "/api/polyforge/status"], ["GET", "/api/git/status"], ["GET", "/api/tools/settings"],
      ];
      const denied = [];
      for (const [method, path] of probes) {
        const response = await call(method, path, method === "POST" ? {} : undefined, cookie);
        if (response.status !== 403) denied.push(`${method} ${path} -> ${response.status}`);
      }
      assert.deepEqual(denied, [], "普通用户直访运营者面没有被 403 拒绝");
    });

    // -- S-B07 旧 YF_LLM_* 通道移除 ----------------------------------------------
    await record("S-B07", "旧 YF_LLM_* 环境变量通道移除（源码零读取）", async () => {
      const hits = [];
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!/\.(ts|tsx|mjs)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
          if (readFileSync(full, "utf8").includes("YF_LLM_")) hits.push(full);
        }
      };
      for (const dir of ["app", "lib", "components"]) {
        const full = join(root, dir);
        if (statSync(full).isDirectory()) walk(full);
      }
      assert.deepEqual(hits, [], `旧 YF_LLM_* 环境变量仍有读取处: ${hits.join(", ")}`);
    });
  } finally {
    // Graceful SIGTERM first, then escalate: a next dev that survives SIGTERM
    // keeps holding .next/dev/lock and blocks every later e2e run in this
    // checkout (observed on this suite's baseline run).
    server?.kill("SIGTERM");
    const stopDeadline = Date.now() + 5_000;
    while (server && server.exitCode === null && Date.now() < stopDeadline) await delay(100);
    if (server && server.exitCode === null) server.kill("SIGKILL");
    contract?.close();
    llm?.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nyf-behavior: ${results.length - failed.length}/${results.length} scenarios pass`);
  if (failed.length > 0) {
    console.log("failed scenarios:", failed.map((result) => result.id).join(", "));
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});