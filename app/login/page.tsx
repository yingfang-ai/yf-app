"use client";

import { useEffect, useState, type FormEvent } from "react";
import { login, register, YfApiError, YfUnauthorizedError } from "@/lib/yf/api";
import { clearSavedUser, getSavedUserId, saveUserId } from "@/lib/yf/auth-store";

type Mode = "login" | "register";

/**
 * 账号面：登录（user_id 预填、recovery 不持久化）与注册（邀请码 + recovery，
 * 注册成功后强制确认已保存 recovery 才能进入产品）。
 */
function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [userId, setUserId] = useState("");
  const [recovery, setRecovery] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 注册成功后的确认门状态：user_id 只在此屏展示一次。
  const [registeredUserId, setRegisteredUserId] = useState<string | null>(null);
  const [confirmedSaved, setConfirmedSaved] = useState(false);

  useEffect(() => {
    // user_id 由 localStorage 记住；recovery 永不预填（也不存在于任何存储）。
    const saved = getSavedUserId();
    if (saved) setUserId(saved);
  }, []);

  const enterProduct = (savedUserId: string) => {
    saveUserId(savedUserId);
    window.location.replace("/");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "register") {
        const result = await register({ invite_code: inviteCode, recovery });
        setRegisteredUserId(result.user_id);
      } else {
        const result = await login({ user_id: userId, recovery });
        enterProduct(result.user_id);
      }
    } catch (err) {
      if (err instanceof YfUnauthorizedError) {
        // 契约 401 unauthorized：user_id 与 recovery 不匹配。如实呈现：
        // recovery 是唯一凭据，服务端没有找回端点，丢失即账号丢失。
        setError("登录失败：user_id 或 recovery 不正确。recovery 是唯一凭据，本服务没有找回通道，丢失即无法访问账号。");
      } else if (err instanceof YfApiError) {
        if (err.code === "invite_not_found") {
          setError("邀请码不存在，请核对后重试。");
        } else if (err.code === "invite_exhausted") {
          setError("该邀请码名额已用完。");
        } else if (err.code === "bad_request") {
          setError("提交的信息不完整或不合法（recovery 至少 8 个字符）。");
        } else {
          setError(err.message || "请求失败，请稍后重试。");
        }
      } else {
        setError("网络异常，请稍后重试。");
      }
    } finally {
      setBusy(false);
    }
  };

  if (registeredUserId !== null) {
    // 注册成功 → 展示 user_id + 强制确认已保存 recovery（「丢失无法找回」警示）。
    return (
      <main className="min-h-dvh flex items-center justify-center bg-bg px-4">
        <div className="w-full max-w-md border border-border rounded-lg p-6 bg-bg-panel">
          <h1 className="text-lg font-semibold text-text">注册成功</h1>
          <p className="mt-3 text-sm text-text-muted">
            你的 <strong className="text-text">user_id</strong>（登录名，已自动为你记住）：
          </p>
          <p className="mt-1 select-all rounded bg-bg-subtle px-3 py-2 font-mono text-sm text-text break-all">
            {registeredUserId}
          </p>
          <div className="mt-4 rounded border border-border bg-bg-subtle p-3 text-sm text-text">
            <p className="font-semibold">请立即保存你的 recovery（恢复码）</p>
            <ul className="mt-2 list-disc pl-5 space-y-1 text-text-muted">
              <li>recovery 是<strong className="text-text">唯一</strong>登录凭据，只在本次展示，本页面不会再次显示。</li>
              <li>服务端<strong className="text-text">没有</strong>找回端点：recovery 一旦丢失，账号将<strong className="text-text">永久无法访问</strong>，无法找回。</li>
            </ul>
          </div>
          <label className="mt-4 flex items-start gap-2 text-sm text-text cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={confirmedSaved}
              onChange={(event) => setConfirmedSaved(event.target.checked)}
            />
            <span>我已把 recovery 保存到安全的地方，并了解：丢失 recovery 即丢失账号，且无法找回。</span>
          </label>
          <button
            type="button"
            disabled={!confirmedSaved || busy}
            className="mt-4 w-full rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => enterProduct(registeredUserId)}
          >
            我已保存，进入产品
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md border border-border rounded-lg p-6 bg-bg-panel">
        <h1 className="text-lg font-semibold text-text">yf-app</h1>
        <p className="mt-1 text-sm text-text-muted">图像创作工作台</p>

        <div className="mt-4 flex gap-2 text-sm" role="tablist">
          {(["login", "register"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={mode === candidate}
              className={`rounded px-3 py-1.5 ${mode === candidate ? "bg-accent text-white" : "bg-bg-subtle text-text-muted"}`}
              onClick={() => {
                setMode(candidate);
                setError("");
              }}
            >
              {candidate === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form className="mt-4 space-y-3" onSubmit={submit}>
          {mode === "register" ? (
            <label className="block text-sm text-text">
              邀请码
              <input
                className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 text-text"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                autoComplete="off"
                autoFocus
                required
                disabled={busy}
              />
            </label>
          ) : (
            <label className="block text-sm text-text">
              user_id
              <input
                className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 font-mono text-text"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                required
                disabled={busy}
              />
            </label>
          )}
          <label className="block text-sm text-text">
            recovery{mode === "register" ? "（至少 8 个字符，请自行妥善保存）" : ""}
            <input
              className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 text-text"
              type="password"
              value={recovery}
              onChange={(event) => setRecovery(event.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              minLength={mode === "register" ? 8 : undefined}
              disabled={busy}
            />
          </label>
          {mode === "register" ? (
            <p className="text-xs text-text-muted">
              注册后 recovery 是唯一登录凭据：服务端没有找回通道，丢失即永久失去账号。
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "请稍候…" : mode === "register" ? "注册" : "登录"}
          </button>
          <p className="text-sm text-red-500" role="alert" aria-live="polite">{error}</p>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // 进入登录页即视为要离开当前会话：清掉记住的 user_id 以外的残留（无）。
  // recovery 从不持久化，因此这里没有可清理的凭据；user_id 的预填保留。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("logout") === "1") {
      clearSavedUser();
    }
  }, []);
  return <AuthForm />;
}
