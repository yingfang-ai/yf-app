import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// conv 续接存储（verification rewind 补丁）：`yf.conv.<user_id>` 按用户分键，
// 登出清全部 `yf.conv.*`——换号登录不复用上一个用户的 conv_id。

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const {
  currentConvKey,
  readCurrentConvId,
  storeCurrentConvId,
  clearAllConvKeys,
} = await jiti.import("./conv-storage.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("the conv key is per user: another user's stored conv is invisible", () => {
  const storage = createStorage({
    "yf.user_id": "user-b",
    "yf.conv.user-a": "conv-of-a",
    "yf.conv.user-b": "conv-of-b",
  });
  assert.equal(currentConvKey(storage), "yf.conv.user-b");
  assert.equal(readCurrentConvId(storage), "conv-of-b");
  // 上一个用户的键在，但读不到（换号不复用）。
  storeCurrentConvId("conv-new", storage);
  assert.equal(storage.getItem("yf.conv.user-b"), "conv-new");
  assert.equal(storage.getItem("yf.conv.user-a"), "conv-of-a", "别人的键不动，只清登出");
});

test("no remembered user id (or no storage) degrades to no reuse", () => {
  assert.equal(currentConvKey(createStorage({})), null);
  assert.equal(readCurrentConvId(createStorage({ "yf.user_id": "u" })), null);
  assert.equal(currentConvKey(null), null);
  assert.equal(readCurrentConvId(null), null);
  // 写入也不抛（无键可写即不写）。
  assert.doesNotThrow(() => storeCurrentConvId("c", null));
});

test("logout clears every yf.conv.* key and nothing else", () => {
  const storage = createStorage({
    "yf.user_id": "user-a",
    "yf.conv.user-a": "conv-of-a",
    "yf.conv.user-b": "conv-of-b",
    "yf.round.some-session": "{\"convId\":\"c\",\"roundId\":\"r\"}",
    "yf.user_id.backup": "unrelated",
  });
  clearAllConvKeys(storage);
  assert.equal(storage.getItem("yf.conv.user-a"), null);
  assert.equal(storage.getItem("yf.conv.user-b"), null);
  assert.equal(storage.getItem("yf.round.some-session"), "{\"convId\":\"c\",\"roundId\":\"r\"}");
  assert.equal(storage.getItem("yf.user_id"), "user-a");
  assert.equal(storage.getItem("yf.user_id.backup"), "unrelated");
});