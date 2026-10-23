import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

// yingfang#31 review rewind（第 3 轮，review FAIL 的 blocking 项）：ChatWindow 传给
// ChatInput 的 onSetDefaultThinkingLevel（「设为默认思考等级」星标，PUT
// /api/models/default，requireOperator 守卫）必须按 operatorSession 门控——普通用户
// 会话拿到这个星标，点击必然 403 并弹出英文错误。
//
// 星标只渲染在思考等级下拉的 thinkingDropdownOpen 分支里（components/ChatInput.tsx
// 的 SelectorRow star），下拉默认闭合，renderToStaticMarkup 静态渲染看不到它；因此按
// review 裁决允许的口径，在 ChatWindow 的 prop 传递层断言：用 TS AST 取出
// <ChatInput 的 onSetDefaultThinkingLevel 属性的真实表达式，代入四种
// (operatorSession, session, isNew) 组合执行——普通用户必须是 undefined，运营者
// 会话拿得到（正向对照）。旧代码（session || isNew 门控）在普通用户两行上必红。

const source = ts.createSourceFile(
  "ChatWindow.tsx",
  readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function chatInputDefaultThinkingExpression() {
  let found = null;
  (function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "ChatInput"
    ) {
      // 主聊天输入是自闭合元素（<ChatInput ... />），引用输入（quoteChatInput）
      // 也是；只有带 onSetDefaultThinkingLevel 属性的那个才是本断言的对象。
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText(source) === "onSetDefaultThinkingLevel") {
          assert.ok(
            ts.isJsxExpression(prop.initializer) && prop.initializer.expression,
            "onSetDefaultThinkingLevel must be a {expression} attribute",
          );
          assert.ok(found === null, "ChatWindow passes onSetDefaultThinkingLevel more than once");
          found = prop.initializer.expression.getText(source);
        }
      }
    }
    ts.forEachChild(node, visit);
  })(source);
  return found;
}

test("the save-default-thinking star stays operator-only (yingfang#31 A6, review round 2)", () => {
  const expr = chatInputDefaultThinkingExpression();
  assert.ok(expr, "ChatWindow must pass onSetDefaultThinkingLevel into ChatInput");
  const value = new Script(
    ts.transpileModule(`(${expr})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
  );
  const fn = () => {};
  const cases = [
    // 普通用户的既有会话：拿不到星标（PUT /api/models/default 仅运营者，点击必 403）。
    [{ operatorSession: false, session: { id: "s" }, isNew: false }, undefined],
    // 普通用户的新建会话：同样拿不到。
    [{ operatorSession: false, session: null, isNew: true }, undefined],
    // 正向对照：运营者的既有会话与新建会话都拿得到。
    [{ operatorSession: true, session: { id: "s" }, isNew: false }, fn],
    [{ operatorSession: true, session: null, isNew: true }, fn],
    // 运营者但既无会话也非新建：基线口径，不挂。
    [{ operatorSession: true, session: null, isNew: false }, undefined],
  ];
  for (const [scope, expected] of cases) {
    const got = value.runInNewContext({ ...scope, handleSetDefaultThinkingLevel: fn });
    assert.strictEqual(
      got,
      expected,
      `onSetDefaultThinkingLevel for ${JSON.stringify(scope)}`,
    );
  }
});
