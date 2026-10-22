# CLAUDE.md — yf-app

## 永久分叉声明（先读这一段）

**yf-app 是 silgrid/pi-web 的永久分叉（permanent fork），独立产品线。**

- **不做任何持续上游跟随合并**：pi-web 上游的后续 commit / 版本表 / release 一律不
  自动进入本仓库。仓库里不存在也不得引入任何「从上游持续合并 / 同步」的流程、
  脚本或入口。当前基线为上游 main commit `2481a70`
  （`2481a70b5b9ef23cb38847a7bc79101491446ea5`，yingfang#28 2026-10-22 一次性重定基
  合入）：pi-web 整体形态（AppShell、文件浏览器、聊天窗）随基线保留。
- 基线之上，terminal、git worktree、models 配置三面板与主机 shell（terminal 面板
  与 agent 的 bash 工具，运营者也没有）已按 yingfang#28 移除；普通用户只有聊天栏
  （引导 skill + 生图 workflow）+ 自己的画廊，skills 安装 / plugins / app-update /
  任意目录浏览 / LLM 配置仅运营者可用。
- 任何把仓库「持续升级到 pi-web 新版本」的提议都与本声明冲突，直接拒绝。

## 产品一句话

C 端图像创作工作台：邀请码注册 → user_id+recovery 登录 → 聊天栏引导对话（新对话
默认进入引导 skill）→ 草案确认 → 按 yingfang 契约下单 → GET-only 轮询到终态 →
画廊按用户隔离浏览。UI 仅简体中文；桌面优先，窄视口能看即可。

## 硬纪律

- **不改 yingfang 契约**：`repos/yingfang/docs/api-contract.md` §2 的路由全集是唯一
  对接面；不新增/修改/删除契约端点，不加 SSE/WS、消息持久化、backend 列表端点。
- 契约错误信封 `{"error":{code,message,details?}}` 按码如实呈现，不吞不改。
- **LLM key 经 UI 通道（仅运营者）配置后存服务端数据根（0600），只写不回显**：保存后
  连运营者也只看到「已配置」，可覆盖不可读回；key 不进仓、不进日志、不进普通用户
  的浏览器可见字节；旧 `YF_LLM_*` 环境变量通道已移除，UI 通道是唯一来源。
- recovery 永不被任何客户端存储持久化；user_id 由 localStorage 记住（`yf.` 前缀）。
- 后端/模型清单来自打包内静态配置（`config/backends.json`），运行时零列表网络请求。

## Quick Start

```bash
npm ci
npm run dev   # 127.0.0.1:30141
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
Test: `npm test`  
Build: `npm run build`

## 代码地图

```
app/api/yf/[...path]/route.ts   yingfang 契约同源代理（/api/yf/* → :9701，逐字转发）
app/api/yf/me/                  当前身份（user_id + operator 判定）
app/api/yf/llm-config/          单一 LLM 配置通道（仅运营者，key 只写不回显）
app/api/yf/land/                done 轮落盘画廊（presign → 下载 → 原子写）
app/api/agent/  app/api/sessions/  聊天栏会话面（pi-web 基线形态）
lib/yf/               yingfang 契约客户端、引导 skill、草案、workflow、画廊
config/operators.json  运营者 user_id 名单（只含 user_id，可进仓）
config/backends.json   内置静态后端/模型清单
config/guide-skill/    引导技能定义（新对话默认进入）
```
