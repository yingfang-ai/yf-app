import { NextResponse } from "next/server";
import { filterSessionsFor, unauthorizedResponse } from "@/lib/yf/session-access";
import { resolveYfIdentity } from "@/lib/yf/identity";
import { listAllSessions } from "@/lib/session-reader";
import { getSessionListVersion, resolveSessionIdByPath } from "@/lib/session-reader";
import { getRecentSessionWrites, type SessionWriteEvent } from "@/lib/session-watcher";
import {
  getAwaitingRpcSessionIds,
  getCompletionNotificationSuppressedRpcSessionIds,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * Resolves the ring's session ids lazily: an empty ring (the common case) does
 * no work, keeping this poll lightweight.
 */
async function getRecentSessionWritePayload(): Promise<
  Array<{ sessionId: string | undefined; path: SessionWriteEvent["path"]; generation: number }>
> {
  const writes = getRecentSessionWrites();
  if (writes.length === 0) return [];
  return Promise.all(writes.map(async (write) => ({
    sessionId: await resolveSessionIdByPath(write.path),
    path: write.path,
    generation: write.generation,
  })));
}

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET(req: Request) {
  const identity = resolveYfIdentity(req);
  if (!identity) return unauthorizedResponse();
  // 普通用户只看到自己的会话 id（运营者原样）；写入环（带文件路径）同样按可见集过滤。
  const visibleIds = identity.operator
    ? null
    : new Set(filterSessionsFor(identity, await listAllSessions({ allowStale: true })).map((session) => session.id));
  const onlyVisible = (ids: string[]) => visibleIds ? ids.filter((id) => visibleIds.has(id)) : ids;
  const writes = await getRecentSessionWritePayload();
  return NextResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: onlyVisible(getRunningRpcSessionIds()),
      awaitingSessionIds: onlyVisible(getAwaitingRpcSessionIds()),
      completionNotificationSuppressedSessionIds: onlyVisible(getCompletionNotificationSuppressedRpcSessionIds()),
      recentSessionWrites: visibleIds
        ? writes.filter((write) => write.sessionId !== undefined && visibleIds.has(write.sessionId))
        : writes,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
