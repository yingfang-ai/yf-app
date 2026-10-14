import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDE_MAX_N,
  clampN,
  clampSeed,
  extractDraftBlock,
  normalizeDraft,
} from "./guide-protocol.ts";

test("extractDraftBlock finds the last fenced block and strips it from the reply", () => {
  const text = [
    "好的，我补全了画面：一只橘猫在窗台晒太阳。",
    "```yf-draft",
    '{"prompt":"一只橘猫在窗台晒太阳","n":4}',
    "```",
  ].join("\n");
  const { reply, block } = extractDraftBlock(text);
  assert.equal(reply, "好的，我补全了画面：一只橘猫在窗台晒太阳。");
  assert.deepEqual(block, { prompt: "一只橘猫在窗台晒太阳", n: 4 });
});

test("extractDraftBlock without a block returns the whole text and null", () => {
  const { reply, block } = extractDraftBlock("还差一个信息：画面是白天还是夜晚？");
  assert.equal(reply, "还差一个信息：画面是白天还是夜晚？");
  assert.equal(block, null);
});

test("extractDraftBlock with an unparsable block degrades to no draft", () => {
  const text = "先这样。\n```yf-draft\n{oops\n```";
  const { block } = extractDraftBlock(text);
  assert.equal(block, null);
});

test("clampN keeps n within the product range and defaults when missing", () => {
  assert.equal(clampN(undefined), GUIDE_MAX_N);
  assert.equal(clampN(Number.NaN), GUIDE_MAX_N);
  assert.equal(clampN(0), 1);
  assert.equal(clampN(3.6), 4);
  assert.equal(clampN(16), GUIDE_MAX_N);
});

test("clampSeed defaults to -1 (backend picks) and rounds fractional input", () => {
  assert.equal(clampSeed(undefined), -1);
  assert.equal(clampSeed(Number.NaN), -1);
  assert.equal(clampSeed(7), 7);
  assert.equal(clampSeed(7.9), 8);
});

test("normalizeDraft fills defaults and drops empty optional fields", () => {
  const draft = normalizeDraft({ prompt: "一只橘猫", n: 99, seed: 7.9, negative_prompt: "  ", params: { width: "1024", "": "x" } });
  assert.equal(draft.n, GUIDE_MAX_N);
  assert.equal(draft.seed, 8);
  assert.equal(draft.negative_prompt, undefined);
  assert.deepEqual(draft.params, { width: "1024" });
});

test("normalizeDraft rejects blocks without a prompt", () => {
  assert.equal(normalizeDraft({ n: 4 }), null);
  assert.equal(normalizeDraft("not an object"), null);
});
