// 勾选（定稿/收藏）语义与「默认 refine parent」记忆。
//
// 契约（§2.9）：POST select，同轮至多一张（服务端一条 UPDATE 保证），幂等。
// UI 纪律：勾选呈现为「定稿」；勾选完成后，该 conv 的后续 refine 默认以该轮为
// parent（提交 parent_round_id = 该轮、branch_kind = refine），无需用户显式指定。
// 记忆仅存 localStorage（yf.selection.<conv_id>），不要求服务端任何持久化。
import { selectImage } from "./api.ts";
import type { SelectImageResponse } from "./types.ts";

const KEY_PREFIX = "yf.selection.";

/** 一个会话的勾选记忆：round_id → 勾选的 idx（同轮至多一张）。 */
export type SelectionMemory = Record<string, number>;

function keyFor(convId: string): string {
  return `${KEY_PREFIX}${convId}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function loadSelections(convId: string): SelectionMemory {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(keyFor(convId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const memory: SelectionMemory = {};
    for (const [roundId, idx] of Object.entries(parsed)) {
      if (typeof idx === "number" && Number.isInteger(idx) && idx >= 0) {
        memory[roundId] = idx;
      }
    }
    return memory;
  } catch {
    return {};
  }
}

function saveSelections(convId: string, memory: SelectionMemory): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(keyFor(convId), JSON.stringify(memory));
  } catch {
    // 存储满/被禁用：默认 parent 记忆是尽力而为的客户端面。
  }
}

/** 记录一次勾选（同轮重复勾选即改选；契约幂等）。写入序 = 默认 parent 的新到旧。 */
export function rememberSelection(convId: string, roundId: string, idx: number): SelectionMemory {
  const memory = loadSelections(convId);
  // 先删再写：让 Object.keys 的插入序反映「最近勾选」，defaultRefineParent 取末位。
  delete memory[roundId];
  memory[roundId] = idx;
  saveSelections(convId, memory);
  return memory;
}

export type SelectFn = typeof selectImage;

/** 调用 select 端点并写入本地记忆；契约错误按原样上抛（UI 如实呈现）。 */
export async function selectRoundImage(
  convId: string,
  roundId: string,
  idx: number,
  epoch = 0,
  select: SelectFn = selectImage,
): Promise<{ response: SelectImageResponse; memory: SelectionMemory }> {
  const response = await select(roundId, idx, epoch);
  const memory = rememberSelection(convId, roundId, idx);
  return { response, memory };
}

/** 该会话最近勾选的轮（写入顺序的最后一个）⇒ 默认 refine parent。 */
export function defaultRefineParent(convId: string): string | null {
  const memory = loadSelections(convId);
  const rounds = Object.keys(memory);
  return rounds.length > 0 ? rounds[rounds.length - 1] : null;
}
