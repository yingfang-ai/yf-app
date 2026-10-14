#!/usr/bin/env bash
#
# .polyforge/release.sh — yf-app's release procedure.
#
# This file makes repos/yf-app the release-procedure owner for this capsule
# (a polyforge release step scans repos/ for .polyforge/release.sh or
# .polyforge/release.md; with exactly one owner it executes that procedure
# verbatim, and any nonzero exit of this script is a release failure).
#
# What a release is in this repo — yf-app's own convention, no upstream
# involved (yf-app is a permanent fork of silgrid/pi-web, baseline v0.0.20;
# it never fetches, merges, follows, or publishes upstream):
#
#   1. bump the version in package.json (and package-lock.json),
#   2. run the green bar — `npm run lint`, `npm test`, `npm run build` — to
#      validate the shipped build (the full CI bar additionally runs the
#      e2e acceptance suite via .github/workflows/ci.yml on every push),
#   3. commit the bump, create an annotated tag v<version> and push ONLY
#      that tag to origin (yingfang-ai/yf-app). The tag push triggers
#      .github/workflows/release.yml, which publishes the npm package
#      `yf-app` via npm Trusted Publishing (OIDC, provenance) — no npm
#      token secret exists anywhere. Prerequisite (one-time, npmjs.com):
#      the package `yf-app` has a Trusted Publisher configured for
#      repository yingfang-ai/yf-app, workflow release.yml.
#
# Why the tag push only: this environment's global git pre-push hook refuses
# pushing main/master to GitHub remotes (changes land via PR; override is
# reserved for deliberate human pushes). This script pushes the release tag
# only — the tag carries the release commit, and the tag push is what
# triggers publishing. It never sets PF_ALLOW_MAIN_PUSH and never pushes a
# branch.
#
# Usage (run from anywhere; the script resolves its own repo root):
#   .polyforge/release.sh <major|minor|patch|X.Y.Z>
#   e.g. .polyforge/release.sh patch    # 0.0.20 -> 0.0.21
#
# Exit contract: 0 = released (version bumped, green bar passed, annotated
# tag v<version> pushed to origin); nonzero = release failed. On failure
# before the release commit, package.json / package-lock.json are restored
# and nothing was committed or pushed; on failure after the commit, the
# local commit and tag exist and the retry is `git push origin refs/tags/v<version>`.
set -euo pipefail

log() { echo "release: $*" >&2; }
die() { echo "release: FATAL: $*" >&2; exit 1; }

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <major|minor|patch|X.Y.Z>" >&2
  exit 2
fi
BUMP="$1"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$REPO_ROOT"

# --- rollback scaffolding ----------------------------------------------------
# Until the release commit exists, any failure restores package.json and
# package-lock.json so the tree is left exactly as it was. After the commit,
# nothing is auto-undone (it is local-only until the tag push; retry is a
# plain `git push origin refs/tags/v<version>`).
committed=0
NEW=""
on_exit() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$committed" -eq 0 ]; then
      git checkout -- package.json package-lock.json 2>/dev/null || true
      log "FAILED (rc=$rc): nothing committed, nothing pushed; package.json/package-lock.json restored"
    else
      log "FAILED (rc=$rc) after the release commit: local commit + tag v${NEW} exist, nothing was pushed"
      log "retry the publish with: git push origin refs/tags/v${NEW}"
    fi
  fi
}
trap on_exit EXIT

# --- preconditions -----------------------------------------------------------
[ -f package.json ] || die "package.json not found (repo root: $REPO_ROOT)"
PKG_NAME="$(node -p "require('./package.json').name")"
if [ "$PKG_NAME" != "yf-app" ]; then
  die "package.json name is '$PKG_NAME', expected 'yf-app' — refusing to release under any other identity"
fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git worktree"
BRANCH="$(git symbolic-ref -q --short HEAD)" || die "detached HEAD — refusing to release from a detached state"
if [ -n "$(git status --porcelain)" ]; then
  die "worktree not clean — commit or stash before releasing (a release is cut from a committed state)"
fi

# Release speaks only to this repo's own identity on GitHub. Raw configured
# URL is checked (transport-level insteadOf rewrites are the operator's
# business); any remote pointing at the upstream project is fatal.
ORIGIN_URL="$(git config --get remote.origin.url)" || die "no origin remote configured"
case "$ORIGIN_URL" in
  git@github.com:yingfang-ai/yf-app.git | \
  https://github.com/yingfang-ai/yf-app.git | \
  https://github.com/yingfang-ai/yf-app) ;;
  *) die "origin is '$ORIGIN_URL' — this procedure only releases to yingfang-ai/yf-app (this repo's own identity)" ;;
esac
while read -r rname rurl _rest; do
  case "$rurl" in
    *silgrid* | *pi-web*)
      die "remote '$rname' ($rurl) points at the upstream project — yf-app never merges or publishes upstream" ;;
  esac
done < <(git remote -v)

[ -f .github/workflows/release.yml ] || die ".github/workflows/release.yml missing — the tag push would publish nothing"

# --- resolve the next version -------------------------------------------------
CURRENT="$(node -p "require('./package.json').version")"
case "$BUMP" in
  major | minor | patch)
    NEW="$(node -e 'const [maj,min,pat]=process.argv[1].split(".").map(Number);if([maj,min,pat].some((v)=>!Number.isFinite(v))){process.exit(3)}const n={major:(maj+1)+".0.0",minor:maj+"."+(min+1)+".0",patch:maj+"."+min+"."+(pat+1)}[process.argv[2]];if(!n){process.exit(3)}console.log(n)' "$CURRENT" "$BUMP")" || die "cannot bump '$CURRENT' by $BUMP" ;;
  *)
    if ! echo "$BUMP" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      die "argument must be major|minor|patch or an explicit X.Y.Z version, got '$BUMP'"
    fi
    NEW="$BUMP" ;;
esac
if [ "$NEW" = "$CURRENT" ]; then
  die "package.json is already at version $CURRENT"
fi
if [ "$(printf '%s\n%s\n' "$CURRENT" "$NEW" | sort -V | head -n1)" = "$NEW" ]; then
  die "new version $NEW is not greater than current $CURRENT — releases only move forward"
fi
if git rev-parse -q --verify "refs/tags/v$NEW" >/dev/null 2>&1; then
  die "tag v$NEW already exists locally"
fi
REMOTE_TAG="$(git ls-remote --tags origin "refs/tags/v$NEW")" || die "cannot reach origin to check existing tags — aborting before any mutation"
if [ -n "$REMOTE_TAG" ]; then
  die "tag v$NEW already exists on origin ($ORIGIN_URL)"
fi

# --- bump the version (working tree only until the bar is green) --------------
log "bumping version $CURRENT -> $NEW in package.json + package-lock.json"
npm version "$NEW" --no-git-tag-version >/dev/null

# --- green bar: validate the shipped build ------------------------------------
if [ ! -d node_modules/next ]; then
  log "node_modules missing — running npm ci first"
  npm ci --no-audit --no-fund
fi
log "green bar 1/3: npm run lint"
npm run lint
log "green bar 2/3: npm test"
npm test
log "green bar 3/3: npm run build"
npm run build

# --- commit, annotated tag, tag-only push -------------------------------------
git add package.json package-lock.json
git commit -m "release: v$NEW"
committed=1
log "committed the version bump on $BRANCH ($(git rev-parse --short HEAD))"

git tag -a "v$NEW" -m "yf-app v$NEW

Release of yf-app's own npm package (name: yf-app). Pushing this tag
triggers .github/workflows/release.yml, which publishes via npm Trusted
Publishing (OIDC, provenance). yf-app is a permanent fork of
silgrid/pi-web (baseline v0.0.20): it does not publish, follow, or merge
from the upstream project."
log "created annotated tag v$NEW"

log "pushing tag v$NEW to origin ($ORIGIN_URL) — branch push deliberately omitted (main lands via PR)"
git push origin "refs/tags/v$NEW"
PUSHED_TAG="$(git ls-remote --tags origin "refs/tags/v$NEW")" || die "cannot re-reach origin to confirm the push"
if [ -z "$PUSHED_TAG" ]; then
  die "push reported success but v$NEW is not visible on origin"
fi

log "RELEASE OK"
cat <<EOF
RELEASE OK
version: $NEW
tag: v$NEW (annotated) -> pushed to origin yingfang-ai/yf-app
published_by: .github/workflows/release.yml, triggered by this tag push
npm_package: yf-app@$NEW (npm Trusted Publishing, OIDC, provenance)
artifacts_published:
  - git-tag: v$NEW @ yingfang-ai/yf-app
  - npm-package: yf-app@$NEW (published by release.yml on this tag push)
EOF
