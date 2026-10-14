# 部署 — 同源反向代理形态

## 拓扑

yf-app（Next.js 服务）与 yingfang API **同源**部署：一个反向代理对外暴露唯一 origin，
按路径把 `/api` 转发给 yingfang、其余转发给 yf-app。浏览器只见一个源，因此
yingfang 下发的 `yf_session` cookie（`HttpOnly` / `SameSite=Lax` / `Path=/`）在
yf-app 页面发起的同源 fetch 中**自然携带**——yf-app 不实现任何 CORS / 跨源凭据方案。

```
浏览器 ──▶ 反向代理（唯一 origin，TLS 在此终结）
             ├─ /api/*        ──▶ yingfang（-listen :9701）
             └─ /*            ──▶ yf-app Next 服务（:30141）
```

- yingfang 的 `-cors-origin` 保持未配置（CORS 关闭）——同源形态根本不需要它。
- `GET /healthz`（运维面）不经代理暴露公网。
- 唯一的 yf-app 自有 API 是 `POST /api/guide`：它必须由 yf-app 自己处理，因此在
  反向代理上把 `/api/guide` 从「转发 yingfang」的规则里排除，落回 yf-app 服务。

## Caddy 示例

```caddy
example.com {
    # yf-app 自有服务端面：LLM 引导代理（key 在 yf-app 服务端环境变量）
    handle /api/guide {
        reverse_proxy 127.0.0.1:30141
    }
    # yingfang 契约面：register/login/logout/convs/rounds/tree/select/presign
    handle /api/* {
        reverse_proxy 127.0.0.1:9701
    }
    # 产品页面与静态资源
    handle {
        reverse_proxy 127.0.0.1:30141
    }
}
```

## Nginx 示例

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    location = /api/guide {
        proxy_pass http://127.0.0.1:30141;
        proxy_set_header Host $host;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:9701;
        proxy_set_header Host $host;
    }
    location / {
        proxy_pass http://127.0.0.1:30141;
        proxy_set_header Host $host;
    }
}
```

## yf-app 服务端环境变量（LLM 引导代理）

| 变量 | 语义 |
|---|---|
| `YF_LLM_BASE_URL` | LLM 提供方 OpenAI 兼容 API 根地址（如 `https://api.example.com/v1`） |
| `YF_LLM_API_KEY` | LLM 提供方 API key——**只在服务端**，绝不进入浏览器可见字节 |
| `YF_LLM_MODEL` | 单一固定模型 id；用户无模型选择面 |

三项任一缺失 ⇒ `POST /api/guide` 按请求回 503（引导对话不可用），其余产品面不受影响。

## 上线核对

- [ ] 浏览器 devtools 里可见的任何请求/响应/JS bundle 中无 LLM key。
- [ ] 登录后 `yf_session` cookie 属性为 `HttpOnly; SameSite=Lax; Path=/`。
- [ ] 全部契约请求与页面同源，响应无 `Access-Control-*` 头。

---

## 本地发版与部署（polyforge 规约）

发版与部署遵循 polyforge 的「发版独立成 bundle」裁定：release / verify / deploy
是三个相互不信任的步骤，全部命令取证，**只部署 verify 过的具体版本**，失败即回滚。
本仓的两个 procedure 是这套规则的本地承载：

| 文件 | 角色 | 契约 |
|---|---|---|
| `.polyforge/release.sh` | 发版 procedure | `release.sh <major\|minor\|patch\|X.Y.Z>`；`release.sh --verify <X.Y.Z>`（只读核验：tag 在 origin、annotated、package.json 版本一致、tag message 非空、可达 origin/main、npm 制品可见[软检查]） |
| `.polyforge/deploy.sh` | 本地部署 procedure | `deploy.sh <X.Y.Z> --confirm <v>`（confirm 必须与位置参数逐字相等）；`deploy.sh --status`（只读） |

### 发版（谁切版本）

- **polyforge 路径**：提一张 `workflows/release/` bundle 的 WI（goal 写明 bump 值，
  例如 "release patch"）。三步 `release → verify → deploy` 由 driver 执行：
  release 步跑本仓 release.sh 切版本；verify 步 distrust 上一步，用
  `release.sh --verify` 复核；deploy 步跑 `deploy.sh <v> --confirm <v>`。
  三步失败即终态（**不 rewind**——已推送的 tag 不可变，重发需另提 WI）。
- **人工路径**：直接跑 `.polyforge/release.sh patch`——同一个 procedure，
  幂等契约与退出码和 bundle 调用完全一致。

### 本地部署（deploy.sh）

```bash
# 一次性准备：运行环境（XDG 配置位，与部署产物分离；key 永不进仓库）
mkdir -p ~/.config/yf-app
cat > ~/.config/yf-app/env <<'ENV'
YF_LLM_API_KEY=sk-...          # 必填，缺失 = 拒绝部署（fail closed）
YF_LLM_BASE_URL=https://...    # 可选
YF_LLM_MODEL=...               # 可选
ENV
chmod 600 ~/.config/yf-app/env

# 部署某个已发版版本
.polyforge/deploy.sh 0.0.1 --confirm 0.0.1

# 查看状态 / 历史
.polyforge/deploy.sh --status
```

部署根布局：`releases/v<版本>/`（tag 导出 + 构建产物）、`current`（原子换的
稳定符号链接）、`state/`（pid / 日志 / 部署历史）、`deploy.lock`（主机侧锁，
并发部署即拒）。运行环境在 `~/.config/yf-app/env`（`YF_APP_ENV_FILE` 可
覆盖，600 权限），不随 releases 轮转清理——凭据不随产物走。

**防线一览**：`--confirm` 等值防线（拒绝 latest/别名）；只部署 origin 上存在的
tag 且本地复核 tag 处版本号；构建前 fail closed 检查 LLM key；健康检查
（`GET /` 60 秒预算）不过即自动回滚上一版本并重启（无上一版本则保持停止，
exit 非零）；保留当前+上一两个版本目录，更旧的自动清理。

### 与 yingfang 后端的本地配合

yf-app 只覆盖对话引导（`/api/guide`）与页面；契约端点（register/login/convs/
rounds/tree/select/presign）按同源拓扑由反代分流给 yingfang（`:9701`）。
本地把整链跑起来需要：

1. yingfang `app/api` 指向一个本地 PostgreSQL（`deploy/db.toml` 声明连接路径，
   schema 迁移跑齐），邀请码按裁决由 owner 手工插入；
2. 一个按路径分流的本地反代（把上面的 Caddy/Nginx 示例的域名换成
   `127.0.0.1:3000` 即可），`/api/guide` 落 yf-app、其余 `/api/*` 落 yingfang；
3. `deploy.sh` 只管 yf-app 这一个面——yingfang 侧服务的启停是它自己的运维面。
