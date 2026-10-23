import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// yingfang#30: leftovers of the #28 rebase onto upstream main commit 2481a70
// that no step's file list covered.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("release files and package.json declare the 2481a70 fork baseline, not v0.0.20 (B2)", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(packageJson.description, /2481a70/);
  assert.doesNotMatch(packageJson.description, /v0\.0\.20/);

  for (const path of [".polyforge/release.sh", ".github/workflows/release.yml"]) {
    const source = read(path);
    assert.match(source, /baseline upstream main commit 2481a70/, path);
    assert.doesNotMatch(source, /baseline v0\.0\.20|pi-web v0\.0\.20/, path);
  }
  // The annotated release-tag message is user-visible text.
  assert.match(
    read(".polyforge/release.sh"),
    /git tag -a "v\$NEW" -m "[^"]*baseline upstream main commit 2481a70[^"]*"/,
  );
});

test("upstream docs restored by the rebase are gone or describe this tree (B3)", () => {
  // Upstream npm-package promotion and its release checklist: yf-app publishes neither.
  for (const path of ["README.ja.md", "README.ru.md", "docs/release.md"]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  // Agent docs must not document deleted surfaces as current behaviour.
  // yingfang#31（owner 推翻 #28 对应裁决）：ModelsConfig / EnabledModelsSection /
  // GET /api/models 随「模型」tab 恢复，移出删除面正则；terminal / worktree /
  // 主机 shell / web-auth 维持删除。
  const deletedSurface = /abort_bash|`!` shell|ProjectWorktreePicker|NewSessionContextBar|\/api\/web-auth`? and every/;
  for (const path of ["docs/agents/models.md", "docs/agents/files-and-access.md", "docs/agents/sessions.md"]) {
    assert.doesNotMatch(read(path), deletedSurface, path);
  }
  // models.md 改写为「模型」tab 面貌：新面在场，旧通道只以「已移除」叙述出现。
  const modelsDoc = read("docs/agents/models.md");
  assert.match(modelsDoc, /「模型」/);
  assert.match(modelsDoc, /\/api\/yf\/llm-config/);
  assert.match(modelsDoc, /全站默认模型未配置/);
});
