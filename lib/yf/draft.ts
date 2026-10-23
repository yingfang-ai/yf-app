// 草案（plan step 12，R8/R9）：引导 skill 在聊天里产出的结构化绘图请求。
//
// 草案块 = 回复里语言标记为 `yf-draft` 的围栏代码块，内容是一个 JSON 对象（字段集
// 即 SubmitRequest 去掉 conv_id/parent/branch 的部分）。本模块只做两件事：从文本里
// 取出最后一个草案块，并按「契约入队闸同款」规则校验——backend_id ∈ 静态清单、n 在
// 后端上限内、params 键 ⊆ 后端合法字段集、不认识的字段 fail closed。校验拒绝的
// 理由只描述草案本身，不涉及任何服务端资源（反枚举：这里没有「存在性」可泄露）。
import { findBackend } from "./backends.ts";
import type { WorkbenchRequest } from "./submit.ts";

export interface Draft {
  backend_id: string;
  prompt: string;
  negative_prompt?: string;
  n: number;
  seed: number;
  params?: Record<string, string>;
}

export type DraftParse =
  | { ok: true; draft: Draft }
  | { ok: false; errors: string[] };

const ALLOWED_KEYS = new Set(["backend_id", "prompt", "negative_prompt", "n", "seed", "params"]);
const DRAFT_BLOCK = /```yf-draft[ \t]*\r?\n([\s\S]*?)\r?\n```/g;

/** 校验一个已解析的 JSON 值；seed 缺省补 -1（后端自选）。 */
export function validateDraft(value: unknown): DraftParse {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["草案必须是一个 JSON 对象"] };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) errors.push(`不认识的字段：${key}`);
  }

  const backend = typeof record.backend_id === "string" ? findBackend(record.backend_id) : undefined;
  if (!backend) errors.push("backend_id 不在可用清单内");
  if (typeof record.prompt !== "string" || record.prompt.trim().length === 0) {
    errors.push("prompt 必须是非空字符串");
  }
  if (!Number.isInteger(record.n)) {
    errors.push("n 必须是整数");
  } else if (backend && ((record.n as number) < 1 || (record.n as number) > backend.max_n)) {
    errors.push(`n 必须在 1 到 ${backend.max_n} 之间`);
  }
  if (record.seed !== undefined && !Number.isInteger(record.seed)) errors.push("seed 必须是整数");
  if (record.negative_prompt !== undefined) {
    if (typeof record.negative_prompt !== "string") errors.push("negative_prompt 必须是字符串");
    else if (backend && !backend.supports_negative_prompt && record.negative_prompt.length > 0) {
      errors.push("该后端不支持 negative_prompt");
    }
  }
  if (record.params !== undefined) {
    const params = record.params;
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      errors.push("params 必须是对象");
    } else if (backend) {
      for (const [key, paramValue] of Object.entries(params as Record<string, unknown>)) {
        const field = backend.param_fields.find((candidate) => candidate.key === key);
        if (!field) errors.push(`params 里不认识的键：${key}`);
        else if (typeof paramValue !== "string" || !field.options.includes(paramValue)) {
          errors.push(`params.${key} 的取值不在可选范围内`);
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const draft: Draft = {
    backend_id: record.backend_id as string,
    prompt: (record.prompt as string).trim(),
    n: record.n as number,
    seed: (record.seed as number | undefined) ?? -1,
  };
  if (typeof record.negative_prompt === "string" && record.negative_prompt.trim()) {
    draft.negative_prompt = record.negative_prompt.trim();
  }
  if (record.params && Object.keys(record.params as object).length > 0) {
    draft.params = { ...(record.params as Record<string, string>) };
  }
  return { ok: true, draft };
}

/** 取文本里最后一个草案块并校验；没有草案块 → null。 */
export function extractDraft(text: string): DraftParse | null {
  let last: string | null = null;
  for (const match of text.matchAll(DRAFT_BLOCK)) last = match[1];
  if (last === null) return null;
  try {
    return validateDraft(JSON.parse(last));
  } catch {
    return { ok: false, errors: ["草案不是合法 JSON"] };
  }
}

/** 草案 → 下单请求（buildSubmitRequest 的入参形状）。 */
export function draftToWorkbenchRequest(draft: Draft): WorkbenchRequest {
  return {
    backendId: draft.backend_id,
    prompt: draft.prompt,
    negativePrompt: draft.negative_prompt ?? "",
    n: draft.n,
    seed: draft.seed,
    params: draft.params ?? {},
  };
}
