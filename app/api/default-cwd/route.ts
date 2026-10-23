import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { defaultCwdPath } from "@/lib/default-cwd";
import { requireOperator } from "@/lib/yf/route-policy";
import { resolveYfIdentity } from "@/lib/yf/identity";
import { ensureUserDataDir } from "@/lib/yf/user-dirs";
import { unauthorizedResponse } from "@/lib/yf/session-access";

// GET /api/default-cwd
// Reports today's default directory (~/pi-cwd-<YYYYMMDD>) WITHOUT creating
// it, so the sidebar can apply shortcut-visibility rules (pi#18: hide the
// "use default directory" button when pinned projects diverge from it)
// without side effects. Selection still goes through POST, which creates
// the directory and allow-lists it for the file browser.
export async function GET(req: Request) {
  const denied = await requireOperator(req);
  if (denied) return denied;
  return NextResponse.json({ cwd: defaultCwdPath() });
}

// POST /api/default-cwd
// Creates ~/pi-cwd/<YYYYMMDD> (local date) if it doesn't exist and returns the path.
// The client then selects it through /api/cwd/validate like any other directory.
//
// 普通用户（yingfang#28 step 10）：「默认目录」就是服务端为其建好的自己的数据目录
// （GET 仍仅运营者——路由表语义不变，POST 是新对话取 cwd 的入口）。
export async function POST(req: Request) {
  const identity = resolveYfIdentity(req);
  if (!identity) return unauthorizedResponse();
  if (!identity.operator) {
    try {
      return NextResponse.json({ cwd: ensureUserDataDir(identity.userId) });
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }
  try {
    const dir = defaultCwdPath();
    mkdirSync(dir, { recursive: true });
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
