import test from "node:test";
import assert from "node:assert/strict";
import { initJetStream } from "../src/libs/nats.js";

test("initJetStream degrades when JetStream is disabled", async () => {
  const nc = {
    jetstreamManager: async () => {
      throw Object.assign(new Error("JetStream not enabled"), {
        code: "JetStreamNotEnabled",
      });
    },
    jetstream: () => ({ name: "js" }),
  };

  assert.deepEqual(await initJetStream(nc), { js: null, jsm: null });
});

test("initJetStream returns manager and client when available", async () => {
  const jsm = { name: "jsm" };
  const js = { name: "js" };
  const nc = {
    jetstreamManager: async () => jsm,
    jetstream: () => js,
  };

  assert.deepEqual(await initJetStream(nc), { js, jsm });
});
