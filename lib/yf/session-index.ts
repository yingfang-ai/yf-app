import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFileAtomicSync } from "../atomic-file";

/**
 * 服务端身份索引（plan D2）：yingfang 契约没有 whoami 端点，而 yf-app 服务端必须
 * 知道当前请求的 user_id（画廊目录、运营者判定）。客户端自报 user_id 不可信
 * （谎报即击穿 R10 隔离），故 login 经 `/api/yf` 代理时服务端顺手落一条索引：
 *
 * `<数据根>/session-index/<sha256(token)>.json` → `{user_id, expires_at}`
 *
 * 只存哈希不存 token 明文——拿到索引文件造不出 cookie。logout 删除；注册不落
 * （无 cookie）；过期/伪造 token 在索引里查不到 → 按 401 处理。
 */
export interface SessionIndexEntry {
  user_id: string;
  expires_at: string;
}

/** yf_session cookie 的 token 提取（契约 §2.2：`yf_session=<token>`，`;` 分隔）。 */
export function yfSessionTokenFromCookie(cookie: string | undefined | null): string | null {
  const token = /(?:^|;\s*)yf_session=([^;]+)/.exec(cookie ?? "")?.[1];
  return token ? token : null;
}

export function sessionIndexTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionIndexPath(dataRoot: string, token: string): string {
  return join(dataRoot, "session-index", `${sessionIndexTokenHash(token)}.json`);
}

/** 落一条会话索引（原子写；目录不存在则建）。 */
export function writeSessionIndex(dataRoot: string, token: string, entry: SessionIndexEntry): void {
  mkdirSync(join(dataRoot, "session-index"), { recursive: true });
  writePrivateFileAtomicSync(sessionIndexPath(dataRoot, token), JSON.stringify(entry));
}

/** 删一条会话索引（logout；幂等，不存在即无操作）。 */
export function deleteSessionIndex(dataRoot: string, token: string): void {
  rmSync(sessionIndexPath(dataRoot, token), { force: true });
}

/** 查一条会话索引；不存在/不可解析 → null（按 401 处理）。 */
export function readSessionIndex(dataRoot: string, token: string): SessionIndexEntry | null {
  const filePath = sessionIndexPath(dataRoot, token);
  if (!existsSync(filePath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (
      parsed
      && typeof parsed === "object"
      && typeof (parsed as SessionIndexEntry).user_id === "string"
      && typeof (parsed as SessionIndexEntry).expires_at === "string"
    ) {
      return parsed as SessionIndexEntry;
    }
  } catch {
    // 不可解析的索引文件按不存在处理（fail closed）。
  }
  return null;
}