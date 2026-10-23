import { NextResponse, type NextRequest } from "next/server";
import { resolveYfIdentity } from "@/lib/yf/identity";
import { isSafeUserId, userGalleryDir } from "@/lib/yf/user-dirs";

/**
 * GET /api/yf/me —— 当前身份（plan D2/D3）：`{user_id, operator, gallery_root}`。
 *
 * 身份走 session index（lib/yf/identity.ts），运营者 = 名单 ∪
 * `YF_OPERATOR_USER_IDS`；不回名单本身。`gallery_root` 是该用户自己的画廊根
 * （服务端布局 `<数据根>/gallery/<user_id>`，R10 读面：文件浏览器把它作为
 * 普通用户的 explorer 分区；只在自己文件根之内，不暴露别人的任何路径）。
 * 匿名/伪造/已登出 token → 401（契约错误信封形态）。
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
  return NextResponse.json({
    user_id: identity.userId,
    operator: identity.operator,
    gallery_root: isSafeUserId(identity.userId) ? userGalleryDir(identity.userId) : null,
  });
}
