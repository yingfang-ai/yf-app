import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { extractDraft, validateDraft, draftToWorkbenchRequest } = await jiti.import("./draft.ts");
const { loadGuideSkillPrompt } = await jiti.import("./guide-skill.ts");

const good = { backend_id: "zimage-turbo", prompt: "一只猫", n: 4, seed: -1 };
const fence = (obj) => "好的，这是草案：\n```yf-draft\n" + JSON.stringify(obj) + "\n```\n请确认。";

test("a valid draft block parses; seed defaults to -1", () => {
  const parsed = extractDraft(fence({ backend_id: "zimage-turbo", prompt: " 一只猫 ", n: 2 }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.draft, { backend_id: "zimage-turbo", prompt: "一只猫", n: 2, seed: -1 });
});

test("the example in the guide skill itself validates (skill and validator cannot drift)", () => {
  const parsed = extractDraft(loadGuideSkillPrompt());
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
});

test("no draft block → null; the last block wins; broken JSON is reported", () => {
  assert.equal(extractDraft("只是聊天，没有草案"), null);
  const two = fence({ ...good, prompt: "第一版" }) + "\n" + fence({ ...good, prompt: "第二版" });
  assert.equal(extractDraft(two).draft.prompt, "第二版");
  assert.deepEqual(extractDraft("```yf-draft\n{oops\n```"), { ok: false, errors: ["草案不是合法 JSON"] });
});

test("values are checked like the enqueue gate: backend list, n range, unknown fields, params", () => {
  const bad = (patch) => validateDraft({ ...good, ...patch });
  assert.equal(bad({ backend_id: "nope" }).ok, false);
  assert.equal(bad({ n: 0 }).ok, false);
  assert.equal(bad({ n: 9 }).ok, false);
  assert.equal(bad({ n: 1.5 }).ok, false);
  assert.equal(bad({ prompt: "  " }).ok, false);
  assert.equal(bad({ seed: "x" }).ok, false);
  assert.equal(bad({ conv_id: "x".repeat(32) }).ok, false, "unknown fields fail closed");
  assert.equal(bad({ params: { width: "1024", height: "1024" } }).ok, true);
  assert.equal(bad({ params: { width: "999" } }).ok, false);
  assert.equal(bad({ params: { steps: "8" } }).ok, false);
  assert.equal(validateDraft([]).ok, false);
});

test("rejections describe the draft only — never a server resource (anti-enumeration)", () => {
  const rejected = validateDraft({ ...good, backend_id: "someone-elses-backend" });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.every((e) => !/round|conv|user|存在/.test(e)));
});

test("a draft maps onto the submit request shape", () => {
  const request = draftToWorkbenchRequest({ ...good, negative_prompt: "模糊", params: { width: "1024" } });
  assert.deepEqual(request, {
    backendId: "zimage-turbo", prompt: "一只猫", negativePrompt: "模糊", n: 4, seed: -1, params: { width: "1024" },
  });
});
