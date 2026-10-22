# yf-app

C 端图像创作工作台（映坊）：邀请码注册、`user_id`+recovery 登录、聊天栏引导对话
（新对话默认进入引导 skill）产出可下单草案、确认后按 yingfang 契约下单产图、
GET-only 轮询到终态、画廊按用户隔离浏览。

产品文档与界面语言均为简体中文（见 [README.zh-CN.md](./README.zh-CN.md)）。

## 永久分叉声明

yf-app 是 **silgrid/pi-web 的永久分叉（permanent fork）**，独立产品线演进：不跟随
pi-web 上游做版本表合并，仓库内不存在任何持续同步脚本或上游合并入口，上游后续
变更不自动进入本仓库。当前基线为上游 main commit
`2481a70`（`2481a70b5b9ef23cb38847a7bc79101491446ea5`，yingfang#28 一次性重定基
合入）：pi-web 的整体形态（AppShell、文件浏览器、聊天窗）随基线保留；terminal、
git worktree、models 配置三面板与主机 shell（含 agent 的 bash 工具，运营者也没有）
按 yingfang#28 移除。上游 tag 不推 origin，版本留在 yf-app 0.0.1 纪元，本仓不发版。

## 开发

```bash
npm ci        # 安装依赖
npm run dev   # 开发服务（127.0.0.1:30141）
npm run lint  # eslint
npm test      # node:test 单测
npm run build # next build
```

部署形态为同源挂载：yingfang 契约面整体挂在 `/api/yf/*` 前缀下由 Next 代理到
yingfang（`:9701`），`yf_session` cookie 自然携带——见
[docs/deploy.md](./docs/deploy.md)。