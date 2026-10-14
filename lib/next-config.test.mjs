import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("scopes Next.js output file tracing to the yf-app package", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });

  assert.equal(config.outputFileTracingRoot, projectRoot);
});

test("keeps the response compression and unoptimized image optimizer settings", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });

  assert.equal(config.compress, true);
  assert.deepEqual(config.images, { unoptimized: true });
});

test("carries no upstream pi-web identity env", async () => {
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });

  assert.equal(typeof config.env.NEXT_PUBLIC_APP_VERSION, "string");
  assert.equal(config.env.NEXT_PUBLIC_PI_VERSION, undefined);
  assert.ok(!config.headers.toString().includes("assetlinks"));
});
