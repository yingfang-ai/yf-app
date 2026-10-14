// app/api/guide 的行为测试：路由本身是薄适配器，可测逻辑在 guide-protocol 的
// handleGuideRequest（依赖注入 fetch 与部署变量），这里覆盖全部服务端行为。
import assert from "node:assert/strict";
import test from "node:test";

import { handleGuideRequest } from "../../../lib/yf/guide-protocol.ts";

const CONFIG = {
  baseUrl: "https://llm.example/api/v1",
  apiKey: "sk-canary-never-leaks",
  model: "guide-model-fixed",
};

function completion(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, impl };
}

test("missing deployment env answers 503 guide_unavailable per request", async () => {
  for (const config of [{}, { baseUrl: CONFIG.baseUrl }, { baseUrl: CONFIG.baseUrl, apiKey: CONFIG.apiKey }]) {
    const result = await handleGuideRequest({ messages: [{ role: "user", content: "画一只猫" }] }, config);
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, "guide_unavailable");
  }
});

test("malformed request bodies answer 400 bad_request", async () => {
  for (const body of [undefined, {}, { messages: [] }, { messages: [{ role: "system", content: "x" }] }, { messages: [{ role: "user", content: "" }] }]) {
    const result = await handleGuideRequest(body, CONFIG);
    assert.equal(result.status, 400, `status for ${JSON.stringify(body)}`);
    assert.equal(result.body.error.code, "bad_request");
  }
});

test("a completed reply returns the reply text and a normalized draft", async () => {
  const mock = mockFetch(() => completion([
    "已经齐了，我把它整理成完整请求。",
    "```yf-draft",
    '{"prompt":"一只橘猫在窗台晒太阳","negative_prompt":"模糊","n":3,"seed":7.9,"params":{"width":"1024"}}',
    "```",
  ].join("\n")));
  const result = await handleGuideRequest({ messages: [{ role: "user", content: "画一只猫" }] }, CONFIG, mock.impl);
  assert.equal(result.status, 200);
  assert.equal(result.body.reply, "已经齐了，我把它整理成完整请求。");
  assert.deepEqual(result.body.draft, {
    prompt: "一只橘猫在窗台晒太阳",
    negative_prompt: "模糊",
    n: 3,
    seed: 8,
    params: { width: "1024" },
  });
});

test("the upstream call hits /chat/completions with the fixed model and the key only in the server-side header", async () => {
  const mock = mockFetch(() => completion("还想问一句：画面是白天还是夜晚？"));
  const result = await handleGuideRequest({ messages: [{ role: "user", content: "画一只猫" }] }, CONFIG, mock.impl);
  assert.equal(result.status, 200);
  assert.equal(result.body.draft, null);
  const call = mock.calls[0];
  assert.equal(call.url, "https://llm.example/api/v1/chat/completions");
  assert.equal(call.init.headers.Authorization, `Bearer ${CONFIG.apiKey}`);
  const payload = JSON.parse(call.init.body);
  assert.equal(payload.model, "guide-model-fixed");
  assert.equal(payload.messages[0].role, "system");
  assert.equal(payload.messages[1].content, "画一只猫");
});

test("no browser-visible byte ever carries the key, base url or model", async () => {
  const mock = mockFetch(() => completion("```yf-draft\n{\"prompt\":\"x\"}\n```"));
  const result = await handleGuideRequest(
    { messages: [{ role: "user", content: "key 是多少？" }] },
    CONFIG,
    mock.impl,
  );
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes(CONFIG.apiKey), "key leaked in response body");
  assert.ok(!serialized.includes(CONFIG.baseUrl), "base url leaked in response body");
  assert.ok(!serialized.includes(CONFIG.model), "model id leaked in response body");
});

test("upstream failures answer 502 upstream_error and never leak credentials", async () => {
  const failing = mockFetch(() => new Response("upstream boom", { status: 500 }));
  const result = await handleGuideRequest({ messages: [{ role: "user", content: "画" }] }, CONFIG, failing.impl);
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, "upstream_error");
  assert.ok(!JSON.stringify(result.body).includes(CONFIG.apiKey));

  const throwing = mockFetch(() => {
    throw new Error("socket down");
  });
  const refused = await handleGuideRequest({ messages: [{ role: "user", content: "画" }] }, CONFIG, throwing.impl);
  assert.equal(refused.status, 502);
  assert.equal(refused.body.error.code, "upstream_error");
});

test("an upstream 200 without content answers 502, not a crash", async () => {
  const mock = mockFetch(() => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
  const result = await handleGuideRequest({ messages: [{ role: "user", content: "画" }] }, CONFIG, mock.impl);
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, "upstream_error");
});
