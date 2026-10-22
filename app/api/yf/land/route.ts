import { NextResponse, type NextRequest } from "next/server";
import { yfDataRoot } from "@/lib/yf/data-root";
import { resolveYfIdentity } from "@/lib/yf/identity";
import { landRound } from "@/lib/yf/land";
import { upstreamBase } from "@/lib/yf/upstream";

export const dynamic = "force-dynamic";

/**
 * POST /api/yf/land `{"round_id"}` —— 把已完成的一轮落进登录用户自己的画廊
 * （plan step 13）。cookie 鉴权（身份取自 session index，不信客户端自报）；
 * done → presign → 下载 → 原子写，幂等；非 done → `{"landed": 0}`；别人的轮 →
 * 契约的 404 not_found 原样透传（反枚举）。静态段优先于 `[...path]` 代理。
 */
function envelope(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveYfIdentity(request);
  if (!identity) return envelope(401, "unauthorized", "未登录");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return envelope(400, "invalid_json", "请求体不是合法 JSON");
  }
  const roundId = (body as { round_id?: unknown } | null)?.round_id;
  if (typeof roundId !== "string") return envelope(400, "bad_request", "缺少 round_id");
  try {
    const result = await landRound(roundId, {
      upstream: upstreamBase(),
      cookie: request.headers.get("cookie") ?? "",
      userId: identity.userId,
      dataRoot: yfDataRoot(),
    });
    if (result.ok) return NextResponse.json({ landed: result.landed });
    return new NextResponse(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return envelope(502, "internal", error instanceof Error ? error.message : "落盘失败");
  }
}
