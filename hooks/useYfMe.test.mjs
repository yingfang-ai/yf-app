import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

// useYfMe（共享身份读面，verification rewind fix 2）：一个事实一个地方——
// /api/yf/me 只在 hooks/useYfMe.ts 里取，SettingsPanel / SessionSidebar 的
// 运营者入口都经它判定。这里测单飞共享与降级路径，组件侧的接线由
// SettingsPanel/SessionSidebar 的源级断言覆盖。

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { fetchYfMe } = await jiti.import("./useYfMe.ts");

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

test("one flight is shared: repeated reads never re-fetch /api/yf/me", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ user_id: "unit-user", operator: true, gallery_root: "/data/gallery/unit-user" }),
      { headers: { "content-type": "application/json" } },
    );
  };
  const first = await fetchYfMe();
  const second = await fetchYfMe();
  assert.equal(first?.user_id, "unit-user");
  assert.equal(first?.operator, true);
  assert.equal(first?.gallery_root, "/data/gallery/unit-user");
  assert.equal(calls, 1, "the module-level promise must be shared, not re-fetched");
  assert.equal(second, first, "the same resolved identity object comes back");
});

test("the hook degrades to null (ordinary-user treatment) on a non-OK answer or a network failure", () => {
  const source = readFileSync(new URL("./useYfMe.ts", import.meta.url), "utf8");
  // 401（匿名/伪造）与 fetch 异常都归 null：UI 按普通用户处理，不闪运营者面。
  assert.match(source, /if \(!response\.ok\) return null;/);
  assert.match(source, /\.catch\(\(\) => null\)/);
  assert.match(source, /if \(!cancelled && data\) setMe\(data\);/);
  assert.match(source, /export function useYfMe\(\): YfMe \| null \{/);
});
test("a failed read is not cached: the next read fetches /api/yf/me again (yingfang#30 N4)", async () => {
  // A fresh module instance, so the identity cached by the test above does not leak in.
  const fresh = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
  const { fetchYfMe: fetchFresh } = await fresh.import("./useYfMe.ts");
  const answers = [
    () => new Response("upstream down", { status: 502 }),
    () => { throw new TypeError("network down"); },
    () => new Response(JSON.stringify({ user_id: "op-user", operator: true }), { headers: { "content-type": "application/json" } }),
  ];
  let calls = 0;
  globalThis.fetch = async () => answers[calls++]();

  assert.equal(await fetchFresh(), null, "a non-OK answer degrades to null");
  assert.equal(await fetchFresh(), null, "a network failure degrades to null");
  const me = await fetchFresh();
  assert.equal(me?.operator, true, "the identity is read once the endpoint answers");
  assert.equal(calls, 3, "each failure was retried by the next read");
  assert.equal(await fetchFresh(), me, "a successful read is still shared");
  assert.equal(calls, 3);
});
