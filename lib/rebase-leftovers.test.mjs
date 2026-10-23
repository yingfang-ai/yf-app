import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
