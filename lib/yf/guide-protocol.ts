// 引导对话协议：请求校验、LLM 输出解析与 SubmitRequest 草案归一化。
//
// 本模块是纯逻辑层（不依赖 next/server）：`app/api/guide/route.ts` 是薄适配器，
// 把 Next 请求/环境变量交给 `handleGuideRequest`。这样 node:test 可以直接以
// mock fetch 覆盖全部行为，构建期由 Next 负责适配器的接线。
import { z } from "zod";
import type { BranchKind } from "./types.ts";

// ---------------------------------------------------------------------------
// 定档（plan 实现决策）
// ---------------------------------------------------------------------------

/** 一轮张数的产品上限（D16：当期产品形态一轮 8 张；S4=16 只是 wire 护栏）。 */
export const GUIDE_MAX_N = 8;
/** branch_kind 缺省：refine（根轮也带 refine，契约 §2.7 形态）。 */
export const DEFAULT_BRANCH_KIND: BranchKind = "refine";
/** seed 缺省：-1 = 由后端自选基 seed（D20 语义的实现侧约定）。 */
export const DEFAULT_SEED = -1;

// ---------------------------------------------------------------------------
// 请求 schema
// ---------------------------------------------------------------------------

export const guideMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

export const guideRequestSchema = z.object({
  messages: z.array(guideMessageSchema).min(1).max(50),
});

export type GuideMessage = z.infer<typeof guideMessageSchema>;

// ---------------------------------------------------------------------------
// LLM 结构化产出（```yf-draft 围栏块）→ SubmitRequest 草案
// ---------------------------------------------------------------------------

/** 归一化后的请求草案：可直接作为 SubmitRequest 的业务字段来源。 */
export interface GuideDraft {
  prompt: string;
  negative_prompt?: string;
  n: number;
  seed: number;
  params?: Record<string, string>;
}

const draftBlockSchema = z.object({
  prompt: z.string().min(1),
  negative_prompt: z.string().optional(),
  n: z.number().finite().optional(),
  seed: z.number().finite().optional(),
  params: z.record(z.string(), z.string()).optional(),
});

/**
 * 从模型回复中提取最后一个 ```yf-draft 围栏块。
 * 返回剥掉该块后的展示文本与解析出的原始块（缺失/非法 → block=null）。
 */
export function extractDraftBlock(text: string): { reply: string; block: unknown | null } {
  const marker = /```yf-draft\s*\n([\s\S]*?)```/g;
  let last: { json: string; start: number; end: number } | null = null;
  for (const match of text.matchAll(marker)) {
    last = { json: match[1], start: match.index, end: match.index + match[0].length };
  }
  if (!last) {
    return { reply: text.trim(), block: null };
  }
  let block: unknown = null;
  try {
    block = JSON.parse(last.json);
  } catch {
    block = null;
  }
  const reply = `${text.slice(0, last.start)}${text.slice(last.end)}`.trim();
  return { reply, block };
}

/** 钳制函数：n 落在 1..GUIDE_MAX_N；seed 取整。 */
export function clampN(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return GUIDE_MAX_N;
  return Math.min(GUIDE_MAX_N, Math.max(1, Math.round(value)));
}

export function clampSeed(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_SEED;
  return Math.round(value);
}

/** 原始块 → GuideDraft（branch_kind 由调用方按会话上下文补默认；非法块 → null）。 */
export function normalizeDraft(block: unknown): GuideDraft | null {
  const parsed = draftBlockSchema.safeParse(block);
  if (!parsed.success) return null;
  const data = parsed.data;
  const draft: GuideDraft = {
    prompt: data.prompt,
    n: clampN(data.n),
    seed: clampSeed(data.seed),
  };
  const negative = data.negative_prompt?.trim();
  if (negative) draft.negative_prompt = negative;
  if (data.params) {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(data.params)) {
      if (!key) continue;
      params[key] = String(value);
    }
    if (Object.keys(params).length > 0) draft.params = params;
  }
  return draft;
}

// ---------------------------------------------------------------------------
// 系统提示词（单一固定模型；输出语言仅简体中文）
// ---------------------------------------------------------------------------

export const GUIDE_SYSTEM_PROMPT = [
  "你是 yf-app 的图像创作引导助手，全程使用简体中文。",
  "用户会给出一个模糊的图像想法，你的任务是通过简短、一次最多一个问题的追问，",
  "把想法补全为一条可以直接执行的文生图请求。",
  "规则：",
  "1. 每次回复先给一句自然的中文对话（确认、追问或建议），不要长篇大论。",
  "2. 当画面主体、风格/氛围、构图要点已经明确时，把最终请求写进一个 ```yf-draft 围栏块，",
  "   块内是 JSON 对象，字段：",
  "   - prompt：完整的正向提示词（具体、可执行）；",
  "   - negative_prompt：负向提示词（可选，没有就不要写）；",
  "   - n：张数（1 到 8 的整数，用户没说就给 4）；",
  "   - seed：整数基 seed（用户没提就不要写，由后端自选）；",
  "   - params：其余参数（可选，值一律字符串）。",
  "3. 围栏块必须放在回复最后；还没到成稿阶段时，绝对不要输出围栏块。",
  "4. 不要替用户编造他不关心的细节；不要询问技术后端或模型名。",
].join("\n");

// ---------------------------------------------------------------------------
// 服务端处理器（依赖注入：baseUrl/apiKey/model + 可注入 fetch）
// ---------------------------------------------------------------------------

export interface GuideHandlerConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface GuideHandlerResult {
  status: number;
  body: { reply: string; draft: GuideDraft | null } | { error: { code: string; message: string } };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

/** 统一错误信封形态（与 yingfang §1 同形；code 为 yf-app 自有面）。 */
function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export async function handleGuideRequest(
  rawBody: unknown,
  config: GuideHandlerConfig,
  fetchImpl: FetchLike = defaultFetch,
): Promise<GuideHandlerResult> {
  // 部署三件套（YF_LLM_BASE_URL / YF_LLM_API_KEY / YF_LLM_MODEL）任一缺失 ⇒
  // 按请求 503，其余产品面不受影响（docs/deploy.md）。
  if (!config.baseUrl || !config.apiKey || !config.model) {
    return { status: 503, body: errorBody("guide_unavailable", "引导服务暂不可用") };
  }

  const parsed = guideRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { status: 400, body: errorBody("bad_request", "请求格式不正确") };
  }

  const upstreamMessages = [
    { role: "system" as const, content: GUIDE_SYSTEM_PROMPT },
    ...parsed.data.messages.map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    })),
  ];

  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // key 只出现在服务端 → 上游的请求里；绝不进入任何响应体。
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: upstreamMessages,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { status: 502, body: errorBody("upstream_error", "引导服务暂时无法连接模型") };
  }

  if (!response.ok) {
    return { status: 502, body: errorBody("upstream_error", "引导服务暂时不可用") };
  }

  let completion: { choices?: Array<{ message?: { content?: string } }> };
  try {
    completion = (await response.json()) as typeof completion;
  } catch {
    return { status: 502, body: errorBody("upstream_error", "引导服务返回了无法解析的内容") };
  }
  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    return { status: 502, body: errorBody("upstream_error", "引导服务没有返回内容") };
  }

  const { reply, block } = extractDraftBlock(content);
  const draft = block === null ? null : normalizeDraft(block);
  return { status: 200, body: { reply, draft } };
}
