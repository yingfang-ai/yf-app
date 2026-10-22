import { yfDataRoot } from "./data-root";
import { isOperatorUserId } from "./operators";
import { readSessionIndex, yfSessionTokenFromCookie } from "./session-index";

/**
 * 请求的服务端身份（plan D2）：cookie → session index → user_id。一个事实一个
 * 地方：me / 运营者守卫 / 会话 cwd / 画廊落盘都经这里取身份。
 *
 * 有效性：索引命中即有效。`expires_at` 只作记录、不在 yf-app 侧再判过期——会话
 * 的真实期限归 yingfang 与 cookie 自己的 Max-Age 管（过期 cookie 浏览器不再带，
 * 契约调用被 yingfang 401 透传；无 cookie 则拿不到索引项，索引只存 token 哈希）。
 * 匿名/伪造/已登出（索引已删）→ null。
 */
export interface YfIdentity {
  userId: string;
  operator: boolean;
}

export function resolveYfIdentity(request: Request): YfIdentity | null {
  const token = yfSessionTokenFromCookie(request.headers.get("cookie"));
  if (!token) return null;
  const entry = readSessionIndex(yfDataRoot(), token);
  if (!entry) return null;
  return { userId: entry.user_id, operator: isOperatorUserId(entry.user_id) };
}
