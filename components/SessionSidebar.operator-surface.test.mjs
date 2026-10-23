import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 运营者面入口的源级断言（verification rewind fix 2，R5）：普通用户的侧边栏
// 不渲染任意目录浏览入口（add-directory 工具钮与两个 DirectoryPicker）。
// 身份经共享读面 useYfMe 判定；me=null（未加载/匿名）按普通用户处理。
// 渲染级验证受限于 renderToStaticMarkup 不跑 effect（身份永远 null），故
// 按本仓既有源级断言惯例（见 DraftConfirmCard.test.mjs）锁住接线。

const source = readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("the sidebar reads identity through the shared useYfMe hook", () => {
  assert.match(source, /import \{ useYfMe \} from "@\/hooks\/useYfMe";/);
  assert.match(source, /const me = useYfMe\(\);/);
  assert.match(source, /const isOperator = me\?\.operator === true;/);
});

test("the add-directory toolbar button renders only for operators", () => {
  const onClick = source.indexOf("setAddDirectoryOpen(true)");
  assert.ok(onClick > 0, "the picker opener must exist");
  const guard = source.lastIndexOf("{isOperator && (", onClick);
  assert.ok(guard > 0, "the add-directory button must sit inside an isOperator JSX guard");
  const between = source.slice(guard, onClick);
  assert.match(between, /<button/, "the guard wraps the button itself");
  assert.equal(between.includes(")}"), false, "no JSX expression closes between the guard and the button");
});

test("both DirectoryPicker surfaces render only for operators", () => {
  assert.match(source, /\{isOperator && customPathOpen && \(/);
  assert.match(source, /\{isOperator && addDirectoryOpen && \(/);
  // 无守卫的旧形态不再出现（守卫必须包住 picker，而不是只在别处判定）。
  assert.doesNotMatch(source, /\{customPathOpen && \(/);
  assert.doesNotMatch(source, /\{addDirectoryOpen && \(/);
});