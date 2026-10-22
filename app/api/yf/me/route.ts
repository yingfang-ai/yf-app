import { NextResponse, type NextRequest } from "next/server";
import { resolveYfIdentity } from "@/lib/yf/identity";

/**
 * GET /api/yf/me —— 当前身份（plan D2/D3）：`{user_id, operator}`。
 *
 * 身份走 session index（lib/yf/identity.ts），运营者 = 名单 ∪
 * `YF_OPERATOR_USER_IDS`；不回名单本身。匿名/伪造/已登出 token → 401
 * （契约错误信封形态）。
 */
function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: "unauthorized", message: "未登录" } },
    { status: 401 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = resolveYfIdentity(request);
  if (!identity) return unauthorized();
  return NextResponse.json({ user_id: identity.userId, operator: identity.operator });
}
