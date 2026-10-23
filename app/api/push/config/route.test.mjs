import "../../../../lib/yf/test-operator.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-push-config-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { writeSessionIndex } = await jiti.import("../../../../lib/yf/session-index.ts");

test.after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

// 会话索引里的普通用户（不在运营者名单）：VAPID 配置面与订阅面同属运营者
// 限定（R5/R10）——匿名/伪造 cookie 401，普通用户 403。
const ORDINARY_USER_ID = "c".repeat(32);
writeSessionIndex(process.env.YF_DATA_DIR, "tok-ordinary-push-config", {
  user_id: ORDINARY_USER_ID,
  expires_at: "2030-01-01T00:00:00Z",
});

const get = (cookie) =>
  GET(new Request("http://localhost/api/push/config", {
    headers: cookie ? { cookie } : {},
  }));

test("forged and ordinary cookies never see the VAPID public key", async () => {
  assert.equal((await get("yf_session=forged-token")).status, 401);
  const ordinary = await get("yf_session=tok-ordinary-push-config");
  assert.equal(ordinary.status, 403);
  assert.equal((await ordinary.json()).error.code, "forbidden");
});

test("an operator session gets the public key, never the private key", async () => {
  const response = await get();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(typeof payload.publicKey, "string");
  assert.ok(payload.publicKey.length > 0);
  assert.equal("privateKey" in payload, false);
});