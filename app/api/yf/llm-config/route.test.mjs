import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const dataRoot = mkdtempSync(path.join(tmpdir(), "yf-llm-config-route-"));
process.env.YF_DATA_DIR = dataRoot;
process.env.YF_OPERATOR_USER_IDS = "f".repeat(32);

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET, PUT } = await jiti.import("./route.ts");
const { writeSessionIndex } = await jiti.import("../../../../lib/yf/session-index.ts");
const { readLlmConfig } = await jiti.import("../../../../lib/yf/llm-config.ts");

const OPERATOR = "f".repeat(32);
const ORDINARY = "0".repeat(32);
const operatorCookie = "yf_session=tok-op";
const ordinaryCookie = "yf_session=tok-user";

writeSessionIndex(dataRoot, "tok-op", { user_id: OPERATOR, expires_at: "2030-01-01T00:00:00Z" });
writeSessionIndex(dataRoot, "tok-user", { user_id: ORDINARY, expires_at: "2030-01-01T00:00:00Z" });

test.after(() => {
  rmSync(dataRoot, { recursive: true, force: true });
  delete process.env.YF_DATA_DIR;
  delete process.env.YF_OPERATOR_USER_IDS;
});

const request = (method, cookie, body) => new Request("http://localhost/api/yf/llm-config", {
  method,
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test("GET: unconfigured → empty view with key_configured false", async () => {
  const response = await GET(request("GET", operatorCookie));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { base_url: "", model_id: "", key_configured: false });
});

test("PUT + GET: operator writes and reads the view shape; the key never echoes", async () => {
  const put = await PUT(request("PUT", operatorCookie, {
    base_url: "http://127.0.0.1:9/v1", key: "sk-route-test", model_id: "m-1",
  }));
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.deepEqual(putBody, { base_url: "http://127.0.0.1:9/v1", model_id: "m-1", key_configured: true });
  assert.equal(JSON.stringify(putBody).includes("sk-route-test"), false);

  const got = await GET(request("GET", operatorCookie));
  assert.equal(got.status, 200);
  const gotBody = await got.json();
  assert.deepEqual(gotBody, { base_url: "http://127.0.0.1:9/v1", model_id: "m-1", key_configured: true });
  assert.equal(JSON.stringify(gotBody).includes("sk-route-test"), false);
  // 服务端确实存了 key（只写不回显，不是丢弃）。
  assert.equal(readLlmConfig(dataRoot)?.key, "sk-route-test");
});

test("PUT with an empty key keeps the configured key (可覆盖，不误清)", async () => {
  const put = await PUT(request("PUT", operatorCookie, {
    base_url: "http://127.0.0.1:10/v1", key: "", model_id: "m-2",
  }));
  assert.equal(put.status, 200);
  assert.equal(readLlmConfig(dataRoot)?.key, "sk-route-test");
  assert.equal(readLlmConfig(dataRoot)?.model_id, "m-2");
});

test("ordinary user → 403; anonymous → 401 (A2)", async () => {
  assert.equal((await GET(request("GET", ordinaryCookie))).status, 403);
  assert.equal((await PUT(request("PUT", ordinaryCookie, {
    base_url: "http://x/v1", key: "k", model_id: "m",
  }))).status, 403);
  assert.equal((await GET(request("GET", null))).status, 401);
  assert.equal((await PUT(request("PUT", null, {
    base_url: "http://x/v1", key: "k", model_id: "m",
  }))).status, 401);
  // 普通用户/匿名没能改写配置。
  assert.equal(readLlmConfig(dataRoot)?.model_id, "m-2");
});

test("PUT with an incomplete payload → 400, nothing written", async () => {
  const before = readLlmConfig(dataRoot);
  const bad = await PUT(request("PUT", operatorCookie, { base_url: "http://x/v1" }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, "bad_request");
  assert.deepEqual(readLlmConfig(dataRoot), before);
});