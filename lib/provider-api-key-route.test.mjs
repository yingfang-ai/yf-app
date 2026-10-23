import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API key saves do not use ModelRuntime.login's network refresh", async () => {
  const source = await readFile(new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url), "utf-8");

  assert.doesNotMatch(source, /modelRuntime\.login\(/);
  assert.match(source, /apiKeyAuth\.login\(/);
  assert.match(source, /signal:\s*req\.signal/);
  assert.match(source, /storeProviderCredential\(provider, credential\)/);
  // yingfang#31（spec R5/A6）：录入面仅运营者——handler 顶部接 requireOperator。
  assert.match(source, /requireOperator\(req\)/);
  // yingfang#31（spec R7/plan A3）：录入只收字面量——`!命令`/`$VAR` 表达式 400。
  assert.match(source, /isConfigExpression/);
});
