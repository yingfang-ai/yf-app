import { mkdirSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute, resolve } from "node:path";
import { yfDataRoot } from "./data-root";

/**
 * 普通用户的数据目录布局（plan step 10，R5/R10）：
 *
 * - `<数据根>/users/<user_id>/` —— 该用户 agent 会话的 cwd（服务端建目录）
 * - `<数据根>/gallery/<user_id>/…` —— 该用户的画廊（plan D3，step 13 落盘）
 *
 * user_id 只当目录名用：必须是安全的单段名（契约是 32 位 hex，运营者名单里的
 * id 同形），否则一律拒绝——不让 `../` 之类穿出自己的目录。
 */
const SAFE_USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isSafeUserId(userId: string): boolean {
  return SAFE_USER_ID.test(userId);
}

function assertSafe(userId: string): void {
  if (!isSafeUserId(userId)) throw new Error("invalid user id");
}

export function usersRoot(dataRoot: string = yfDataRoot()): string {
  return join(dataRoot, "users");
}

export function userDataDir(userId: string, dataRoot: string = yfDataRoot()): string {
  assertSafe(userId);
  return join(usersRoot(dataRoot), userId);
}

export function userGalleryDir(userId: string, dataRoot: string = yfDataRoot()): string {
  assertSafe(userId);
  return join(dataRoot, "gallery", userId);
}

/** 建（幂等）并返回规范路径（realpath）。 */
export function ensureUserDataDir(userId: string, dataRoot: string = yfDataRoot()): string {
  const dir = userDataDir(userId, dataRoot);
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** `child` 是否在 `parent` 之内（含相等），按 realpath 比较。 */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(realOrResolved(parent), realOrResolved(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** cwd 是否落在某个用户目录（任何人的 `users/<id>/` 之内）——引导会话的判据。 */
export function isUserDataCwd(cwd: string, dataRoot: string = yfDataRoot()): boolean {
  const root = usersRoot(dataRoot);
  return cwd !== root && isInside(root, cwd);
}

/** cwd 是否属于该用户自己的数据目录。 */
export function isOwnDataCwd(userId: string, cwd: string, dataRoot: string = yfDataRoot()): boolean {
  return isSafeUserId(userId) && isInside(userDataDir(userId, dataRoot), cwd);
}
