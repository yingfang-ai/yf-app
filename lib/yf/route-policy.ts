import { NextResponse } from "next/server";
import { resolveYfIdentity } from "./identity";

/**
 * 运营者限定路由表（plan step 5，spec R5/A2/A5，路由族从基线树 2481a70 实查）：
 * 前缀 → 运营者限定。一张表一个事实；守卫（requireOperator）在表内每个路由
 * 文件的每个 handler 顶部一行接入。
 *
 * 普通用户直访 → 403（A2：身份已认证、权限不足——契约 §4 的 not_found 反枚举
 * 语义只针对「别人的资源」，不对配置面复用；403 也让运营者排障更直接）。
 * 匿名 → 401（yf 门在 middleware 层已拦，此处兜底）。
 *
 * 注意：本表管「谁能打哪个路由」；「打进去之后看哪个目录」是 files 根解析
 * （plan step 10）的另一个面，不要合成一个。
 */
export const OPERATOR_ONLY_ROUTE_PREFIXES = [
  "/api/skills", // 全族：route、install、check、search、update
  "/api/plugins", // 全族：route、check
  "/api/app-update",
  "/api/cwd", // browse、validate
  "/api/default-cwd",
  "/api/home",
  "/api/fs-manage",
  "/api/open-in-explorer",
  "/api/polyforge", // detect、status、watch
  "/api/project-trust",
  "/api/git", // status、diff（agent 面的 git 状态展示，R5 运营者限定）
  "/api/file-index",
  "/api/tools/settings",
  "/api/provider-usage", // query（读运营者机器上的 provider 凭据）
  "/api/subagents", // profiles、settings、[id]（子代理配置/运行面）
  "/api/push", // config、subscribe（web-push：订阅者能收到会话名/会话 id 的推送，仅运营者）
] as const;

export function isOperatorOnlyRoute(pathname: string): boolean {
  return OPERATOR_ONLY_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function deny(status: 401 | 403, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * 运营者守卫：返回 null 放行（运营者），否则返回应直接下发的拒绝响应。
 * 每个运营者限定路由的 handler 顶部一行接入：
 *
 *   const denied = await requireOperator(req);
 *   if (denied) return denied;
 */
export async function requireOperator(request: Request): Promise<NextResponse | null> {
  const identity = resolveYfIdentity(request);
  if (!identity) return deny(401, "unauthorized", "未登录");
  if (!identity.operator) return deny(403, "forbidden", "权限不足（该面仅运营者可用）");
  return null;
}
