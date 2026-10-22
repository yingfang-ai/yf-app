# 部署 — 同源形态（Next 代理 `/api/yf/*`）

## 拓扑

yf-app（Next.js 服务）是浏览器唯一的源：页面与 `/api/*` 都由它提供。yingfang 的
契约面**整体挂在 yf-app 自己的 `/api/yf/*` 前缀下**，由
`app/api/yf/[...path]/route.ts` 逐字代理到 yingfang（缺省 `http://127.0.0.1:9701`，
`YF_API_UPSTREAM` 可覆盖）：cookie 原样携带、`Set-Cookie` 原样回传、错误信封透传。
因此 `yf_session` cookie（`HttpOnly` / `SameSite=Lax` / `Path=/`）对全站同源自然携带
——yf-app 不实现任何 CORS / 跨源凭据方案。

```
浏览器 ──▶ 反向代理（唯一 origin，TLS 在此终结；**不再按 /api/* 分流**）
             └─ /*   ──▶ yf-app Next 服务（:30141）
                          ├─ /api/yf/*  ──▶ yingfang（-listen :9701，服务端内部转发）
                          └─ 其余 /api/*、页面  yf-app 自己处理
```

- 上游 pi-web 的 Next 服务自己拥有 `/api/*`（agent/sessions/files…），与 yingfang
  契约的 `/api/*` 会撞名，所以旧的「Caddy 按 `/api/*` 分流给 yingfang」形态已取消。
- yingfang 的 `-cors-origin` 保持未配置（CORS 关闭）。`GET /healthz` 不经代理暴露公网。
- 身份：login 经代理时 yf-app 服务端落 session index（`<数据根>/session-index/
  <sha256(token)>.json`，只存哈希），据此判定 user_id 与运营者身份。

## Caddy 示例

```caddy
example.com {
    reverse_proxy 127.0.0.1:30141
}
```

## Nginx 示例

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:30141;
        proxy_set_header Host $host;
        # SSE（agent 事件流）不能被缓冲
        proxy_buffering off;
    }
}
```

## yf-app 服务端环境变量

| 变量 | 语义 |
|---|---|
| `YF_API_UPSTREAM` | yingfang 契约面地址，缺省 `http://127.0.0.1:9701` |
| `YF_DATA_DIR` | 数据根，缺省 `~/.local/share/yf-app` |
| `YF_OPERATOR_USER_IDS` | 逗号分隔的运营者 user_id，与 `config/operators.json` 取并集（e2e/部署引导缝） |

**LLM 配置不走环境变量**：运营者登录后在设置的「LLM 服务」里填 base_url / key /
model_id，存 `<数据根>/llm/config.json`（0600，只写不回显、不进仓、不进日志）。
未配置时新对话明确报错、不静默兜底。

## 数据根布局（全部不进 git）

```
<数据根>/gallery/<user_id>/<conv_id>/<round_id>/<idx>.<ext>   画廊（done 轮落盘）
<数据根>/users/<user_id>/                                     普通用户会话的 cwd
<数据根>/llm/config.json                                      LLM 配置（0600）
<数据根>/session-index/<sha256(token)>.json                   服务端身份索引
```

## 运营者名单

`config/operators.json`：`{"operatorUserIds": ["<32hex>", …]}`，只含 user_id、不含任何
凭据，可进仓。运营者可用 skills 安装 / plugins / app-update / 任意目录浏览 / LLM 配置；
普通用户直访这些面返回 403。

## 上线核对

- [ ] 浏览器 devtools 里可见的任何请求/响应/JS bundle 中无 LLM key。
- [ ] 登录后 `yf_session` cookie 属性为 `HttpOnly; SameSite=Lax; Path=/`。
- [ ] 全部契约请求与页面同源，响应无 `Access-Control-*` 头。
- [ ] 反代没有把 `/api/*` 转给 yingfang（一律落 yf-app）。

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
# 可选：运行环境（XDG 配置位，与部署产物分离）。LLM key 不在这里——部署后由
# 运营者在设置里配置。
mkdir -p ~/.config/yf-app
cat > ~/.config/yf-app/env <<'ENV'
YF_OPERATOR_USER_IDS=<运营者 user_id>   # 可选，与 config/operators.json 并集
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
tag 且本地复核 tag 处版本号；健康检查
（`GET /` 60 秒预算）不过即自动回滚上一版本并重启（无上一版本则保持停止，
exit 非零）；保留当前+上一两个版本目录，更旧的自动清理。

### 与 yingfang 后端的本地配合

yf-app 经 `/api/yf/*` 同源代理把契约端点（register/login/convs/rounds/tree/select/
presign）转给 yingfang（`:9701`）。本地把整链跑起来需要：

1. yingfang `app/api` 指向一个本地 PostgreSQL（`deploy/db.toml` 声明连接路径，
   schema 迁移跑齐），邀请码按裁决由 owner 手工插入；
2. 运营者在设置里配好「LLM 服务」，聊天栏引导才可用；
3. `deploy.sh` 只管 yf-app 这一个面——yingfang 侧服务的启停是它自己的运维面。
