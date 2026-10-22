import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { runDraft, resumeRound } = await jiti.import("./workflow.ts");

const draft = { backend_id: "zimage-turbo", prompt: "猫", n: 2, seed: -1 };
const ROUND = "e".repeat(32);

function harness({ terminal = "done", pollThrows = null } = {}) {
  const phases = [];
  const log = { submitted: [], polled: [], landed: [], getCalls: 0 };
  const deps = {
    submit: async (convId, request) => {
      log.submitted.push({ convId, request });
      return { convId: "c".repeat(32), round: { round_id: ROUND } };
    },
    poll: async (roundId, options) => {
      log.polled.push(roundId);
      // GET-only：每次观测一个非终态，再给终态（模拟 queued → running → terminal）。
      for (const state of ["queued", "running", terminal]) {
        log.getCalls += 1;
        options.onTick?.({ state });
      }
      if (pollThrows) throw pollThrows;
      return { state: terminal };
    },
    land: async (roundId) => {
      log.landed.push(roundId);
      return { landed: 2, files: ["/g/0.png", "/g/1.png"] };
    },
  };
  return { phases, log, deps, onPhase: (p) => phases.push(p) };
}

test("confirmed draft: submit → poll to done → land; phases in order, files reported", async () => {
  const h = harness();
  const refs = [];
  const final = await runDraft(draft, { convId: null, onSubmitted: (r) => refs.push(r), onPhase: h.onPhase, deps: h.deps });
  assert.deepEqual(final, { kind: "done", roundId: ROUND, files: ["/g/0.png", "/g/1.png"] });
  assert.equal(h.log.submitted.length, 1);
  assert.equal(h.log.submitted[0].request.backendId, "zimage-turbo");
  assert.deepEqual(refs, [{ convId: "c".repeat(32), roundId: ROUND }]);
  assert.deepEqual(h.phases.map((p) => p.kind), ["submitting", "running", "running", "running", "landing", "done"]);
  assert.deepEqual(h.log.landed, [ROUND]);
});

test("failed / cancelled rounds stop the poll, land nothing, and say so", async () => {
  for (const terminal of ["failed", "cancelled"]) {
    const h = harness({ terminal });
    const final = await runDraft(draft, { convId: "k".repeat(32), onSubmitted() {}, onPhase: h.onPhase, deps: h.deps });
    assert.deepEqual(final, { kind: "ended", roundId: ROUND, state: terminal });
    assert.equal(h.log.landed.length, 0, "no landing for a non-done round");
  }
});

test("a submit failure surfaces as an error phase and never polls", async () => {
  const h = harness();
  h.deps.submit = async () => { throw new Error("入队闸拒绝"); };
  const final = await runDraft(draft, { convId: null, onSubmitted() { throw new Error("must not be called"); }, onPhase: h.onPhase, deps: h.deps });
  assert.deepEqual(final, { kind: "error", message: "入队闸拒绝" });
  assert.equal(h.log.polled.length, 0);
});

test("resume after a reload continues from the stored round id (landing is idempotent server-side)", async () => {
  const h = harness();
  const final = await resumeRound(ROUND, h.onPhase, h.deps);
  assert.equal(final.kind, "done");
  assert.equal(h.log.submitted.length, 0, "resume never submits again");
});

test("a poll error is reported with the round id so the card can offer a retry", async () => {
  const h = harness({ pollThrows: new Error("网络断了") });
  const final = await resumeRound(ROUND, h.onPhase, h.deps);
  assert.deepEqual(final, { kind: "error", message: "网络断了", roundId: ROUND });
});
