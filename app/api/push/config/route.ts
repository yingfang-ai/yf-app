import { getVapidPublicKey } from "@/lib/web-push";
import { requireOperator } from "@/lib/yf/route-policy";
import type { PushConfigResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

// GET /api/push/config - VAPID public key for client-side push subscriptions.
// The private key never leaves the server. 运营者限定（R5/R10）：与 subscribe
// 同面——推送携带会话名/会话 id，配置面不得对普通用户/匿名开放。
export async function GET(req: Request): Promise<Response> {
  const denied = await requireOperator(req);
  if (denied) return denied;
  const publicKey = await getVapidPublicKey();
  const body: PushConfigResponse = { publicKey };
  return Response.json(body);
}
