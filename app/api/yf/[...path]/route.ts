import { NextResponse, type NextRequest } from "next/server";
import { yfDataRoot } from "@/lib/yf/data-root";
import {
  deleteSessionIndex,
  writeSessionIndex,
  yfSessionTokenFromCookie,
} from "@/lib/yf/session-index";

/**
 * yingfang 契约同源代理（plan D1）：`/api/yf/*` 整体逐字转发到 yingfang
 * （缺省 `http://127.0.0.1:9701`，`YF_API_UPSTREAM` 可覆盖——e2e 的测试内桩缝）。
 *
 * - cookie 原样携带、`Set-Cookie` 原样回传（`yf_session` 自然覆盖全站）；
 * - 错误信封透传不改（契约权威在 api-contract.md §2）；
 * - login 响应顺手落 session index（D2，服务端身份），logout 删 index；
 * - 反代不再分流 `/api/*`（docs/deploy.md 随新拓扑改写）。
 *
 * 注册/登录是 pre-auth 端点：本路由对匿名可达（鉴权由契约与 yf-app 路由自己管）。
 */
const DEFAULT_UPSTREAM = "http://127.0.0.1:9701";

// 逐字转发时不该由本服务代言的头（hop-by-hop / 传输层）。
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
]);

function upstreamBase(): string {
  return (process.env.YF_API_UPSTREAM ?? DEFAULT_UPSTREAM).replace(/\/+$/, "");
}

async function forward(request: NextRequest, path: string): Promise<Response> {
  const target = new URL(`${upstreamBase()}/api/${path}${new URL(request.url).search}`);
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (!DROPPED_REQUEST_HEADERS.has(key)) headers.set(key, value);
  }
  const hasBody = !["GET", "HEAD"].includes(request.method);
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });
  return response;
}

/** 从上游响应的 Set-Cookie 里取 yf_session token（login 建立会话时才有）。 */
function sessionTokenFromSetCookies(setCookies: string[]): string | null {
  for (const cookie of setCookies) {
    const token = /(?:^|;\s*)yf_session=([^;]+)/.exec(cookie.split("\n")[0])?.[1];
    if (token) return token;
  }
  return null;
}

async function handle(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const path = pathSegments.map((segment) => decodeURIComponent(segment)).join("/");
  const response = await forward(request, path);
  // 契约响应都是小 JSON；落盘路由（land）在服务端自己下载，不经本代理。
  const body = Buffer.from(await response.arrayBuffer());
  const setCookies = response.headers.getSetCookie();

  // login（D2）：会话建立时服务端顺手落 session index（只存 sha256(token)）。
  if (path === "login" && request.method === "POST" && response.status === 200) {
    const token = sessionTokenFromSetCookies(setCookies);
    if (token) {
      try {
        const payload: unknown = JSON.parse(body.toString("utf8"));
        if (
          payload
          && typeof payload === "object"
          && typeof (payload as { user_id?: unknown }).user_id === "string"
          && typeof (payload as { expires_at?: unknown }).expires_at === "string"
        ) {
          writeSessionIndex(yfDataRoot(), token, {
            user_id: (payload as { user_id: string }).user_id,
            expires_at: (payload as { expires_at: string }).expires_at,
          });
        }
      } catch {
        // 响应体不是 JSON：不落索引，响应原样透传。
      }
    }
  }

  // logout（D2）：删 index（幂等；伪造 token 在 index 里查不到，删也无害）。
  if (path === "logout" && request.method === "POST") {
    const token = yfSessionTokenFromCookie(request.headers.get("cookie"));
    if (token) deleteSessionIndex(yfDataRoot(), token);
  }

  const outgoing = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  for (const cookie of setCookies) {
    outgoing.headers.append("set-cookie", cookie);
  }
  return outgoing;
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return handle(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return handle(request, (await context.params).path);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  return handle(request, (await context.params).path);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  return handle(request, (await context.params).path);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  return handle(request, (await context.params).path);
}