import { allowFileRoot, getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { isRegistrableRoot } from "./root-registration-policy";
import { listAllSessions } from "./session-reader";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath } from "./paths";

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    // The project root (main repo shared by all worktrees) is browsable too —
    // the project dropdown lists it even when only worktrees have sessions.
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }

  for (const root of getAdditionalAllowedRoots()) roots.add(root);

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots);
}

/**
 * yingfang#31（spec R2）：模型配置面（/api/models*）的 cwd 守卫——运营者可以
 * 对任何「可登记」目录使用模型面（与 /api/agent/new 同一事实：家目录或
 * PI_WEB_ALLOWED_ROOT_PREFIXES 内，见 lib/root-registration-policy.ts）；命中
 * 即顺手登记（allowFileRoot），后续 files/models 请求同样可用。普通用户不经
 * 此路径（requireOperator 已先行拒绝），他们的 cwd 本就是服务端控制的用户目录。
 */
export async function isOperatorModelsCwdAllowed(cwd: string): Promise<boolean> {
  if (isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return true;
  const registrable = isRegistrableRoot(cwd);
  if (!registrable.ok) return false;
  allowFileRoot(registrable.path);
  return true;
}
