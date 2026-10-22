// 生图 workflow（plan step 13，R9/D4/D6）：聊天面确认草案后的编排——以**登录用户
// 自己的 cookie** 经 `/api/yf` 同源代理下单（懒建会话）、GET-only 轮询到终态停表、
// done 后调服务端落盘路由把图落进用户自己的画廊；failed/cancelled 只告知、不落文件。
//
// 无服务端常驻状态（D6）：轮询跑在浏览器里；浏览器重开后，聊天按本地记下的
// round_id 调 `resumeRound` 继续（落盘幂等）。本模块不引入 SSE/WebSocket，也不碰
// 任何契约外端点（落盘路由是 yf-app 自己的）。
import { YfUnauthorizedError, yfFetch, yfApiErrorFrom } from "./api.ts";
import { draftToWorkbenchRequest, type Draft } from "./draft.ts";
import { pollRoundUntilTerminal, type PollRoundOptions } from "./round-poll.ts";
import { submitWork } from "./submit.ts";
import type { Round, RoundState } from "./types.ts";

export type WorkflowPhase =
  | { kind: "submitting" }
  | { kind: "running"; roundId: string; state: RoundState }
  | { kind: "landing"; roundId: string }
  | { kind: "done"; roundId: string; files: string[] }
  | { kind: "ended"; roundId: string; state: "failed" | "cancelled" }
  | { kind: "error"; message: string; roundId?: string };

/** 浏览器侧要持久化的最小引用：重开后凭它续轮询。 */
export interface RoundRef {
  convId: string;
  roundId: string;
}

export interface WorkflowDeps {
  submit?: typeof submitWork;
  poll?: (roundId: string, options: PollRoundOptions) => Promise<Round>;
  land?: (roundId: string) => Promise<{ landed: number; files: string[] }>;
  pollOptions?: Pick<PollRoundOptions, "initialDelayMs" | "maxDelayMs" | "delayFn">;
}

/** 调服务端落盘路由（POST /api/yf/land）；契约错误信封原样抛。 */
export async function landRoundRequest(roundId: string): Promise<{ landed: number; files: string[] }> {
  const response = await yfFetch("/api/yf/land", { method: "POST", body: JSON.stringify({ round_id: roundId }) });
  if (!response.ok) throw await yfApiErrorFrom(response);
  const body = await response.json() as { landed?: number; files?: string[] };
  return { landed: body.landed ?? 0, files: body.files ?? [] };
}

function describe(error: unknown): string {
  if (error instanceof YfUnauthorizedError) return "登录已失效，请重新登录";
  return error instanceof Error ? error.message : String(error);
}

/** 已知 round_id：GET-only 轮询到终态，done 则落盘；终态即停表。 */
export async function resumeRound(
  roundId: string,
  onPhase: (phase: WorkflowPhase) => void,
  deps: WorkflowDeps = {},
  signal?: AbortSignal,
): Promise<WorkflowPhase> {
  const poll = deps.poll ?? pollRoundUntilTerminal;
  const land = deps.land ?? landRoundRequest;
  const emit = (phase: WorkflowPhase): WorkflowPhase => {
    onPhase(phase);
    return phase;
  };
  try {
    const round = await poll(roundId, {
      ...deps.pollOptions,
      signal,
      onTick: (tick) => onPhase({ kind: "running", roundId, state: tick.state }),
    });
    if (round.state === "failed" || round.state === "cancelled") {
      return emit({ kind: "ended", roundId, state: round.state });
    }
    onPhase({ kind: "landing", roundId });
    const landed = await land(roundId);
    return emit({ kind: "done", roundId, files: landed.files });
  } catch (error) {
    return emit({ kind: "error", message: describe(error), roundId });
  }
}

/** 确认后的草案 → 下单 → resumeRound。`onSubmitted` 让调用方持久化 RoundRef。 */
export async function runDraft(
  draft: Draft,
  options: {
    convId: string | null;
    onSubmitted: (ref: RoundRef) => void;
    onPhase: (phase: WorkflowPhase) => void;
    deps?: WorkflowDeps;
    signal?: AbortSignal;
  },
): Promise<WorkflowPhase> {
  const deps = options.deps ?? {};
  const submit = deps.submit ?? submitWork;
  options.onPhase({ kind: "submitting" });
  let submitted: Awaited<ReturnType<typeof submitWork>>;
  try {
    submitted = await submit(options.convId, draftToWorkbenchRequest(draft));
  } catch (error) {
    const phase: WorkflowPhase = { kind: "error", message: describe(error) };
    options.onPhase(phase);
    return phase;
  }
  options.onSubmitted({ convId: submitted.convId, roundId: submitted.round.round_id });
  return resumeRound(submitted.round.round_id, options.onPhase, deps, options.signal);
}
