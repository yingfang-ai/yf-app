import assert from "node:assert/strict";
import test from "node:test";

import { formatRelativeTime, formatUpdatedTime, interpolateMessage, translateMessage } from "./format.ts";

test("interpolates string and numeric parameters", () => {
  assert.equal(interpolateMessage("Hello, {name} ({count})", { name: "yf", count: 2 }), "Hello, yf (2)");
});

test("resolves from the requested locale and returns the key when missing", () => {
  assert.equal(translateMessage("zh-CN", "common.ok", { "zh-CN": { "common.ok": "确定" } }), "确定");
  assert.equal(translateMessage("zh-CN", "missing.key", { "zh-CN": {} }), "missing.key");
});

test("formats relative time using the selected locale", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(formatRelativeTime(new Date("2026-01-01T00:05:00.000Z"), "zh-CN", now), "5分钟后");
  assert.equal(formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), "zh-CN", now), "1小时前");
});

test("shows a clock time today and a relative day for earlier updates", () => {
  const now = new Date(2026, 8, 22, 21, 18, 0);
  const today = new Date(2026, 8, 22, 9, 5, 0);
  const earlier = new Date(2026, 8, 19, 21, 18, 0);
  assert.equal(
    formatUpdatedTime(today.getTime(), "zh-CN", now),
    today.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  );
  assert.equal(formatUpdatedTime(earlier.getTime(), "zh-CN", now), "3天前");
});
