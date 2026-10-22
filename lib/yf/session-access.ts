import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { resolveYfIdentity, type YfIdentity } from "./identity";
import { isOwnDataCwd } from "./user-dirs";

/**
 * 会话归属守卫（plan step 10，R5/R10）：普通用户只能碰 cwd 在自己数据目录里的
 * 会话；运营者保持上游行为（全部）。别人的/不存在的会话一律 404（反枚举，与契约
 * §4 的 not_found 语义同形）；匿名 401。
 *
 *   const denied = await requireSessionAccess(req, id);
 *   if (denied) return denied;
 */
function deny(status: 401 | 404, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function unauthorizedResponse(): NextResponse {
  return deny(401, "unauthorized", "未登录");
}

async function sessionCwd(sessionId: string): Promise<string | null> {
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) return live.cwd;
  const file = await resolveSessionPath(sessionId);
  return file ? readSessionHeader(file)?.cwd ?? null : null;
}

export function sessionVisibleTo(identity: YfIdentity, cwd: string | null | undefined): boolean {
  if (identity.operator) return true;
  return typeof cwd === "string" && isOwnDataCwd(identity.userId, cwd);
}

export async function requireSessionAccess(request: Request, sessionId: string): Promise<NextResponse | null> {
  const identity = resolveYfIdentity(request);
  if (!identity) return unauthorizedResponse();
  if (identity.operator) return null;
  const cwd = await sessionCwd(sessionId);
  if (!sessionVisibleTo(identity, cwd)) return deny(404, "not_found", "资源不存在");
  return null;
}

/** 列表类路由用：普通用户只留 cwd 在自己数据目录里的会话，运营者原样。 */
export function filterSessionsFor<T extends { cwd?: string | null }>(identity: YfIdentity, sessions: readonly T[]): T[] {
  return identity.operator ? [...sessions] : sessions.filter((session) => sessionVisibleTo(identity, session.cwd));
}
