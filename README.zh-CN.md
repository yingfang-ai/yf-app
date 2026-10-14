# yf-app

C 端图像创作工作台。把一个模糊的图像想法，经 LLM 引导对话变成完整请求，下单产图、
读图勾选，全程不改 yingfang 契约。

## 永久分叉声明

yf-app 是 **silgrid/pi-web v0.0.20 的永久分叉**（permanent fork），作为独立产品线演进。
不跟随 pi-web 上游合并（无版本表合并、无同步脚本、无上游合并入口），上游后续变更
不再进入本仓库。上游的 coding-agent 使用面（terminal、文件浏览、git worktree、
models 配置、agent sessions）已全部移除，保留的面仅有：注册/登录/登出、对话工作台、
产图读面。

## 使用流程

1. **注册**：持邀请码访问 `/login`，自拟 recovery（≥8 字符）注册。注册成功后展示
   `user_id`，必须确认已保存 recovery 才能进入产品。**recovery 丢失即账号丢失，
   服务端没有找回通道。**
2. **登录**：`user_id`（32 位 hex）+ recovery。`user_id` 由浏览器 localStorage 记住，
   recovery 永不持久化。
3. **对话工作台**：一句话描述想画什么，LLM 引导补全 prompt / negative_prompt /
   n / seed / params（默认隐藏；专家模式可查看修改，并可选择后端）。
4. **下单与轮询**：提交后 202 取 `round_id`，前端仅以 GET 轮询获知轮状态。
5. **产图读面**：图片经 presign URL 加载（过期自动重签；未配置 presign 时如实呈现
   「图片暂不可用」）。勾选一张图即定稿，后续 refine 默认以该轮为 parent。

## 部署

同源反向代理形态：yf-app 与 yingfang API 同源挂载（例如 Caddy/Nginx 把 `/api` 转发
到 yingfang、其余转发到 yf-app 的 Next 服务），`yf_session` cookie（HttpOnly /
SameSite=Lax / Path=/）同源自然携带，yf-app 不自建任何跨源凭据方案。
服务端 LLM 环境变量：`YF_LLM_BASE_URL` / `YF_LLM_API_KEY` / `YF_LLM_MODEL`。
详见 [docs/deploy.md](./docs/deploy.md)。

## 开发

```bash
npm ci
npm run dev   # 127.0.0.1:30141
npm run lint && npm test && npm run build
```
