"use client";

import { useCallback, useEffect, useState } from "react";
import { RoundImages } from "@/components/yf/RoundImages";
import { getConvTree, YfApiError, YfUnauthorizedError } from "@/lib/yf/api";
import { flattenTree } from "@/lib/yf/linear";
import type { Round, RoundTree } from "@/lib/yf/types";

const STATE_LABELS: Record<string, string> = {
  queued: "排队中",
  dispatched: "已派发",
  running: "生成中",
  done: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
};

/**
 * 会话的线性产图流（读面）。
 *
 * 树语义在 UI 上不可见：GET /api/convs/{conv_id}/tree 的平面列表被摊平为
 * 按时间顺序的线性流，无分支导航器、无分支切换控件；refine 与 redirect
 * 对用户呈现为普通的前后轮次。
 */
export function ConversationFeed({
  convId,
  trackedRound,
  selections,
  onSelect,
  refreshKey,
}: {
  convId: string;
  /** 正在追踪的轮（轮询观测），用于即时刷新对应轮的状态。 */
  trackedRound: Round | null;
  selections: Record<string, number | null>;
  onSelect: (roundId: string, idx: number) => void;
  refreshKey: number;
}) {
  const [rounds, setRounds] = useState<RoundTree[]>([]);
  const [error, setError] = useState("");

  const loadTree = useCallback(async () => {
    try {
      const tree = await getConvTree(convId);
      setRounds(flattenTree(tree));
      setError("");
    } catch (err) {
      if (err instanceof YfUnauthorizedError) {
        window.location.replace("/login");
        return;
      }
      if (err instanceof YfApiError) {
        setError(err.message);
      } else {
        setError("会话树加载失败，请稍后重试。");
      }
    }
  }, [convId]);

  useEffect(() => {
    void loadTree();
  }, [loadTree, refreshKey]);

  // 被追踪的轮每变化一次状态，就刷新一次树（轮询状态源仍然是 GET）。
  const trackedState = trackedRound ? `${trackedRound.round_id}:${trackedRound.state}` : "";
  useEffect(() => {
    if (!trackedState) return;
    void loadTree();
  }, [trackedState, loadTree]);

  if (error) {
    return <p className="mt-2 text-sm text-red-500" role="alert">{error}</p>;
  }
  if (rounds.length === 0) {
    return null;
  }

  return (
    <section aria-label="产图流" className="mx-auto w-full max-w-[48rem] space-y-4">
      {rounds.map((round, index) => (
        <article
          key={round.round_id}
          className="rounded-lg border border-border bg-bg-panel p-4"
          data-round-id={round.round_id}
        >
          <div className="flex items-center justify-between text-sm">
            <h3 className="font-semibold text-text">第 {index + 1} 轮</h3>
            <span className={`text-xs ${round.state === "done" ? "text-text-muted" : "text-text"}`}>
              {STATE_LABELS[round.state] ?? round.state}
            </span>
          </div>
          <RoundImages
            roundId={round.round_id}
            n={round.n}
            state={round.state}
            selectedIdx={selections[round.round_id] ?? null}
            onSelect={(idx) => onSelect(round.round_id, idx)}
          />
        </article>
      ))}
    </section>
  );
}
