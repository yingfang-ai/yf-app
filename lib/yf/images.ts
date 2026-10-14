// 读面图片发现与 presign 生命周期。
//
// 契约读面不枚举图片行：前端以轮的 n 派生候选 idx（0..n-1，epoch 0）逐张 presign；
// 404 = 未产出（占位）；503 presign_unavailable = 「图片暂不可用」态（不是崩溃）；
// URL 过期前（expires_at 减安全余量）重签（spec Assumptions 授权的实现性推导）。
import { presignImage, YfApiError } from "./api.ts";
import type { PresignResponse } from "./types.ts";

/** URL 过期前的重签安全余量。 */
export const RESIGN_MARGIN_MS = 60_000;

export type ImageSlotStatus = "loading" | "ready" | "not-produced" | "unavailable" | "error";

export interface ImageSlot {
  idx: number;
  epoch: number;
  status: ImageSlotStatus;
  /** status=ready 时的带签名 URL。 */
  url?: string;
  /** status=ready 时的过期时刻（epoch ms）。 */
  expiresAt?: number;
}

export type PresignFn = typeof presignImage;

/** 候选 idx：0..n-1（钳到 1..16，契约护栏 S4）。 */
export function candidateIndexes(n: number): number[] {
  const count = Math.min(16, Math.max(1, Math.round(n) || 1));
  return Array.from({ length: count }, (_, idx) => idx);
}

export function loadingSlots(n: number): ImageSlot[] {
  return candidateIndexes(n).map((idx) => ({ idx, epoch: 0, status: "loading" as const }));
}

/** 单张 presign → 槽位（404/503/其他错误各自成态，绝不抛出）。 */
export async function presignSlot(
  roundId: string,
  idx: number,
  presign: PresignFn = presignImage,
): Promise<ImageSlot> {
  let payload: PresignResponse;
  try {
    payload = await presign(roundId, idx, 0);
  } catch (error) {
    if (error instanceof YfApiError) {
      if (error.status === 404) return { idx, epoch: 0, status: "not-produced" };
      if (error.status === 503 && error.code === "presign_unavailable") {
        return { idx, epoch: 0, status: "unavailable" };
      }
    }
    return { idx, epoch: 0, status: "error" };
  }
  return {
    idx,
    epoch: 0,
    status: "ready",
    url: payload.url,
    expiresAt: Date.parse(payload.expires_at),
  };
}

/** ready 且距过期不足安全余量（或缺期）⇒ 需要重签。 */
export function needsResign(slot: ImageSlot, now: number = Date.now()): boolean {
  if (slot.status !== "ready") return false;
  if (slot.expiresAt === undefined) return true;
  return slot.expiresAt - RESIGN_MARGIN_MS <= now;
}

/** 装载一轮的全部候选槽位（并行 presign）。 */
export async function loadRoundImages(
  roundId: string,
  n: number,
  presign: PresignFn = presignImage,
): Promise<ImageSlot[]> {
  const slots = loadingSlots(n);
  return Promise.all(slots.map((slot) => presignSlot(roundId, slot.idx, presign)));
}

/** 对到期的 ready 槽位重签；其余槽位原样保留。 */
export async function refreshDueSlots(
  roundId: string,
  slots: ImageSlot[],
  presign: PresignFn = presignImage,
  now: number = Date.now(),
): Promise<ImageSlot[]> {
  return Promise.all(
    slots.map(async (slot) => (needsResign(slot, now) ? presignSlot(roundId, slot.idx, presign) : slot)),
  );
}
