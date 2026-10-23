import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  deleteSessionIndex,
  readSessionIndex,
  sessionIndexTokenHash,
  sessionIndexPath,
  writeSessionIndex,
  yfSessionTokenFromCookie,
} = await jiti.import("./session-index.ts");

function freshRoot() {
  return mkdtempSync(path.join(tmpdir(), "yf-session-index-"));
}

test("yfSessionTokenFromCookie extracts the yf_session token from cookie headers", () => {
  assert.equal(yfSessionTokenFromCookie("yf_session=abc"), "abc");
  assert.equal(yfSessionTokenFromCookie("other=1; yf_session=abc; x=2"), "abc");
  assert.equal(yfSessionTokenFromCookie("yf_session="), null);
  assert.equal(yfSessionTokenFromCookie(null), null);
  assert.equal(yfSessionTokenFromCookie("other=1"), null);
});

test("the index stores only sha256(token), never the token itself", () => {
  const root = freshRoot();
  try {
    const token = "t".repeat(32);
    writeSessionIndex(root, token, { user_id: "u".repeat(32), expires_at: "2026-01-01T00:00:00Z" });
    const files = readdirSync(path.join(root, "session-index"));
    assert.equal(files.length, 1);
    assert.equal(files[0], `${sessionIndexTokenHash(token)}.json`);
    assert.equal(sessionIndexPath(root, token), path.join(root, "session-index", files[0]));
    // 索引目录里没有 token 明文。
    assert.ok(!JSON.stringify(files).includes(token));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write/read/delete round trip; delete is idempotent", () => {
  const root = freshRoot();
  try {
    const token = "a".repeat(32);
    const entry = { user_id: "0".repeat(32), expires_at: "2030-01-01T00:00:00Z" };
    writeSessionIndex(root, token, entry);
    assert.deepEqual(readSessionIndex(root, token), entry);
    deleteSessionIndex(root, token);
    assert.equal(readSessionIndex(root, token), null);
    // 幂等：不存在的索引删除不抛。
    deleteSessionIndex(root, token);
    assert.equal(existsSync(path.join(root, "session-index")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSessionIndex returns null for unknown or unparsable entries (fail closed)", () => {
  const root = freshRoot();
  try {
    assert.equal(readSessionIndex(root, "b".repeat(32)), null);
    mkdirSync(path.join(root, "session-index"), { recursive: true });
    const broken = sessionIndexPath(root, "c".repeat(32));
    writeFileSync(broken, "{not json", { encoding: "utf8" });
    assert.equal(readSessionIndex(root, "c".repeat(32)), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});