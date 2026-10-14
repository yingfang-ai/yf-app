"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationFeed } from "@/components/yf/ConversationFeed";
import { GuideChat } from "@/components/yf/GuideChat";
import { initialRequest, RequestCard, type ParentMode, type RequestState } from "@/components/yf/RequestCard";
import { createConv, guide, listConvs, logout, YfApiError, YfUnauthorizedError } from "@/lib/yf/api";
import { defaultBackend, findBackend } from "@/lib/yf/backends";
import {
  appendGuideTurn,
  clearGuideHistory,
  listGuideConvs,
  loadGuideHistory,
  type GuideTurn,
} from "@/lib/yf/guide-store";
import { pollRoundUntilTerminal } from "@/lib/yf/round-poll";
import { defaultRefineParent, loadSelections, selectRoundImage } from "@/lib/yf/selection";
import { submitWork } from "@/lib/yf/submit";
import type { GuideDraft, GuideMessage } from "@/lib/yf/guide-protocol";
import type { Round } from "@/lib/yf/types";
import { clearSavedUser, getSavedUserId } from "@/lib/yf/auth-store";

/** 引导回复里的草案 → 请求成形卡状态（后端上限钳制 n；seed 缺省 -1）。 */
function draftToRequest(draft: GuideDraft, current: RequestState): RequestState {
  const backend = findBackend(current.backendId) ?? defaultBackend();
  const params: Record<string, string> = { ...current.params };
  if (draft.params) {
    // 草案里后端合法字段集之外的键丢弃（params 过合法字段集，R-A4 的前端预检）。
    for (const field of backend.param_fields) {
      if (draft.params[field.key] !== undefined) params[field.key] = draft.params[field.key];
    }
  }
  return {
    ...current,
    prompt: draft.prompt,
    negativePrompt: draft.negative_prompt ?? "",
    n: Math.min(backend.max_n, Math.max(1, draft.n)),
    seed: draft.seed,
    params,
  };
}

export default function Workbench() {
  const [authState, setAuthState] = useState<"checking" | "ready">("checking");
  const [userId, setUserId] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [turns, setTurns] = useState<GuideTurn[]>([]);
  const [request, setRequest] = useState<RequestState>(() => initialRequest(defaultBackend()));
  const [expertMode, setExpertMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resumableConv, setResumableConv] = useState<string | null>(null);
  const [trackedRound, setTrackedRound] = useState<Round | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollAbort = useRef<AbortController | null>(null);
  const [selections, setSelections] = useState<Record<string, number | null>>({});
  const [parentMode, setParentMode] = useState<ParentMode>("follow-selection");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await listConvs();
        if (cancelled) return;
        setUserId(getSavedUserId());
        const resumable = listGuideConvs()[0] ?? null;
        setResumableConv(resumable);
        setAuthState("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof YfUnauthorizedError) {
          window.location.replace("/login");
          return;
        }
        setUserId(getSavedUserId());
        setAuthState("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const send = async (text: string) => {
    setBusy(true);
    setError("");
    try {
      // 会话懒创建：第一条消息时才建 conv（POST /api/convs，契约 §2.4）。
      let threadId = convId;
      if (threadId === null) {
        const created = await createConv();
        threadId = created.conv_id;
        setConvId(threadId);
      }
      const userTurn: GuideTurn = { role: "user", content: text, at: new Date().toISOString() };
      const history = appendGuideTurn(threadId, userTurn);
      setTurns(history);

      const messages: GuideMessage[] = history.map((turn) => ({ role: turn.role, content: turn.content }));
      const result = await guide({ messages });
      const assistantTurn: GuideTurn = { role: "assistant", content: result.reply, at: new Date().toISOString() };
      setTurns(appendGuideTurn(threadId, assistantTurn));
      if (result.draft) {
        setRequest((current) => draftToRequest(result.draft as GuideDraft, current));
      }
      setResumableConv(null);
    } catch (err) {
      if (err instanceof YfUnauthorizedError) {
        window.location.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "发送失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!resumableConv) return;
    setTurns(loadGuideHistory(resumableConv));
    setConvId(resumableConv);
    setSelections(loadSelections(resumableConv));
    setResumableConv(null);
  };

  const discardThread = () => {
    if (convId) clearGuideHistory(convId);
    pollAbort.current?.abort();
    setTrackedRound(null);
    setConvId(null);
    setTurns([]);
    setRequest(initialRequest(defaultBackend()));
  };

  /** 勾选一张图 = 定稿（同轮至多一张，契约幂等），并成为后续 refine 的默认 parent。 */
  const pickImage = async (roundId: string, idx: number) => {
    if (!convId) return;
    try {
      const { memory } = await selectRoundImage(convId, roundId, idx);
      setSelections(memory);
    } catch (err) {
      if (err instanceof YfUnauthorizedError) {
        window.location.replace("/login");
        return;
      }
      setError(err instanceof YfApiError ? err.message : "勾选失败，请稍后重试。");
    }
  };

  /** 下单：202 取 round_id → GET 轮询至终态。错误信封如实呈现。 */
  const submitRequest = async () => {
    if (!convId || submitting || request.prompt.trim().length === 0) return;
    setSubmitting(true);
    setError("");
    setTrackedRound(null);
    pollAbort.current?.abort();
    const controller = new AbortController();
    pollAbort.current = controller;
    // 默认 parent：最近勾选的轮（branch_kind=refine）；专家模式可改为根轮或 redirect。
    const selectedRound = defaultRefineParent(convId);
    const parent =
      parentMode === "root" || !selectedRound ? null
      : { roundId: selectedRound, branchKind: parentMode === "redirect" ? ("redirect" as const) : ("refine" as const) };
    try {
      const { round } = await submitWork(convId, request, parent);
      setTrackedRound({
        round_id: round.round_id,
        conv_id: convId,
        parent_round_id: null,
        branch_kind: "refine",
        state: "queued",
        n: round.n,
        seed: request.seed,
        model_id: "",
        backend_id: round.backend_id,
        hold_micros: round.hold_micros,
        enqueued_at: round.enqueued_at,
      });
      const terminal = await pollRoundUntilTerminal(round.round_id, {
        signal: controller.signal,
        onTick: (observed) => setTrackedRound(observed),
      });
      if (terminal.state !== "done") {
        setError(`本轮未完成（${terminal.state === "cancelled" ? "已取消" : "生成失败"}），积分不会结算为图片。`);
      }
      setRefreshKey((key) => key + 1);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof YfUnauthorizedError) {
        window.location.replace("/login");
        return;
      }
      if (err instanceof YfApiError) {
        const detail = err.details?.map((item) => item.detail ?? item.kind).join("；");
        setError(detail ? `${err.message}（${detail}）` : err.message);
      } else {
        setError(err instanceof Error ? err.message : "下单失败，请稍后重试。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } finally {
      clearSavedUser();
      window.location.replace("/login?logout=1");
    }
  };

  if (authState === "checking") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg">
        <p className="text-sm text-text-muted">正在检查登录状态…</p>
      </main>
    );
  }

  const hasThread = convId !== null && turns.length > 0;

  return (
    <main className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">yf-app 工作台</h1>
          {userId ? (
            <p className="truncate font-mono text-xs text-text-muted">{userId}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={expertMode}
              onChange={(event) => setExpertMode(event.target.checked)}
            />
            专家模式
          </label>
          <button
            type="button"
            onClick={signOut}
            className="rounded border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-bg-subtle"
          >
            登出
          </button>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[64rem] flex-1 flex-col px-2 py-4 sm:px-4">
        {!hasThread && resumableConv ? (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-panel px-4 py-3 text-sm">
            <span className="text-text-muted">检测到上次的引导对话（仅保存在本浏览器）。</span>
            <button
              type="button"
              onClick={resume}
              className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm text-white"
            >
              继续上次对话
            </button>
          </div>
        ) : null}

        <GuideChat turns={turns} busy={busy} disabled={false} onSend={send} />

        <div className="mt-4 flex justify-center">
          <RequestCard
            request={request}
            onChange={setRequest}
            expertMode={expertMode}
            active={hasThread}
            parentMode={parentMode}
            onParentModeChange={setParentMode}
            hasSelection={convId ? defaultRefineParent(convId) !== null : false}
          />
        </div>
        {hasThread ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={submitRequest}
              disabled={submitting || request.prompt.trim().length === 0}
              className="rounded bg-accent px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? "下单中…" : "生成"}
            </button>
          </div>
        ) : null}
        {trackedRound ? (
          <section aria-label="轮次追踪" className="mx-auto mt-3 w-full max-w-[48rem] rounded border border-border bg-bg-panel px-4 py-3 text-sm">
            <p>
              本轮状态：
              <span className="font-mono">{trackedRound.state}</span>
              {trackedRound.state === "done" ? " —— 生成完成。" : "（仅靠 GET 轮询感知，无推送）"}
            </p>
            <p className="mt-1 font-mono text-xs text-text-muted">round_id: {trackedRound.round_id}</p>
          </section>
        ) : null}
        {convId ? (
          <div className="mt-4">
            <ConversationFeed
              convId={convId}
              trackedRound={trackedRound}
              selections={selections}
              onSelect={pickImage}
              refreshKey={refreshKey}
            />
          </div>
        ) : null}
        {error ? (
          <p className="mt-2 text-center text-sm text-red-500" role="alert" aria-live="polite">{error}</p>
        ) : null}
        {hasThread ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={discardThread}
              className="text-xs text-text-muted underline hover:text-text"
            >
              放弃本次对话，重新开始
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
