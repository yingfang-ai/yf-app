// yf-app 对 yingfang 契约的类型镜像。
//
// 唯一权威：`repos/yingfang/docs/api-contract.md` §2 与
// `repos/yingfang/pkg/wire/submit.go` 的 `SubmitRequest`。
// 本文件不得引入契约之外的端点或字段语义；契约演进时先改契约文档，再镜像到这里。

// ---------------------------------------------------------------------------
// 提交侧（wire.SubmitRequest 的逐字段镜像）
// ---------------------------------------------------------------------------

/** branch_kind：refine = 在 parent 基础上修改；redirect = 换方向重来。 */
export type BranchKind = "refine" | "redirect";

/**
 * 一次下单请求（`POST /api/convs/{conv_id}/rounds` 的请求体）。
 * 字段集与 `wire.SubmitRequest` 的 json tag 一一对应；契约按**载荷里的 conv_id**为准
 * （路径参数只用于路由）。未知字段会被 yingfang 的入队闸 fail-closed 拒绝（R-B2）。
 */
export interface SubmitRequest {
  /** 会话 id（32 hex）。以载荷里的为准。 */
  conv_id: string;
  /** 父轮 id；缺省 = 根轮。树不是链（R-G3）：一个 parent 可有多个 child。 */
  parent_round_id?: string;
  branch_kind: BranchKind;
  /** 目标后端条目，取值必须来自打包内静态清单（config/backends.json）。 */
  backend_id: string;
  prompt: string;
  /** 负向词；schema 上无条件存在，逐后端判定可用性（R-H1）。 */
  negative_prompt?: string;
  /** 一轮张数，1..16（上限 S4；产品形态默认 8）。 */
  n: number;
  /** 一轮一个基 seed；-1 = 由后端自选。 */
  seed: number;
  /** 其余可调参数，取值一律字符串；键必须过目标后端的合法字段集（R-A4）。 */
  params?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// 读侧
// ---------------------------------------------------------------------------

/** 轮状态全集（`core/queue/queue.go` 常量表）：done / failed / cancelled 是终态。 */
export type RoundState =
  | "queued"
  | "dispatched"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

/** 终态集合：轮询循环据此停表。 */
export const ROUND_TERMINAL_STATES: readonly RoundState[] = [
  "done",
  "failed",
  "cancelled",
] as const;

export function isRoundTerminal(state: RoundState): boolean {
  return ROUND_TERMINAL_STATES.includes(state);
}

/** `GET /api/rounds/{round_id}` 的响应（§2.7）。 */
export interface Round {
  round_id: string;
  conv_id: string;
  parent_round_id: string | null;
  branch_kind: BranchKind;
  state: RoundState;
  n: number;
  seed: number;
  model_id: string;
  backend_id: string;
  hold_micros: number;
  /** 只在有值时出现。 */
  settled_micros?: number;
  enqueued_at: string;
  /** 只在有值时出现。 */
  finished_at?: string;
}

/** `GET /api/convs/{conv_id}/tree` 的节点（§2.8）：平面列表，客户端自行组树。 */
export interface RoundTree {
  round_id: string;
  parent_round_id: string | null;
  branch_kind: BranchKind;
  state: RoundState;
  n: number;
  seed: number;
  model_id: string;
  backend_id: string;
  cancel_tombstone: boolean;
  enqueued_at: string;
}

/** `GET /api/convs` 的会话行。 */
export interface ConvSummary {
  conv_id: string;
  title: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 账号面
// ---------------------------------------------------------------------------

/** `POST /api/register` 请求。recovery 是唯一凭据，服务端无找回端点。 */
export interface RegisterRequest {
  invite_code: string;
  /** ≥8 字符；注册后仅此一次可见，用户必须自行保存。 */
  recovery: string;
  display_name?: string;
}

/** `POST /api/register` 响应（201）。 */
export interface RegisterResponse {
  user_id: string;
}

/** `POST /api/login` 请求。 */
export interface LoginRequest {
  /** 32 hex。 */
  user_id: string;
  recovery: string;
}

/** `POST /api/login` 响应（200）；会话经 `yf_session` cookie（HttpOnly）建立。 */
export interface LoginResponse {
  user_id: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// 勾选与 presign
// ---------------------------------------------------------------------------

/** `POST /api/rounds/{round_id}/images/{idx}/{epoch}/select` 响应（200，幂等）。 */
export interface SelectImageResponse {
  round_id: string;
  idx: number;
  epoch: number;
  selected: boolean;
}

/** `POST /api/rounds/{round_id}/images/{idx}/{epoch}/presign` 响应（200）。 */
export interface PresignResponse {
  round_id: string;
  idx: number;
  epoch: number;
  url: string;
  expires_at: string;
}

/** 下单响应（202 Accepted 形）。 */
export interface SubmitRoundResponse {
  round_id: string;
  backend_id: string;
  n: number;
  unit_price_micros: number;
  hold_micros: number;
  enqueued_at: string;
}

// ---------------------------------------------------------------------------
// 统一错误信封（§1）
// ---------------------------------------------------------------------------

/** `details` 里的一条成因（只在入队被拒等场景出现）。 */
export interface ErrorDetail {
  kind: string;
  field?: string;
  detail?: string;
}

/** 契约错误码封闭枚举（§1 表）。 */
export type ApiErrorCode =
  | "invalid_json"
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "invite_not_found"
  | "invite_exhausted"
  | "presign_unavailable"
  | "internal";

/** 统一错误信封：`{"error": {"code", "message", "details"?}}`。 */
export interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
}
