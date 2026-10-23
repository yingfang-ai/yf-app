import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { isConfigExpression } from "@/lib/model-discovery-guards";
import { removeStoredCredentialIfType, storeProviderCredential } from "@/lib/provider-credential-store";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { requireOperator } from "@/lib/yf/route-policy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  // yingfang#31（spec R5/plan A6）：内置 provider key 录入面仅运营者——普通用户 403、匿名 401。
  const denied = await requireOperator(req);
  if (denied) return denied;

  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    // yingfang#31（spec R7/plan A3）：录入同样只收字面量——`!命令` / `$VAR` 表达式
    // 会在服务端执行 shell / 读服务端环境变量，不属于可录入的密钥形态。
    if (isConfigExpression(apiKey.trim())) {
      return NextResponse.json({
        error: "API key 只接受字面量：不支持「!命令」或「$环境变量」表达式写法",
      }, { status: 400 });
    }
    const modelRuntime = await createModelRuntimeWithExtensions();
    const apiKeyAuth = modelRuntime.getProvider(provider)?.auth.apiKey;
    if (!apiKeyAuth?.login) {
      throw new Error(`${provider} does not support API key login`);
    }
    let keySubmitted = false;
    const credential = await apiKeyAuth.login({
      signal: req.signal,
      notify: () => {},
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const keyOption = prompt.options.find((option) => option.id === "api-key" || option.id === "bearer-token");
          if (keyOption) return keyOption.id;
          throw new Error(`${provider} requires interactive authentication setup`);
        }
        if (!keySubmitted && prompt.type === "secret") {
          keySubmitted = true;
          return apiKey.trim();
        }
        throw new Error(`${provider} requires additional authentication settings`);
      },
    });
    // ModelRuntime.login() persists the credential and then performs an
    // unbounded network catalog refresh. Store the returned credential
    // directly so a slow catalog cannot leave the save request hanging.
    await storeProviderCredential(provider, credential);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(req: Request, { params }: Params) {
  // yingfang#31（spec R5/plan A6）：key 删除面仅运营者——普通用户 403、匿名 401。
  const denied = await requireOperator(req);
  if (denied) return denied;

  const { provider } = await params;
  try {
    const removal = await removeStoredCredentialIfType(provider, "api_key");
    if (removal.status === "type_mismatch") {
      return NextResponse.json(
        { error: `${provider} is authenticated with OAuth, not an API key` },
        { status: 409 },
      );
    }
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
