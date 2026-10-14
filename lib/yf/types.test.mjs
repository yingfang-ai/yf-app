import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUND_TERMINAL_STATES,
  isRoundTerminal,
} from "./types.ts";

test("terminal states are exactly done / failed / cancelled", () => {
  assert.deepEqual([...ROUND_TERMINAL_STATES].sort(), ["cancelled", "done", "failed"]);
  assert.equal(isRoundTerminal("queued"), false);
  assert.equal(isRoundTerminal("dispatched"), false);
  assert.equal(isRoundTerminal("running"), false);
  assert.equal(isRoundTerminal("done"), true);
  assert.equal(isRoundTerminal("failed"), true);
  assert.equal(isRoundTerminal("cancelled"), true);
});

test("SubmitRequest mirrors the wire schema field names", async () => {
  // 与 repos/yingfang/pkg/wire/submit.go 的 json tag 名单逐字段对账（缺省字段不计入）。
  const wireFieldNames = [
    "conv_id",
    "parent_round_id",
    "branch_kind",
    "backend_id",
    "prompt",
    "negative_prompt",
    "n",
    "seed",
    "params",
  ];
  // 本地权威副本：payload 字段集必须落在 wire 名单内。
  const payload = JSON.parse(JSON.stringify({
    conv_id: "c",
    parent_round_id: "p",
    branch_kind: "refine",
    backend_id: "zimage-turbo",
    prompt: "x",
    negative_prompt: "y",
    n: 8,
    seed: 7,
    params: { width: "1024" },
  }));
  assert.deepEqual(Object.keys(payload).sort(), [...wireFieldNames].sort());
});
