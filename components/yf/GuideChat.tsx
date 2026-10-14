"use client";

import { useEffect, useRef, useState } from "react";
import type { GuideTurn } from "@/lib/yf/guide-store";

/** 引导对话流：线性消息 + 一句话输入。 */
export function GuideChat({
  turns,
  busy,
  disabled,
  onSend,
}: {
  turns: GuideTurn[];
  busy: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, busy]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <section aria-label="引导对话" className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <p className="rounded-lg border border-border bg-bg-panel p-4 text-sm text-text-muted">
            用一句话描述你想画的画面，例如：「一只橘猫在窗台晒太阳，午后阳光，胶片感」。
            我会帮你把想法补全成一次完整的生成请求。
          </p>
        ) : null}
        {turns.map((turn, index) => (
          <div
            key={`${turn.at}-${index}`}
            className={`max-w-[48rem] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
              turn.role === "user"
                ? "ml-auto bg-accent text-white"
                : "bg-bg-panel text-text"
            }`}
          >
            {turn.content}
          </div>
        ))}
        {busy ? (
          <p className="text-xs text-text-muted" aria-live="polite">引导助手正在思考…</p>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <input
          className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-2 text-sm text-text"
          placeholder="一句话起步…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          disabled={busy || disabled}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || disabled || text.trim().length === 0}
          className="shrink-0 rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </section>
  );
}
