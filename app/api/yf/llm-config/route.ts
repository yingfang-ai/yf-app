import { NextResponse, type NextRequest } from "next/server";
import { requireOperator } from "@/lib/yf/route-policy";
import { llmConfigView, readLlmConfig, writeLlmConfig } from "@/lib/yf/llm-config";

/**
 * 单一 LLM 配置通道（plan step 6，spec R3/A2）：仅运营者可看可改。
 *
 * - GET → `{base_url, model_id, key_configured}`（key 永不回显）；
 * - PUT `{base_url, key, model_id}` → 写入（可覆盖不可读回）；
 * - 普通用户 → 403（A2）；匿名 → 401（守卫兜底）。
 * 响应与日志里不出现 key 的任何字节。
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOperator(request);
  if (denied) return denied;
  const config = readLlmConfig();
  if (!config) {
    return NextResponse.json({ base_url: "", model_id: "", key_configured: false }, { status: 200 });
  }
  return NextResponse.json(llmConfigView(config));
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOperator(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "bad_request", message: "请求体不是合法 JSON" } },
      { status: 400 },
    );
  }
  const { base_url, key, model_id } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof base_url !== "string" || typeof model_id !== "string" || typeof key !== "string"
    || base_url.length === 0 || model_id.length === 0
  ) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "base_url / key / model_id 不完整" } },
      { status: 400 },
    );
  }
  // key 留空 = 保持已配置的 key 不变（可覆盖不可读回，也不允许误清）。
  const existing = readLlmConfig();
  const effectiveKey = key.length > 0 ? key : existing?.key ?? "";
  try {
    writeLlmConfig({ base_url, key: effectiveKey, model_id });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "internal", message: error instanceof Error ? error.message : String(error) } },
      { status: 500 },
    );
  }
  return NextResponse.json(llmConfigView({ base_url, key: effectiveKey, model_id }));
}