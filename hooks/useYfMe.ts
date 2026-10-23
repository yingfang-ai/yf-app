"use client";

import { useEffect, useState } from "react";

/**
 * 当前身份的客户端读面（一个事实一个地方）：`GET /api/yf/me` 只在这里取，
 * SettingsPanel / SessionSidebar 等一切「运营者才有的 UI 入口」都经
 * useYfMe() 判定，不各自 fetch。
 *
 * 模块级单飞 promise：同屏多个组件共享一次请求；会话切换（登出/换号）伴随
 * 整页跳转（window.location.replace），模块必然重载，不会读到旧身份。
 */
export interface YfMe {
  user_id: string;
  operator: boolean;
  /** 该用户自己的画廊根（服务端布局；匿名不可达，此处恒有值或 null）。 */
  gallery_root?: string | null;
}

let mePromise: Promise<YfMe | null> | null = null;

export function fetchYfMe(): Promise<YfMe | null> {
  if (!mePromise) {
    mePromise = fetch("/api/yf/me")
      .then(async (response): Promise<YfMe | null> => {
        if (!response.ok) return null;
        try {
          return await response.json() as YfMe;
        } catch {
          return null;
        }
      })
      .catch(() => null);
  }
  return mePromise;
}

/** 当前身份；未加载/匿名（401）时为 null（UI 按普通用户处理，不闪运营者面）。 */
export function useYfMe(): YfMe | null {
  const [me, setMe] = useState<YfMe | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchYfMe().then((data) => {
      if (!cancelled && data) setMe(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}