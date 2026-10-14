// yingfang 契约客户端：全部走同源 fetch（cookie 自然携带，无跨源凭据方案）。
//
// 路由全集 = repos/yingfang/docs/api-contract.md §2。yf-app 不依赖契约之外的任何
// yingfang 端点；`POST /api/guide` 是 yf-app 自己的服务端面，不在这里。
import type {
  ConvSummary,
  ErrorDetail,
  ErrorEnvelope,
  LoginRequest,
  LoginResponse,
  PresignResponse,
  RegisterRequest,
  RegisterResponse,
  Round,
  RoundTree,
  SelectImageResponse,
  SubmitRequest,
  SubmitRoundResponse,
} from "./types.ts";

/** 401：未登录 / 会话过期 / 凭据不对——调用方据此跳登录页。 */
export class YfUnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "YfUnauthorizedError";
  }
}

/** 契约错误信封的异常形态：code/message/details 原样保留，调用方按码如实呈现。 */
export class YfApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "YfApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 同源 fetch 封装：JSON 头、401 统一抛未登录、错误信封统一解析。 */
export async function yfFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 401) {
    throw new YfUnauthorizedError();
  }
  return response;
}

/** 解析契约错误信封；非信封形态的响应体退化为 internal。 */
export async function yfApiErrorFrom(response: Response): Promise<YfApiError> {
  let code = "internal";
  let message = `HTTP ${response.status}`;
  let details: ErrorDetail[] | undefined;
  try {
    const payload = (await response.json()) as Partial<ErrorEnvelope>;
    if (payload?.error && typeof payload.error === "object") {
      if (typeof payload.error.code === "string") code = payload.error.code;
      if (typeof payload.error.message === "string") message = payload.error.message;
      if (Array.isArray(payload.error.details)) details = payload.error.details;
    }
  } catch {
    // 响应体不是 JSON：保留 HTTP 状态语义。
  }
  return new YfApiError(response.status, code, message, details);
}

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await yfApiErrorFrom(response);
  }
  return (await response.json()) as T;
}

/** JSON 请求体的序列化形态：undefined 字段不进载荷（对应 omitempty 语义）。 */
function jsonBody(payload: unknown): string {
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// 账号面（§2.1–2.3）
// ---------------------------------------------------------------------------

/** POST /api/register —— 凭邀请码注册。201 → {user_id}。 */
export async function register(request: RegisterRequest): Promise<RegisterResponse> {
  const response = await yfFetch("/api/register", {
    method: "POST",
    body: jsonBody(request),
  });
  return expectJson<RegisterResponse>(response);
}

/** POST /api/login —— 登录；会话经 yf_session cookie 建立。 */
export async function login(request: LoginRequest): Promise<LoginResponse> {
  const response = await yfFetch("/api/login", {
    method: "POST",
    body: jsonBody(request),
  });
  return expectJson<LoginResponse>(response);
}

/** POST /api/logout —— 登出（幂等）。 */
export async function logout(): Promise<void> {
  const response = await yfFetch("/api/logout", { method: "POST" });
  if (!response.ok) {
    throw await yfApiErrorFrom(response);
  }
}

// ---------------------------------------------------------------------------
// yf-app 自有面（非 yingfang 契约端点）
// ---------------------------------------------------------------------------

export interface GuideTurnPayload {
  role: "user" | "assistant";
  content: string;
}

export interface GuideResponse {
  reply: string;
  draft: import("./guide-protocol").GuideDraft | null;
}

/** POST /api/guide —— yf-app 服务端的引导代理（LLM 调用全在服务端）。 */
export async function guide(body: { messages: GuideTurnPayload[] }): Promise<GuideResponse> {
  const response = await yfFetch("/api/guide", {
    method: "POST",
    body: jsonBody(body),
  });
  return expectJson<GuideResponse>(response);
}

// ---------------------------------------------------------------------------
// 会话（§2.4–2.5）
// ---------------------------------------------------------------------------

/** POST /api/convs —— 建会话（conv_id 服务端生成）。 */
export async function createConv(title?: string): Promise<{ conv_id: string }> {
  const response = await yfFetch("/api/convs", {
    method: "POST",
    body: jsonBody(title === undefined ? {} : { title }),
  });
  return expectJson<{ conv_id: string }>(response);
}

/** GET /api/convs —— 列自己的会话（全量，空 → []）。 */
export async function listConvs(): Promise<ConvSummary[]> {
  const response = await yfFetch("/api/convs", { method: "GET" });
  const payload = await expectJson<{ convs: ConvSummary[] }>(response);
  return payload.convs;
}

// ---------------------------------------------------------------------------
// 下单与轮次（§2.6–2.8）
// ---------------------------------------------------------------------------

/**
 * POST /api/convs/{conv_id}/rounds —— 下单。载荷为 SubmitRequest 原始 JSON；
 * 202 → {round_id, ...}；rate_limited / bad_request（details 逐条）如实上抛。
 */
export async function submitRound(
  convId: string,
  request: SubmitRequest,
): Promise<SubmitRoundResponse> {
  const response = await yfFetch(`/api/convs/${encodeURIComponent(convId)}/rounds`, {
    method: "POST",
    body: jsonBody(request),
  });
  return expectJson<SubmitRoundResponse>(response);
}

/** GET /api/rounds/{round_id} —— 取一轮（轮询唯一状态源）。 */
export async function getRound(roundId: string): Promise<Round> {
  const response = await yfFetch(`/api/rounds/${encodeURIComponent(roundId)}`, {
    method: "GET",
  });
  return expectJson<Round>(response);
}

/** GET /api/convs/{conv_id}/tree —— 会话树（平面列表）。 */
export async function getConvTree(convId: string): Promise<RoundTree[]> {
  const response = await yfFetch(
    `/api/convs/${encodeURIComponent(convId)}/tree`,
    { method: "GET" },
  );
  const payload = await expectJson<{ rounds: RoundTree[] }>(response);
  return payload.rounds;
}

// ---------------------------------------------------------------------------
// 勾选与 presign（§2.9–2.10）
// ---------------------------------------------------------------------------

/** POST /api/rounds/{round_id}/images/{idx}/{epoch}/select —— 勾选一张图（同轮至多一张，幂等）。 */
export async function selectImage(
  roundId: string,
  idx: number,
  epoch: number,
): Promise<SelectImageResponse> {
  const response = await yfFetch(
    `/api/rounds/${encodeURIComponent(roundId)}/images/${idx}/${epoch}/select`,
    { method: "POST" },
  );
  return expectJson<SelectImageResponse>(response);
}

/** POST /api/rounds/{round_id}/images/{idx}/{epoch}/presign —— 取带签名 URL（15 分钟有效）。 */
export async function presignImage(
  roundId: string,
  idx: number,
  epoch: number,
): Promise<PresignResponse> {
  const response = await yfFetch(
    `/api/rounds/${encodeURIComponent(roundId)}/images/${idx}/${epoch}/presign`,
    { method: "POST" },
  );
  return expectJson<PresignResponse>(response);
}

/** 契约端点的命名集合（`POST /api/guide` 是 yf-app 自有面，不在此列）。 */
export const yfApi = {
  register,
  login,
  logout,
  createConv,
  listConvs,
  submitRound,
  getRound,
  getConvTree,
  selectImage,
  presignImage,
} as const;
