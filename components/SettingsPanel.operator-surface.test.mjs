import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 设置面板运营者分区的源级断言（verification rewind fix 2，R5）：llm/skills/
// agents/plugins/polyforge 五个分区对普通用户不存在——tab 导航、移动端下拉、
// 内容宿主与「恢复到不可见分区」的回退都经 isSettingsSectionVisible（纯函数
// 的行为由 lib/settings-navigation.test.mjs 覆盖）。渲染级验证受限于
// renderToStaticMarkup 不跑 effect（身份永远 null），故按本仓既有源级断言
// 惯例锁住接线。

const source = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

test("the panel reads identity through the shared useYfMe hook", () => {
  assert.match(source, /import \{ useYfMe \} from "@\/hooks\/useYfMe";/);
  assert.match(source, /const me = useYfMe\(\);/);
  assert.match(source, /const isOperator = me\?\.operator === true;/);
});

test("the section list is filtered by the shared visibility rule, not re-derived", () => {
  assert.match(source, /isSettingsSectionVisible/);
  assert.match(source, /\.filter\(\(item\) => isSettingsSectionVisible\(item\.id, isOperator\)\)/);
  // 旧形态（只有 llm 一个分区按运营者折叠）不再出现。
  assert.doesNotMatch(source, /\.\.\.\(isOperator \? \[\{ id: "llm"/);
});

test("a restored-but-invisible section falls back to general (no operator flash)", () => {
  const fallback = source.indexOf("if (isSettingsSectionVisible(section, isOperator)) return;");
  assert.ok(fallback > 0, "the visibility fallback effect must exist");
  const effect = source.slice(source.lastIndexOf("useEffect(() => {", fallback), fallback + 200);
  assert.match(effect, /setSection\("general"\);/);
  // 内容宿主也按可见分区过滤：普通用户不会 mount 运营者分区内容。
  assert.match(source, /visibleSectionIds\.has\(id\) && mountedSections\.has\(id\)/);
});

test("the push-permission entry (operator-only /api/push) renders only for operators", () => {
  assert.match(source, /\{pushSurfaceOperator && \(/);
  assert.match(source, /const pushSurfaceOperator = me\?\.operator === true;/);
});