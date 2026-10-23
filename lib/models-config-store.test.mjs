import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  ModelsConfigReadError,
  normalizeModelsConfigCosts,
  readModelsConfig,
  toMaskedModelsConfig,
  validateModelsConfigPayload,
  writeModelsConfig,
} = await jiti.import("./models-config-store.ts");
const { invalidateModelsCache, loadModelsWithCache } = await jiti.import("./models-cache.ts");
const { buildSessionContext, getSessionEntries } = await jiti.import("./session-reader.ts");

function createTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-models-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function modelsData(id) {
  return {
    models: { [`provider:${id}`]: id },
    modelList: [{ id, name: id, provider: "provider" }],
    defaultModel: null,
    defaultThinkingLevel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
    thinkingLevelPins: {},
  };
}

test("saving models.json atomically invalidates the model-list cache", async (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "agent", "models.json");
  const config = {
    providers: {
      acme: {
        baseUrl: "https://models.example.test/v1",
        api: "openai-completions",
        models: [{ id: "acme-2" }],
      },
    },
  };
  let loads = 0;

  invalidateModelsCache();
  await loadModelsWithCache(root, async () => modelsData(`load-${++loads}`));
  writeModelsConfig(config, modelsPath);
  const reloaded = await loadModelsWithCache(root, async () => modelsData(`load-${++loads}`));

  assert.equal(loads, 2);
  assert.equal(reloaded.modelList[0].id, "load-2");
  assert.deepEqual(readModelsConfig(modelsPath), config);
  assert.deepEqual(readdirSync(join(root, "agent")), ["models.json"]);
  if (process.platform !== "win32") {
    assert.equal(statSync(modelsPath).mode & 0o777, 0o600);
  }
});

test("models.json reads accept the BOM, comments and trailing commas pi accepts", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, `\uFEFF{
  // Hand-edited provider
  "providers": {
    "acme": {
      "baseUrl": "https://models.example.test/v1", // keeps the // inside strings
      "apiKey": "key,}",
      "models": [{ "id": "acme-2", }],
    },
  },
}
`);

  assert.deepEqual(readModelsConfig(modelsPath), {
    providers: {
      acme: {
        baseUrl: "https://models.example.test/v1",
        apiKey: "key,}",
        models: [{ id: "acme-2" }],
      },
    },
  });
});

test("an unreadable models.json is reported and never replaced by a save", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "models.json");
  const original = '{ "providers": { "acme": { "models": [ } } }';
  writeFileSync(modelsPath, original);

  assert.throws(() => readModelsConfig(modelsPath), ModelsConfigReadError);
  assert.throws(
    () => writeModelsConfig({ providers: { other: { models: [] } } }, modelsPath),
    ModelsConfigReadError,
  );
  assert.equal(readFileSync(modelsPath, "utf8"), original);

  writeFileSync(modelsPath, "[]");
  assert.throws(() => readModelsConfig(modelsPath), /expected a JSON object/);
});

test("an empty models.json reads as no providers and can be saved over", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, "\n");

  assert.deepEqual(readModelsConfig(modelsPath), { providers: {} });
  writeModelsConfig({ providers: { acme: { models: [] } } }, modelsPath);
  assert.deepEqual(readModelsConfig(modelsPath), { providers: { acme: { models: [] } } });
});

test("models.json writes fill partial cost groups with zero and remove empty groups", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "agent", "models.json");
  const config = {
    providers: {
      acme: {
        models: [
          { id: "empty-cost", cost: {} },
          { id: "partial-cost", cost: { input: 1, output: 2, cacheRead: 0.1 } },
          { id: "complete-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.1 } },
        ],
        modelOverrides: {
          inherited: { cost: { input: 3 } },
        },
      },
    },
  };

  const normalized = normalizeModelsConfigCosts(config);
  assert.deepEqual(normalized.providers.acme.models, [
    { id: "empty-cost" },
    { id: "partial-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } },
    { id: "complete-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.1 } },
  ]);
  assert.deepEqual(normalized.providers.acme.modelOverrides, {
    inherited: { cost: { input: 3 } },
  });
  assert.deepEqual(config.providers.acme.models[0], { id: "empty-cost", cost: {} });

  writeModelsConfig(config, modelsPath);
  assert.deepEqual(readModelsConfig(modelsPath), normalized);
});

test("saving models.json drops blank model rows without hiding other schema errors", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "agent", "models.json");

  writeModelsConfig({
    providers: {
      acme: {
        baseUrl: "https://models.example.test/v1",
        api: "openai-completions",
        models: [
          { id: "working-model", cost: { input: 1 } },
          { id: "" },
          { id: "  " },
          { id: 42 },
          { name: "Missing identifier" },
          null,
        ],
      },
    },
  }, modelsPath);

  assert.deepEqual(readModelsConfig(modelsPath), {
    providers: {
      acme: {
        baseUrl: "https://models.example.test/v1",
        api: "openai-completions",
        models: [
          { id: "working-model", cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
          { id: 42 },
          { name: "Missing identifier" },
          null,
        ],
      },
    },
  });
});

test("an existing session opens after its historical model is removed from config", (t) => {
  const root = createTempRoot(t);
  const sessionPath = join(root, "session.jsonl");
  const modelsPath = join(root, "models.json");
  const records = [
    {
      type: "session",
      version: 3,
      id: "existing-session",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: root,
    },
    {
      type: "model_change",
      id: "model-old",
      parentId: null,
      provider: "retired-provider",
      modelId: "retired-model",
      timestamp: "2026-01-01T00:00:01.000Z",
    },
    {
      type: "message",
      id: "user-1",
      parentId: "model-old",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: { role: "user", content: "keep this conversation" },
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-01-01T00:00:03.000Z",
      message: {
        role: "assistant",
        provider: "retired-provider",
        model: "retired-model",
        content: [{ type: "text", text: "still readable" }],
      },
    },
  ];
  writeFileSync(sessionPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  writeModelsConfig({
    providers: {
      "retired-provider": {
        baseUrl: "https://retired.example.test/v1",
        api: "openai-completions",
        models: [{ id: "retired-model" }],
      },
    },
  }, modelsPath);
  const beforeChange = buildSessionContext(getSessionEntries(sessionPath));
  assert.equal(beforeChange.messages[1].content[0].text, "still readable");

  writeModelsConfig({
    providers: {
      replacement: {
        baseUrl: "https://replacement.example.test/v1",
        api: "openai-completions",
        models: [{ id: "replacement-model" }],
      },
    },
  }, modelsPath);

  const afterChange = buildSessionContext(getSessionEntries(sessionPath));
  assert.deepEqual(afterChange.entryIds, ["user-1", "assistant-1"]);
  assert.equal(afterChange.messages[0].content, "keep this conversation");
  assert.equal(afterChange.messages[1].content[0].text, "still readable");
});

// ---------------------------------------------------------------------------
// yingfang#31 (spec R4 / plan A2/A3): 只写不回显 + 留空保持原值 + 字面量校验
// ---------------------------------------------------------------------------

test("the masked read view carries no secret bytes and marks the 已配置 slots", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "models.json");
  const config = {
    providers: {
      acme: {
        baseUrl: "https://acme.example/v1",
        apiKey: "provider-secret",
        headers: { "x-keep": "header-secret" },
        models: [{ id: "m1", headers: { "x-model": "model-secret" } }],
        modelOverrides: { m0: { headers: { "x-override": "override-secret" } } },
      },
      bare: { baseUrl: "https://bare.example/v1" },
    },
  };
  writeModelsConfig(config, modelsPath);

  const masked = toMaskedModelsConfig(readModelsConfig(modelsPath));
  const text = JSON.stringify(masked);
  for (const secret of ["provider-secret", "header-secret", "model-secret", "override-secret"]) {
    assert.ok(!text.includes(secret), `${secret} leaked into the masked view`);
  }

  const acme = masked.providers.acme;
  assert.equal(acme.key_configured, true);
  assert.deepEqual(acme.headers, { "x-keep": "" });
  assert.deepEqual(acme.headers_configured, { "x-keep": true });
  assert.equal(acme.models[0].headers["x-model"], "");
  assert.equal(acme.models[0].headers_configured["x-model"], true);
  assert.equal(acme.modelOverrides.m0.headers["x-override"], "");
  assert.ok(!("key_configured" in masked.providers.bare), "an unconfigured provider is marked as configured");
});

test("saving the masked draft round-trip keeps the stored secrets (留空=保持原值)", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "models.json");
  const config = {
    providers: {
      acme: {
        baseUrl: "https://acme.example/v1",
        apiKey: "stored-key",
        headers: { "x-keep": "stored-header" },
        models: [{ id: "m1", headers: { "x-model": "stored-model-header" } }],
        modelOverrides: { m0: { headers: { "x-override": "stored-override-header" } } },
      },
    },
  };
  writeModelsConfig(config, modelsPath);
  assert.deepEqual(readModelsConfig(modelsPath), config);

  // The panel saves the masked view it loaded: no apiKey, header values empty,
  // markers included. The stored secrets must survive that save verbatim.
  const masked = toMaskedModelsConfig(readModelsConfig(modelsPath));
  writeModelsConfig(masked, modelsPath);
  assert.deepEqual(readModelsConfig(modelsPath), config);

  // A new value overwrites; an empty apiKey keeps the stored one; a model's
  // empty header value keeps the stored one.
  writeModelsConfig({
    providers: {
      acme: {
        baseUrl: "https://acme.example/v1",
        apiKey: "new-key",
        headers: { "x-keep": "new-header" },
        models: [{ id: "m1", headers: { "x-model": "" } }],
        modelOverrides: { m0: { headers: { "x-override": "" } } },
      },
    },
  }, modelsPath);
  const overwritten = readModelsConfig(modelsPath).providers.acme;
  assert.equal(overwritten.apiKey, "new-key");
  assert.deepEqual(overwritten.headers, { "x-keep": "new-header" });
  assert.deepEqual(overwritten.models[0].headers, { "x-model": "stored-model-header" });
  assert.deepEqual(overwritten.modelOverrides.m0.headers, { "x-override": "stored-override-header" });

  // An empty-string apiKey keeps the stored key; a wholly missing headers
  // object is no edit surface and keeps the stored headers.
  writeModelsConfig({
    providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "" } },
  }, modelsPath);
  const kept = readModelsConfig(modelsPath).providers.acme;
  assert.equal(kept.apiKey, "new-key");
  assert.deepEqual(kept.headers, { "x-keep": "new-header" });

  // A header name dropped from the draft is a row the operator deleted.
  writeModelsConfig({
    providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "", headers: {} } },
  }, modelsPath);
  const rowDeleted = readModelsConfig(modelsPath).providers.acme;
  assert.equal(rowDeleted.apiKey, "new-key");
  assert.ok(!("headers" in rowDeleted), "a removed header row survived the save");
});

test("expression-shaped apiKey/headers values are refused on the save face (plan A3)", () => {
  const cases = [
    { providers: { e2e: { apiKey: "!curl http://evil.example" } } },
    { providers: { e2e: { apiKey: "$MY_SECRET" } } },
    { providers: { e2e: { apiKey: "${MY_SECRET}" } } },
    { providers: { e2e: { headers: { "x-a": "!echo hi" } } } },
    { providers: { e2e: { models: [{ id: "m", headers: { "x-b": "$MY_SECRET" } }] } } },
    { providers: { e2e: { modelOverrides: { m: { headers: { "x-c": "!cmd" } } } } } },
  ];
  for (const body of cases) {
    assert.deepEqual(
      validateModelsConfigPayload(body),
      { ok: false, reason: "invalidConfigExpression" },
      JSON.stringify(body),
    );
  }

  // Literals still pass, and a structural failure still reads as invalidBody.
  assert.equal(validateModelsConfigPayload({
    providers: { e2e: { apiKey: "sk-literal", headers: { "x-a": "literal-value" } } },
  }).ok, true);
  assert.deepEqual(
    validateModelsConfigPayload({ providers: { e2e: { baseUrl: 17 } } }),
    { ok: false, reason: "invalidBody" },
  );
});
