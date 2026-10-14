import assert from "node:assert/strict";
import test from "node:test";

import { nextDelay, pollRoundUntilTerminal } from "./round-poll.ts";

function roundWith(state) {
  return {
    round_id: "r".repeat(32),
    conv_id: "c".repeat(32),
    parent_round_id: null,
    branch_kind: "refine",
    state,
    n: 4,
    seed: 7,
    model_id: "Z-Image-Turbo",
    backend_id: "zimage-turbo",
    hold_micros: 4000000,
    enqueued_at: "2026-10-14T00:00:00.000Z",
  };
}

/** GET-only 轮询的状态序列驱动器。 */
function mockStates(states, afterEach) {
  const calls = [];
  return {
    calls,
    getRound: async (roundId) => {
      calls.push(roundId);
      afterEach?.();
      const state = states[Math.min(calls.length - 1, states.length - 1)];
      return roundWith(state);
    },
  };
}

test("polls GET /api/rounds/{id} until a terminal state and reports the last observation", async () => {
  const mock = mockStates(["queued", "dispatched", "running", "done"]);
  const ticks = [];
  const final = await pollRoundUntilTerminal("r1", {
    getRoundFn: mock.getRound,
    delayFn: async () => {},
    onTick: (round) => ticks.push(round.state),
  });
  assert.equal(final.state, "done");
  assert.equal(mock.calls.length, 4);
  assert.deepEqual(ticks, ["queued", "dispatched", "running", "done"]);
});

test("failed and cancelled are terminal, not just done", async () => {
  for (const state of ["failed", "cancelled"]) {
    const mock = mockStates([state]);
    const final = await pollRoundUntilTerminal("r1", { getRoundFn: mock.getRound, delayFn: async () => {} });
    assert.equal(final.state, state);
  }
});

test("backoff starts at 2s, grows 1.5x and caps at 15s", () => {
  assert.equal(nextDelay(2000), 3000);
  assert.equal(nextDelay(3000), 4500);
  assert.equal(nextDelay(12000), 15000);
  assert.equal(nextDelay(14000), 15000);
});

test("aborting the signal stops the loop before the next GET", async () => {
  const controller = new AbortController();
  const mock = mockStates(["queued"]);
  const attempt = pollRoundUntilTerminal("r1", {
    getRoundFn: mock.getRound,
    delayFn: async () => {
      controller.abort();
    },
    signal: controller.signal,
  });
  await assert.rejects(attempt, /轮询已取消/);
  assert.equal(mock.calls.length, 1);
});

test("errors from the poll face surface verbatim (contract 404 stays a typed error)", async () => {
  class NotFound extends Error {
    constructor() {
      super("不存在");
      this.name = "YfApiError";
    }
  }
  await assert.rejects(
    pollRoundUntilTerminal("missing", {
      getRoundFn: async () => {
        throw new NotFound();
      },
      delayFn: async () => {},
    }),
    NotFound,
  );
});
