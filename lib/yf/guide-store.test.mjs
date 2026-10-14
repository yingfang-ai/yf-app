import assert from "node:assert/strict";
import test from "node:test";

import {
  appendGuideTurn,
  clearGuideHistory,
  listGuideConvs,
  loadGuideHistory,
} from "./guide-store.ts";

function withFakeStorage(fn) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
      key: (index) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  };
  try {
    return fn({ store });
  } finally {
    delete globalThis.window;
  }
}

test("guide history is a linear per-conv array under the yf.guide. prefix", () => {
  withFakeStorage(({ store }) => {
    const conv = "c".repeat(32);
    assert.deepEqual(loadGuideHistory(conv), []);
    appendGuideTurn(conv, { role: "user", content: "画一只猫", at: "2026-10-14T00:00:00.000Z" });
    appendGuideTurn(conv, { role: "assistant", content: "白天还是夜晚？", at: "2026-10-14T00:00:01.000Z" });
    const turns = loadGuideHistory(conv);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].role, "user");
    assert.equal(turns[1].role, "assistant");
    // 键控形态：yf.guide.<conv_id>。
    assert.deepEqual([...store.keys()], [`yf.guide.${conv}`]);
  });
});

test("corrupt or non-array payloads degrade to an empty history", () => {
  withFakeStorage(({ store }) => {
    const conv = "d".repeat(32);
    store.set(`yf.guide.${conv}`, "{not json");
    assert.deepEqual(loadGuideHistory(conv), []);
    store.set(`yf.guide.${conv}`, JSON.stringify({ not: "an array" }));
    assert.deepEqual(loadGuideHistory(conv), []);
    store.set(`yf.guide.${conv}`, JSON.stringify([{ role: "user", content: "ok", at: "" }, { junk: true }, 5]));
    const turns = loadGuideHistory(conv);
    assert.equal(turns.length, 1);
  });
});

test("clearGuideHistory removes the conv key entirely", () => {
  withFakeStorage(({ store }) => {
    const conv = "e".repeat(32);
    appendGuideTurn(conv, { role: "user", content: "x", at: "" });
    clearGuideHistory(conv);
    assert.deepEqual([...store.keys()], []);
    assert.deepEqual(loadGuideHistory(conv), []);
  });
});

test("listGuideConvs orders by latest turn, newest first", () => {
  withFakeStorage(() => {
    const older = "1".repeat(32);
    const newer = "2".repeat(32);
    appendGuideTurn(older, { role: "user", content: "old", at: "2026-10-14T00:00:00.000Z" });
    appendGuideTurn(newer, { role: "user", content: "new", at: "2026-10-14T09:00:00.000Z" });
    assert.deepEqual(listGuideConvs(), [newer, older]);
  });
});
