import assert from "node:assert/strict";
import test from "node:test";

import { flattenTree } from "./linear.ts";

function node(roundId, parentRoundId, enqueuedAt) {
  return {
    round_id: roundId,
    parent_round_id: parentRoundId,
    branch_kind: parentRoundId ? "refine" : "refine",
    state: "done",
    n: 4,
    seed: 7,
    model_id: "Z-Image-Turbo",
    backend_id: "zimage-turbo",
    cancel_tombstone: false,
    enqueued_at: enqueuedAt,
  };
}

test("a multi-round conversation (refine + redirect) flattens to a linear time-ordered stream", () => {
  const rounds = [
    node("r2", "r1", "2026-10-14T00:10:00.000Z"),
    node("r1", null, "2026-10-14T00:00:00.000Z"),
    node("r3", "r1", "2026-10-14T00:20:00.000Z"),
  ];
  const flat = flattenTree(rounds);
  assert.deepEqual(flat.map((round) => round.round_id), ["r1", "r2", "r3"]);
});

test("children always come after their parent even when enqueued timestamps tie", () => {
  const rounds = [
    node("child", "root", "2026-10-14T00:00:00.000Z"),
    node("root", null, "2026-10-14T00:00:00.000Z"),
  ];
  const flat = flattenTree(rounds);
  assert.deepEqual(flat.map((round) => round.round_id), ["root", "child"]);
});

test("orphans and cycles cannot crash the flattener (depth-0 fallback)", () => {
  const rounds = [
    node("ghost-child", "missing-parent", "2026-10-14T00:30:00.000Z"),
    node("loop-a", "loop-b", "2026-10-14T00:40:00.000Z"),
    node("loop-b", "loop-a", "2026-10-14T00:41:00.000Z"),
  ];
  const flat = flattenTree(rounds);
  assert.equal(flat.length, 3);
  assert.ok(flat.every((round) => Number.isFinite(Date.parse(round.enqueued_at))));
});

test("an empty conversation flattens to an empty stream", () => {
  assert.deepEqual(flattenTree([]), []);
});
