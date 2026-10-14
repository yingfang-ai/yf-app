import { NextResponse } from "next/server";

// 最小同源直通。
//
// yf-app 的部署形态是同源反向代理（docs/deploy.md）：浏览器只见一个源，契约端点
// （register/login/logout/convs/rounds/tree/select/presign）由反向代理转发给
// yingfang，`yf_session` cookie 自然携带；`/api/guide` 是 yf-app 自有的服务端面，
// 由反向代理排除在转发规则外、落回本服务。
//
// 这里不再有上游 pi-web 的 web-password 门与面向 coding-agent 的请求安全逻辑：
// 每个请求原样直通，由各路由自己处理。
export function proxy() {
  return NextResponse.next();
}

export const config = { matcher: ["/", "/login", "/api/:path*"] };
