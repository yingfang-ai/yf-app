import raw from "../../config/operators.json" with { type: "json" };

/**
 * 运营者判定（plan D3/A3）：`config/operators.json` 的 user_id 名单 ∪
 * `YF_OPERATOR_USER_IDS`（逗号列表，e2e/部署的引导缝）。yingfang 契约没有角色
 * 字段，判定全在 yf-app 侧（yingfang 仓零改动）。只在服务端 import，不进任何
 * 客户端字节。
 */
export function isOperatorUserId(userId: string): boolean {
  const ids = new Set<string>(raw.operatorUserIds);
  for (const entry of (process.env.YF_OPERATOR_USER_IDS ?? "").split(",")) {
    const trimmed = entry.trim();
    if (trimmed) ids.add(trimmed);
  }
  return ids.has(userId);
}