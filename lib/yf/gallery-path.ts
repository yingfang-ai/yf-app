import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { yfDataRoot } from "./data-root";
import { userGalleryDir } from "./user-dirs";

/**
 * 画廊命名（plan D3/A3）：`<数据根>/gallery/<user_id>/<conv_id>/<round_id>/<idx>.<ext>`。
 * conv_id / round_id 是契约的 32 位 hex，落盘前一律过形状校验——它们成为目录名，
 * 不能让上游响应里的怪值穿出自己的画廊根。
 */
const HEX32 = /^[0-9a-f]{32}$/;

export function isHex32(value: unknown): value is string {
  return typeof value === "string" && HEX32.test(value);
}

export function galleryRoundDir(
  userId: string,
  convId: string,
  roundId: string,
  dataRoot: string = yfDataRoot(),
): string {
  if (!isHex32(convId) || !isHex32(roundId)) throw new Error("invalid conv/round id");
  return join(userGalleryDir(userId, dataRoot), convId, roundId);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** 扩展名：先看 Content-Type，再看 URL 路径后缀，都不认就 `bin`。 */
export function imageExtension(contentType: string | null, url: string): string {
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const fromUrl = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  return fromUrl && ["png", "jpg", "jpeg", "webp", "gif"].includes(fromUrl) ? fromUrl : "bin";
}

/** 该序号是否已落盘（任一扩展名）；幂等重落据此跳过。 */
export function landedFileFor(dir: string, idx: number): string | null {
  if (!existsSync(dir)) return null;
  const prefix = `${idx}.`;
  return readdirSync(dir).find((name) => name.startsWith(prefix) && !name.endsWith(".tmp")) ?? null;
}
