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
