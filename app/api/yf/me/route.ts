import { NextResponse, type NextRequest } from "next/server";
import { yfDataRoot } from "@/lib/yf/data-root";
import { readSessionIndex, yfSessionTokenFromCookie } from "@/lib/yf/session-index";
import { isOperatorUserId } from "@/lib/yf/operators";

/**
 * GET /api/yf/me —— 当前身份（plan D2/D3）：`{user_id, operator}`。
 *
 * 身份走 session index（sha256(token) → user_id），运营者 = 名单 ∪
 * `YF_OPERATOR_USER_IDS`；不回名单本身。匿名/伪造/过期 token → 401
 * （契约错误信封形态）。
 */
function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: "unauthorized", message: "未登录" } },
    { status: 401 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = yfSessionTokenFromCookie(request.headers.get("cookie"));
  if (!token) return unauthorized();
  const entry = readSessionIndex(yfDataRoot(), token);
  if (!entry) return unauthorized();
  if (Date.parse(entry.expires_at) <= Date.now()) return unauthorized();
  return NextResponse.json({
    user_id: entry.user_id,
    operator: isOperatorUserId(entry.user_id),
  });
}