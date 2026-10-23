import { buildApiKeyProviderList, buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { requireOperator } from "@/lib/yf/route-policy";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET(req: Request) {
  // yingfang#31（spec R5/plan A6）：provider 清单面仅运营者——普通用户 403、
  // 匿名 401。读回只含「已配置」标记（lib/provider-listing 的 configured 布尔），
  // 不含任何 key 字节。
  const denied = await requireOperator(req);
  if (denied) return denied;

  const modelRuntime = await createModelRuntimeWithExtensions();
  const inputs = await collectProviderListingInputs(modelRuntime);
  const oauthProviders = buildOAuthProviderList(inputs);
  const apiKeyProviders = buildApiKeyProviderList(inputs);
  return Response.json({ providers: oauthProviders, oauthProviders, apiKeyProviders });
}
