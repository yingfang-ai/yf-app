"use client";

import { useEffect, useState } from "react";
import { GuideChat } from "@/components/yf/GuideChat";
import { initialRequest, RequestCard, type RequestState } from "@/components/yf/RequestCard";
import { createConv, guide, listConvs, logout, YfUnauthorizedError } from "@/lib/yf/api";
import { defaultBackend, findBackend } from "@/lib/yf/backends";
import {
  appendGuideTurn,
  clearGuideHistory,
  listGuideConvs,
  loadGuideHistory,
  type GuideTurn,
} from "@/lib/yf/guide-store";
import type { GuideDraft, GuideMessage } from "@/lib/yf/guide-protocol";
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
    setResumableConv(null);
  };

  const discardThread = () => {
    if (convId) clearGuideHistory(convId);
    setConvId(null);
    setTurns([]);
    setRequest(initialRequest(defaultBackend()));
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
          />
        </div>
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
