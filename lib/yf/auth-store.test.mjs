import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSavedUser,
  getSavedUserId,
  managedKeys,
  saveUserId,
} from "./auth-store.ts";

/** 极简 localStorage 桩（node 环境无 window）。 */
function withFakeStorage(fn) {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: storage };
  try {
    return fn({ store, storage });
  } finally {
    globalThis.window = originalWindow;
  }
}

test("user_id is remembered under the yf. prefix and cleared on logout", () => {
  withFakeStorage(({ store }) => {
    assert.equal(getSavedUserId(), null);
    saveUserId("a".repeat(32));
    assert.equal(getSavedUserId(), "a".repeat(32));
    // 键名带 yf. 前缀（plan 定档的 localStorage schema）。
    assert.ok([...store.keys()].every((key) => key.startsWith("yf.")));
    clearSavedUser();
    assert.equal(getSavedUserId(), null);
  });
});

test("the module manages exactly one key and it is not a recovery slot", () => {
  assert.deepEqual([...managedKeys()], ["yf.user_id"]);
  // 审计：本模块没有暴露任何写 recovery 的入口（导出面即纪律面）。
  withFakeStorage(({ store }) => {
    saveUserId("b".repeat(32));
    assert.deepEqual([...store.entries()], [["yf.user_id", "b".repeat(32)]]);
  });
});

test("storage failures degrade to no-prefill instead of throwing", () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    },
  };
  try {
    assert.doesNotThrow(() => saveUserId("c".repeat(32)));
    assert.equal(getSavedUserId(), null);
    assert.doesNotThrow(() => clearSavedUser());
  } finally {
    globalThis.window = originalWindow;
  }
});
