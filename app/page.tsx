"use client";

import { useEffect, useState } from "react";
import { listConvs, logout, YfUnauthorizedError } from "@/lib/yf/api";
import { clearSavedUser, getSavedUserId } from "@/lib/yf/auth-store";

/**
 * 工作台壳：未登录（GET /api/convs 401）重定向 /login；已登录展示产品主面。
 * 引导对话与产图读面在后续步骤接入本壳。
 */
export default function WorkbenchShell() {
  const [authState, setAuthState] = useState<"checking" | "logged-in">("checking");
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await listConvs();
        if (!cancelled) {
          setUserId(getSavedUserId());
          setAuthState("logged-in");
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof YfUnauthorizedError) {
          // 未登录：会话探测 401 → 登录页。
          window.location.replace("/login");
          return;
        }
        // 非鉴权错误也先按未登录链路处理以外的形态：留在页面上如实报错。
        setAuthState("logged-in");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <main className="min-h-dvh flex items-center justify-center bg-bg">
        <p className="text-sm text-text-muted">正在检查登录状态…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-base font-semibold">yf-app</h1>
          {userId ? (
            <p className="text-xs text-text-muted font-mono break-all">{userId}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={signOut}
          className="rounded border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-bg-subtle"
        >
          登出
        </button>
      </header>
      <section className="px-4 py-6">
        <p className="text-sm text-text-muted">对话工作台装配中。</p>
      </section>
    </main>
  );
}
