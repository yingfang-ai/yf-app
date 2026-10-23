import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";
import { isConfigExpression } from "./model-discovery-guards";
import { isRecord } from "./type-guards";

const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

function normalizeModelCost(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const providedKeys = MODEL_COST_KEYS.filter((key) => value[key] !== undefined);
  if (providedKeys.length === 0) return undefined;
  if (providedKeys.some((key) => (
    typeof value[key] !== "number" || !Number.isFinite(value[key])
  ))) return undefined;

  return Object.fromEntries([
    ...Object.entries(value),
    ...MODEL_COST_KEYS.map((key) => [key, value[key] ?? 0]),
  ]);
}

/** Complete partial cost groups with zero; omit a cost group only when it is empty. */
export function normalizeModelsConfigCosts(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = structuredClone(data);
  if (!isRecord(normalized.providers)) return normalized;

  for (const provider of Object.values(normalized.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!isRecord(model) || !("cost" in model)) continue;
      const cost = normalizeModelCost(model.cost);
      if (cost) model.cost = cost;
      else delete model.cost;
    }
  }
  return normalized;
}

function sanitizeModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;

  const providers = Object.fromEntries(Object.entries(data.providers).map(([providerId, provider]) => {
    if (!isRecord(provider) || !Array.isArray(provider.models)) return [providerId, provider];
    const models = provider.models.filter((model) => (
      !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
    ));
    return [providerId, { ...provider, models }];
  }));

  return { ...data, providers };
}

export function getModelsConfigPath(): string {
  return join(getAgentDir(), "models.json");
}

/** models.json exists but its contents cannot be used, so it must not be replaced. */
export class ModelsConfigReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelsConfigReadError";
  }
}

/**
 * Mirrors pi's `stripJsonComments` (utils/json.js, not exported by the SDK):
 * drops `//` line comments and trailing commas, leaving string literals alone.
 */
function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => (match[0] === '"' ? match : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail?: string) => tail ?? (match[0] === '"' ? match : ""));
}

/**
 * Reads models.json with the same leniency as pi's loader (BOM, `//` comments,
 * trailing commas). A file pi accepts must never read as empty here: the panel
 * saves its whole draft, so an empty read would delete every provider on the
 * next save. Unusable contents throw instead.
 *
 * Returns the FULL configuration, secrets included: only the server's own
 * consumers (runtime composition, discovery guards) may call it. Every read
 * that leaves the server process goes through `toMaskedModelsConfig`.
 */
export function readModelsConfig(
  modelsPath = getModelsConfigPath(),
): Record<string, unknown> {
  if (!existsSync(modelsPath)) return { providers: {} };
  let parsed: unknown;
  try {
    const content = readFileSync(modelsPath, "utf8").replace(/^\uFEFF/, "");
    if (!content.trim()) return { providers: {} };
    parsed = JSON.parse(stripJsonComments(content));
  } catch (error) {
    throw new ModelsConfigReadError(
      `Failed to read ${modelsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new ModelsConfigReadError(`Failed to read ${modelsPath}: expected a JSON object`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// 只写不回显 (spec R4, plan A2): the masked read view, and the matching
// keep-on-empty save merge. Both live here and nowhere else — one fact, one
// place.
// ---------------------------------------------------------------------------

/**
 * Marker keys the masked view adds; stripped again before anything is written
 * so models.json never carries UI bookkeeping.
 */
const MASK_MARKER_KEYS = ["key_configured", "headers_configured"] as const;

/**
 * Mask one entry (provider, model, modelOverride): drop `apiKey`, empty the
 * header VALUES (names stay so the panel can round-trip and edit rows), and
 * add the 「已配置」 markers instead.
 */
function maskEntrySecrets(entry: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...entry };
  delete masked.apiKey;
  if (typeof entry.apiKey === "string" && entry.apiKey) {
    masked.key_configured = true;
  }
  if (isRecord(masked.headers)) {
    const headers: Record<string, string> = {};
    const configured: Record<string, true> = {};
    for (const [name, value] of Object.entries(masked.headers)) {
      headers[name] = "";
      if (typeof value === "string" && value) configured[name] = true;
    }
    masked.headers = headers;
    if (Object.keys(configured).length > 0) masked.headers_configured = configured;
  }
  return masked;
}

/**
 * The masked view every read-back API serves (GET /api/models-config and the
 * panel built on it): apiKey and header VALUES never appear — only the
 * `key_configured` / `headers_configured` 「已配置」 markers. Structure the
 * panel edits (baseUrl, api, model ids, header names) is untouched.
 */
export function toMaskedModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  const masked = structuredClone(data);
  if (!isRecord(masked.providers)) return masked;
  for (const [providerId, provider] of Object.entries(masked.providers)) {
    if (!isRecord(provider)) continue;
    let entry = maskEntrySecrets(provider);
    if (Array.isArray(entry.models)) {
      entry = {
        ...entry,
        models: entry.models.map((model) => (isRecord(model) ? maskEntrySecrets(model) : model)),
      };
    }
    if (isRecord(entry.modelOverrides)) {
      entry = {
        ...entry,
        modelOverrides: Object.fromEntries(Object.entries(entry.modelOverrides).map(([key, value]) => (
          [key, isRecord(value) ? maskEntrySecrets(value) : value]
        ))),
      };
    }
    masked.providers[providerId] = entry;
  }
  return masked;
}

/** Deep-strip the mask markers from an entry tree (they are UI bookkeeping, not config). */
function stripMaskMarkers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMaskMarkers);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((MASK_MARKER_KEYS as readonly string[]).includes(key)) continue;
    result[key] = stripMaskMarkers(entry);
  }
  return result;
}

/**
 * Merge one entry's secret values with the stored ones. Save semantics
 * (plan A2): 留空表示保持原值 —
 * - `apiKey`: a non-empty payload value overwrites; an empty string or a
 *   missing key keeps the stored value (when one exists).
 * - `headers`: the payload's name set is the row set (a name it omits is a
 *   row the operator deleted); a non-empty value overwrites, an empty value
 *   keeps the stored value for that name; a wholly missing `headers` object
 *   is no edit surface at all and keeps the stored headers.
 * Model lists and modelOverrides are the draft's own (whole-replace), but
 * each model/override entry's header values merge by id/key the same way.
 */
function mergeEntrySecrets(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...incoming };

  if (typeof result.apiKey !== "string" || !result.apiKey) {
    delete result.apiKey;
    if (typeof stored?.apiKey === "string" && stored.apiKey) result.apiKey = stored.apiKey;
  }

  if (!isRecord(result.headers)) {
    if (isRecord(stored?.headers)) result.headers = stored.headers;
  } else {
    const merged: Record<string, string> = {};
    const storedHeaders = isRecord(stored?.headers) ? stored.headers : undefined;
    for (const [name, value] of Object.entries(result.headers)) {
      if (typeof value === "string" && value) {
        merged[name] = value;
      } else {
        const storedValue = storedHeaders?.[name];
        if (typeof storedValue === "string" && storedValue) merged[name] = storedValue;
      }
    }
    if (Object.keys(merged).length > 0) result.headers = merged;
    else delete result.headers;
  }

  if (Array.isArray(result.models)) {
    const storedModels = new Map<string, Record<string, unknown>>();
    if (stored && Array.isArray(stored.models)) {
      for (const model of stored.models) {
        if (isRecord(model) && typeof model.id === "string") storedModels.set(model.id, model);
      }
    }
    result.models = result.models.map((model) => (
      isRecord(model) && typeof model.id === "string"
        ? mergeEntrySecrets(model, storedModels.get(model.id))
        : model
    ));
  }

  if (isRecord(result.modelOverrides) && isRecord(stored?.modelOverrides)) {
    for (const [key, value] of Object.entries(result.modelOverrides)) {
      if (!isRecord(value)) continue;
      const storedOverride = stored.modelOverrides[key];
      result.modelOverrides[key] = mergeEntrySecrets(value, isRecord(storedOverride) ? storedOverride : undefined);
    }
  }

  return result;
}

/** The save side of 只写不回显: fill the draft's empty secret slots from the stored config. */
function mergeModelsConfigSecrets(
  data: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const merged = stripMaskMarkers(data) as Record<string, unknown>;
  if (!isRecord(merged.providers)) return merged;
  if (!isRecord(stored.providers)) return merged;
  for (const [providerId, provider] of Object.entries(merged.providers)) {
    if (!isRecord(provider)) continue;
    const storedProvider = stored.providers[providerId];
    merged.providers[providerId] = mergeEntrySecrets(
      provider,
      isRecord(storedProvider) ? storedProvider : undefined,
    );
  }
  return merged;
}

/**
 * Schema validation for a models.json PUT body (audit S8). The route
 * previously wrote an unrestricted `Record<string, unknown>` straight to
 * disk; the SDK then rejects mistyped fields when loading models.json. The
 * schema below mirrors the SDK's own `ProviderConfigSchema` /
 * `ModelDefinitionSchema` (core/model-config.js) field-for-field, so a
 * payload this panel accepts is one pi can load, and a mistyped field
 * (`baseUrl: 17`, `models: [{ id: 0 }]`, …) is refused with the typed
 * `invalidBody` code before anything is written. Unknown keys are
 * PRESERVED, like the SDK's own loader (TypeBox without
 * `additionalProperties: false`).
 *
 * yingfang#31 (plan A3) overturns the baseline's expression tolerance: an
 * apiKey or header value shaped like `!command` / `$VAR` would be evaluated
 * against the SERVER's environment by the SDK's config resolver, so the save
 * face refuses every expression with the typed `invalidConfigExpression`
 * code — only literals are stored (reusing `isConfigExpression` from
 * lib/model-discovery-guards, not redefining it).
 */
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

/** `compat` is a per-API union the SDK re-validates at composition time; here
 *  it only needs to be structured JSON (not `17`, not `"nope"`). */
const compatSchema = z.record(z.string(), jsonValueSchema);

const thinkingLevelMapSchema = z.looseObject({
  off: z.string().nullable().optional(),
  minimal: z.string().nullable().optional(),
  low: z.string().nullable().optional(),
  medium: z.string().nullable().optional(),
  high: z.string().nullable().optional(),
  xhigh: z.string().nullable().optional(),
  max: z.string().nullable().optional(),
});

const costRatesSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});

/** Model-definition cost may arrive partial (the panel's draft); the write
 *  path completes missing rates with zero (normalizeModelsConfigCosts). */
const modelCostSchema = z.looseObject({
  input: z.number().optional(),
  output: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  tiers: z.array(z.object({ inputTokensAbove: z.number(), ...costRatesSchema.shape })).optional(),
});

const promptCacheSchema = z.looseObject({
  short: z.number().positive().optional(),
  long: z.number().positive().optional(),
});

const imageResizeSchema = z.looseObject({
  maxWidth: z.number().int().positive().optional(),
  maxHeight: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
  jpegQuality: z.number().int().min(1).max(100).optional(),
});

const inputLimitsSchema = z.looseObject({
  maxRequestBytes: z.number().int().positive().optional(),
  images: z.looseObject({
    resize: imageResizeSchema.optional(),
    maxPerMessage: z.number().int().positive().optional(),
    maxPerRequest: z.number().int().positive().optional(),
  }).optional(),
});

const modelInputSchema = z.array(z.union([z.literal("text"), z.literal("image")]));

const modelDefinitionSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  reasoning: z.boolean().optional(),
  thinkingLevelMap: thinkingLevelMapSchema.optional(),
  input: modelInputSchema.optional(),
  inputLimits: inputLimitsSchema.optional(),
  cost: modelCostSchema.optional(),
  promptCache: promptCacheSchema.optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  samplingParams: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: compatSchema.optional(),
});

const modelOverrideSchema = z.looseObject({
  name: z.string().min(1).optional(),
  reasoning: z.boolean().optional(),
  thinkingLevelMap: thinkingLevelMapSchema.optional(),
  input: modelInputSchema.optional(),
  inputLimits: inputLimitsSchema.optional(),
  cost: z.looseObject({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
    tiers: z.array(z.object({ inputTokensAbove: z.number(), ...costRatesSchema.shape })).optional(),
  }).optional(),
  promptCache: promptCacheSchema.optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  samplingParams: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: compatSchema.optional(),
});

const providerConfigSchema = z.looseObject({
  name: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  oauth: z.literal("radius").optional(),
  headers: z.record(z.string(), z.string()).optional(),
  compat: compatSchema.optional(),
  authHeader: z.boolean().optional(),
  models: z.array(modelDefinitionSchema).optional(),
  modelOverrides: z.record(z.string(), modelOverrideSchema).optional(),
});

const modelsConfigSchema = z.looseObject({
  providers: z.record(z.string(), providerConfigSchema),
});

/** Any secret-bearing string value in a payload entry tree (plan A3):
 *  provider/model/modelOverrides `apiKey` and `headers` values only — the
 *  names, ids and everything else are not credentials. */
function findConfigExpressionValue(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.apiKey === "string" && isConfigExpression(value.apiKey)) {
    return value.apiKey;
  }
  if (isRecord(value.headers)) {
    for (const header of Object.values(value.headers)) {
      if (typeof header === "string" && isConfigExpression(header)) return header;
    }
  }
  for (const container of [value.models, value.modelOverrides, value.providers]) {
    const entries = Array.isArray(container)
      ? container
      : isRecord(container) ? Object.values(container) : [];
    for (const entry of entries) {
      const hit = findConfigExpressionValue(entry);
      if (hit) return hit;
    }
  }
  return undefined;
}

export type ModelsConfigPayloadValidation =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: "invalidBody" | "invalidConfigExpression" };

export function validateModelsConfigPayload(body: unknown): ModelsConfigPayloadValidation {
  const parsed = modelsConfigSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "invalidBody" };
  // Plan A3: expressions are refused on the save face before anything is
  // written — apiKey and header values (provider, model, modelOverrides
  // level) must be literals.
  const expression = findConfigExpressionValue(parsed.data);
  if (expression) return { ok: false, reason: "invalidConfigExpression" };
  return { ok: true, data: parsed.data as Record<string, unknown> };
}

export function writeModelsConfig(
  data: Record<string, unknown>,
  modelsPath = getModelsConfigPath(),
): void {
  // Refuse to replace a file this panel could not read: the draft being saved
  // was not built from it, so writing would silently discard its contents.
  const stored = readModelsConfig(modelsPath);
  const dir = dirname(modelsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const normalized = normalizeModelsConfigCosts(sanitizeModelsConfig(
    mergeModelsConfigSecrets(data, stored),
  ));
  writePrivateFileAtomicSync(modelsPath, JSON.stringify(normalized, null, 2));
  invalidateModelsCache();
}
