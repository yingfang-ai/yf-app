import "../../../lib/yf/test-operator.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);

// Real paths: `inferRemovedWorktree()` resolves the repo it infers, and the temp folder
// is a link on macOS.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-models-worktree-")));
const agentDir = join(root, "agent");
const repo = join(root, "repo");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousOffline = process.env.PI_OFFLINE;
// Ambient provider auth (a developer shell or CI runner may export an
// anthropic key or bearer token) would add that provider's models to the
// list and break the "acme:one" expectation, so it is cleared here like
// any other ambient state the file already isolates.
const ambientAuthKeys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
const previousAuth = ambientAuthKeys.map((key) => [key, process.env[key]]);
for (const key of ambientAuthKeys) delete process.env[key];
process.env.PI_CODING_AGENT_DIR = agentDir;
// The list is served from the SDK's own data and the models.json below, so the route
// never reaches for the network here.
process.env.PI_OFFLINE = "1";

await mkdir(agentDir, { recursive: true });
await writeFile(join(agentDir, "models.json"), JSON.stringify({
  providers: {
    acme: {
      baseUrl: "https://example.invalid/v1",
      apiKey: "sk-test",
      api: "openai-completions",
      models: [{ id: "one", name: "Acme One" }],
    },
  },
}, null, 2));

// A worktree folder is `<repoRoot>-worktrees/<dir>` (what `addWorktree()` makes), and the
// sibling holding `.git` is the repo its removal is inferred back to.
async function initRepo(name) {
  const path = join(root, name);
  await execFileAsync("git", ["init", path]);
  return path;
}
await initRepo("repo");

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { GET } = await jiti.import("./route.ts");
const { writeSessionIndex } = await jiti.import("../../../lib/yf/session-index.ts");
// The repo of the removed worktree below is a project some session named, which is what
// makes it an allowed root; the fallback never adds one of its own.
allowFileRoot(repo);

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = previousOffline;
  for (const [key, value] of previousAuth) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
});

async function models(cwd) {
  const response = await GET(new Request(`http://localhost/api/models?cwd=${encodeURIComponent(cwd)}`, { headers: { host: "localhost" } }));
  return { status: response.status, body: await response.json() };
}

test("a removed worktree is listed from the repo it branched from", async () => {
  // A finished subagent run: its worktree is gone, its session still names it as the cwd.
  const removed = join(`${repo}-worktrees`, "pi-web-agent-abc");

  const fromRemoved = await models(removed);
  const fromRepo = await models(repo);

  assert.equal(fromRemoved.status, 200);
  // Not merely some list: the same one the repo answers, which is what a session that ran
  // without worktree isolation gets.
  assert.deepEqual(fromRemoved.body, fromRepo.body);
  assert.deepEqual(fromRemoved.body.modelList.map((m) => `${m.provider}:${m.id}`), ["acme:one"], "an empty list would make the comparison say nothing");
});

test("the repo a removed worktree falls back to is authorized as any other cwd", async () => {
  // A repo no session and no `allowFileRoot()` ever named.
  const unknown = await initRepo("unknown");
  const denied = await models(join(`${unknown}-worktrees`, "pi-web-agent-abc"));
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: "Access denied" });

  // Granting the worktree folder — what `addWorktree()` does for a live one — is not a
  // grant for the repo: the folder the fallback answers from is the one checked.
  const granted = join(`${unknown}-worktrees`, "granted-only");
  allowFileRoot(granted);
  assert.equal((await models(granted)).status, 403);
});

test("a missing folder that is not a removed worktree of a repo is refused as before", async () => {
  const missing = join(root, "never-existed");
  const gone = await models(missing);
  assert.equal(gone.status, 400);
  assert.equal(gone.body.error, `Directory does not exist: ${missing}`);

  // The `-worktrees` name alone is not enough: there has to be a repo to fall back to.
  const orphan = await models(join(`${root}-worktrees`, "orphan"));
  assert.equal(orphan.status, 400);
  assert.equal(orphan.body.error, `Directory does not exist: ${join(`${root}-worktrees`, "orphan")}`);
});

// yingfang#31（spec R5/plan A6）：模型列表面仅运营者——伪造 cookie 401、普通用户 403。
// test-operator.mjs 已把无 cookie 的请求包成运营者身份，上面的直调用例因此放行。
const ORDINARY_USER_ID = "c".repeat(32);

test("the models list is operator-only: forged cookie 401, ordinary session 403", async () => {
  writeSessionIndex(process.env.YF_DATA_DIR, "tok-ordinary-models-list", {
    user_id: ORDINARY_USER_ID,
    expires_at: "2030-01-01T00:00:00Z",
  });
  const forged = await GET(new Request(`http://localhost/api/models?cwd=${encodeURIComponent(repo)}`, {
    headers: { host: "localhost", cookie: "yf_session=forged-token" },
  }));
  assert.equal(forged.status, 401);
  const ordinary = await GET(new Request(`http://localhost/api/models?cwd=${encodeURIComponent(repo)}`, {
    headers: { host: "localhost", cookie: "yf_session=tok-ordinary-models-list" },
  }));
  assert.equal(ordinary.status, 403);
  assert.deepEqual(await ordinary.json(), { error: { code: "forbidden", message: "权限不足（该面仅运营者可用）" } });
});

test("an operator may list models for any registrable cwd, registered on first use (yingfang#31 spec R2)", async (t) => {
  // No session ever named this directory, so it is not in the allowed-roots
  // set — but it lies inside a registration prefix, which is the same fact
  // /api/agent/new uses for the operator's workspace. The models face must
  // accept it (and register it, so later requests see it too).
  const { __setRegistrationScopesForTesting: setScopes } = await jiti.import("../../../lib/root-registration-policy.ts");
  const home = await mkdtemp(join(tmpdir(), "yf-models-reg-home-"));
  const project = join(home, "project");
  await mkdir(project);
  setScopes(home, null);
  t.after(async () => {
    setScopes(null, null);
    await rm(home, { recursive: true, force: true });
  });

  const listed = await models(project);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.modelList.map((m) => `${m.provider}:${m.id}`), ["acme:one"]);

  // An operator cwd OUTSIDE every registration prefix stays refused.
  const outside = await mkdtemp(join(tmpdir(), "yf-models-outside-"));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  assert.equal((await models(join(outside, "nope"))).status, 400); // does not exist
  const outsideDir = await mkdtemp(join(tmpdir(), "yf-models-outside-dir-"));
  t.after(async () => rm(outsideDir, { recursive: true, force: true }));
  assert.equal((await models(outsideDir)).status, 403);
});
