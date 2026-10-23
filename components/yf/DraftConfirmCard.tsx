"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { findBackend } from "@/lib/yf/backends";
import type { Draft } from "@/lib/yf/draft";
import { readCurrentConvId, storeCurrentConvId } from "@/lib/yf/conv-storage";
import { resumeRound, runDraft, type RoundRef, type WorkflowPhase } from "@/lib/yf/workflow";
import { RoundResultCard } from "./RoundResultCard";

/**
 * 草案确认卡（plan step 12，R8/R9/A4）：聊天里展示引导员给出的草案——后端
 * （backend_id + 名称）、张数、prompt 摘要——用户**明确点「确认下单」**之前不提交
 * 任何东西。不展示价格（价格只在下单响应里）。确认后经 lib/yf/workflow 以登录用户
 * 自己的身份下单、GET-only 轮询、落盘到自己的画廊。
 *
 * 重开恢复（D6）：下单后的 {convId, roundId} 记在浏览器 localStorage（key 含会话/
 * 消息位置），重新打开聊天时按它续轮询；落盘幂等，重复续不产生重复文件。
 * conv id 记在**按用户分键**的 `yf.conv.<user_id>`（lib/yf/conv-storage.ts，
 * 登出时清）：换号登录不会复用上一个用户的会话（那只会 not_found）。
 */
const STORAGE_PREFIX = "yf.round.";

function readRef(storageKey: string): RoundRef | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    const parsed = raw ? JSON.parse(raw) as Partial<RoundRef> : null;
    return parsed && typeof parsed.convId === "string" && typeof parsed.roundId === "string"
      ? { convId: parsed.convId, roundId: parsed.roundId }
      : null;
  } catch {
    return null;
  }
}

export function DraftConfirmCard({
  draft,
  storageKey,
  onOpenFile,
}: {
  draft: Draft;
  storageKey: string;
  onOpenFile?: (filePath: string, page?: number) => void;
}) {
  const backend = findBackend(draft.backend_id);
  const [phase, setPhase] = useState<WorkflowPhase | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = phase !== null && phase.kind !== "done" && phase.kind !== "ended" && phase.kind !== "error";

  const resume = useCallback((roundId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void resumeRound(roundId, setPhase, {}, controller.signal);
  }, []);

  useEffect(() => {
    const ref = readRef(storageKey);
    if (ref) resume(ref.roundId);
    return () => abortRef.current?.abort();
  }, [storageKey, resume]);

  const confirm = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // 按当前用户分键取 conv（无存储/未记 user_id → null，每次新建会话）。
    const convId = readCurrentConvId();
    void runDraft(draft, {
      convId,
      signal: controller.signal,
      onPhase: setPhase,
      onSubmitted: (ref) => {
        try {
          window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(ref));
        } catch { /* 存储不可用：本次仍可跑完，只是重开后不续 */ }
        storeCurrentConvId(ref.convId);
      },
    });
  };

  return (
    <div className="yf-draft-card" style={{ margin: "8px 0", padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>绘图草案</div>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
        <dt>后端</dt>
        <dd style={{ margin: 0 }}>{backend ? `${backend.label}（${backend.backend_id}）` : draft.backend_id}</dd>
        <dt>张数</dt>
        <dd style={{ margin: 0 }}>{draft.n} 张</dd>
        <dt>描述</dt>
        <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{draft.prompt}</dd>
        {draft.negative_prompt && (
          <>
            <dt>避免</dt>
            <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{draft.negative_prompt}</dd>
          </>
        )}
      </dl>
      {phase === null || phase.kind === "error" || phase.kind === "ended" ? (
        <button type="button" onClick={confirm} disabled={busy} style={{ marginTop: 10 }}>
          {phase === null ? "确认下单" : "再试一次"}
        </button>
      ) : null}
      {phase && (
        <RoundResultCard
          phase={phase}
          onOpenFile={onOpenFile}
          onRetry={phase.kind === "error" && phase.roundId ? () => resume(phase.roundId as string) : undefined}
        />
      )}
    </div>
  );
}
