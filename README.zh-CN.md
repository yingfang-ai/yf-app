# yf-app

C 端图像创作工作台。把一个模糊的图像想法，经 LLM 引导对话变成完整请求，下单产图、
读图勾选，全程不改 yingfang 契约。

## 永久分叉声明

yf-app 是 **silgrid/pi-web 的永久分叉**（permanent fork），作为独立产品线演进。
不跟随 pi-web 上游做持续合并（无版本表合并、无同步脚本、无上游合并入口），上游后续
变更不自动进入本仓库。当前基线为上游 main commit `2481a70`
（`2481a70b5b9ef23cb38847a7bc79101491446ea5`，yingfang#28 一次性重定基合入）：
pi-web 整体形态（AppShell、文件浏览器、聊天窗）随基线保留；terminal、git worktree、
models 配置三面板与主机 shell（含 agent 的 bash 工具，运营者也没有）已移除。普通
用户只有聊天栏（引导 skill + 生图 workflow）+ 自己的画廊；skills 安装、plugins、
app-update、任意目录浏览、LLM 配置仅运营者可用。

## 使用流程

1. **注册**：持邀请码访问 `/login`，自拟 recovery（≥8 字符）注册。注册成功后展示
   `user_id`，必须确认已保存 recovery 才能进入产品。**recovery 丢失即账号丢失，
   服务端没有找回通道。**
2. **登录**：`user_id`（32 位 hex）+ recovery。`user_id` 由浏览器 localStorage 记住，
   recovery 永不持久化。
3. **引导对话**：新对话默认进入引导 skill，用日常的话描述想画什么，引导员多轮追问后给出
   一份**草案**（后端、张数、描述）；想改就在同一个对话里接着改。
4. **确认下单**：草案以确认卡呈现，点「确认下单」才会提交（以你的登录身份下单，卡上
   不显示价格）；之后仅以 GET 轮询获知轮状态直到终态。
5. **画廊**：完成的图片落到你自己的画廊（`<数据根>/gallery/<user_id>/…`），在聊天里
   直接看缩略图、点开大图；失败/取消只在聊天里告知。用户之间互不可见。

## 部署

同源形态：反向代理只把全部流量交给 yf-app 的 Next 服务；yingfang 契约面挂在
`/api/yf/*` 下由 Next 代理到 yingfang（`:9701`），`yf_session` cookie（HttpOnly /
SameSite=Lax / Path=/）同源自然携带，yf-app 不自建任何跨源凭据方案。LLM 由运营者
在设置里配置（key 只写不回显，存服务端数据根），不走环境变量。
详见 [docs/deploy.md](./docs/deploy.md)。

## 开发

```bash
npm ci
npm run dev   # 127.0.0.1:30141
npm run lint && npm test && npm run build
```
