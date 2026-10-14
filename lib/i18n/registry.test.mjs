import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getLocalePlugin,
  getSupportedLocales,
  resolveBrowserLocale,
} = await jiti.import("./registry.ts");

test("the only built-in locale is zh-CN, whatever the browser asks for", () => {
  assert.deepEqual(getSupportedLocales(), ["zh-CN"]);
  assert.equal(resolveBrowserLocale(["en-US", "zh-CN"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["zh-TW", "en"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["fr-FR"]), "zh-CN");
  assert.equal(resolveBrowserLocale([]), "zh-CN");
});

test("the zh-CN plugin registers with a label and a message dictionary", () => {
  const plugin = getLocalePlugin("zh-CN");
  assert.ok(plugin);
  assert.equal(plugin.label, "简体中文");
  assert.equal(typeof plugin.messages["common.language"], "string");
  assert.equal(getLocalePlugin("en"), undefined);
  assert.equal(getLocalePlugin("zh-TW"), undefined);
});
