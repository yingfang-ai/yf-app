#!/usr/bin/env bash
#
# .polyforge/deploy.sh — yf-app 的本地部署 procedure（polyforge release bundle 的 deploy 面）。
#
# 契约（polyforge 01-workflow-skills.md「发版独立成 bundle」裁定）：
#   .polyforge/deploy.sh <X.Y.Z> --confirm <X.Y.Z>
#   —— 位置参数版本与 --confirm 的值必须逐字相等，缺一或不相等即拒绝（这是
#      release bundle 的 deploy step 写下的防线：部署目标永远是一个具体版本，
#      绝不是 "latest"）；
#   —— 只部署已经发版（tag 在 origin 上）的版本，且不信任上游传话：tag、
#      tag 处 package.json 的版本号都在本地复核一遍；
#   —— 主机侧锁（flock）：同一部署根上并发部署直接拒绝；
#   —— 失败自动回滚：健康检查不过 ⇒ 停新服务、current 指回上一个版本、重启，
#      procedure 以「新版本在线」或「已回滚」结束，回滚 = 本脚本 exit 非零；
# 凭据两分（合同不变，位置更新）：tag-push 凭据（git）与运行时凭据
# （~/.config/yf-app/env 里的 YF_LLM_*，引导代理的 key）彼此独立，
# 后者永不进仓库、永不进部署产物。
#
# fail closed（缺配置 = 拒绝部署，而不是部署一个起不来/没引导的实例）：
#   ~/.config/yf-app/env 必须存在且 YF_LLM_API_KEY 非空。这个检查发生在
#   **构建之前**，所以一次缺 key 的部署不会留下任何构建产物。
#
# 本地部署形态（对应 docs/deploy.md 的同源反代拓扑，本机 pilot 版）：
#
#   <deploy-root>/            默认 ~/deploy/yf-app，可用 YF_APP_DEPLOY_ROOT 覆盖
#     releases/v<version>/    从 tag 导出的源码树 + node_modules + .next 产物
#     current -> releases/v<version>   原子换的稳定符号链接（相对目标，树可搬迁）
#     state/app.pid           当前服务 pid
#     state/app.log           服务 stdout/stderr
#     state/deploy-history.log  每次部署/回滚一行记账
#     deploy.lock             主机侧锁（flock）
#
#   运行环境（凭据/配置）与部署产物分离：环境文件在 XDG 配置位
#     ~/.config/yf-app/env     （可用 YF_APP_ENV_FILE 覆盖；600 权限），
#   不在部署根里——releases 会被轮转清理，凭据不随产物走；这与机器上
#   其它服务的惯例一致（polyforge 的 cli.toml 同在 ~/.config/）。
#
#   服务监听 127.0.0.1:$YF_APP_PORT（默认 30141，与 package.json 一致）。
#   生产拓扑里对外暴露的是反代（见 docs/deploy.md），本地 pilot 直接访问
#   http://127.0.0.1:<port>/；要让「注册→对话→下单」整链走通，还需要
#   yingfang app/api（:9701）与一个按路径分流的本地反代——那是部署文档的
#   事，本脚本只负责 yf-app 自己这一个面。
#
# Usage:
#   .polyforge/deploy.sh <X.Y.Z> --confirm <X.Y.Z>    # 部署（或幂等命中）
#   .polyforge/deploy.sh --status                     # 只读：当前版本/健康/历史
#   .polyforge/deploy.sh --help
#
# Exit contract: 0 = 新版本在线（或幂等命中且健康）；1 = 部署失败且已回滚
# （无上一版本时保持停止状态退出 1）；2 = 用法/参数错误。
set -euo pipefail

log() { echo "deploy: $*" >&2; }
die() { echo "deploy: FATAL: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
usage: .polyforge/deploy.sh <X.Y.Z> --confirm <X.Y.Z>
       .polyforge/deploy.sh --status
EOF
  exit 2
}

# ─── 参数解析 ─────────────────────────────────────────────────────────────────
CONFIRM=""
VERSION=""
STATUS=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --confirm) [ "$#" -ge 2 ] || usage; CONFIRM="$2"; shift 2 ;;
    --status)  STATUS=1; shift ;;
    --help|-h) usage ;;
    -*)        usage ;;
    *)         [ -z "$VERSION" ] || usage; VERSION="$1"; shift ;;
  esac
done
if [ "$STATUS" -eq 1 ]; then
  [ -z "$VERSION" ] && [ -z "$CONFIRM" ] || usage
else
  [ -n "$VERSION" ] || usage
  [ -n "$CONFIRM" ] || usage
  [ "$VERSION" = "$CONFIRM" ] || die "--confirm '$CONFIRM' != positional '$VERSION' — refusing (a deploy target is one concrete version, never an alias)"
  echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "version must be X.Y.Z, got '$VERSION'"
  [ "$VERSION" != "latest" ] || true # unreachable (regex), kept as a readable vow
fi

# ─── 仓库身份（与 release.sh 同款：只认 yingfang-ai/yf-app，上游 remote 即死）──
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$REPO_ROOT"
ORIGIN_URL="$(git config --get remote.origin.url)" || die "no origin remote configured"
case "$ORIGIN_URL" in
  git@github.com:yingfang-ai/yf-app.git | \
  https://github.com/yingfang-ai/yf-app.git | \
  https://github.com/yingfang-ai/yf-app) ;;
  *) die "origin is '$ORIGIN_URL' — this procedure only deploys yingfang-ai/yf-app" ;;
esac
while read -r rname rurl _rest; do
  case "$rurl" in
    *silgrid* | *pi-web*)
      die "remote '$rname' ($rurl) points at the upstream project — yf-app never merges or publishes upstream" ;;
  esac
done < <(git remote -v)

# ─── 部署根与运行参数 ─────────────────────────────────────────────────────────
DEPLOY_ROOT="${YF_APP_DEPLOY_ROOT:-$HOME/deploy/yf-app}"
PORT="${YF_APP_PORT:-30141}"
HOST="${YF_APP_HOST:-127.0.0.1}"
HEALTH_URL="http://$HOST:$PORT/"
mkdir -p "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/state"
LOCK="$DEPLOY_ROOT/deploy.lock"

current_version() { readlink "$DEPLOY_ROOT/current" 2>/dev/null | sed 's|^releases/||' || true; }

# ─── --status：只读面 ─────────────────────────────────────────────────────────
if [ "$STATUS" -eq 1 ]; then
  CUR="$(current_version)"
  PID="$(cat "$DEPLOY_ROOT/state/app.pid" 2>/dev/null || true)"
  ALIVE=no
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then ALIVE=yes; fi
  HEALTH=no
  curl -fsS -m 5 -o /dev/null "$HEALTH_URL" 2>/dev/null && HEALTH=yes || true
  echo "deploy-root: $DEPLOY_ROOT"
  echo "current:     ${CUR:-none}"
  echo "pid:         ${PID:-none} (alive: $ALIVE)"
  echo "health:      $HEALTH ($HEALTH_URL)"
  echo "--- last deploys ---"
  tail -n 10 "$DEPLOY_ROOT/state/deploy-history.log" 2>/dev/null || echo "(no history)"
  exit 0
fi

# ─── 主机侧锁：同一部署根上并发部署即拒 ───────────────────────────────────────
exec 9>"$LOCK"
flock -n 9 || die "another deploy holds $LOCK — refusing to run concurrently"

# ─── 只部署发过版的版本，且本地复核（不信任上游传话）─────────────────────────
TAG="v$VERSION"
REMOTE_TAG="$(git ls-remote --tags origin "refs/tags/$TAG" 2>/dev/null || true)"
[ -n "$REMOTE_TAG" ] || die "tag $TAG not found on origin — only released versions are deployable (never a local-only build, never 'latest')"
# fetch 该 tag；若本地已有且与远端分叉，fetch 自身会报错（clobber 保护），正是要的信号
git fetch --quiet --no-tags origin "refs/tags/$TAG:refs/tags/$TAG" 2>/dev/null || \
  die "local tag $TAG diverges from origin (or fetch failed) — refusing"
git rev-parse -q --verify "$TAG^{commit}" >/dev/null || die "$TAG does not resolve to a commit"
TAG_VERSION="$(git show "$TAG:package.json" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version' 2>/dev/null || true)"
[ "$TAG_VERSION" = "$VERSION" ] || die "package.json at $TAG is '${TAG_VERSION:-unreadable}', expected '$VERSION' — refusing to deploy a version that does not match its own tag"

# ─── fail closed：运行环境在构建之前检查 ─────────────────────────────────────
# XDG 配置位（~/.config/yf-app/env），与部署产物分离：releases 会被轮转清理，
# 凭据不随产物走。可用 YF_APP_ENV_FILE 覆盖。
ENV_FILE="${YF_APP_ENV_FILE:-$HOME/.config/yf-app/env}"
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE — create it first (see docs/deploy.md: YF_LLM_API_KEY required; the key never enters the repo or any release dir)"
grep -Eq '^YF_LLM_API_KEY=.+' "$ENV_FILE" || die "$ENV_FILE lacks a non-empty YF_LLM_API_KEY — refusing to deploy a guide-less instance (fail closed)"

# ─── 幂等命中 ─────────────────────────────────────────────────────────────────
REL="$DEPLOY_ROOT/releases/$VERSION"
CUR_TARGET="$(readlink "$DEPLOY_ROOT/current" 2>/dev/null || true)"
if [ "$CUR_TARGET" = "releases/$VERSION" ]; then
  log "current already points at $VERSION — verifying health only (idempotent)"
  if curl -fsS -m 5 -o /dev/null "$HEALTH_URL" 2>/dev/null; then
    echo "DEPLOY OK (idempotent): $VERSION already current and healthy"
    exit 0
  fi
  die "$VERSION is current but unhealthy — treat as a broken deploy: see --status, fix, or redeploy after removing $REL"
fi
if [ -e "$REL" ]; then
  die "$REL already exists but is not current (a previous failed deploy?) — remove it (or inspect it) before redeploying this version"
fi

# ─── 导出源码（git archive：不占用 worktree、不碰开发 checkout）──────────────
log "exporting $TAG -> $REL"
mkdir -p "$REL"
git archive "$TAG" | tar -x -C "$REL"

# ─── 构建（release 绿棒已过一遍，这里是部署构建）────────────────────────────
log "npm ci (in $REL)"
( cd "$REL" && npm ci --no-audit --no-fund ) || { rm -rf "$REL"; die "npm ci failed"; }
log "npm run build"
( cd "$REL" && npm run build ) || { rm -rf "$REL"; die "npm run build failed"; }

# ─── 服务生命周期 ─────────────────────────────────────────────────────────────
stop_server() {
  local pid
  pid="$(cat "$DEPLOY_ROOT/state/app.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    log "stopping server pid $pid (TERM)"
    kill -TERM "$pid" 2>/dev/null || true
    local waited=0
    while kill -0 "$pid" 2>/dev/null; do
      [ "$waited" -ge 30 ] && { log "pid $pid did not exit in 30s — KILL"; kill -KILL "$pid" 2>/dev/null || true; sleep 1; break; }
      sleep 1; waited=$((waited + 1))
    done
  fi
  rm -f "$DEPLOY_ROOT/state/app.pid"
}

start_server() {
  local target="$1"   # releases/vX.Y.Z（相对 DEPLOY_ROOT）
  ( cd "$DEPLOY_ROOT/$target" && \
    set -a && . "$ENV_FILE" && set +a && \
    nohup node_modules/.bin/next start -H "$HOST" -p "$PORT" \
      >> "$DEPLOY_ROOT/state/app.log" 2>&1 & echo $! > "$DEPLOY_ROOT/state/app.pid" )
}

wait_healthy() {
  local budget="${1:-60}" waited=0
  while [ "$waited" -lt "$budget" ]; do
    if curl -fsS -m 5 -o /dev/null "$HEALTH_URL" 2>/dev/null; then return 0; fi
    sleep 1; waited=$((waited + 1))
  done
  return 1
}

history_line() { echo "$(date -u +%FT%TZ) $*" >> "$DEPLOY_ROOT/state/deploy-history.log"; }

# ─── 换版：停旧 → 原子换链 → 起新 → 健康检查（失败即回滚）────────────────────
PREV_TARGET="$CUR_TARGET"
stop_server

log "swapping current -> releases/$VERSION (atomic)"
ln -sfn "releases/$VERSION" "$DEPLOY_ROOT/.current.tmp.$$"
mv -T "$DEPLOY_ROOT/.current.tmp.$$" "$DEPLOY_ROOT/current"

log "starting $VERSION on $HOST:$PORT"
start_server "releases/$VERSION"
if wait_healthy 60; then
  history_line "deployed $VERSION (pid $(cat "$DEPLOY_ROOT/state/app.pid"))"
  log "pruning old releases (keeping current + previous)"
  for d in "$DEPLOY_ROOT"/releases/*; do
    [ -d "$d" ] || continue
    n="$(basename "$d")"
    [ "$n" = "$VERSION" ] && continue
    [ "releases/$n" = "$PREV_TARGET" ] && continue
    rm -rf "$d" && log "pruned $d"
  done
  cat <<EOF
DEPLOY OK
version: $VERSION (tag $TAG, package.json verified)
origin: $ORIGIN_URL
service: $HOST:$PORT (pid $(cat "$DEPLOY_ROOT/state/app.pid"))
health: $HEALTH_URL
previous: ${PREV_TARGET:-none}
EOF
  exit 0
fi

# ─── 回滚 ─────────────────────────────────────────────────────────────────────
log "health check FAILED after 60s — rolling back"
stop_server
if [ -n "$PREV_TARGET" ] && [ -d "$DEPLOY_ROOT/$PREV_TARGET" ]; then
  ln -sfn "$PREV_TARGET" "$DEPLOY_ROOT/.current.tmp.$$"
  mv -T "$DEPLOY_ROOT/.current.tmp.$$" "$DEPLOY_ROOT/current"
  log "current -> $PREV_TARGET (rollback); restarting previous"
  start_server "$PREV_TARGET"
  if wait_healthy 60; then
    history_line "rollback $VERSION -> $PREV_TARGET (previous healthy)"
    die "deploy of $VERSION failed health check; rolled back to $PREV_TARGET and restarted"
  else
    history_line "rollback $VERSION -> $PREV_TARGET (previous ALSO unhealthy, left running for inspection)"
    die "deploy of $VERSION failed AND previous $PREV_TARGET is unhealthy too — inspect state/app.log"
  fi
else
  rm -f "$DEPLOY_ROOT/current"
  history_line "failed $VERSION (no previous to roll back to; left stopped)"
  die "deploy of $VERSION failed and there is no previous release to roll back to — service left stopped; fix and redeploy"
fi
