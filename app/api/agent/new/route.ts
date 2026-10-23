import { NextResponse } from "next/server";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { allowFileRoot } from "@/lib/file-access";
import { isRegistrableRoot } from "@/lib/root-registration-policy";
import { invalidateSessionListCache } from "@/lib/session-reader";
import { startRpcSession } from "@/lib/rpc-manager";
import { resolveYfIdentity } from "@/lib/yf/identity";
import { unauthorizedResponse } from "@/lib/yf/session-access";
import { ensureUserDataDir } from "@/lib/yf/user-dirs";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)) {
    return value as ThinkingLevel;
  }
  throw new Error(`Invalid thinking level: ${String(value)}`);
}
// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns pi's real session id plus the model/thinking state selected at startup.
export async function POST(req: Request) {
  let commandType: string | undefined;
  let promptAccepted = false;
  try {
    const identity = resolveYfIdentity(req);
    if (!identity) return unauthorizedResponse();
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd: requestedCwd, ...command } = body;
    commandType = typeof command.type === "string" ? command.type : undefined;
    // 普通用户（plan step 10，R5/R10）：会话 cwd 永远是自己的数据目录（服务端建，客户端
    // 给的 cwd 不采纳）；模型与工具由服务端定（单一 LLM 通道、无工具聊天）。运营者保持
    // 上游行为。
    const cwd = identity.operator ? requestedCwd : ensureUserDataDir(identity.userId);
    if (!identity.operator) {
      delete command.provider;
      delete command.modelId;
      delete command.toolNames;
    }

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({
        error: "cwd is required",
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({
        error: `Directory does not exist: ${cwd}`,
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 400 });
    }

    // Guard the workspace BEFORE any session creation or file-root promotion:
    // the cwd's realpath must lie within an allowed registration prefix
    // (operator homedir, PI_WEB_ALLOWED_ROOT_PREFIXES, or an already-
    // registered root). A client must not be able to start the agent in an
    // arbitrary host directory such as / or /etc. Every downstream consumer
    // (session creation AND root registration) uses the guard's CANONICAL
    // path — the client-supplied alias must never be registered, or a
    // later retargeted symlink inside home would smuggle an outside
    // directory into the trusted prefixes (review r1 P1, pi#55).
    // 普通用户的目录是服务端按 user_id 生成的，不走「家目录前缀」登记策略。
    const registrable = identity.operator ? isRegistrableRoot(cwd) : { ok: true as const, path: cwd };
    if (!registrable.ok) {
      return NextResponse.json({
        error: "Workspace path is not registrable as a file root",
        reason: registrable.reason,
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 403 });
    }

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: unknown; [key: string]: unknown };
    if ((provider && !modelId) || (!provider && modelId)) {
      throw new Error("provider and modelId must be provided together");
    }
    const explicitThinkingLevel = parseThinkingLevel(thinkingLevel);

    // Must be unique per request: startRpcSession coalesces concurrent callers
    // that share a key onto one session. Date.now() (ms resolution) collides for
    // requests in the same millisecond, merging two new sessions into one.
    const tempKey = `__new__${randomUUID()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", registrable.path, {
      ...(toolNames ? { toolNames } : {}),
      ...(provider && modelId ? { initialModel: { provider, modelId } } : {}),
      ...(explicitThinkingLevel ? { thinkingLevel: explicitThinkingLevel } : {}),
    });

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    if (identity.operator) allowFileRoot(registrable.path);
    invalidateSessionListCache();

    const state = await session.send({ type: "get_state" }) as {
      model?: { id: string; provider: string };
      thinkingLevel?: string;
    };

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({
        success: true,
        sessionId: realSessionId,
        data: null,
        model: state.model
          ? { provider: state.model.provider, modelId: state.model.id }
          : null,
        thinkingLevel: state.thinkingLevel,
      });
    }

    const result = await session.send(promptCommand);
    promptAccepted = promptCommand.type === "prompt";

    return NextResponse.json({
      success: true,
      sessionId: realSessionId,
      data: result,
      model: state.model
        ? { provider: state.model.provider, modelId: state.model.id }
        : null,
      thinkingLevel: state.thinkingLevel,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(commandType === "prompt" && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: 500 });
  }
}
