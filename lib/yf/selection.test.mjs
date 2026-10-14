import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultRefineParent,
  loadSelections,
  selectRoundImage,
} from "./selection.ts";

async function withFakeStorage(fn) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
  try {
    return await fn({ store });
  } finally {
    delete globalThis.window;
  }
}

test("selectRoundImage calls the select endpoint and remembers the conv-level choice", async () => {
  await withFakeStorage(async ({ store }) => {
    const calls = [];
    const { response, memory } = await selectRoundImage("conv1", "round1", 2, 0, async (roundId, idx, epoch) => {
      calls.push({ roundId, idx, epoch });
      return { round_id: roundId, idx, epoch, selected: true };
    });
    assert.equal(response.selected, true);
    assert.deepEqual(calls, [{ roundId: "round1", idx: 2, epoch: 0 }]);
    assert.deepEqual(memory, { round1: 2 });
    assert.deepEqual([...store.keys()], ["yf.selection.conv1"]);
  });
});

test("re-selecting in the same round replaces the choice (at-most-one, idempotent UI)", async () => {
  await withFakeStorage(async () => {
    const select = async (roundId, idx) => ({ round_id: roundId, idx, epoch: 0, selected: true });
    await selectRoundImage("conv1", "round1", 0, 0, select);
    await selectRoundImage("conv1", "round1", 3, 0, select);
    assert.deepEqual(loadSelections("conv1"), { round1: 3 });
  });
});

test("defaultRefineParent is the most recently selected round", async () => {
  await withFakeStorage(async () => {
    assert.equal(defaultRefineParent("conv1"), null);
    const select = async (roundId, idx) => ({ round_id: roundId, idx, epoch: 0, selected: true });
    await selectRoundImage("conv1", "roundA", 0, 0, select);
    await selectRoundImage("conv1", "roundB", 1, 0, select);
    assert.equal(defaultRefineParent("conv1"), "roundB");
    await selectRoundImage("conv1", "roundA", 2, 0, select);
    assert.equal(defaultRefineParent("conv1"), "roundA");
  });
});

test("corrupt memory degrades to empty instead of crashing the read face", () => {
  withFakeStorage(({ store }) => {
    store.set("yf.selection.conv1", "{broken");
    assert.deepEqual(loadSelections("conv1"), {});
    store.set("yf.selection.conv1", JSON.stringify({ round1: 1.5, round2: -1, round3: 4 }));
    assert.deepEqual(loadSelections("conv1"), { round3: 4 });
  });
});
