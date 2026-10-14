import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateIndexes,
  loadRoundImages,
  needsResign,
  presignSlot,
  refreshDueSlots,
  RESIGN_MARGIN_MS,
} from "./images.ts";
import { YfApiError } from "./api.ts";

function apiError(status, code) {
  return new YfApiError(status, code, code);
}

function presignStub(handler) {
  const calls = [];
  return {
    calls,
    presign: async (roundId, idx, epoch) => {
      calls.push({ roundId, idx, epoch });
      return handler(roundId, idx, epoch);
    },
  };
}

test("candidateIndexes derives 0..n-1 and clamps into the contract guardrail", () => {
  assert.deepEqual(candidateIndexes(1), [0]);
  assert.deepEqual(candidateIndexes(4), [0, 1, 2, 3]);
  assert.deepEqual(candidateIndexes(0), [0]);
  assert.deepEqual(candidateIndexes(99).length, 16);
});

test("presignSlot maps contract outcomes to honest slot states", async () => {
  const missing = await presignSlot("r1", 0, async () => {
    throw apiError(404, "not_found");
  });
  assert.equal(missing.status, "not-produced");

  const unavailable = await presignSlot("r1", 1, async () => {
    throw apiError(503, "presign_unavailable");
  });
  assert.equal(unavailable.status, "unavailable");

  const broken = await presignSlot("r1", 2, async () => {
    throw new Error("socket down");
  });
  assert.equal(broken.status, "error");

  const stub = presignStub(() => ({
    round_id: "r1", idx: 3, epoch: 0, url: "https://obj/signed?exp=1", expires_at: "2026-10-14T00:15:00.000Z",
  }));
  const ready = await presignSlot("r1", 3, stub.presign);
  assert.equal(ready.status, "ready");
  assert.equal(ready.url, "https://obj/signed?exp=1");
  assert.equal(stub.calls[0].epoch, 0, "candidate epoch is 0");
});

test("loadRoundImages fills one slot per candidate idx", async () => {
  const stub = presignStub((_roundId, idx) => ({
    round_id: "r1", idx, epoch: 0, url: `https://obj/img-${idx}`, expires_at: "2026-10-14T00:15:00.000Z",
  }));
  const slots = await loadRoundImages("r1", 3, stub.presign);
  assert.deepEqual(slots.map((slot) => slot.idx), [0, 1, 2]);
  assert.ok(slots.every((slot) => slot.status === "ready"));
});

test("needsResign fires inside the safety margin and after expiry only", () => {
  const now = 1_000_000_000_000;
  const fresh= { idx: 0, epoch: 0, status: "ready", url: "u", expiresAt: now + RESIGN_MARGIN_MS + 60_000 };
  const dueSoon= { idx: 0, epoch: 0, status: "ready", url: "u", expiresAt: now + RESIGN_MARGIN_MS - 1 };
  const expired= { idx: 0, epoch: 0, status: "ready", url: "u", expiresAt: now - 1 };
  assert.equal(needsResign(fresh, now), false);
  assert.equal(needsResign(dueSoon, now), true);
  assert.equal(needsResign(expired, now), true);
  assert.equal(needsResign({ idx: 0, epoch: 0, status: "not-produced" }, now), false);
});

test("refreshDueSlots re-signs only the due slots", async () => {
  const now = 1_000_000_000_000;
  const fresh= { idx: 0, epoch: 0, status: "ready", url: "u0", expiresAt: now + RESIGN_MARGIN_MS + 60_000 };
  const due= { idx: 1, epoch: 0, status: "ready", url: "u1", expiresAt: now - 1 };
  const stub = presignStub((_roundId, idx) => ({
    round_id: "r1", idx, epoch: 0, url: `https://obj/new-${idx}`, expires_at: new Date(now + 900_000).toISOString(),
  }));
  const slots = await refreshDueSlots("r1", [fresh, due], stub.presign, now);
  assert.equal(slots[0].url, "u0", "fresh slot untouched");
  assert.equal(slots[1].url, "https://obj/new-1");
  assert.deepEqual(stub.calls.map((call) => call.idx), [1]);
});

