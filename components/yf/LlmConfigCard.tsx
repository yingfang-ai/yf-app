"use client";

import { useEffect, useState, type FormEvent } from "react";

/**
 * 单一 LLM 配置通道（plan step 6，spec R3）：仅运营者可用的设置面入口。
 * key 只写不回显：保存后连运营者也只看到「已配置」，可覆盖不可读回。
 * 文案仅简体中文（R12）。
 */
export function LlmConfigCard() {
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/yf/llm-config")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { base_url?: string; model_id?: string; key_configured?: boolean };
        if (cancelled) return;
        setBaseUrl(data.base_url ?? "");
        setModelId(data.model_id ?? "");
        setKeyConfigured(data.key_configured === true);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/yf/llm-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl, key: apiKey, model_id: modelId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
      }
      const data = await response.json() as { key_configured?: boolean };
      setKeyConfigured(data.key_configured === true);
      setApiKey("");
      setStatus({ kind: "ok", message: "已保存。key 已配置（不回显），可随时覆盖。" });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-general-section settings-llm-config">
      <h2 className="settings-general-heading">LLM 服务（单一配置通道）</h2>
      <p className="settings-general-description">
        全站共用一份 LLM 配置，供聊天栏（含引导技能）使用；仅运营者可配置。
        key 只写不回显：保存后只显示「已配置」，可覆盖、不可读回。
      </p>
      <form className="settings-llm-form" onSubmit={submit}>
        <label className="settings-llm-label" htmlFor="llm-base-url">服务地址（base_url）</label>
        <input
          id="llm-base-url"
          className="settings-llm-input"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://…/v1"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={busy}
        />
        <label className="settings-llm-label" htmlFor="llm-model-id">模型标识（model_id）</label>
        <input
          id="llm-model-id"
          className="settings-llm-input"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          placeholder="例如 gpt-4o-mini"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={busy}
        />
        <label className="settings-llm-label" htmlFor="llm-api-key">
          API key{keyConfigured ? "（已配置，留空则保持不变）" : ""}
        </label>
        <input
          id="llm-api-key"
          className="settings-llm-input"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={keyConfigured ? "已配置" : "sk-…"}
          autoComplete="new-password"
          required={!keyConfigured}
          disabled={busy}
        />
        <button type="submit" className="settings-llm-save" disabled={busy || !loaded}>
          {busy ? "保存中…" : "保存配置"}
        </button>
        {status && (
          <p
            role="alert"
            aria-live="polite"
            className={status.kind === "ok" ? "settings-llm-status ok" : "settings-llm-status error"}
          >
            {status.message}
          </p>
        )}
      </form>
    </div>
  );
}