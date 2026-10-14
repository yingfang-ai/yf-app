// 账号面的客户端存储：localStorage 只记住 user_id（登录态），recovery 零持久化。
//
// 纪律（spec「账号面」Requirement）：
// - user_id 由浏览器 localStorage 记住，登录页据此预填，免重复输入；
// - recovery 是唯一凭据，绝不写入任何客户端存储（localStorage /
//   sessionStorage / cookie 均不写），也不做任何摘要/缓存式变体持久化；
// - 「丢 recovery = 丢账号」由注册确认门与登录失败文案如实呈现。
const USER_ID_KEY = "yf.user_id";

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** 读取记住的 user_id（未登录过或存储不可用时返回 null）。 */
export function getSavedUserId(): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(USER_ID_KEY);
  } catch {
    return null;
  }
}

/** 登录/注册成功后记住 user_id。 */
export function saveUserId(userId: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(USER_ID_KEY, userId);
  } catch {
    // 存储被禁用（隐私模式等）：预填不可用是可接受的降级，登录态在 cookie 上。
  }
}

/** 登出时清除记住的 user_id。 */
export function clearSavedUser(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(USER_ID_KEY);
  } catch {
    // 同上：忽略存储异常。
  }
}

/** 全部由本模块管理的键（测试/审计用）。 */
export function managedKeys(): readonly string[] {
  return [USER_ID_KEY] as const;
}
