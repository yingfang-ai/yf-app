"use client";

import { encodeFilePathForApi } from "@/lib/file-paths";
import type { WorkflowPhase } from "@/lib/yf/workflow";

/**
 * 一轮生图的进度与结果（plan step 13）：聊天里确认下单后的状态呈现。
 * done → 画廊里的真实文件缩略图（经 files API，点开走文件预览 R6）；
 * failed/cancelled 只在聊天里告知（不落文件）。不展示价格。
 */
const STATE_TEXT: Record<string, string> = {
  queued: "排队中…",
  dispatched: "已派发，马上开始…",
  running: "生成中…",
};

export function describePhase(phase: WorkflowPhase): string {
  switch (phase.kind) {
    case "submitting": return "正在提交…";
    case "running": return STATE_TEXT[phase.state] ?? "处理中…";
    case "landing": return "生成完成，正在保存到你的画廊…";
    case "done": return `已保存 ${phase.files.length} 张到你的画廊`;
    case "ended": return phase.state === "failed" ? "这一轮没有生成成功，可以让引导员调整后再试。" : "这一轮已被取消。";
    case "error": return `出了点问题：${phase.message}`;
  }
}

export function RoundResultCard({
  phase,
  onOpenFile,
  onRetry,
}: {
  phase: WorkflowPhase;
  onOpenFile?: (filePath: string, page?: number) => void;
  onRetry?: () => void;
}) {
  return (
    <div className="yf-round-result" role="status" style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>
      <div>{describePhase(phase)}</div>
      {phase.kind === "error" && onRetry && phase.roundId && (
        <button type="button" onClick={onRetry} style={{ marginTop: 6 }}>重试</button>
      )}
      {phase.kind === "done" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {phase.files.map((file) => (
            <button
              key={file}
              type="button"
              onClick={() => onOpenFile?.(file)}
              aria-label="查看大图"
              style={{ padding: 0, border: "1px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/files/${encodeFilePathForApi(file)}?type=read`}
                alt="生成的图片"
                width={160}
                height={160}
                style={{ objectFit: "cover", borderRadius: 6, display: "block" }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
