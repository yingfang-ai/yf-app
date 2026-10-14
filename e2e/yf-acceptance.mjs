// yf-acceptance.mjs — e2e-authored acceptance bar for yf-app (wi_aOGUvDkGfgG5).
//
// Authored by the e2e-author lane against `artifacts/spec.md` BEFORE the
// implementation ("code") step ran. Every check encodes a spec acceptance
// criterion, never an implementation surface that did not exist at authoring
// time: the probed URLs are the pre-implementation tree's own coding-agent
// routes (they exist today and MUST disappear), and the remaining checks are
// grounded in the spec (zh-CN only, permanent-fork declaration, yingfang
// zero-diff) or in pages that exist today (/ and /login).
//
// This file is named in execution.json steps.e2e-author.output.test_files.
// Implementation steps MUST NOT delete it while cleaning up the legacy pi-web
// e2e scenarios — the cleanup targets the old runner/checks, not this bar.
//
// Run (from repos/yf-app, after `npm ci`):
//   node e2e/yf-acceptance.mjs
//
// Style follows e2e/run.mjs: self-managed Next dev server on a free loopback
// port, fixtures in a temporary PI_CODING_AGENT_DIR, no credentials needed.
// Scenario IDs (S-E2E-xx) are keyed 1:1 to artifacts/e2e-scenarios.md.
//
// Expected result on the pre-implementation tree: RED at the assertion level
// (that is the bar e2e-baseline lays down). The suite must go green only once
// the implementation satisfies the spec. Every scenario prints PASS/FAIL so a
// run always reports the full bar, never aborts on the first failure.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, "test-results", "e2e-yf");
mkdirSync(artifacts, { recursive: true });

const results = [];
async function record(id, title, fn) {
  try {
    await fn();
    results.push({ id, title, ok: true });
    console.log(`PASS ${id} ${title}`);
  } catch (error) {
    results.push({ id, title, ok: false });
    console.log(`FAIL ${id} ${title}\n     ${error?.message ?? error}`);
  }
}

function basename(path) { return path.split(/[\\/]/).pop(); }

async function main() {
  if (!existsSync(join(root, "node_modules", "next"))) {
    console.error("node_modules missing — run `npm ci` in repos/yf-app first");
    process.exit(1);
  }
  if (existsSync(join(root, ".next/dev/lock"))) {
    console.error("An active dev server holds .next/dev/lock — run in a checkout without one (see e2e/README.md)");
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Static checks (no server needed)
  // -------------------------------------------------------------------------

  // S-E2E-01b — spec AC1: coding-agent API route directories must not exist.
  // Frozen list of the pre-implementation tree's app/api families; spec says
  // the terminal / file browsing / git worktree / models config / agent
  // sessions faces must be removed, and each of these directories is a
  // direct-URL surface that exists today.
  const codingAgentApiFamilies = [
    "agent", "app-update", "auth", "cwd", "default-cwd", "file-index", "files",
    "fs-manage", "git", "home", "models", "models-config", "plugins",
    "project-trust", "provider-usage", "push", "sessions", "skills", "subagents",
    "terminal", "tools", "web-auth", "worktrees",
  ];
  await record("S-E2E-01b", "coding-agent API 路由目录物理不存在", () => {
    const present = codingAgentApiFamilies.filter((family) => existsSync(join(root, "app", "api", family)));
    if (present.length > 0) {
      throw new Error(`coding-agent route families still present: ${present.join(", ")}`);
    }
  });

  // S-E2E-22 — spec AC13 (UI 语言仅 zh-CN): the locale directory that exists
  // in the pre-implementation tree (lib/i18n/messages) must ship zh-CN only.
  // If the layout is restructured, this fails with a pointer to re-verify the
  // intent manually instead of silently passing.
  await record("S-E2E-22", "locale 文件仅 zh-CN", () => {
    const dir = join(root, "lib", "i18n", "messages");
    if (!existsSync(dir)) {
      throw new Error("lib/i18n/messages no longer exists (layout changed — re-verify the zh-CN-only intent against the new layout)");
    }
    const locales = readdirSync(dir).filter((name) => /\.(ts|tsx|js|mjs|json)$/.test(name));
    const nonZh = locales.filter((name) => !/^zh-CN\./.test(name));
    if (nonZh.length > 0) {
      throw new Error(`non-zh-CN locale files shipped: ${nonZh.join(", ")}`);
    }
  });

  // S-E2E-24 — spec AC15: repo docs must declare the permanent fork (baseline
  // silgrid/pi-web v0.0.20) and the package must not carry the upstream
  // identity.
  await record("S-E2E-24", "永久分叉载明且无上游包身份", () => {
    const candidates = [
      join(root, "README.md"), join(root, "CLAUDE.md"), join(root, "AGENTS.md"),
      join(root, "CONTEXT.md"),
    ];
    const docs = join(root, "docs");
    if (existsSync(docs)) {
      for (const name of readdirSync(docs)) {
        if (name.endsWith(".md")) candidates.push(join(docs, name));
      }
    }
    const found = candidates.filter((path) => existsSync(path));
    const declares = found.some((path) => {
      const text = readFileSync(path, "utf8");
      return /永久分叉|permanent fork/i.test(text) && /v0\.0\.20/.test(text);
    });
    if (!declares) {
      throw new Error(`no repo doc declares the permanent fork with baseline v0.0.20 (searched: ${found.map(basename).join(", ")})`);
    }
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.name === "@silgrid/pi-web") {
      throw new Error("package.json still carries the upstream @silgrid/pi-web identity");
    }
  });

  // S-E2E-25 — spec AC16: the yingfang repo (contract owner) must be untouched.
  await record("S-E2E-25", "yingfang 仓库零改动", () => {
    const yingfang = join(root, "..", "yingfang");
    if (!existsSync(join(yingfang, ".git"))) {
      throw new Error("sibling repos/yingfang checkout not found — run inside the capsule layout");
    }
    const status = spawnSync("git", ["-C", yingfang, "status", "--porcelain"], { encoding: "utf8" });
    if (status.status !== 0) {
      throw new Error(`git status failed: ${status.stderr}`);
    }
    if (status.stdout.trim() !== "") {
      throw new Error(`repos/yingfang has local changes:\n${status.stdout.trim()}`);
    }
  });

  // -------------------------------------------------------------------------
  // Live server checks (Next dev, same lifecycle as e2e/run.mjs)
  // -------------------------------------------------------------------------
  const agentDir = mkdtempSync(join(tmpdir(), "yf-acceptance-"));
  const serverLog = createWriteStream(join(artifacts, "server.log"));
  let server;
  let serverError;
  let base;
  // Try a handful of free ports: Next rejects a few reserved port numbers, and
  // the OS may hand us one of those from the ephemeral range.
  for (let attempt = 0; ; attempt++) {
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
    base = `http://127.0.0.1:${port}`;

    server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: root,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        PI_WEB_PASSWORD: "",
        NEXT_TELEMETRY_DISABLED: "1",
        // Same operator escape hatch e2e/run.mjs uses for its tmpdir workspace.
        PI_WEB_ALLOWED_ROOT_PREFIXES: agentDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.once("error", (error) => { serverError = error; });
    server.stdout.pipe(serverLog, { end: false });
    server.stderr.pipe(serverLog, { end: false });

    // Readiness: any HTTP response on a known path means the server is up.
    // Pre-implementation /api/sessions answers 200; post-implementation it
    // 404s — either way a response means the server is listening. If the
    // process dies first (e.g. reserved port), retry on a fresh port.
    const deadline = Date.now() + 240_000;
    let responded = false;
    while (true) {
      if (serverError) throw serverError;
      if (server.exitCode !== null) break;
      const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (response) { responded = true; break; }
      if (Date.now() > deadline) throw new Error("server readiness timed out; see test-results/e2e-yf/server.log");
      await delay(500);
    }
    if (responded) break;
    assert.ok(attempt < 4, `server kept exiting before readiness; see test-results/e2e-yf/server.log`);
    console.log(`server exited before readiness (attempt ${attempt + 1}), retrying on a new port`);
  }

  try {
    async function request(method, path, body) {
      return fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
        redirect: "follow",
      });
    }

    // S-E2E-01a — spec AC1 / spec Scenario "coding-agent 面不可达": every
    // coding-agent direct URL that exists in the pre-implementation tree must
    // be gone (404). Frozen probe list taken from today's app/api route leaves.
    const codingAgentProbes = [
      ["GET", "/api/sessions"],
      ["POST", "/api/agent/new", { type: "get_state" }],
      ["GET", "/api/agent/running"],
      ["GET", "/api/terminal"],
      ["POST", "/api/terminal", {}],
      ["GET", "/api/files/package.json?type=read"],
      ["POST", "/api/fs-manage", {}],
      ["POST", "/api/git/status", {}],
      ["GET", "/api/worktrees"],
      ["GET", "/api/models"],
      ["GET", "/api/models/enabled"],
      ["POST", "/api/models/refresh", {}],
      ["GET", "/api/models-config"],
      ["POST", "/api/models-config/discover", {}],
      ["GET", "/api/plugins"],
      ["GET", "/api/skills"],
      ["GET", "/api/subagents/profiles"],
      ["GET", "/api/tools/settings"],
      ["GET", "/api/cwd"],
      ["POST", "/api/cwd/validate", {}],
      ["GET", "/api/default-cwd"],
      ["GET", "/api/file-index"],
      ["GET", "/api/home"],
      ["POST", "/api/project-trust", {}],
      ["POST", "/api/provider-usage/query", {}],
      ["GET", "/api/push/config"],
      ["POST", "/api/push/subscribe", {}],
      ["GET", "/api/app-update"],
      ["GET", "/api/auth/providers"],
      ["GET", "/api/web-auth"],
    ];
    await record("S-E2E-01a", "coding-agent API 直连 URL 全部 404", async () => {
      const alive = [];
      for (const [method, path, body] of codingAgentProbes) {
        const response = await request(method, path, body);
        if (response.status !== 404) {
          alive.push(`${method} ${path} -> ${response.status}`);
        }
      }
      if (alive.length > 0) {
        throw new Error(`coding-agent endpoints still reachable:\n  ${alive.join("\n  ")}`);
      }
    });

    // S-E2E-02 — spec Scenario "保留面可用" (URL-level half; the behavioral
    // half is scenario E2E-02 in artifacts/e2e-scenarios.md): / and /login
    // must stay reachable. Both pages exist in the pre-implementation tree, so
    // this is a keep-guard, not a removal bar.
    await record("S-E2E-02", "保留页面根路径与登录页可达", async () => {
      for (const path of ["/", "/login"]) {
        const response = await request("GET", path);
        if (response.status >= 400) {
          throw new Error(`GET ${path} -> ${response.status}`);
        }
      }
    });
  } finally {
    server?.kill("SIGTERM");
    rmSync(agentDir, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nyf-acceptance: ${results.length - failed.length}/${results.length} scenarios pass`);
  if (failed.length > 0) {
    console.log("failed scenarios:", failed.map((result) => result.id).join(", "));
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
