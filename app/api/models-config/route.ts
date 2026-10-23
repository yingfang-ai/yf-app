import { NextResponse } from "next/server";
import {
  ModelsConfigReadError,
  readModelsConfig,
  toMaskedModelsConfig,
  validateModelsConfigPayload,
  writeModelsConfig,
} from "@/lib/models-config-store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { requireOperator } from "@/lib/yf/route-policy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // yingfang#31（spec R5/plan A6）：模型配置面仅运营者——普通用户 403、匿名 401。
  const denied = await requireOperator(req);
  if (denied) return denied;

  try {
    // yingfang#31（spec R4/plan A2）：读回一律走脱敏视图——apiKey 与 headers 值
    // 字节永不回显（含运营者自己），只给 key_configured / headers_configured
    // 「已配置」标记；服务端内部（runtime 组合、discover 守卫）仍读全量配置。
    return NextResponse.json(toMaskedModelsConfig(readModelsConfig()));
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  // yingfang#31（spec R5/plan A6）：模型配置面仅运营者——普通用户 403、匿名 401。
  const denied = await requireOperator(req);
  if (denied) return denied;

  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json().catch(() => null);
    // Audit S8: schema-gate the payload instead of writing an unrestricted
    // record to models.json.
    const validated = validateModelsConfigPayload(body);
    if (!validated.ok) {
      // yingfang#31（spec R7/plan A3）：表达式写法给可读提示——`!命令` 会在服务器
      // 上执行 shell、`$VAR` 会读服务器环境变量，两者都不属于运营者该在「模型」
      // tab 里录入的密钥形态。
      const error = validated.reason === "invalidConfigExpression"
        ? "API key 与自定义 headers 的值只接受字面量：不支持「!命令」或「$环境变量」表达式写法"
        : validated.reason;
      return NextResponse.json({ error }, { status: 400 });
    }
    writeModelsConfig(validated.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
