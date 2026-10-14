import assert from "node:assert/strict";
import test from "node:test";

import {
  YfApiError,
  YfUnauthorizedError,
  createConv,
  getConvTree,
  getRound,
  listConvs,
  login,
  logout,
  presignImage,
  register,
  selectImage,
  submitRound,
  yfApiErrorFrom,
} from "./api.ts";

/** 用可编程的假 fetch 替换全局；返回 (calls, 恢复函数)。 */
function mockFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const call = { url, method: init?.method ?? "GET", body: init?.body, headers: init?.headers };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("register posts invite_code + recovery to /api/register and returns user_id", async () => {
  const mock = mockFetch(() => jsonResponse(201, { user_id: "a".repeat(32) }));
  try {
    const result = await register({ invite_code: "INV-1", recovery: "long-enough" });
    assert.equal(result.user_id, "a".repeat(32));
    assert.equal(mock.calls[0].url, "/api/register");
    assert.equal(mock.calls[0].method, "POST");
    const payload = JSON.parse(mock.calls[0].body);
    assert.deepEqual(Object.keys(payload).sort(), ["invite_code", "recovery"]);
  } finally {
    mock.restore();
  }
});

test("login posts user_id + recovery and keeps the envelope fields", async () => {
  const mock = mockFetch(() =>
    jsonResponse(200, { user_id: "b".repeat(32), expires_at: "2027-01-01T00:00:00.000Z" }),
  );
  try {
    const result = await login({ user_id: "b".repeat(32), recovery: "secret-1" });
    assert.equal(result.expires_at, "2027-01-01T00:00:00.000Z");
    assert.equal(mock.calls[0].url, "/api/login");
  } finally {
    mock.restore();
  }
});

test("logout tolerates the contract 200 and surfaces error envelopes", async () => {
  const ok = mockFetch(() => jsonResponse(200, { ok: true }));
  try {
    await logout();
    assert.equal(ok.calls[0].url, "/api/logout");
  } finally {
    ok.restore();
  }
  const bad = mockFetch(() => jsonResponse(500, { error: { code: "internal", message: "boom" } }));
  try {
    await assert.rejects(logout(), (error) => error instanceof YfApiError && error.code === "internal");
  } finally {
    bad.restore();
  }
});

test("createConv posts to /api/convs; listConvs returns the convs array", async () => {
  const mock = mockFetch((call) =>
    call.url === "/api/convs" && call.method === "POST"
      ? jsonResponse(201, { conv_id: "c".repeat(32) })
      : jsonResponse(200, { convs: [{ conv_id: "c".repeat(32), title: null, created_at: "2026-10-14T00:00:00.000Z" }] }),
  );
  try {
    const created = await createConv();
    assert.equal(created.conv_id, "c".repeat(32));
    assert.deepEqual(JSON.parse(mock.calls[0].body), {});
    const convs = await listConvs();
    assert.equal(convs.length, 1);
    assert.equal(convs[0].title, null);
  } finally {
    mock.restore();
  }
});

test("submitRound sends the full SubmitRequest field set and reads the 202 payload", async () => {
  const mock = mockFetch(() =>
    jsonResponse(202, {
      round_id: "r".repeat(32),
      backend_id: "zimage-turbo",
      n: 8,
      unit_price_micros: 1000000,
      hold_micros: 8000000,
      enqueued_at: "2026-10-14T00:00:00.000Z",
    }),
  );
  try {
    const request = {
      conv_id: "c".repeat(32),
      parent_round_id: "p".repeat(32),
      branch_kind: "refine",
      backend_id: "zimage-turbo",
      prompt: "一只橘猫",
      negative_prompt: "模糊",
      n: 8,
      seed: -1,
      params: { width: "1024" },
    };
    const result = await submitRound(request.conv_id, request);
    assert.equal(result.round_id, "r".repeat(32));
    assert.equal(mock.calls[0].url, `/api/convs/${"c".repeat(32)}/rounds`);
    const payload = JSON.parse(mock.calls[0].body);
    // 载荷字段集与 wire.SubmitRequest 的 json 名单一致（缺省字段不进载荷的不算）。
    assert.deepEqual(
      Object.keys(payload).sort(),
      ["backend_id", "branch_kind", "conv_id", "n", "negative_prompt", "params", "parent_round_id", "prompt", "seed"].sort(),
    );
    assert.equal(payload.negative_prompt, "模糊");
  } finally {
    mock.restore();
  }
});

test("submitRound surfaces rate_limited and bad_request envelopes verbatim", async () => {
  const limited = mockFetch(() =>
    jsonResponse(429, { error: { code: "rate_limited", message: "太快了" } }),
  );
  try {
    await assert.rejects(
      submitRound("c".repeat(32), { conv_id: "c".repeat(32), branch_kind: "refine", backend_id: "zimage-turbo", prompt: "x", n: 1, seed: 1 }),
      (error) => error instanceof YfApiError && error.status === 429 && error.code === "rate_limited",
    );
  } finally {
    limited.restore();
  }
  const badRequest = mockFetch(() =>
    jsonResponse(400, {
      error: {
        code: "bad_request",
        message: "入队被拒",
        details: [{ kind: "malformed", field: "backend_id", detail: "未注册" }],
      },
    }),
  );
  try {
    await assert.rejects(
      submitRound("c".repeat(32), { conv_id: "c".repeat(32), branch_kind: "refine", backend_id: "nope", prompt: "x", n: 1, seed: 1 }),
      (error) =>
        error instanceof YfApiError
        && error.code === "bad_request"
        && error.details?.length === 1
        && error.details[0].field === "backend_id",
    );
  } finally {
    badRequest.restore();
  }
});

test("getRound and getConvTree read the poll/tree faces", async () => {
  const mock = mockFetch((call) => {
    if (call.url === "/api/rounds/r1") {
      return jsonResponse(200, { round_id: "r1", conv_id: "c1", parent_round_id: null, branch_kind: "refine", state: "running", n: 8, seed: 7, model_id: "Z-Image-Turbo", backend_id: "zimage-turbo", hold_micros: 1, enqueued_at: "2026-10-14T00:00:00.000Z" });
    }
    if (call.url === "/api/convs/c1/tree") {
      return jsonResponse(200, { rounds: [{ round_id: "r1", parent_round_id: null, branch_kind: "refine", state: "done", n: 8, seed: 7, model_id: "Z-Image-Turbo", backend_id: "zimage-turbo", cancel_tombstone: false, enqueued_at: "2026-10-14T00:00:00.000Z" }] });
    }
    return jsonResponse(404, { error: { code: "not_found", message: "不存在" } });
  });
  try {
    const round = await getRound("r1");
    assert.equal(round.state, "running");
    const tree = await getConvTree("c1");
    assert.equal(tree[0].cancel_tombstone, false);
  } finally {
    mock.restore();
  }
});

test("selectImage and presignImage hit the per-image endpoints", async () => {
  const mock = mockFetch((call) => {
    if (call.url.endsWith("/select")) {
      return jsonResponse(200, { round_id: "r1", idx: 0, epoch: 0, selected: true });
    }
    if (call.url.endsWith("/presign")) {
      return jsonResponse(200, { round_id: "r1", idx: 0, epoch: 0, url: "https://obj/signed", expires_at: "2026-10-14T00:15:00.000Z" });
    }
    return jsonResponse(404, { error: { code: "not_found", message: "不存在" } });
  });
  try {
    const selected = await selectImage("r1", 0, 0);
    assert.equal(selected.selected, true);
    assert.equal(mock.calls[0].url, "/api/rounds/r1/images/0/0/select");
    assert.equal(mock.calls[0].method, "POST");
    const presigned = await presignImage("r1", 0, 0);
    assert.equal(presigned.url, "https://obj/signed");
    assert.equal(mock.calls[1].url, "/api/rounds/r1/images/0/0/presign");
  } finally {
    mock.restore();
  }
});

test("presign 503 presign_unavailable arrives as a typed error, not a crash", async () => {
  const mock = mockFetch(() =>
    jsonResponse(503, { error: { code: "presign_unavailable", message: "预签名未配置" } }),
  );
  try {
    await assert.rejects(
      presignImage("r1", 0, 0),
      (error) => error instanceof YfApiError && error.status === 503 && error.code === "presign_unavailable",
    );
  } finally {
    mock.restore();
  }
});

test("401 from any contract endpoint becomes YfUnauthorizedError", async () => {
  const mock = mockFetch(() =>
    jsonResponse(401, { error: { code: "unauthorized", message: "未认证" } }),
  );
  try {
    await assert.rejects(listConvs(), YfUnauthorizedError);
    await assert.rejects(getRound("r1"), YfUnauthorizedError);
  } finally {
    mock.restore();
  }
});

test("yfApiErrorFrom degrades a non-envelope body to internal", async () => {
  const error = await yfApiErrorFrom(new Response("<html>boom</html>", { status: 502 }));
  assert.equal(error.code, "internal");
  assert.equal(error.status, 502);
});
