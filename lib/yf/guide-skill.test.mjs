import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GUIDE_SKILL_MARKER, loadGuideSkillPrompt, stripFrontmatter } = await jiti.import("./guide-skill.ts");

test("the guide skill carries the stable marker, the draft definition and zh-CN text", () => {
  const prompt = loadGuideSkillPrompt();
  assert.ok(prompt.includes(GUIDE_SKILL_MARKER));
  assert.ok(prompt.includes("草案"));
  assert.ok(prompt.includes("```yf-draft"));
  assert.ok(!prompt.startsWith("---"), "frontmatter is stripped from the injected prompt");
});

test("the documented draft example is valid JSON naming a backend from the static list", async () => {
  const prompt = loadGuideSkillPrompt();
  const block = /```yf-draft\n([\s\S]*?)\n```/.exec(prompt)?.[1];
  assert.ok(block, "draft block present");
  const draft = JSON.parse(block);
  const { default: backends } = await import("../../config/backends.json", { with: { type: "json" } });
  assert.ok(backends.backends.some((b) => b.backend_id === draft.backend_id));
  assert.ok(Number.isInteger(draft.n) && draft.n >= 1 && draft.n <= 8);
});

test("stripFrontmatter keeps text without frontmatter untouched", () => {
  assert.equal(stripFrontmatter("---\nname: x\n---\nbody"), "body");
  assert.equal(stripFrontmatter("plain"), "plain");
});
