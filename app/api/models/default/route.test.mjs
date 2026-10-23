import "../../../../lib/yf/test-operator.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// Boundary regression for the review follow-up: a JSON body of null (or a
// primitive) must answer the controlled 400, never surface as a TypeError
// from reading properties off the parsed value.
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { PUT } = await jiti.import("./route.ts");
const { writeSessionIndex } = await jiti.import("../../../../lib/yf/session-index.ts");

function put(body) {
  return PUT(new Request("http://localhost/api/models/default", {
    method: "PUT",
    headers: { host: "localhost", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

test("a JSON-null body answers the controlled 400, not a TypeError", async () => {
  const response = await put(null);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body" });
});

test("JSON-primitive bodies answer the controlled 400 as well", async () => {
  for (const primitive of [7, "plain text", true]) {
    const response = await put(primitive);
    assert.equal(response.status, 400, `body: ${JSON.stringify(primitive)}`);
  }
});

// yingfang#31（spec R5/plan A6）：默认模型写入面仅运营者——伪造 cookie 401、
// 普通用户 403。test-operator.mjs 已把无 cookie 的请求包成运营者身份。
const ORDINARY_USER_ID = "c".repeat(32);

test("the default-model write is operator-only: forged cookie 401, ordinary session 403", async () => {
  writeSessionIndex(process.env.YF_DATA_DIR, "tok-ordinary-models-default", {
    user_id: ORDINARY_USER_ID,
    expires_at: "2030-01-01T00:00:00Z",
  });
  const forged = await PUT(new Request("http://localhost/api/models/default", {
    method: "PUT",
    headers: { host: "localhost", "content-type": "application/json", cookie: "yf_session=forged-token" },
    body: "{}",
  }));
  assert.equal(forged.status, 401);
  const ordinary = await PUT(new Request("http://localhost/api/models/default", {
    method: "PUT",
    headers: { host: "localhost", "content-type": "application/json", cookie: "yf_session=tok-ordinary-models-default" },
    body: "{}",
  }));
  assert.equal(ordinary.status, 403);
});
