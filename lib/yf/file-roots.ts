import { normalizeSlashes } from "@/lib/allowed-roots";
import { userDataDir, userGalleryDir } from "./user-dirs";

/**
 * 普通用户的 files API 根（plan step 10，R5/R10）：只认自己的会话目录与自己的
 * 画廊——不是「所有会话 cwd 的并集」（那会让一个用户读到别人的目录）。
 * 与会话归属守卫（session-access.ts）是两个面：这里管「打进 files 之后看哪个目录」。
 * 运营者保持上游 registrable-root 行为（调用方走 getAllowedFileRoots）。
 */
export function ownFileRoots(userId: string): Set<string> {
  return new Set([normalizeSlashes(userDataDir(userId)), normalizeSlashes(userGalleryDir(userId))]);
}
