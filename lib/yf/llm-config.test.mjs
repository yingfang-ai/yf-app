import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  LLM_CHANNEL_PROVIDER_ID,
  llmConfigPath,
  llmConfigView,
  readLlmConfig,
  writeLlmConfig,
} = await jiti.import("./llm-config.ts");

function freshRoot() {
  return mkdtempSync(path.join(tmpdir(), "yf-llm-config-"));
}

test("write/read round trip under the data root (llm/config.json)", () => {
  const root = freshRoot();
  try {
    const config = { base_url: "http://127.0.0.1:9/v1", key: "sk-test", model_id: "m-1" };
    writeLlmConfig(config, root);
    assert.equal(existsSync(llmConfigPath(root)), true);
    assert.deepEqual(readLlmConfig(root), config);
    // 0600（key 明文只存服务端数据根，不进仓不进日志）。
    const mode = statSync(llmConfigPath(root)).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readLlmConfig: unconfigured or unparsable → null (no silent fallback)", () => {
  const root = freshRoot();
  try {
    assert.equal(readLlmConfig(root), null);
    mkdirSync(path.join(root, "llm"), { recursive: true });
    writeFileSync(llmConfigPath(root), "{not json", { encoding: "utf8" });
    assert.equal(readLlmConfig(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the view never carries the key: key_configured is boolean only", () => {
  const config = { base_url: "http://x/v1", key: "sk-secret-value", model_id: "m" };
  const view = llmConfigView(config);
  assert.deepEqual(view, { base_url: "http://x/v1", model_id: "m", key_configured: true });
  assert.equal(JSON.stringify(view).includes("sk-secret-value"), false);
  assert.equal(llmConfigView({ ...config, key: "" }).key_configured, false);
});

test("writeLlmConfig refuses an incomplete payload", () => {
  const root = freshRoot();
  try {
    assert.throws(() => writeLlmConfig({ base_url: "", key: "k", model_id: "m" }, root));
    assert.throws(() => writeLlmConfig({ base_url: "b", key: "k" }, root));
    assert.equal(existsSync(llmConfigPath(root)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("llmChannelModelRuntime generates the runtime models.json with the channel provider", async () => {
  const { llmChannelModelRuntime } = await jiti.import("./llm-config.ts");
  const root = freshRoot();
  try {
    const config = { base_url: "http://127.0.0.1:9/v1", key: "sk-test", model_id: "m-1" };
    const runtime = await llmChannelModelRuntime(config, root);
    const generated = JSON.parse(readFileSync(path.join(root, "llm", "runtime-models.json"), "utf8"));
    assert.deepEqual(generated.providers[LLM_CHANNEL_PROVIDER_ID].baseUrl, "http://127.0.0.1:9/v1");
    assert.deepEqual(generated.providers[LLM_CHANNEL_PROVIDER_ID].models.map((m) => m.id), ["m-1"]);
    // 派生文件同样 0600，且 ModelRuntime 能解析出通道模型。
    assert.equal(statSync(path.join(root, "llm", "runtime-models.json")).mode & 0o777, 0o600);
    assert.ok(runtime.getModel(LLM_CHANNEL_PROVIDER_ID, "m-1"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});