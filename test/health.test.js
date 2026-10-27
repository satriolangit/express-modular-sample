import test from "node:test";
import assert from "node:assert/strict";
import { computeHealth } from "../src/libs/health.js";

test("optional NATS failure keeps readiness true and reports degraded", () => {
  const result = computeHealth(
    { pg: true, nats: false, ws: true },
    { natsRequired: false },
  );

  assert.deepEqual(result, {
    ok: true,
    degraded: true,
    checks: { pg: true, nats: false, ws: true },
  });
});

test("required NATS failure fails readiness", () => {
  const result = computeHealth(
    { pg: true, nats: false, ws: true },
    { natsRequired: true },
  );

  assert.equal(result.ok, false);
  assert.equal(result.degraded, true);
});

test("postgres failure always fails readiness", () => {
  const result = computeHealth(
    { pg: false, nats: true, ws: true },
    { natsRequired: false },
  );

  assert.equal(result.ok, false);
  assert.equal(result.degraded, false);
});
