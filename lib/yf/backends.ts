// 内置静态后端清单的加载与校验。
//
// 纪律（spec「下单」Requirement）：后端/模型清单 MUST 来自 yf-app 打包内的静态配置
// （config/backends.json），运行时不发起任何「backend 列表」网络请求。本模块是
// 该清单的唯一读取面：加载即校验（fail closed——清单畸形宁可显式报错，不静默放行）。
import raw from "../../config/backends.json" with { type: "json" };

export interface BackendParamField {
  key: string;
  label: string;
  kind: "select";
  options: string[];
  default: string;
}

export interface BackendEntry {
  backend_id: string;
  label: string;
  description: string;
  default_n: number;
  max_n: number;
  supports_negative_prompt: boolean;
  param_fields: BackendParamField[];
}

export interface BackendsConfig {
  version: number;
  backends: BackendEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateEntry(value: unknown): BackendEntry {
  if (!isRecord(value)) throw new Error("backends.json: 条目必须是对象");
  for (const key of ["backend_id", "label", "description", "default_n", "max_n", "supports_negative_prompt", "param_fields"]) {
    if (!(key in value)) throw new Error(`backends.json: 条目缺少 ${key}`);
  }
  if (typeof value.backend_id !== "string" || value.backend_id.length === 0) {
    throw new Error("backends.json: backend_id 必须是非空字符串");
  }
  if (typeof value.default_n !== "number" || !Number.isInteger(value.default_n) || value.default_n < 1) {
    throw new Error(`backends.json: ${value.backend_id} 的 default_n 必须是正整数`);
  }
  if (typeof value.max_n !== "number" || !Number.isInteger(value.max_n) || value.max_n < value.default_n) {
    throw new Error(`backends.json: ${value.backend_id} 的 max_n 必须是不小于 default_n 的整数`);
  }
  if (!Array.isArray(value.param_fields)) {
    throw new Error(`backends.json: ${value.backend_id} 的 param_fields 必须是数组`);
  }
  for (const field of value.param_fields) {
    if (!isRecord(field) || typeof field.key !== "string" || !Array.isArray(field.options)) {
      throw new Error(`backends.json: ${value.backend_id} 的参数字段形态不合法`);
    }
  }
  return value as unknown as BackendEntry;
}

function loadConfig(input: unknown): BackendsConfig {
  if (!isRecord(input) || !Array.isArray(input.backends) || input.backends.length === 0) {
    throw new Error("backends.json: 清单为空或形态不合法");
  }
  const backends = input.backends.map(validateEntry);
  const ids = new Set<string>();
  for (const entry of backends) {
    if (ids.has(entry.backend_id)) {
      throw new Error(`backends.json: backend_id 重复：${entry.backend_id}`);
    }
    ids.add(entry.backend_id);
  }
  return { version: typeof input.version === "number" ? input.version : 1, backends };
}

export const backendsConfig: BackendsConfig = loadConfig(raw);

/** 默认后端（清单第一条）。 */
export function defaultBackend(): BackendEntry {
  return backendsConfig.backends[0];
}

/** 按 backend_id 查条目；不存在的 id 返回 undefined（提交前由调用方判）。 */
export function findBackend(backendId: string): BackendEntry | undefined {
  return backendsConfig.backends.find((entry) => entry.backend_id === backendId);
}

/** 专家面板的 n 取值范围：1..max_n（后端自带）。 */
export function nRange(backend: BackendEntry): { min: number; max: number } {
  return { min: 1, max: backend.max_n };
}
