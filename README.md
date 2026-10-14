# yf-app

C 端图像创作工作台：邀请码注册、一句话起步、LLM 引导对话把模糊想法变成完整请求、
按 yingfang 契约下单产图、读面查看并勾选定稿。

产品文档与界面语言均为简体中文（见 [README.zh-CN.md](./README.zh-CN.md)）。

## 产品形态

- **账号面**：邀请码注册（`user_id` + recovery），登录/登出。recovery 是唯一凭据，
  服务端无找回端点——丢失即永久失去账号；注册时强制确认已保存 recovery。
- **对话工作台**：一句话起步，yf-app 服务端代理 LLM（单一固定模型，key 只在服务端），
  引导生成符合 yingfang `SubmitRequest` 的完整请求；可调参数默认隐藏，专家模式可见可改。
- **产图读面**：GET 轮询轮状态、presign 浏览图片、勾选即定稿并作为后续 refine 的默认 parent；
  多轮会话（含 refine/redirect）呈现为线性对话流。

## 永久分叉声明

yf-app 是 **silgrid/pi-web v0.0.20 的永久分叉**（permanent fork），独立产品线演进：
不跟随 pi-web 上游做版本表合并，上游后续变更不进入本仓库，仓库内不存在任何上游
合并流程或入口。上游的 coding-agent 使用面（terminal、文件浏览、git worktree、
models 配置、agent sessions）已全部移除。

## 开发

```bash
npm ci        # 安装依赖
npm run dev   # 开发服务（127.0.0.1:30141）
npm run lint  # eslint
npm test      # node:test 单测
npm run build # next build
```

部署形态为**同源反向代理**：yf-app（Next.js）与 yingfang API 同源挂载，
`yf_session` cookie 自然携带，无跨源凭据方案——见 [docs/deploy.md](./docs/deploy.md)。
