// yingfang#32 B1 的红测试（repro 步交付）：普通用户可经 set_model RPC 把自己的
// 会话切到任意已配置模型——「模型固定为默认模型」只做了 UI 隐藏，服务端没拦。
// 本文件以真实身份解析（cookie → session index → user_id → 运营者判定）驱动
// `POST /api/agent/[id]` 路由处理器：
//   1. 普通用户对自己的会话发 set_model → 必须被服务端拒绝（403 形，
//      requireOperator 同形），且命令不得到达会话（当前代码上是红的）；
//   2. 运营者发 set_model 照常到达会话（正向对照）；
//   3. 普通用户在自己会话上的普通命令不受影响（边界，防修法误伤）。
import "../../../lib/yf/test-operator.mjs";
import { OPERATOR_SESSION_COOKIE } from "../../../lib/yf/test-operator.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// 关闭会话空闲关停计时：本文件不建真实 wrapper，但与 agent-route.test.mjs 同款
// 保险，防止任何真实 wrapper 的待决 timer 挂住测试进程。
process.env.PI_WEB_IDLE_TIMEOUT_MS = "0";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST: postAgentCommand } = await jiti.import("./[id]/route.ts");
const { writeSessionIndex } = await jiti.import("../../../lib/yf/session-index.ts");
const { ensureUserDataDir } = await jiti.import("../../../lib/yf/user-dirs.ts");
const { yfDataRoot } = await jiti.import("../../../lib/yf/data-root.ts");

// 普通用户身份：落一条真实 session index 项（token 只存哈希），数据根由
// test-operator.mjs 预置的 YF_DATA_DIR 提供。
const ORDINARY = "0".repeat(32);
const ORDINARY_COOKIE = "yf_session=tok-ordinary-set-model-gate";
writeSessionIndex(yfDataRoot(), "tok-ordinary-set-model-gate", {
  user_id: ORDINARY,
  expires_at: "2030-01-01T00:00:00Z",
});
// 该普通用户自己的会话 cwd：<数据根>/users/<ORDINARY>/（requireSessionAccess
// 的归属判据 isOwnDataCwd 命中，会话可见，守卫真实放行后到达 set_model 面前）。
const ORDINARY_CWD = ensureUserDataDir(ORDINARY);

// 会话注册表挂在 globalThis（Next/jiti 模块副本间共享，见 agent-route.test.mjs）。
// fake wrapper 只需路由与守卫真实代码路径会用到的面：cwd / isAlive / send。
function installFakeRegistry(t, wrapper) {
  const previous = globalThis.__piSessions;
  const registry = new Map();
  if (wrapper !== undefined) registry.set("own-session", wrapper);
  globalThis.__piSessions = registry;
  t.after(() => { globalThis.__piSessions = previous; });
}

function makeRecordingWrapper() {
  const calls = { sent: [] };
  return {
    calls,
    cwd: ORDINARY_CWD,
    sessionFile: "",
    isAlive: () => true,
    async send(command) {
      calls.sent.push(command);
      return { id: "recorded", provider: "recorded" };
    },
  };
}

async function post(body, cookie) {
  const response = await postAgentCommand(new Request("http://localhost/api/agent/own-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "own-session" }) });
  return { status: response.status, body: await response.json() };
}

test("B1: 普通用户对自己的会话发 set_model 被服务端拒绝（403 形）", async (t) => {
  const wrapper = makeRecordingWrapper();
  installFakeRegistry(t, wrapper);

  const { status, body } = await post(
    { type: "set_model", provider: "openai", modelId: "gpt-burn-operator-quota" },
    ORDINARY_COOKIE,
  );

  // 403 形与 requireOperator 同形：{ error: { code: "forbidden", … } }。
  assert.equal(status, 403, `expected 403, got ${status} ${JSON.stringify(body)}`);
  assert.equal(body.error?.code, "forbidden");
  // 命令不得到达会话：拒绝发生在快路径/冷启动之前。
  const setModel = wrapper.calls.sent.filter((command) => command.type === "set_model");
  assert.equal(setModel.length, 0, "set_model must never reach the session for a non-operator");
});

test("B1 正向对照：运营者 set_model 照常到达会话", async (t) => {
  const wrapper = makeRecordingWrapper();
  installFakeRegistry(t, wrapper);

  const { status, body } = await post(
    { type: "set_model", provider: "openai", modelId: "gpt-burn-operator-quota" },
    OPERATOR_SESSION_COOKIE,
  );

  assert.equal(status, 200, JSON.stringify(body));
  const setModel = wrapper.calls.sent.filter((command) => command.type === "set_model");
  assert.equal(setModel.length, 1);
  assert.equal(setModel[0].provider, "openai");
  assert.equal(setModel[0].modelId, "gpt-burn-operator-quota");
});

test("B1 边界：普通用户自己会话上的普通命令不受影响", async (t) => {
  const wrapper = makeRecordingWrapper();
  installFakeRegistry(t, wrapper);

  const { status, body } = await post({ type: "get_state" }, ORDINARY_COOKIE);

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(wrapper.calls.sent.length, 1);
  assert.equal(wrapper.calls.sent[0].type, "get_state");
});
