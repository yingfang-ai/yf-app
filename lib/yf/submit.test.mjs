import assert from "node:assert/strict";
import test from "node:test";

import { buildSubmitRequest, submitWork } from "./submit.ts";

const REQUEST = {
  backendId: "zimage-turbo",
  prompt: "一只橘猫在窗台晒太阳",
  negativePrompt: "",
  n: 4,
  seed: -1,
  params: { width: "1024", height: "1024" },
};

test("buildSubmitRequest emits exactly the wire schema field set (omitted by default)", () => {
  const payload = buildSubmitRequest("c".repeat(32), REQUEST);
  assert.deepEqual(Object.keys(payload).sort(), ["backend_id", "branch_kind", "conv_id", "n", "params", "prompt", "seed"].sort());
  assert.equal(payload.branch_kind, "refine");
  assert.ok(!("parent_round_id" in payload));
  assert.ok(!("negative_prompt" in payload), "empty negative_prompt must stay out of the payload");
});

test("buildSubmitRequest carries the parent ref and non-empty optional fields", () => {
  const payload = buildSubmitRequest(
    "c".repeat(32),
    { ...REQUEST, negativePrompt: " 模糊 ", params: { width: "1024", "": "junk" } },
    { roundId: "r".repeat(32) },
  );
  assert.equal(payload.parent_round_id, "r".repeat(32));
  assert.equal(payload.branch_kind, "refine");
  assert.equal(payload.negative_prompt, "模糊");
});

test("an explicit redirect parent keeps branch_kind=redirect", () => {
  const payload = buildSubmitRequest("c".repeat(32), REQUEST, { roundId: "r1", branchKind: "redirect" });
  assert.equal(payload.branch_kind, "redirect");
});

test("submitWork lazily creates the conv when none exists", async () => {
  const calls = [];
  const created = [];
  const round = await submitWork(null, REQUEST, null, {
    createConv: async () => {
      created.push(1);
      return { conv_id: "c".repeat(32) };
    },
    submitRound: async (convId, payload) => {
      calls.push({ convId, payload });
      return {
        round_id: "r".repeat(32),
        backend_id: "zimage-turbo",
        n: 4,
        unit_price_micros: 1000000,
        hold_micros: 4000000,
        enqueued_at: "2026-10-14T00:00:00.000Z",
      };
    },
  });
  assert.equal(created.length, 1);
  assert.equal(round.convId, "c".repeat(32));
  assert.equal(round.round.round_id, "r".repeat(32));
  assert.equal(calls[0].payload.conv_id, round.convId);
});

test("submitWork reuses the existing conv when one is already open", async () => {
  let created = 0;
  const round = await submitWork("c".repeat(32), REQUEST, null, {
    createConv: async () => {
      created += 1;
      return { conv_id: "unexpected" };
    },
    submitRound: async (convId) => {
      assert.equal(convId, "c".repeat(32));
      return {
        round_id: "r".repeat(32),
        backend_id: "zimage-turbo",
        n: 4,
        unit_price_micros: 1000000,
        hold_micros: 4000000,
        enqueued_at: "2026-10-14T00:00:00.000Z",
      };
    },
  });
  assert.equal(created, 0);
  assert.equal(round.convId, "c".repeat(32));
});

test("contract error envelopes propagate verbatim (rate_limited shape)", async () => {
  class FakeRateLimited extends Error {
    constructor() {
      super("太快了");
      this.name = "YfApiError";
    }
  }
  await assert.rejects(
    submitWork("c".repeat(32), REQUEST, null, {
      submitRound: async () => {
        throw new FakeRateLimited();
      },
    }),
    FakeRateLimited,
  );
});
