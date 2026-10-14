import assert from "node:assert/strict";
import test from "node:test";

import {
  backendsConfig,
  defaultBackend,
  findBackend,
  nRange,
} from "./backends.ts";

test("the bundled list is non-empty with unique backend ids", () => {
  assert.ok(backendsConfig.backends.length >= 1);
  const ids = backendsConfig.backends.map((entry) => entry.backend_id);
  assert.equal(new Set(ids).size, ids.length);
});

test("entries carry a usable param panel definition (defaults inside options)", () => {
  for (const entry of backendsConfig.backends) {
    assert.ok(entry.default_n >= 1, "default_n >= 1");
    assert.ok(entry.max_n >= entry.default_n, "max_n >= default_n");
    for (const field of entry.param_fields) {
      assert.ok(field.options.includes(field.default), `${entry.backend_id}.${field.key} default not in options`);
    }
  }
});

test("defaultBackend and findBackend resolve against the static list only", () => {
  const backend = defaultBackend();
  assert.equal(findBackend(backend.backend_id), backend);
  assert.equal(findBackend("no-such-backend"), undefined);
});

test("nRange bounds the product per-round image count (D16 shape)", () => {
  const { min, max } = nRange(defaultBackend());
  assert.equal(min, 1);
  assert.ok(max >= 1 && max <= 16, "product n cap must stay within the contract guardrail S4=16");
});
