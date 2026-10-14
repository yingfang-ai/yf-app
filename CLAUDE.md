# CLAUDE.md — yf-app

## 永久分叉声明（先读这一段）

**yf-app 是 silgrid/pi-web v0.0.20 的永久分叉（permanent fork），独立产品线。**

- **不做任何上游跟随合并**：pi-web 上游的后续 commit / 版本表 / release 一律不进入
  本仓库。仓库里不存在也不得引入任何「从上游合并 / 同步 / cherry-pick」的流程、
  脚本或入口。
- 基线之上，上游的 coding-agent 使用面（terminal、文件浏览、git worktree、models
  配置、agent sessions、PWA/push、移动壳与桌面壳）已全部移除；yf-app 只保留三个
  用户面：注册/登录/登出、对话工作台、产图读面。
- 任何把仓库「升级到 pi-web 新版本」的提议都与本声明冲突，直接拒绝。

## 产品一句话

C 端图像创作工作台：邀请码注册 → 一句话起步 → LLM 引导对话（服务端代理，key 不进
浏览器，历史仅存 localStorage）→ 按 yingfang 契约下单 → GET 轮询 → presign 读图 →
勾选定稿（后续 refine 默认 parent）。UI 仅简体中文；桌面优先，窄视口能看即可。

## 硬纪律

- **不改 yingfang 契约**：`repos/yingfang/docs/api-contract.md` §2 的路由全集是唯一
  对接面；不新增/修改/删除契约端点，不加 SSE/WS、消息持久化、backend 列表端点。
- 契约错误信封 `{"error":{code,message,details?}}` 按码如实呈现，不吞不改。
- LLM API key 只存部署环境变量（`YF_LLM_API_KEY` 等），绝不出现在任何发往浏览器的
  字节中；不用 `NEXT_PUBLIC_` 承载任何密钥。
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
app/page.tsx          对话工作台 + 产图读面（主页面）
app/login/page.tsx    注册（含 recovery 确认门）/ 登录
app/api/guide/        服务端 LLM 引导代理（唯一自有 API 路由）
lib/yf/               yingfang 契约客户端、引导协议、轮询、读面逻辑
config/backends.json  内置静态后端/模型清单
```
