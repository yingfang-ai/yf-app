import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { landRound } = await jiti.import("./land.ts");
const gallery = await jiti.import("./gallery-path.ts");

const USER = "a".repeat(32);
const CONV = "c".repeat(32);
const ROUND = "d".repeat(32);
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

function fakeFetch({ state = "done", n = 2, owner = true } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", cookie: init.headers?.cookie });
    const u = new URL(String(url));
    if (u.pathname === `/api/rounds/${ROUND}`) {
      if (!owner) return new Response(JSON.stringify({ error: { code: "not_found", message: "x" } }), { status: 404 });
      return new Response(JSON.stringify({ state, n, conv_id: CONV }), { status: 200 });
    }
    if (/\/presign$/.test(u.pathname)) {
      const idx = u.pathname.split("/")[5];
      return new Response(JSON.stringify({ url: `http://img.test/o/${idx}.png` }), { status: 200 });
    }
    if (u.host === "img.test") return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    return new Response("?", { status: 500 });
  };
  return { impl, calls };
}

function setup() {
  const dataRoot = mkdtempSync(path.join(tmpdir(), "yf-land-"));
  return { dataRoot, done: () => rmSync(dataRoot, { recursive: true, force: true }) };
}

test("done: images land under gallery/<user>/<conv>/<round>/<idx>.<ext>, with the user's cookie on contract calls only", async () => {
  const { dataRoot, done } = setup();
  try {
    const { impl, calls } = fakeFetch();
    const result = await landRound(ROUND, { upstream: "http://up", cookie: "yf_session=t", userId: USER, dataRoot, fetchImpl: impl });
    assert.deepEqual(result, { ok: true, landed: 2 });
    const dir = path.join(dataRoot, "gallery", USER, CONV, ROUND);
    assert.deepEqual(readdirSync(dir).sort(), ["0.png", "1.png"]);
    assert.equal(readFileSync(path.join(dir, "0.png")).toString("hex"), PNG.toString("hex"));
    for (const call of calls.filter((c) => c.url.startsWith("http://up"))) assert.equal(call.cookie, "yf_session=t");
    for (const call of calls.filter((c) => c.url.startsWith("http://img.test"))) assert.equal(call.cookie, undefined);
  } finally { done(); }
});

test("idempotent: a second land downloads nothing and leaves no duplicates", async () => {
  const { dataRoot, done } = setup();
  try {
    const first = fakeFetch();
    const deps = { upstream: "http://up", cookie: "c", userId: USER, dataRoot };
    await landRound(ROUND, { ...deps, fetchImpl: first.impl });
    const second = fakeFetch();
    const result = await landRound(ROUND, { ...deps, fetchImpl: second.impl });
    assert.deepEqual(result, { ok: true, landed: 2 });
    assert.equal(second.calls.filter((c) => c.url.includes("presign")).length, 0);
    assert.deepEqual(readdirSync(path.join(dataRoot, "gallery", USER, CONV, ROUND)).sort(), ["0.png", "1.png"]);
  } finally { done(); }
});

test("a round that is not done lands nothing and writes no directory", async () => {
  const { dataRoot, done } = setup();
  try {
    for (const state of ["queued", "running", "failed", "cancelled"]) {
      const { impl } = fakeFetch({ state });
      assert.deepEqual(
        await landRound(ROUND, { upstream: "http://up", cookie: "c", userId: USER, dataRoot, fetchImpl: impl }),
        { ok: true, landed: 0 },
      );
    }
    assert.equal(existsSync(path.join(dataRoot, "gallery")), false);
  } finally { done(); }
});

test("someone else's round: the contract's 404 passes through untouched, nothing is written", async () => {
  const { dataRoot, done } = setup();
  try {
    const { impl } = fakeFetch({ owner: false });
    const result = await landRound(ROUND, { upstream: "http://up", cookie: "c", userId: USER, dataRoot, fetchImpl: impl });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(JSON.parse(result.body).error.code, "not_found");
    assert.equal(existsSync(path.join(dataRoot, "gallery")), false);
  } finally { done(); }
});

test("a malformed round id is refused before any upstream call", async () => {
  const { impl, calls } = fakeFetch();
  const result = await landRound("../x", { upstream: "http://up", cookie: "c", userId: USER, dataRoot: "/nonexistent", fetchImpl: impl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(calls.length, 0);
});

test("gallery paths only accept 32-hex ids and known image extensions", () => {
  assert.throws(() => gallery.galleryRoundDir(USER, "../x", ROUND, "/d"));
  assert.equal(gallery.imageExtension("image/jpeg", "http://x/a"), "jpg");
  assert.equal(gallery.imageExtension(null, "http://x/a.webp"), "webp");
  assert.equal(gallery.imageExtension("application/octet-stream", "http://x/a.exe"), "bin");
});
