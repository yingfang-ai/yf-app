import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { DraftConfirmCard } = await jiti.import("./DraftConfirmCard.tsx");
const { RoundResultCard, describePhase } = await jiti.import("./RoundResultCard.tsx");

const draft = { backend_id: "zimage-turbo", prompt: "一只在窗边的猫", n: 4, seed: -1, negative_prompt: "模糊" };

test("the confirm card shows backend (id + name), count and prompt — and no price", () => {
  const html = renderToStaticMarkup(React.createElement(DraftConfirmCard, { draft, storageKey: "k" }));
  assert.match(html, /Z-Image-Turbo/);
  assert.match(html, /zimage-turbo/);
  assert.match(html, />4 张</);
  assert.match(html, /一只在窗边的猫/);
  assert.match(html, /确认下单/);
  assert.doesNotMatch(html, /价格|积分|额度|¥|price|hold/i);
});

test("nothing is submitted by rendering: submission lives only behind the confirm click", () => {
  const source = readFileSync(new URL("./DraftConfirmCard.tsx", import.meta.url), "utf8");
  const runCalls = [...source.matchAll(/runDraft\(/g)];
  assert.equal(runCalls.length, 1);
  const confirmBody = source.slice(source.indexOf("const confirm = () => {"), source.indexOf("return (\n    <div className=\"yf-draft-card\""));
  assert.match(confirmBody, /runDraft\(/);
  const effectBody = source.slice(source.indexOf("useEffect(() => {"), source.indexOf("const confirm"));
  assert.doesNotMatch(effectBody, /runDraft/, "the mount effect may only resume a stored round, never submit");
});

test("the chat renders the card only for settled (non-streaming) text blocks with a valid draft", () => {
  const source = readFileSync(new URL("../MessageView.tsx", import.meta.url), "utf8");
  assert.match(source, /!isStreaming && text\.includes\("yf-draft"\) \? extractDraft\(text\) : null/);
  assert.match(source, /draftParse\?\.ok \?/);
});

test("result card: failed/cancelled are announced in chat, done lists gallery files through the files API", () => {
  assert.match(describePhase({ kind: "ended", roundId: "r", state: "failed" }), /没有生成成功/);
  assert.match(describePhase({ kind: "ended", roundId: "r", state: "cancelled" }), /取消/);
  const html = renderToStaticMarkup(React.createElement(RoundResultCard, {
    phase: { kind: "done", roundId: "r", files: ["/data/gallery/u/c/r/0.png"] },
  }));
  assert.match(html, /\/api\/files\/data\/gallery\/u\/c\/r\/0\.png\?type=read/);
  const ended = renderToStaticMarkup(React.createElement(RoundResultCard, { phase: { kind: "ended", roundId: "r", state: "failed" } }));
  assert.doesNotMatch(ended, /<img/);
});
