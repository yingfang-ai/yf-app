import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { yfDataRoot } from "./data-root";
import { writePrivateFileAtomicSync } from "../atomic-file";

/**
 * 单一 LLM 配置通道（plan step 6，spec R3）：全站共用一份配置，仅运营者可看可改
 * （权限由 /api/yf/llm-config 路由守卫管）；key 只写不回显——GET 永不返回 key，
 * 保存后界面只显示「已配置」。旧 `YF_LLM_*` 环境变量通道已移除（step 2），
 * 本通道是唯一来源。
 *
 * 存储：`<数据根>/llm/config.json`（0600、原子写、不进 git、不进日志、不进构建产物）。
 */
export interface LlmConfig {
  base_url: string;
  key: string;
  model_id: string;
}

/** GET /api/yf/llm-config 的回显形态：key 永不出现（key_configured 布尔化）。 */
export interface LlmConfigView {
  base_url: string;
  model_id: string;
  key_configured: boolean;
}

/** 通道在 SDK ModelRuntime 里的 provider id（生成的 runtime models.json 用）。 */
export const LLM_CHANNEL_PROVIDER_ID = "yf-llm";

export function llmConfigPath(dataRoot: string = yfDataRoot()): string {
  return join(dataRoot, "llm", "config.json");
}

function isLlmConfig(value: unknown): value is LlmConfig {
  return (
    !!value
    && typeof value === "object"
    && typeof (value as LlmConfig).base_url === "string"
    && typeof (value as LlmConfig).key === "string"
    && typeof (value as LlmConfig).model_id === "string"
    && (value as LlmConfig).base_url.length > 0
    && (value as LlmConfig).model_id.length > 0
  );
}

/** 读配置；未配置/不可解析 → null（新会话据此明确报错，不静默兜底）。 */
export function readLlmConfig(dataRoot: string = yfDataRoot()): LlmConfig | null {
  const filePath = llmConfigPath(dataRoot);
  if (!existsSync(filePath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return isLlmConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 写配置（PUT；原子写，可覆盖不可读回）。 */
export function writeLlmConfig(config: LlmConfig, dataRoot: string = yfDataRoot()): void {
  if (!isLlmConfig(config)) throw new Error("LLM 配置不完整（base_url / key / model_id）");
  mkdirSync(join(dataRoot, "llm"), { recursive: true });
  writePrivateFileAtomicSync(llmConfigPath(dataRoot), JSON.stringify(config, null, 2));
}

/** 回显形态（key 布尔化，永不回显 key 字节）。 */
export function llmConfigView(config: LlmConfig): LlmConfigView {
  return { base_url: config.base_url, model_id: config.model_id, key_configured: config.key.length > 0 };
}

/**
 * 由通道生成 SDK 的 ModelRuntime：provider 定义（baseUrl + apiKey + 模型清单）
 * 写进 `<数据根>/llm/runtime-models.json`（0600 派生文件，不进仓不进日志），
 * `ModelRuntime.create({modelsPath})` 以它为唯一 provider 配置源（内置 provider
 * 无凭据不可用，通道 provider 是唯一可用模型源）。幂等：每次会话启动按
 * config.json 重生成（内容稳定，原子写，无并发写竞争）。
 */
export async function llmChannelModelRuntime(
  config: LlmConfig,
  dataRoot: string = yfDataRoot(),
): Promise<ModelRuntime> {
  const runtimeModels = {
    providers: {
      [LLM_CHANNEL_PROVIDER_ID]: {
        name: "LLM 服务（单一通道）",
        baseUrl: config.base_url,
        apiKey: config.key,
        api: "openai-completions",
        models: [
          { id: config.model_id, name: config.model_id, input: ["text"] },
        ],
      },
    },
  };
  const runtimePath = join(dataRoot, "llm", "runtime-models.json");
  mkdirSync(join(dataRoot, "llm"), { recursive: true });
  writePrivateFileAtomicSync(runtimePath, JSON.stringify(runtimeModels, null, 2));
  return ModelRuntime.create({ modelsPath: runtimePath, allowModelNetwork: false });
}