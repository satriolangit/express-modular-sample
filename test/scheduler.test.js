import test from "node:test";
import assert from "node:assert/strict";
import config from "../src/libs/config.js";
import * as scheduler from "../src/libs/scheduler.js";

function wait(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("runOnInit is skipped when the scheduler is disabled", async () => {
  const original = config.scheduler.enabled;
  config.scheduler.enabled = false;
  let calls = 0;

  scheduler.register({
    name: "test:disabled-run-on-init",
    schedule: "0 0 1 1 *",
    runOnInit: true,
    handler: async () => {
      calls++;
    },
  });

  try {
    scheduler.startAll();
    await wait();
    assert.equal(calls, 0);
  } finally {
    scheduler.destroyAll();
    config.scheduler.enabled = original;
  }
});

test("runOnInit runs exactly once when the scheduler starts", async () => {
  const original = config.scheduler.enabled;
  config.scheduler.enabled = true;
  let calls = 0;

  scheduler.register({
    name: "test:enabled-run-on-init",
    schedule: "0 0 1 1 *",
    runOnInit: true,
    handler: async () => {
      calls++;
    },
  });

  try {
    scheduler.startAll();
    await wait();
    scheduler.startAll();
    await wait();
    assert.equal(calls, 1);
  } finally {
    scheduler.destroyAll();
    config.scheduler.enabled = original;
  }
});
