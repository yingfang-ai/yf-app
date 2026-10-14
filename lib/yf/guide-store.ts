// 引导对话历史的客户端存储。
//
// 纪律（spec「引导对话历史」Requirement）：guide 对话轮次仅保存在浏览器
// localStorage；yf-app 服务端不提供任何对话持久化；清缓存即丢，v1 接受。
//
// schema（plan 定档）：按 conv_id 键控的线性消息数组，键名 `yf.guide.<conv_id>`，
// 值为 JSON 数组 [{role, content, at}]；追加采用整组重写（数组保持线性、无分支）。
const KEY_PREFIX = "yf.guide.";
/** 单会话历史上限（防 localStorage 无界增长；超限丢最旧的）。 */
const MAX_TURNS = 200;

export interface GuideTurn {
  role: "user" | "assistant";
  content: string;
  /** ISO 时间戳（客户端时钟，仅排序展示用）。 */
  at: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function keyFor(convId: string): string {
  return `${KEY_PREFIX}${convId}`;
}

function parseTurns(value: string | null): GuideTurn[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const turns: GuideTurn[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" && item !== null
        && "role" in item && "content" in item
        && typeof (item as GuideTurn).content === "string"
        && ((item as GuideTurn).role === "user" || (item as GuideTurn).role === "assistant")
      ) {
        turns.push({
          role: (item as GuideTurn).role,
          content: (item as GuideTurn).content,
          at: typeof (item as GuideTurn).at === "string" ? (item as GuideTurn).at : "",
        });
      }
    }
    return turns;
  } catch {
    // 历史损坏：当作空历史（清缓存即丢语义的宽容形态）。
    return [];
  }
}

/** 读取一个会话的引导历史（线性数组）。 */
export function loadGuideHistory(convId: string): GuideTurn[] {
  if (!isBrowser()) return [];
  try {
    return parseTurns(window.localStorage.getItem(keyFor(convId)));
  } catch {
    return [];
  }
}

/** 追加一轮并整组重写；返回新数组。 */
export function appendGuideTurn(convId: string, turn: GuideTurn): GuideTurn[] {
  const turns = [...loadGuideHistory(convId), turn].slice(-MAX_TURNS);
  if (isBrowser()) {
    try {
      window.localStorage.setItem(keyFor(convId), JSON.stringify(turns));
    } catch {
      // 存储满/被禁用：历史是尽力而为的客户端面，不阻塞对话。
    }
  }
  return turns;
}

/** 清除一个会话的引导历史。 */
export function clearGuideHistory(convId: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(keyFor(convId));
  } catch {
    // 忽略存储异常。
  }
}

/** 列出有本地引导历史的 conv_id（按最后写入时间新→旧，供「继续上次对话」）。 */
export function listGuideConvs(): string[] {
  if (!isBrowser()) return [];
  const ids: Array<{ id: string; latest: number }> = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      const id = key.slice(KEY_PREFIX.length);
      const turns = parseTurns(window.localStorage.getItem(key));
      if (turns.length === 0) continue;
      const latest = turns.reduce((acc, turn) => Math.max(acc, Date.parse(turn.at) || 0), 0);
      ids.push({ id, latest });
    }
  } catch {
    return [];
  }
  return ids.sort((a, b) => b.latest - a.latest).map((entry) => entry.id);
}
