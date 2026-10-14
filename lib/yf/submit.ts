// 下单链路：会话懒创建 + SubmitRequest 组装 + POST /api/convs/{conv_id}/rounds。
//
// 纪律：载荷必须是符合 `wire.SubmitRequest` 的原始 JSON（未知字段会被入队闸
// fail-closed 拒绝）；`rate_limited` / `bad_request`（details 逐条）等契约错误
// 信封按 YfApiError 原样上抛，由 UI 如实呈现，不吞不改。
import { createConv, submitRound } from "./api.ts";
import type { BranchKind, SubmitRequest, SubmitRoundResponse } from "./types.ts";

/** 工作台请求状态的最小形状（components/yf/RequestCard 的 RequestState 同形）。 */
export interface WorkbenchRequest {
  backendId: string;
  prompt: string;
  negativePrompt: string;
  n: number;
  seed: number;
  params: Record<string, string>;
}

export interface ParentRef {
  roundId: string;
  /** 缺省 refine；专家模式可另选 redirect。 */
  branchKind?: BranchKind;
}

/**
 * 组装 SubmitRequest（字段集与 wire schema 一一对应，缺省字段不进载荷）。
 * parent 存在 ⇒ branch_kind 取 parent.branchKind ?? "refine"；根轮也带 refine
 * （契约 §2.7 形态）。
 */
export function buildSubmitRequest(
  convId: string,
  request: WorkbenchRequest,
  parent?: ParentRef | null,
): SubmitRequest {
  const payload: SubmitRequest = {
    conv_id: convId,
    branch_kind: parent?.roundId ? (parent.branchKind ?? "refine") : "refine",
    backend_id: request.backendId,
    prompt: request.prompt,
    n: request.n,
    seed: request.seed,
  };
  if (parent?.roundId) {
    payload.parent_round_id = parent.roundId;
  }
  const negative = request.negativePrompt.trim();
  if (negative) {
    payload.negative_prompt = negative;
  }
  const params = Object.fromEntries(
    Object.entries(request.params).filter(([key, value]) => key.length > 0 && value.length > 0),
  );
  if (Object.keys(params).length > 0) {
    payload.params = params;
  }
  return payload;
}

export interface SubmitDeps {
  createConv?: typeof createConv;
  submitRound?: typeof submitRound;
}

/**
 * 会话懒创建 + 下单。convId 为 null 时先 POST /api/convs 建会话；
 * 202 响应取 round_id 进入轮次追踪。
 */
export async function submitWork(
  convId: string | null,
  request: WorkbenchRequest,
  parent?: ParentRef | null,
  deps: SubmitDeps = {},
): Promise<{ convId: string; round: SubmitRoundResponse }> {
  const create = deps.createConv ?? createConv;
  const submit = deps.submitRound ?? submitRound;
  const threadId = convId ?? (await create()).conv_id;
  const round = await submit(threadId, buildSubmitRequest(threadId, request, parent));
  return { convId: threadId, round };
}
