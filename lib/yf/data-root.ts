import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 数据根（plan D3）：`YF_DATA_DIR` 可覆盖（单测/e2e 的隔离缝，不许写真 home），
 * 缺省 `~/.local/share/yf-app`。其下布局：
 *
 * - `gallery/<user_id>/<conv_id>/<round_id>/<idx>.<ext>` —— 画廊（不进 git）
 * - `users/<user_id>/` —— 普通用户的 agent 会话数据目录（plan step 10）
 * - `llm/config.json` —— LLM 配置（0600，key 只写不回显，plan step 6）
 * - `session-index/<sha256(token)>.json` —— 服务端身份索引（plan D2）
 */
export function yfDataRoot(): string {
  return process.env.YF_DATA_DIR ?? join(homedir(), ".local", "share", "yf-app");
}