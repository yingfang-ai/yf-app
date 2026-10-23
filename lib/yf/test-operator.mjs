// 测试支撑（不是测试文件，npm test 的 glob 不会跑它）：让直调路由处理器的单测
// 以「运营者会话」身份发请求。作为测试文件的**第一条** import 载入：
//   import "<相对路径>/lib/yf/test-operator.mjs";
// 它做三件事：运营者名单走 YF_OPERATOR_USER_IDS、数据根指向临时目录（挂进程
// exit 自清，tmp-guard 零遗留）并落一条 session index（token 只存哈希）、包一层
// 全局 Request——未带 Cookie 的请求自动带上运营者 yf_session。这样上游留下的
// 路由单测不必逐个改请求构造，而路由本身的身份/运营者守卫仍是真实代码路径。
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OPERATOR_ID = "abad1dea000000000000000000000000";
const TOKEN = "unit-test-operator";

process.env.YF_OPERATOR_USER_IDS = [process.env.YF_OPERATOR_USER_IDS, OPERATOR_ID].filter(Boolean).join(",");
const presetDataRoot = process.env.YF_DATA_DIR;
const dataRoot = presetDataRoot ?? mkdtempSync(join(tmpdir(), "yf-test-operator-"));
process.env.YF_DATA_DIR = dataRoot;
// npm test 走 tmp-guard：自建的数据根挂进程 exit 清理，全部测试之后随子进程退出
// 移除（node --test 每个测试文件一个子进程，各自建、各自清）。不能挂 node:test
// 的 root after——本文件是测试文件的**第一条** import，注册时测试文件的根测试还没
// 建立，那种钩子会在测试运行前就跑掉（实测，mkdtemp 后连身份解析都 401）。
// 预置的 YF_DATA_DIR 不归这里管，留给预置方清理。
if (!presetDataRoot) {
  process.on("exit", () => rmSync(dataRoot, { recursive: true, force: true }));
}
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
