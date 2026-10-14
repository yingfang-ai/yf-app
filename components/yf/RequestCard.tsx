"use client";

import type { BackendEntry } from "@/lib/yf/backends";
import { backendsConfig, findBackend } from "@/lib/yf/backends";

/** 工作台正在成形的请求（SubmitRequest 的业务字段来源；conv_id 由提交层补）。 */
export interface RequestState {
  backendId: string;
  prompt: string;
  negativePrompt: string;
  n: number;
  seed: number;
  params: Record<string, string>;
}

/**
 * 请求成形卡。
 *
 * 纪律（spec「对话工作台」Requirement）：普通模式全程不出现 n / seed /
 * negative_prompt / params 的编辑控件——这些值由引导流程生成；只有专家模式
 * （header 开关）展开高级面板后才可见、可改。后端/模型清单来自打包内静态配置。
 */
export function RequestCard({
  request,
  onChange,
  expertMode,
  active,
}: {
  request: RequestState;
  onChange: (next: RequestState) => void;
  expertMode: boolean;
  active: boolean;
}) {
  const backend = findBackend(request.backendId) ?? backendsConfig.backends[0];

  const patch = (partial: Partial<RequestState>) => onChange({ ...request, ...partial });

  const switchBackend = (backendId: string) => {
    const next = findBackend(backendId) ?? backend;
    const params: Record<string, string> = {};
    for (const field of next.param_fields) {
      params[field.key] = request.params[field.key] ?? field.default;
    }
    onChange({
      ...request,
      backendId,
      n: Math.min(request.n, next.max_n),
      params,
    });
  };

  return (
    <section
      aria-label="请求成形卡"
      className="w-full max-w-[48rem] rounded-lg border border-border bg-bg-panel p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">本次生成请求</h2>
        <span className="text-xs text-text-muted">{backend.label}</span>
      </div>

      {/* prompt：请求本体，两种模式都可查看修改。 */}
      <label className="mt-3 block text-sm text-text">
        画面描述（prompt）
        <textarea
          className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text"
          rows={3}
          value={request.prompt}
          onChange={(event) => patch({ prompt: event.target.value })}
          placeholder={active ? "" : "完成引导对话后，这里会出现完整的画面描述"}
          disabled={!active}
        />
      </label>

      {expertMode ? (
        <div className="mt-3 space-y-3 rounded border border-border bg-bg-subtle p-3">
          <p className="text-xs font-semibold text-text-muted">高级参数（专家模式）</p>

          <label className="block text-sm text-text">
            后端
            <select
              className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-sm text-text"
              value={request.backendId}
              onChange={(event) => switchBackend(event.target.value)}
              disabled={!active}
            >
              {backendsConfig.backends.map((entry) => (
                <option key={entry.backend_id} value={entry.backend_id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-text">
            张数 n（1–{backend.max_n}）
            <input
              className="mt-1 w-full rounded border border-border bg-bg px-3 py-1.5 text-sm text-text"
              type="number"
              min={1}
              max={backend.max_n}
              value={Number.isFinite(request.n) ? request.n : ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                patch({ n: Number.isFinite(value) ? Math.min(backend.max_n, Math.max(1, Math.round(value))) : backend.default_n });
              }}
              disabled={!active}
            />
          </label>

          <label className="block text-sm text-text">
            基 seed（-1 = 由后端自选）
            <input
              className="mt-1 w-full rounded border border-border bg-bg px-3 py-1.5 text-sm text-text"
              type="number"
              value={Number.isFinite(request.seed) ? request.seed : ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                patch({ seed: Number.isFinite(value) ? Math.round(value) : -1 });
              }}
              disabled={!active}
            />
          </label>

          <label className="block text-sm text-text">
            负向提示词（negative_prompt）
            <input
              className="mt-1 w-full rounded border border-border bg-bg px-3 py-1.5 text-sm text-text"
              value={request.negativePrompt}
              onChange={(event) => patch({ negativePrompt: event.target.value })}
              placeholder="不需要就留空"
              disabled={!active}
            />
          </label>

          {backend.param_fields.map((field) => (
            <label key={field.key} className="block text-sm text-text">
              {field.label}（params.{field.key}）
              <select
                className="mt-1 w-full rounded border border-border bg-bg px-2 py-1.5 text-sm text-text"
                value={request.params[field.key] ?? field.default}
                onChange={(event) => patch({ params: { ...request.params, [field.key]: event.target.value } })}
                disabled={!active}
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** 由后端定义初始化一份请求状态。 */
export function initialRequest(backend: BackendEntry): RequestState {
  const params: Record<string, string> = {};
  for (const field of backend.param_fields) {
    params[field.key] = field.default;
  }
  return {
    backendId: backend.backend_id,
    prompt: "",
    negativePrompt: "",
    n: backend.default_n,
    seed: -1,
    params,
  };
}
