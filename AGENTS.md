# yf-app - Development Notes

## 永久分叉声明

yf-app 是 **silgrid/pi-web 的永久分叉（permanent fork）**，独立产品线演进：不跟随
pi-web 上游做版本表合并，仓库内不存在任何持续同步脚本或上游合并入口，上游后续
变更不自动进入本仓库。**基线钉在上游 main commit `2481a70`
（`2481a70b5b9ef23cb38847a7bc79101491446ea5`，2026-10-22 一次性重定基合入，
yingfang#28）**：pi-web 的整体形态（AppShell、文件浏览器、聊天窗等）随该基线保留
在产品里；terminal、git worktree 两面板与主机 shell（terminal 面板与 agent 的
bash 工具，运营者也没有）按 yingfang#28 的删除面移除、维持删除。yingfang#31
（owner 2026-10-23 推翻 #28 对应裁决）恢复了「模型」设置分区与 /api/models*、
/api/models-config*、/api/auth/api-key|providers 路由族（仅运营者）；OAuth
登录与 models.dev / pi.dev 目录外联不恢复。上游 tag 不推 origin，版本留在
yf-app 0.0.1 纪元，本仓不发版。

## Quick Start

```bash
npm ci
npm run dev   # 127.0.0.1:30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
Test: `npm test`

**Never run `next build` during dev**: it pollutes `.next/` and breaks `npm run dev`
(upstream engineering discipline, inherited with the rebase). `next dev` runs
Turbopack; never fall back to `next dev --webpack`.

### Dev server troubleshooting (inherited from the rebase)

- First run `lsof -nP -iTCP:30141 -sTCP:LISTEN` and reuse a healthy process. A second
  `next dev` on another port is no workaround: both contend for `.next/dev/lock`.
- `next dev` may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md`.
  It is tooling output: check `git status` and keep it out of unrelated commits.

## Architecture（重定基后的形态）

- **整体形态**：pi-web 的 AppShell / 文件浏览器 / 聊天窗（ChatWindow / ChatInput /
  MessageView / SSE）随基线 `2481a70` 保留；文件浏览器支持图片/视频预览。
- **yingfang 契约面**：整体挂载在 yf-app 自己的 `/api/yf/*` 前缀下，由
  `app/api/yf/[...path]/route.ts` 逐字代理到 yingfang（cookie/Set-Cookie/错误信封
  透传）；yingfang 仓零改动，契约权威在 `docs/api-contract.md` §2。
- **账号面**：邀请码注册（展示生成的 `user_id`、确认已保存 recovery）、
  `user_id`+`recovery` 登录（`yf_session`）；recovery 永不持久化、无找回通道；
  pi-web 的口令登录（`PI_WEB_PASSWORD`）不作为本产品登录方式。
- **身份**：login 经过 `/api/yf` 代理时服务端落 session index
  （sha256(token)→user_id）；运营者 = 服务端 `config/operators.json` 的 user_id
  名单（与 `YF_OPERATOR_USER_IDS` 取并集）。

## 硬纪律

- 不改 yingfang 契约（`repos/yingfang/docs/api-contract.md` §2）；yingfang 仓零改动。
- **模型 provider 的 key 经「模型」tab（仅运营者）配置后存服务端 agent 目录，只写
  不回显**：自定义 provider 配置存 `<agent 目录>/models.json`、内置 provider key 存
  `<agent 目录>/auth.json`（均在服务端，0600、原子写、不进 git/构建产物）；保存后
  连运营者也只看到「已配置」标记，可覆盖不可读回，任何读回接口不出现 key 或
  headers 值字节；key 不进日志、不进普通用户的浏览器可见字节；apiKey 与 headers
  值只收字面量（`!命令` / `$VAR` 表达式一律 400）。yingfang#31 移除了单一「LLM
  服务」通道（`/api/yf/llm-config` 与 `llm/config.json`），「模型」tab 是唯一来源；
  旧 `YF_LLM_*` 环境变量通道维持移除。
- **使用面边界**：主机 shell（terminal 面板与 agent 的 bash 工具）已对所有人移除
  （运营者也没有）；普通用户只有聊天栏（引导 skill + 生图 workflow，无写文件工具）
  + 自己的画廊；skills 安装、plugins、app-update、任意目录浏览、模型配置（「模型」
  tab 与 /api/models*、/api/models-config*、/api/auth/api-key|providers）仅运营者
  可用（普通用户直访 403、匿名 401）。
- recovery 永不持久化于客户端任何存储；user_id 由 localStorage 记住（`yf.` 前缀）。
- UI 仅简体中文；桌面优先，窄视口可用即可。
- 数据根 `YF_DATA_DIR`（缺省 `~/.local/share/yf-app`）：画廊
  `gallery/<user_id>/<conv_id>/<round_id>/`、用户会话目录 `users/<user_id>/`、
  身份索引 `session-index/`——全部不进 git。模型配置不落数据根：自定义 provider
  配置与内置 provider key 在服务端 agent 目录（`models.json` / `auth.json`，
  0600、原子写、不进 git/构建产物，见 `lib/models-config-store.ts` /
  `lib/provider-credential-store.ts`）。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->