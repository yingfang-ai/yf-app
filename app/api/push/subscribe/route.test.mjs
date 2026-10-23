import "../../../../lib/yf/test-operator.mjs";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-push-subscribe-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const { writeSessionIndex } = await jiti.import("../../../../lib/yf/session-index.ts");

const originalSuffixes = process.env.PI_WEB_PUSH_ALLOWED_ENDPOINT_SUFFIXES;

test.after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalSuffixes === undefined) delete process.env.PI_WEB_PUSH_ALLOWED_ENDPOINT_SUFFIXES;
  else process.env.PI_WEB_PUSH_ALLOWED_ENDPOINT_SUFFIXES = originalSuffixes;
  await rm(testAgentDir, { recursive: true, force: true });
});

const KEYS = { p256dh: "p256dh-value", auth: "auth-value" };

// 会话索引里的普通用户（不在运营者名单）：推送携带会话名/会话 id，订阅面
// 仅运营者可达（R5/R10）——普通用户 403、伪造 cookie 401、且都不落订阅。
const ORDINARY_USER_ID = "c".repeat(32);
writeSessionIndex(process.env.YF_DATA_DIR, "tok-ordinary-push", {
  user_id: ORDINARY_USER_ID,
  expires_at: "2030-01-01T00:00:00Z",
});

function subscribe(endpoint, extraBody = {}, cookie) {
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ subscription: { endpoint, keys: KEYS }, locale: "en", ...extraBody }),
  });
}

test("a standard FCM endpoint is persisted", async () => {
  const response = await POST(subscribe("https://fcm.googleapis.com/fcm/send/abc"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const state = JSON.parse(await readFile(join(testAgentDir, "web-push.json"), "utf8"));
  assert.equal(state.subscriptions.length, 1);
  assert.equal(state.subscriptions[0].endpoint, "https://fcm.googleapis.com/fcm/send/abc");
});

test("an arbitrary host is refused with the typed endpoint code and never persisted", async () => {
  const response = await POST(subscribe("https://evil.example/push/abc"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "pushEndpointHostNotAllowed" });

  const state = JSON.parse(await readFile(join(testAgentDir, "web-push.json"), "utf8"));
  assert.ok(state.subscriptions.every((s) => !s.endpoint.includes("evil.example")));
});

test("a plain-http endpoint is refused with the typed scheme code", async () => {
  const response = await POST(subscribe("http://fcm.googleapis.com/fcm/send/abc"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "pushEndpointScheme" });
});

test("the operator suffix env var admits a self-hosted push service", async () => {
  process.env.PI_WEB_PUSH_ALLOWED_ENDPOINT_SUFFIXES = "push.example.com";
  try {
    const response = await POST(subscribe("https://push.example.com/endpoint"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    delete process.env.PI_WEB_PUSH_ALLOWED_ENDPOINT_SUFFIXES;
  }
});

test("a malformed subscription body is refused with the typed body code", async () => {
  const response = await POST(new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: { endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "", auth: "" } } }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalidSubscription" });
});

test("a JSON null body is refused with the typed body code, not an uncaught TypeError (review r2)", async () => {
  const response = await POST(new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null",
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalidBody" });
});

test("a non-object JSON body (string/array/number) is refused with the typed body code", async () => {
  for (const body of ['"a string"', "[1,2,3]", "42"]) {
    const response = await POST(new Request("http://localhost/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }));
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { error: "invalidBody" }, body);
  }
});

test("subscription is operator-only: forged cookie 401, ordinary user 403, nothing persisted for either", async () => {
  const forged = await POST(subscribe("https://fcm.googleapis.com/fcm/send/forged", {}, "yf_session=forged-token"));
  assert.equal(forged.status, 401);
  assert.equal((await forged.json()).error.code, "unauthorized");

  const ordinary = await POST(subscribe("https://fcm.googleapis.com/fcm/send/ordinary", {}, "yf_session=tok-ordinary-push"));
  assert.equal(ordinary.status, 403);
  assert.equal((await ordinary.json()).error.code, "forbidden");

  // 两条拒绝路径都不落订阅（之前的运营者用例已写入状态文件，这里只追加检查）。
  const state = JSON.parse(await readFile(join(testAgentDir, "web-push.json"), "utf8"));
  assert.ok(state.subscriptions.every((s) => !s.endpoint.includes("forged") && !s.endpoint.includes("ordinary")));
});

test("an operator session (the wrapper's default cookie) still subscribes after the guard", async () => {
  const response = await POST(subscribe("https://fcm.googleapis.com/fcm/send/op-ok"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const state = JSON.parse(await readFile(join(testAgentDir, "web-push.json"), "utf8"));
  assert.ok(state.subscriptions.some((s) => s.endpoint === "https://fcm.googleapis.com/fcm/send/op-ok"));
});
