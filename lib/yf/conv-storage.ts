/**
 * 草案下单的会话续接存储（plan D6，verification rewind 补丁）：current conv
 * id 记在 localStorage，**按用户分键**（`yf.conv.<user_id>`）——登录页把
 * user_id 记在 `yf.user_id`（`yf.` 前缀是这个产品的客户端存储约定），这里
 * 只沿用那个键，不另存一份身份。登出（/login?logout=1）时把所有
 * `yf.conv.*` 清掉：换号登录后不会复用上一个用户的 conv_id（那只会得到
 * not_found 的重试循环）。
 *
 * 存储一律 best-effort：不可用/异常降级为「不续接」（每次新建会话），不抛。
 */
const USER_ID_KEY = "yf.user_id";
const CONV_KEY_PREFIX = "yf.conv.";

interface StorageLike {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** current conv 的分键；没有记住的 user_id → null（不续接）。 */
export function currentConvKey(storage: StorageLike | null = browserStorage()): string | null {
  if (!storage) return null;
  try {
    const userId = storage.getItem(USER_ID_KEY);
    return userId ? CONV_KEY_PREFIX + userId : null;
  } catch {
    return null;
  }
}

export function readCurrentConvId(storage: StorageLike | null = browserStorage()): string | null {
  const key = currentConvKey(storage);
  if (!key) return null;
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storeCurrentConvId(convId: string, storage: StorageLike | null = browserStorage()): void {
  const key = currentConvKey(storage);
  if (!key || !storage) return;
  try {
    storage.setItem(key, convId);
  } catch {
    // 存储不可用：本次仍可跑完，只是重开后不续。
  }
}

/** 登出清理：所有 `yf.conv.*`（任何用户的残留 conv id）一并移除。 */
export function clearAllConvKeys(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(CONV_KEY_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // 同上：降级为不清理（换号后按新键取，取不到即新建会话）。
  }
}