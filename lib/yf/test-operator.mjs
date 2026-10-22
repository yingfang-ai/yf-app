// 测试支撑（不是测试文件，npm test 的 glob 不会跑它）：让直调路由处理器的单测
// 以「运营者会话」身份发请求。作为测试文件的**第一条** import 载入：
//   import "<相对路径>/lib/yf/test-operator.mjs";
// 它做三件事：运营者名单走 YF_OPERATOR_USER_IDS、数据根指向临时目录并落一条
// session index（token 只存哈希）、包一层全局 Request——未带 Cookie 的请求自动带上
// 运营者 yf_session。这样上游留下的路由单测不必逐个改请求构造，而路由本身的
// 身份/运营者守卫仍是真实代码路径。
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const OPERATOR_ID = "abad1dea000000000000000000000000";
const TOKEN = "unit-test-operator";

process.env.YF_OPERATOR_USER_IDS = [process.env.YF_OPERATOR_USER_IDS, OPERATOR_ID].filter(Boolean).join(",");
const dataRoot = process.env.YF_DATA_DIR ?? mkdtempSync(join(tmpdir(), "yf-test-operator-"));
process.env.YF_DATA_DIR = dataRoot;
mkdirSync(join(dataRoot, "session-index"), { recursive: true });
writeFileSync(
  join(dataRoot, "session-index", `${createHash("sha256").update(TOKEN).digest("hex")}.json`),
  JSON.stringify({ user_id: OPERATOR_ID, expires_at: "2030-01-01T00:00:00Z" }),
);

const BaseRequest = globalThis.Request;
if (!BaseRequest.__yfOperatorWrapped) {
  class OperatorRequest extends BaseRequest {
    static __yfOperatorWrapped = true;
    constructor(input, init = {}) {
      if (typeof input === "string" || input instanceof URL) {
        const headers = new Headers(init.headers ?? {});
        if (!headers.has("cookie")) headers.set("cookie", `yf_session=${TOKEN}`);
        super(input, { ...init, headers });
      } else {
        super(input, init);
      }
    }
  }
  globalThis.Request = OperatorRequest;
}

export const OPERATOR_USER_ID = OPERATOR_ID;
export const OPERATOR_SESSION_COOKIE = `yf_session=${TOKEN}`;
