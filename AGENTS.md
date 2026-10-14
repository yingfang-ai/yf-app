# yf-app - Development Notes

## 永久分叉声明

yf-app 是 **silgrid/pi-web v0.0.20 的永久分叉（permanent fork）**，独立产品线演进：
不跟随 pi-web 上游合并，无版本表合并、无同步脚本、无上游合并入口；上游后续变更
不进入本仓库。上游 coding-agent 使用面已全部移除，仅保留注册/登录/登出、对话工作台、
产图读面三个用户面。

## Quick Start

```bash
npm ci
npm run dev   # 127.0.0.1:30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
Test: `npm test`  
Build: `npm run build`

## Architecture

```
Browser                Next.js Server                yingfang API
  │                        │                             │
  ├─ POST /api/register ───▶───────── 同源转发 ────────────▶ 邀请码注册
  ├─ POST /api/login ──────▶───────── 同源转发 ────────────▶ yf_session cookie
  ├─ POST /api/guide ──────▶ 服务端持 key 调 LLM          │
  │◀── reply + draft ───────│   （对话历史仅存浏览器       │
  │                         │     localStorage）          │
  ├─ POST /api/convs/... ──▶───────── 同源转发 ────────────▶ 下单（SubmitRequest）
  ├─ GET /api/rounds/{id} ─▶───────── 同源转发 ────────────▶ 轮询轮状态
  ├─ POST .../presign ─────▶───────── 同源转发 ────────────▶ 预签名图片 URL
```

- yf-app 自己的服务端面只有一个：`app/api/guide/`（LLM 引导代理）。其余 `/api/*`
  全部是同源反向代理转发给 yingfang 的契约端点（`docs/deploy.md`）。
- 契约客户端与全部产品逻辑在 `lib/yf/`；后端/模型清单是打包内静态配置
  （`config/backends.json`）。

## 硬纪律

- 不改 yingfang 契约（`repos/yingfang/docs/api-contract.md` §2）。
- LLM key 只在服务端环境变量；recovery 永不持久化；历史仅存 localStorage（`yf.` 前缀）。
- UI 仅简体中文；桌面优先，窄视口可用即可。
- Next.js 可能在 `AGENTS.md` 追加生成的 `BEGIN:nextjs-agent-rules` 块；那是工具输出，
  不要混进无关提交。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
