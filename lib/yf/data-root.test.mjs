import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { yfDataRoot } = await jiti.import("./data-root.ts");

test("yfDataRoot defaults to ~/.local/share/yf-app", () => {
  const previous = process.env.YF_DATA_DIR;
  delete process.env.YF_DATA_DIR;
  try {
    assert.equal(yfDataRoot(), path.join(homedir(), ".local", "share", "yf-app"));
  } finally {
    if (previous !== undefined) process.env.YF_DATA_DIR = previous;
  }
});

test("YF_DATA_DIR overrides the data root (test isolation seam)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yf-data-root-"));
  try {
    process.env.YF_DATA_DIR = dir;
    assert.equal(yfDataRoot(), dir);
  } finally {
    delete process.env.YF_DATA_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});