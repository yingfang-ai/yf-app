// 树语义 → 线性对话流。
//
// 纪律（spec「树形分支」Requirement）：yingfang 的树（parent_round_id +
// branch_kind，一个 parent 可有多个 child）在 UI 上表现为按时间顺序的线性
// 对话流；不出现分支导航器或任何分支结构可视化；refine/redirect 对用户无差别。
//
// 摊平判据：先按 parent 链算深度（环 Guard：孤儿/环回节点按深度 0 处理），
// 再按 (深度, enqueued_at, round_id) 排序——父轮先于子轮，同层按入队时间。
import type { RoundTree } from "./types.ts";

export function flattenTree(rounds: RoundTree[]): RoundTree[] {
  const byId = new Map(rounds.map((round) => [round.round_id, round]));
  const depthCache = new Map<string, number>();

  const depthOf = (roundId: string, seen: Set<string>): number => {
    if (depthCache.has(roundId)) return depthCache.get(roundId) as number;
    if (seen.has(roundId)) return 0; // 环回：按根处理，不再深入。
    const round = byId.get(roundId);
    if (!round || !round.parent_round_id || !byId.has(round.parent_round_id)) {
      depthCache.set(roundId, 0);
      return 0;
    }
    seen.add(roundId);
    const depth = depthOf(round.parent_round_id, seen) + 1;
    seen.delete(roundId);
    depthCache.set(roundId, depth);
    return depth;
  };

  return [...rounds].sort((a, b) => {
    const depthDiff = depthOf(a.round_id, new Set()) - depthOf(b.round_id, new Set());
    if (depthDiff !== 0) return depthDiff;
    const timeDiff = Date.parse(a.enqueued_at) - Date.parse(b.enqueued_at);
    if (timeDiff !== 0) return timeDiff;
    return a.round_id < b.round_id ? -1 : a.round_id > b.round_id ? 1 : 0;
  });
}
