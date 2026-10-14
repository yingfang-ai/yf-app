// 轮次轮询：GET /api/rounds/{round_id} 是唯一的轮状态来源（spec 硬纪律——
// 不引入 SSE / WebSocket 或任何契约外的推送机制）。
//
// 节奏（plan 定档）：初始 2s、按 1.5× 退避、15s 封顶；轮询循环在终态
// （done / failed / cancelled）停表并把最后一轮状态交给调用方。
import { getRound } from "./api.ts";
import type { Round } from "./types.ts";

export interface PollRoundOptions {
  /** 首次轮询前的等待，缺省 2000ms。 */
  initialDelayMs?: number;
  /** 退避上限，缺省 15000ms。 */
  maxDelayMs?: number;
  /** 取消信号；abort 后抛出 abort 错误。 */
  signal?: AbortSignal;
  /** 每次观测回调（进度展示用）。 */
  onTick?: (round: Round) => void;
  /** 等待函数（测试注入；缺省 setTimeout）。 */
  delayFn?: (ms: number) => Promise<void>;
  /** GET 取轮函数（测试注入；缺省 lib/yf/api 的 getRound）。 */
  getRoundFn?: typeof getRound;
}

const DEFAULT_INITIAL_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 15000;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultGetRound = getRound;

/** GET-only 轮询直至终态。401 / not_found / 网络错误按原样上抛。 */
export async function pollRoundUntilTerminal(
  roundId: string,
  options: PollRoundOptions = {},
): Promise<Round> {
  const delay = options.delayFn ?? defaultDelay;
  const getRound = options.getRoundFn ?? defaultGetRound;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  let currentDelay = initialDelayMs;

  for (;;) {
    if (options.signal?.aborted) {
      throw new Error("轮询已取消");
    }
    const round = await getRound(roundId);
    options.onTick?.(round);
    if (round.state === "done" || round.state === "failed" || round.state === "cancelled") {
      return round;
    }
    await delay(currentDelay);
    currentDelay = Math.min(maxDelayMs, Math.round(currentDelay * 1.5));
  }
}

/** 下一次轮询的间隔（导出仅为测试/展示一致性）。 */
export function nextDelay(currentDelayMs: number, maxDelayMs = DEFAULT_MAX_DELAY_MS): number {
  return Math.min(maxDelayMs, Math.round(currentDelayMs * 1.5));
}
