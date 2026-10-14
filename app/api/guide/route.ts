import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleGuideRequest } from "@/lib/yf/guide-protocol";

// yf-app 唯一的自有 API 面：LLM 引导代理。
//
// - key（YF_LLM_API_KEY）只存在于服务端环境变量；请求头只在服务端 → 上游的
//   那一跳出现，响应体绝不回显 key / baseUrl / model（见 guide-protocol 的返回形态）。
// - 模型为单一固定模型（YF_LLM_MODEL，部署环境变量）；用户没有模型选择面。
// - 三项部署变量任一缺失 ⇒ 按请求 503 guide_unavailable（docs/deploy.md）。
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => undefined);
  const result = await handleGuideRequest(body, {
    baseUrl: process.env.YF_LLM_BASE_URL,
    apiKey: process.env.YF_LLM_API_KEY,
    model: process.env.YF_LLM_MODEL,
  });
  return NextResponse.json(result.body, { status: result.status });
}
