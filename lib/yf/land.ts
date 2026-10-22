import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { galleryRoundDir, imageExtension, isHex32, landedFileFor } from "./gallery-path";

/**
 * 画廊落盘（plan step 13，R9/R10）：round 到 done 后，服务端用**登录用户自己的
 * cookie** 向契约取 presign、下载图片、原子写进该用户的画廊。无服务端常驻状态
 * （D6）：幂等——已落的序号跳过，重放/重启恢复都靠再调一次。非 done 不落文件。
 * 返回 `landed` = 该轮此刻画廊里的张数；契约错误（别人的轮 → 404 反枚举）原样透传。
 */
export interface LandDeps {
  upstream: string;
  cookie: string;
  userId: string;
  dataRoot: string;
  fetchImpl?: typeof fetch;
}

export type LandResult =
  | { ok: true; landed: number }
  | { ok: false; status: number; body: string };

async function contract(deps: LandDeps, path: string, method: "GET" | "POST"): Promise<Response> {
  return (deps.fetchImpl ?? fetch)(`${deps.upstream}/api/${path}`, {
    method,
    headers: { cookie: deps.cookie },
    redirect: "manual",
  });
}

function passthrough(response: Response, body: string): LandResult {
  return { ok: false, status: response.status, body };
}

export async function landRound(roundId: string, deps: LandDeps): Promise<LandResult> {
  if (!isHex32(roundId)) {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({ error: { code: "bad_request", message: "round_id 不是合法 id" } }),
    };
  }
  const roundResponse = await contract(deps, `rounds/${roundId}`, "GET");
  const roundText = await roundResponse.text();
  if (roundResponse.status !== 200) return passthrough(roundResponse, roundText);
  const round = JSON.parse(roundText) as { state?: string; conv_id?: unknown; n?: unknown };
  if (round.state !== "done") return { ok: true, landed: 0 };
  if (!isHex32(round.conv_id) || !Number.isInteger(round.n) || (round.n as number) < 0) {
    return {
      ok: false,
      status: 502,
      body: JSON.stringify({ error: { code: "internal", message: "上游轮信息不完整" } }),
    };
  }

  const dir = galleryRoundDir(deps.userId, round.conv_id, roundId, deps.dataRoot);
  const count = round.n as number;
  let landed = 0;
  for (let idx = 0; idx < count; idx += 1) {
    if (landedFileFor(dir, idx)) {
      landed += 1;
      continue;
    }
    const presign = await contract(deps, `rounds/${roundId}/images/${idx}/0/presign`, "POST");
    const presignText = await presign.text();
    if (presign.status !== 200) return passthrough(presign, presignText);
    const { url } = JSON.parse(presignText) as { url?: unknown };
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
      return {
        ok: false,
        status: 502,
        body: JSON.stringify({ error: { code: "internal", message: "presign 响应缺 url" } }),
      };
    }
    // 预签名 URL 自带签名，不带 cookie 去取。
    const image = await (deps.fetchImpl ?? fetch)(url, { redirect: "manual" });
    if (image.status !== 200) {
      return {
        ok: false,
        status: 502,
        body: JSON.stringify({ error: { code: "internal", message: "图片下载失败" } }),
      };
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    mkdirSync(dir, { recursive: true });
    const finalPath = join(dir, `${idx}.${imageExtension(image.headers.get("content-type"), url)}`);
    const tempPath = join(dir, `.${idx}-${randomUUID()}.tmp`);
    try {
      writeFileSync(tempPath, bytes, { flag: "wx", mode: 0o644 });
      renameSync(tempPath, finalPath);
    } finally {
      try { unlinkSync(tempPath); } catch { /* 已改名或不存在 */ }
    }
    landed += 1;
  }
  return { ok: true, landed };
}
