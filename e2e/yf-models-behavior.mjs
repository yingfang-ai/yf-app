// yf-models-behavior.mjs — e2e-authored behavior bar for yingfang#31 (wi_ACEk7amPM5yd).
//
// Authored by the e2e-author lane against `artifacts/spec.md`'s new-behaviour
// acceptance criteria (「模型」tab 恢复 + 单一「LLM 服务」通道移除) BEFORE the
// implementation ("code") step ran. Every scenario encodes one NEW acceptance
// criterion; the regression faces (yingfang contract behaviour, guide-skill
// entry, gallery, operator 403 boundary for the non-models routes, YF_LLM_*
// zero-read) stay in e2e/yf-behavior.mjs / e2e/yf-acceptance.mjs.
//
// Run (from repos/yf-app, after `npm ci`):
//   node e2e/yf-models-behavior.mjs
//
// Style follows e2e/yf-behavior.mjs: self-managed Next dev server on a free
// loopback port, fixtures in temp dirs, no credentials. The yingfang contract
// (api-contract §2) is stubbed IN-TEST; the custom provider's "upstream" is an
// in-test OpenAI-shaped stub, so the suite never leaves loopback.
//
// Probed surfaces are the spec's own named faces, re-derived from the baseline
// tree 2481a70 (the restore is bounded to that shape): /api/models*,
// /api/models-config* (GET/PUT/discover/test), /api/auth/api-key/[provider],
// /api/auth/providers, /api/yf/llm-config (MUST 404), and the session-model
// wiring observable through the LLM stub's request bodies.
//
// Test seams (same as e2e/yf-behavior.mjs):
//   YF_API_UPSTREAM        — /api/yf/[...path] proxy target
//   YF_OPERATOR_USER_IDS   — operator user_ids
//   YF_DATA_DIR            — data root (per-user dirs live under it)
//   PI_CODING_AGENT_DIR    — agent dir (models.json / auth.json / sessions)
//   PI_WEB_ALLOWED_ROOT_PREFIXES — the repo root, so operator cwd routes resolve
//
// Expected result on the pre-implementation tree: RED at the assertion level
// for every scenario below. Scenario IDs (S-Mxx) are keyed 1:1 to
// artifacts/e2e-scenarios.md.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "test-results", "e2e-yf-models-behavior");
mkdirSync(artifacts, { recursive: true });
const serverLogPath = join(artifacts, "server.log");

// Fixed operator user_id: the contract stub returns it deterministically for
// the operator invite, so the suite can name it in YF_OPERATOR_USER_IDS up
// front (32 hex chars, contract §2.1 id shape).
const OPERATOR_INVITE = "e2e-models-operator-invite";
const OPERATOR_USER_ID = "e2eea31a" + "0".repeat(22) + "aa";
const INVITES = new Map([
  [OPERATOR_INVITE, 5],
  ["e2e-models-invite-a", 5], ["e2e-models-invite-b", 5],
]);

// Secret bytes the suite plants and then hunts for in every read-back face.
const CUSTOM_KEY = "e2e-custom-key-3f9d2c";
const HDR_SECRET = "e2e-header-secret-8b71aa";
const MODEL_HDR_SECRET = "e2e-model-header-secret-5c02ee";
const BUILTIN_KEY = "e2e-openai-key-77ee01";
const SECRETS = [CUSTOM_KEY, HDR_SECRET, MODEL_HDR_SECRET, BUILTIN_KEY];

const CUSTOM_PROVIDER = "e2e-custom";
const DEFAULT_MODEL = "e2e-model-a";

const hexId = () => createHash("sha256").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 32);

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

async function waitFor(predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(250);
  }
  return Boolean(predicate());
}

// ---------------------------------------------------------------------------
// yingfang contract stub (api-contract §2): register + login only — the models
// bar needs operator/normal-user identities, not the ordering/gallery faces.
// ---------------------------------------------------------------------------
function contractStub() {
  const users = new Map(); // user_id -> { recovery }
  const inviteUses = new Map([...INVITES].map(([code]) => [code, 0]));
  const sessions = new Map(); // token -> user_id
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, message) => send(res, status, { error: { code, message } });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://stub");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      if (raw) {
        try { body = JSON.parse(raw); } catch { return fail(res, 400, "invalid_json", "请求体不是合法 JSON"); }
      }
      if (url.pathname === "/api/register" && req.method === "POST") {
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
      if (url.pathname === "/api/login" && req.method === "POST") {
        const user = users.get(body?.user_id);
        if (!user || user.recovery !== body?.recovery) {
          return fail(res, 401, "unauthorized", "登录凭据不正确");
        }
        const token = hexId();
        sessions.set(token, body.user_id);
        return send(res, 200, { user_id: body.user_id, expires_at: new Date().toISOString() }, {
          "Set-Cookie": `yf_session=${token}; HttpOnly; SameSite=Lax; Path=/`,
        });
      }
      return fail(res, 404, "not_found", "资源不存在");
    })().catch(() => fail(res, 500, "internal", "桩内部错误"));
  });
  return server;
}

// OpenAI-shaped upstream stub: GET */models answers the discover route's model
// list; POST answers chat completions (streaming only if asked). Every request
// is recorded — the session scenarios assert the model id the server sent.
function llmStub() {
  const requests = [];
  const server = createServer((req, res) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      let json = null;
      try { json = JSON.parse(body); } catch { /* 非 JSON：保留原文 */ }
      requests.push({
        method: req.method,
        url: req.url ?? "",
        authorization: req.headers.authorization ?? "",
        body,
        json,
      });
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          object: "list",
          data: [{ id: "stub-model-alpha" }, { id: "stub-model-beta" }],
        }));
      }
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end();
      }
      const message = { role: "assistant", content: "（模型桩回复）OK" };
      if (json?.stream === true) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: message.content } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-e2e-models", object: "chat.completion", created: Date.now() / 1000,
        model: json?.model ?? "stub",
        choices: [{ index: 0, message, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    })().catch(() => { res.writeHead(500); res.end(); });
  });
  return { server, requests };
}

// A second, deliberately foreign destination: the stored-key guard scenarios
// assert NOTHING is ever sent here.
function foreignStub() {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url ?? "" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [] }));
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

  const dataDir = mkdtempSync(join(tmpdir(), "yf-models-data-"));
  const agentDir = mkdtempSync(join(tmpdir(), "yf-models-agent-"));

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
  const { server: foreign, requests: foreignRequests } = foreignStub();
  await new Promise((resolve, reject) => {
    foreign.once("error", reject);
    foreign.listen(0, "127.0.0.1", resolve);
  });
  const foreignUrl = `http://127.0.0.1:${foreign.address().port}`;

  // Dev server on a free port (same lifecycle as e2e/yf-behavior.mjs).
  const serverLog = createWriteStream(serverLogPath);
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
      // detached: the suite kills the whole process GROUP on teardown — next dev
      // forks workers that outlive a direct-child kill and would keep holding
      // .next/dev/lock for every later e2e run in this checkout.
      detached: true,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_WEB_PASSWORD: "",
        NEXT_TELEMETRY_DISABLED: "1",
        YF_DATA_DIR: dataDir,
        YF_API_UPSTREAM: contractUrl,
        YF_OPERATOR_USER_IDS: OPERATOR_USER_ID,
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
      if (Date.now() > deadline) throw new Error(`server readiness timed out; see ${serverLogPath}`);
      await delay(500);
    }
    if (responded) break;
    assert.ok(attempt < 4, `server kept exiting before readiness; see ${serverLogPath}`);
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
    const excerpt = (response, bytes = 200) => ` -> ${response.status}: ${response.text.slice(0, bytes)}`;

    // Operator identity, established once.
    const opId = await register(OPERATOR_INVITE, "recovery-models-op");
    assert.equal(opId, OPERATOR_USER_ID, "运营者邀请没有返回固定 user_id");
    const opCookie = await login(OPERATOR_USER_ID, "recovery-models-op");

    // S-M02's payload, shared with the masking scenarios: provider-level key +
    // headers, model-level headers — every secret is later hunted in read-backs.
    const customProviderPayload = () => ({
      providers: {
        [CUSTOM_PROVIDER]: {
          name: "E2E 自定义服务",
          baseUrl: llmUrl,
          api: "openai-completions",
          apiKey: CUSTOM_KEY,
          headers: { "x-e2e-secret": HDR_SECRET },
          models: [
            { id: "e2e-model-a", name: "模型 A", headers: { "x-e2e-model-secret": MODEL_HDR_SECRET } },
            { id: "e2e-model-b", name: "模型 B" },
          ],
        },
      },
    });

    // -- S-M01 旧通道移除 -----------------------------------------------------
    await record("S-M01", "旧「LLM 服务」通道整体移除：直访 404、四件套源码不存在", async () => {
      const got = await call("GET", "/api/yf/llm-config", undefined, opCookie);
      assert.equal(got.status, 404, `GET /api/yf/llm-config${excerpt(got)}`);
      const put = await call("PUT", "/api/yf/llm-config",
        { base_url: llmUrl, key: "x", model_id: "y" }, opCookie);
      assert.equal(put.status, 404, `PUT /api/yf/llm-config${excerpt(put)}`);
      assert.ok(!existsSync(join(root, "app", "api", "yf", "llm-config", "route.ts")),
        "app/api/yf/llm-config/route.ts 仍存在");
      assert.ok(!existsSync(join(root, "lib", "yf", "llm-config.ts")),
        "lib/yf/llm-config.ts 仍存在");
      assert.ok(!existsSync(join(root, "components", "yf", "LlmConfigCard.tsx")),
        "components/yf/LlmConfigCard.tsx 仍存在");
      const rpc = readFileSync(join(root, "lib", "rpc-manager.ts"), "utf8");
      assert.ok(!/llmChannelModelRuntime|readLlmConfig|LLM_CHANNEL_PROVIDER_ID/.test(rpc),
        "rpc-manager 仍有 yf-llm 通道注入代码");
      const settingsPanel = readFileSync(join(root, "components", "SettingsPanel.tsx"), "utf8");
      assert.ok(!settingsPanel.includes("LlmConfigCard"), "SettingsPanel 仍挂 LlmConfigCard 分区");
      const settingsCss = readFileSync(join(root, "app", "settings.css"), "utf8");
      assert.ok(!settingsCss.includes("settings-llm-"), "settings.css 仍有 .settings-llm-* 残留");
    });

    // -- S-M02 自定义 provider 配置面 ------------------------------------------
    await record("S-M02", "运营者经「模型」面配置自定义 provider：保存/读回、models 列表、启停", async () => {
      const put = await call("PUT", "/api/models-config", customProviderPayload(), opCookie);
      assert.ok(put.status >= 200 && put.status < 300, `PUT /api/models-config${excerpt(put)}`);
      const got = await call("GET", "/api/models-config", undefined, opCookie);
      assert.equal(got.status, 200, `GET /api/models-config${excerpt(got)}`);
      const entry = got.json?.providers?.[CUSTOM_PROVIDER];
      assert.ok(entry, `GET models-config 没有已保存的 provider: ${got.text.slice(0, 300)}`);
      assert.equal(entry.baseUrl, llmUrl, "读回的 baseUrl 与保存不符");
      assert.deepEqual(
        (entry.models ?? []).map((model) => model.id).sort(),
        ["e2e-model-a", "e2e-model-b"],
        "读回的模型列表与保存不符",
      );
      const modelsQuery = `/api/models?cwd=${encodeURIComponent(root)}`;
      const list = await call("GET", modelsQuery, undefined, opCookie);
      assert.equal(list.status, 200, `GET /api/models${excerpt(list)}`);
      const ids = (list.json?.modelList ?? []).map((model) => `${model.provider}/${model.id}`);
      assert.ok(ids.includes(`${CUSTOM_PROVIDER}/e2e-model-a`) && ids.includes(`${CUSTOM_PROVIDER}/e2e-model-b`),
        `models 列表缺自定义 provider 的模型: ${JSON.stringify(ids).slice(0, 300)}`);
      // 启停：停用 e2e-model-b，列表不再可见；再启用，恢复可见。
      const off = await call("PUT", "/api/models/enabled",
        { cwd: root, op: "models", refs: [`${CUSTOM_PROVIDER}/e2e-model-b`], enabled: false }, opCookie);
      assert.ok(off.status >= 200 && off.status < 300, `PUT /api/models/enabled(停用)${excerpt(off)}`);
      const listOff = await call("GET", modelsQuery, undefined, opCookie);
      const idsOff = (listOff.json?.modelList ?? []).map((model) => `${model.provider}/${model.id}`);
      assert.ok(!idsOff.includes(`${CUSTOM_PROVIDER}/e2e-model-b`), "停用后 models 列表仍含 e2e-model-b");
      assert.ok(idsOff.includes(`${CUSTOM_PROVIDER}/e2e-model-a`), "停用 e2e-model-b 连带影响了 e2e-model-a");
      const on = await call("PUT", "/api/models/enabled",
        { cwd: root, op: "models", refs: [`${CUSTOM_PROVIDER}/e2e-model-b`], enabled: true }, opCookie);
      assert.ok(on.status >= 200 && on.status < 300, `PUT /api/models/enabled(启用)${excerpt(on)}`);
      const listOn = await call("GET", modelsQuery, undefined, opCookie);
      const idsOn = (listOn.json?.modelList ?? []).map((model) => `${model.provider}/${model.id}`);
      assert.ok(idsOn.includes(`${CUSTOM_PROVIDER}/e2e-model-b`), "重新启用后 models 列表没有恢复 e2e-model-b");
    });

    // -- S-M03 未设默认模型 →「未配置」-----------------------------------------
    await record("S-M03", "有 provider 但未设默认模型：新会话明确报「未配置」并指向「模型」tab", async () => {
      const uid = await register("e2e-models-invite-a", "recovery-m03");
      const cookie = await login(uid, "recovery-m03");
      llmRequests.length = 0;
      // 开启新会话（普通用户 cwd 由服务端定为个人目录；此处显式传同一布局）。
      const created = await call("POST", "/api/agent/new",
        { cwd: join(dataDir, "users", uid), type: "ensure_session" }, cookie);
      let message;
      if (created.status >= 200 && created.status < 300) {
        // 实现若把「未配置」推迟到首条 prompt，也必须在那里如实报错，不许静默挑模型。
        const sent = await call("POST", `/api/agent/${encodeURIComponent(created.json.sessionId)}`,
          { type: "prompt", message: "我想画一张测试图" }, cookie);
        assert.ok(sent.status >= 400, `未设默认模型时 prompt 静默成功${excerpt(sent)}`);
        message = String(sent.json?.error ?? sent.text);
      } else {
        message = String(created.json?.error ?? created.text);
      }
      assert.match(message, /未配置/, `报错缺「未配置」口径: ${message.slice(0, 200)}`);
      assert.match(message, /模型/, `报错未指向「模型」tab: ${message.slice(0, 200)}`);
      await delay(1_000);
      assert.equal(llmRequests.length, 0, "未设默认模型时发出了 LLM 请求（静默挑模型）");
    });

    // -- S-M04 全站默认模型驱动新会话 -------------------------------------------
    await record("S-M04", "新会话（普通用户引导聊天、运营者会话）都使用全站默认模型", async () => {
      const put = await call("PUT", "/api/models/default",
        { cwd: root, provider: CUSTOM_PROVIDER, modelId: DEFAULT_MODEL }, opCookie);
      assert.ok(put.status >= 200 && put.status < 300, `PUT /api/models/default${excerpt(put)}`);
      // 普通用户新会话（服务端自动落到引导 skill 聊天）。
      const uid = await register("e2e-models-invite-b", "recovery-m04");
      const cookie = await login(uid, "recovery-m04");
      llmRequests.length = 0;
      const created = await call("POST", "/api/agent/new",
        { cwd: join(dataDir, "users", uid), type: "ensure_session" }, cookie);
      assert.equal(created.status, 200, `POST /api/agent/new(用户)${excerpt(created)}`);
      const sent = await call("POST", `/api/agent/${encodeURIComponent(created.json.sessionId)}`,
        { type: "prompt", message: "我想画一张测试图" }, cookie);
      assert.equal(sent.status, 200, `用户会话 prompt${excerpt(sent)}`);
      const userHit = await waitFor(() => llmRequests.some((r) => r.json?.model === DEFAULT_MODEL));
      assert.ok(userHit, "普通用户新会话的 LLM 请求没有使用默认模型 e2e-model-a");
      // 运营者新会话。
      llmRequests.length = 0;
      const opCreated = await call("POST", "/api/agent/new", { cwd: root, type: "ensure_session" }, opCookie);
      assert.equal(opCreated.status, 200, `POST /api/agent/new(运营者)${excerpt(opCreated)}`);
      const opSent = await call("POST", `/api/agent/${encodeURIComponent(opCreated.json.sessionId)}`,
        { type: "prompt", message: "请只回复 OK" }, opCookie);
      assert.equal(opSent.status, 200, `运营者会话 prompt${excerpt(opSent)}`);
      const opHit = await waitFor(() => llmRequests.some((r) => r.json?.model === DEFAULT_MODEL));
      assert.ok(opHit, "运营者新会话的 LLM 请求没有使用默认模型 e2e-model-a");
    });

    // -- S-M05 内置 provider key 录入 -------------------------------------------
    await record("S-M05", "内置 provider API key 录入（api-key / providers）：录后读回只见「已配置」", async () => {
      const put = await call("POST", "/api/auth/api-key/openai", { apiKey: BUILTIN_KEY }, opCookie);
      assert.ok(put.status >= 200 && put.status < 300, `POST /api/auth/api-key/openai${excerpt(put)}`);
      const got = await call("GET", "/api/auth/providers", undefined, opCookie);
      assert.equal(got.status, 200, `GET /api/auth/providers${excerpt(got)}`);
      const openai = (got.json?.apiKeyProviders ?? []).find((provider) => provider.id === "openai");
      assert.ok(openai, `apiKeyProviders 里没有 openai: ${got.text.slice(0, 300)}`);
      assert.equal(openai.configured, true, "录入 key 后 configured 标记未置位");
      assert.ok(!got.text.includes(BUILTIN_KEY), "providers 读回出现了 key 字节");
    });

    // -- S-M06 discover/test + 防外泄守卫 ----------------------------------------
    await record("S-M06", "discover/test 可用；带已存 key 时目标地址 ≠ 已存地址即被拒", async () => {
      const discoverBody = {
        providerName: CUSTOM_PROVIDER,
        provider: { baseUrl: llmUrl, api: "openai-completions", apiKey: CUSTOM_KEY },
      };
      const before = llmRequests.length;
      const dis = await call("POST", "/api/models-config/discover", discoverBody, opCookie);
      assert.equal(dis.status, 200, `POST /api/models-config/discover${excerpt(dis)}`);
      const ids = (dis.json?.models ?? []).map((model) => model.id);
      assert.ok(ids.includes("stub-model-alpha"), `discover 未返回桩模型列表: ${dis.text.slice(0, 200)}`);
      const discoverHit = llmRequests.slice(before).find((r) => r.method === "GET");
      assert.ok(discoverHit, "discover 没有打到自定义 provider 的服务地址");
      assert.ok(discoverHit.authorization.includes(CUSTOM_KEY),
        "discover 请求没有带上已保存的 key");
      // 守卫：该 provider 已存 key，目标地址 ≠ 已存地址 → 拒绝，且不发出任何请求。
      foreignRequests.length = 0;
      const misdirected = await call("POST", "/api/models-config/discover",
        { providerName: CUSTOM_PROVIDER, provider: { baseUrl: foreignUrl, api: "openai-completions" } }, opCookie);
      assert.equal(misdirected.status, 403, `目标地址不一致未被拒${excerpt(misdirected)}`);
      assert.equal(foreignRequests.length, 0, "被拒的 discover 仍向陌生地址发了请求（key 外泄）");
      const test = await call("POST", "/api/models-config/test",
        { ...discoverBody, model: { id: DEFAULT_MODEL } }, opCookie);
      assert.equal(test.status, 200, `POST /api/models-config/test${excerpt(test)}`);
      assert.equal(test.json?.ok, true, `test 连接未成功: ${test.text.slice(0, 200)}`);
    });

    // -- S-M07 可见性边界 --------------------------------------------------------
    await record("S-M07", "模型配置面仅运营者：普通用户 403、匿名 401", async () => {
      const uid = await register("e2e-models-invite-a", "recovery-m07");
      const cookie = await login(uid, "recovery-m07");
      const probes = [
        ["GET", "/api/models", undefined],
        ["GET", "/api/models-config", undefined],
        ["PUT", "/api/models-config", {}],
        ["POST", "/api/models-config/discover", {}],
        ["POST", "/api/models-config/test", {}],
        ["PUT", "/api/models/default", {}],
        ["PUT", "/api/models/enabled", {}],
        ["GET", "/api/auth/providers", undefined],
        ["POST", "/api/auth/api-key/openai", {}],
      ];
      const denied = [];
      for (const [method, path, body] of probes) {
        const res = await call(method, path, body, cookie);
        if (res.status !== 403) denied.push(`用户 ${method} ${path} -> ${res.status}`);
      }
      assert.deepEqual(denied, [], "普通用户直访模型配置面没有被 403 拒绝");
      const anonymous = [];
      for (const [method, path, body] of probes) {
        const res = await call(method, path, body);
        if (res.status !== 401) anonymous.push(`匿名 ${method} ${path} -> ${res.status}`);
      }
      assert.deepEqual(anonymous, [], "匿名直访模型配置面没有被 401 拒绝");
    });

    // -- S-M08 只写不回显 ---------------------------------------------------------
    await record("S-M08", "任何读回接口不出现 apiKey/headers 密钥字节；0600；「已配置」标记；key 不进日志", async () => {
      const reads = [
        ["GET", "/api/models-config"],
        ["GET", `/api/models?cwd=${encodeURIComponent(root)}`],
        ["GET", "/api/auth/providers"],
      ];
      for (const [method, path] of reads) {
        const res = await call(method, path, undefined, opCookie);
        assert.equal(res.status, 200, `${method} ${path}${excerpt(res)}`);
        for (const secret of SECRETS) {
          assert.ok(!res.text.includes(secret), `${method} ${path} 读回出现了密钥字节 ${secret}`);
        }
      }
      const cfg = await call("GET", "/api/models-config", undefined, opCookie);
      assert.match(cfg.text, /configured|已配置/, "读回缺少「已配置」类标记");
      for (const name of ["models.json", "auth.json"]) {
        const file = join(agentDir, name);
        assert.ok(existsSync(file), `${name} 不在服务端 agent 数据根`);
        assert.equal(statSync(file).mode & 0o777, 0o600, `${name} 权限不是 0600`);
      }
      const log = readFileSync(serverLogPath, "utf8");
      for (const secret of SECRETS) {
        assert.ok(!log.includes(secret), `${secret} 出现在了服务端日志`);
      }
    });

    // -- S-M09 表达式拒绝 ----------------------------------------------------------
    await record("S-M09", "apiKey/headers 值形如 !命令 或 $VAR 的保存被拒绝并提示", async () => {
      const base = () => ({
        providers: {
          "e2e-expr": { baseUrl: llmUrl, api: "openai-completions", models: [{ id: "e2e-expr-model" }] },
        },
      });
      const cases = [
        { ...base(), providers: { "e2e-expr": { ...base().providers["e2e-expr"], apiKey: "!curl http://evil.example" } } },
        { ...base(), providers: { "e2e-expr": { ...base().providers["e2e-expr"], apiKey: "$MY_SECRET" } } },
        { ...base(), providers: { "e2e-expr": { ...base().providers["e2e-expr"], headers: { "x-a": "!echo hi" } } } },
        {
          ...base(),
          providers: {
            "e2e-expr": { ...base().providers["e2e-expr"], models: [{ id: "e2e-expr-model", headers: { "x-b": "$MY_SECRET" } }] },
          },
        },
      ];
      for (const [index, payload] of cases.entries()) {
        const res = await call("PUT", "/api/models-config", payload, opCookie);
        assert.equal(res.status, 400, `表达式写法 #${index} 未被拒绝${excerpt(res)}`);
        assert.ok(res.text.length > 0, `表达式写法 #${index} 被拒但无可读错误提示`);
      }
      const after = await call("GET", "/api/models-config", undefined, opCookie);
      assert.ok(!after.json?.providers?.["e2e-expr"], "被拒绝的表达式配置仍被写入");
      const key = await call("POST", "/api/auth/api-key/openai", { apiKey: "!curl http://evil.example" }, opCookie);
      assert.equal(key.status, 400, `内置 key 录入表达式写法未被拒${excerpt(key)}`);
    });

    // -- S-M10 旧 yf-llm 会话回落 ---------------------------------------------------
    await record("S-M10", "记为 yf-llm 的旧会话重开自动回落到当前默认模型", async () => {
      const sid = hexId();
      const projectDir = join(agentDir, "sessions", "e2e-legacy");
      mkdirSync(projectDir, { recursive: true });
      const file = join(projectDir, `2026-01-01T00-00-00-000Z_${sid}.jsonl`);
      const at = (second) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
      // 历史会话形态（pi 会话文件，见 app/api/sessions/external-write-sync.test.mjs）：
      // 头 + 已有对话 + 记录为 yf-llm 的 model_change + 已有回复。
      const lines = [
        JSON.stringify({ type: "session", version: 3, id: sid, cwd: root, timestamp: at(0) }),
        JSON.stringify({
          id: "legacy0001", parentId: null, type: "message", timestamp: at(1),
          message: { role: "user", content: [{ type: "text", text: "旧会话的历史消息" }] },
        }),
        JSON.stringify({
          id: "legacy0002", parentId: "legacy0001", type: "model_change", timestamp: at(2),
          provider: "yf-llm", modelId: "legacy-yf-model",
        }),
        JSON.stringify({
          id: "legacy0003", parentId: "legacy0002", type: "message", timestamp: at(3),
          message: { role: "assistant", content: [{ type: "text", text: "旧会话的历史回复" }] },
        }),
      ];
      writeFileSync(file, `${lines.join("\n")}\n`);
      llmRequests.length = 0;
      const sent = await call("POST", `/api/agent/${encodeURIComponent(sid)}`,
        { type: "prompt", message: "继续这个旧会话" }, opCookie);
      assert.equal(sent.status, 200, `旧 yf-llm 会话重开失败${excerpt(sent)}`);
      const hit = await waitFor(() => llmRequests.some((r) => r.json?.model === DEFAULT_MODEL));
      assert.ok(hit, "旧 yf-llm 会话重开后没有回落到当前默认模型 e2e-model-a");
      assert.ok(!llmRequests.some((r) => r.json?.model === "legacy-yf-model"),
        "旧会话重开后仍在请求已移除的 legacy-yf-model");
    });
  } finally {
    // Graceful SIGTERM first, then escalate: a next dev that survives SIGTERM
    // keeps holding .next/dev/lock and blocks every later e2e run in this
    // checkout (observed on this suite's sibling baseline run).
    server?.kill("SIGTERM");
    const stopDeadline = Date.now() + 5_000;
    while (server && server.exitCode === null && Date.now() < stopDeadline) await delay(100);
    if (server && server.exitCode === null) {
      // SIGKILL the whole group: next dev's forked workers survive a direct
      // SIGKILL of the spawned bin and keep the dev lock (observed on this
      // suite's baseline run).
      try { process.kill(-server.pid, "SIGKILL"); } catch { server.kill("SIGKILL"); }
    }
    contract?.close();
    llm?.close();
    foreign?.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nyf-models-behavior: ${results.length - failed.length}/${results.length} scenarios pass`);
  if (failed.length > 0) {
    console.log("failed scenarios:", failed.map((result) => result.id).join(", "));
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
