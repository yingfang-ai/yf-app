"use client";

import { useCallback, useEffect, useState } from "react";
import { loadRoundImages, refreshDueSlots, type ImageSlot } from "@/lib/yf/images";

const RESIGN_CHECK_INTERVAL_MS = 60_000;

/**
 * 一轮的图片栅格（读面）。
 * - 每张候选图（idx 0..n-1，epoch 0）经 presign URL 加载；
 * - URL 到期前自动重签；
 * - 404 = 未产出占位；503 presign_unavailable = 「图片暂不可用」，不崩溃。
 */
export function RoundImages({
  roundId,
  n,
  state,
  selectedIdx,
  onSelect,
}: {
  roundId: string;
  n: number;
  state: string;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
}) {
  const [slots, setSlots] = useState<ImageSlot[]>([]);
  const active = state === "done";

  const refresh = useCallback(async () => {
    if (!active) return;
    setSlots(await loadRoundImages(roundId, n));
  }, [active, n, roundId]);

  useEffect(() => {
    if (!active) {
      setSlots([]);
      return;
    }
    void refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setSlots((current) => {
        if (current.some((slot) => slot.status === "ready")) {
          void refreshDueSlots(roundId, current).then(setSlots);
        }
        return current;
      });
    }, RESIGN_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, roundId]);

  if (!active) {
    return null;
  }

  return (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-round-id={roundId}>
      {slots.map((slot) => (
        <figure
          key={slot.idx}
          className="overflow-hidden rounded border border-border bg-bg-subtle"
          data-idx={slot.idx}
        >
          {slot.status === "ready" && slot.url ? (
            <img
              src={slot.url}
              alt={`第 ${slot.idx + 1} 张候选图`}
              className="aspect-square w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center p-2 text-center text-xs text-text-muted">
              {slot.status === "loading" ? "加载中…"
                : slot.status === "not-produced" ? "尚未产出"
                : slot.status === "unavailable" ? "图片暂不可用"
                : "加载失败"}
            </div>
          )}
          <figcaption className="flex items-center justify-between px-2 py-1.5 text-xs">
            <span className="text-text-muted">#{slot.idx}</span>
            {slot.status === "ready" ? (
              <button
                type="button"
                onClick={() => onSelect(slot.idx)}
                className={`rounded px-2 py-0.5 ${
                  selectedIdx === slot.idx
                    ? "bg-accent text-white"
                    : "border border-border text-text-muted hover:bg-bg-hover"
                }`}
                aria-pressed={selectedIdx === slot.idx}
              >
                {selectedIdx === slot.idx ? "已定稿" : "定稿"}
              </button>
            ) : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
