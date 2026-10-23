import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed, isApiRequestHostAllowed } from "@/lib/request-security";
import { yfSessionTokenFromCookie } from "@/lib/yf/session-index";

/**
 * yf 门（plan step 4，spec R7）：`yf_session` cookie 在场放行、不在场跳登录页。
 * 上游 request-security 逻辑保留（host/origin 校验）。
 *
 * - `/api/yf/register`、`/api/yf/login` 是 pre-auth 端点：对匿名可达（鉴权由
 *   契约与 yf-app 路由自己管——yf 门只管页面）。
 * - 其余 `/api/*` 匿名 → 401；页面匿名 → 跳 `/login`（带 next 回跳参数）。
 * - pi-web 的口令登录（PI_WEB_PASSWORD）不再是登录方式：web-auth 族已删。
 */

// pre-auth 端点（契约 §2.1–2.2）：注册与登录本身不需要会话。
const PRE_AUTH_API = /^\/api\/yf\/(register|login)$/;

// 已删除的面（yingfang#28 R3/R4）：路由已不存在，匿名与登录请求一律同样回 404
// （不让登录门把「已删除」伪装成「需要登录」）。放行到路由层由 Next 回 404。
// yingfang#31（spec R1）：models / models-config / auth 三族随「模型」tab 恢复，
// 从删除面移除（owner 推翻 #28 对应裁决）；terminal / worktrees / web-auth 与
// agent bash-output 维持删除。注意 `/api/yf/llm-config` 不在此列：它会被
// `app/api/yf/[...path]` catch-all 逐字转发到 yingfang 上游，须由门直接回 404（见
// REMOVED_LLM_CHANNEL_API）。
const DELETED_API = /^\/api\/(terminal|worktrees|web-auth)(\/|$)|^\/api\/agent\/[^/]+\/bash-output(\/|$)/;

// 已移除的单一「LLM 服务」通道（yingfang#31 spec R1）：`/api/yf/llm-config` 落在
// `/api/yf/*` catch-all 的转发面里，不能像 DELETED_API 族那样放行给 Next 404——
// 放行会把它逐字转发到 yingfang 的 /api/llm-config（上游不可达变 5xx，还绕过
// 登录门形成匿名入口）。门层直接回 404、不转发，匿名与登录请求一致。
const REMOVED_LLM_CHANNEL_API = /^\/api\/yf\/llm-config(\/|$)/;

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  if (isApiRequest && REMOVED_LLM_CHANNEL_API.test(request.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  if (isApiRequest && DELETED_API.test(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const token = yfSessionTokenFromCookie(request.headers.get("cookie"));
  if (token) {
    // 会话在场：放行。会话有效性（index 命中/过期）由各路由自负（me/契约 401）。
    return NextResponse.next();
  }

  if (isApiRequest) {
    if (PRE_AUTH_API.test(request.nextUrl.pathname)) {
      return NextResponse.next();
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (request.nextUrl.pathname === "/login") {
    return NextResponse.next();
  }
  const loginUrl = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/" || request.nextUrl.search) {
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = { matcher: ["/", "/login", "/api/:path*"] };