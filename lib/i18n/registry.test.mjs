import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getLocalePlugin,
  getSupportedLocales,
  resolveBrowserLocale,
} = await jiti.import("./registry.ts");

test("the product resolves every browser language to zh-CN (single-locale, R12)", () => {
  for (const languages of [["zh-CN", "en-US"], ["en-US"], ["zh-TW"], ["fr-FR"], []]) {
    assert.equal(resolveBrowserLocale(languages), "zh-CN");
  }
});

test("returns only registered locales", () => {
  assert.deepEqual(getSupportedLocales(), ["zh-CN"]);
  assert.equal(getLocalePlugin("zh-CN").id, "zh-CN");
  assert.equal(getLocalePlugin("en"), undefined);
  assert.equal(getLocalePlugin("zh-TW"), undefined);
  assert.equal(getLocalePlugin("missing"), undefined);
});

test("preserves upstream sidebar keys alongside the fork directory picker", () => {
  const upstreamKeys = [
    "sidebar.selectProject",
    "sidebar.filterProjects",
    "sidebar.noMatchingProjects",
    "sidebar.useDefaultDirectory",
    "sidebar.customPath",
    "sidebar.uploadFiles",
    "sidebar.worktreePath",
    "sidebar.removeWorktreeTitle",
  ];
  for (const locale of getSupportedLocales()) {
    const messages = getLocalePlugin(locale).messages;
    for (const key of upstreamKeys) {
      assert.equal(typeof messages[key], "string", `${locale}.${key} must survive upstream sync`);
      assert.ok(messages[key].trim(), `${locale}.${key} must not be empty`);
    }
    assert.ok(messages["directoryPicker.entriesTitle"]);
    assert.ok(messages["sidebar.renameDirectory"]);
  }
});

test("zh-CN messages are complete strings with well-formed placeholders", () => {
  const messages = getLocalePlugin("zh-CN").messages;
  for (const [key, message] of Object.entries(messages)) {
    assert.equal(typeof message, "string", key);
    assert.ok(!/\{[^}]*$/.test(message), `${key} has an unterminated placeholder`);
  }
});
