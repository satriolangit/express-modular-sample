import test from "node:test";
import assert from "node:assert/strict";
import { fakeLogger, fakeScheduler, fakeWs } from "./helpers/fakes.js";

function makeNats() {
  const subjects = [];
  let connectedHandler = null;
  let nc = { id: 1 };

  const nats = {
    isAvailable: () => true,
    get: () => ({ nc, sc: { decode: (data) => data } }),
    subscribeJson(subject) {
      subjects.push(subject);
      return {
        async *[Symbol.asyncIterator]() {},
        unsubscribe() {},
      };
    },
    async consume() {
      return {
        async consume() {
          return { async *[Symbol.asyncIterator]() {} };
        },
      };
    },
    onConnected(handler) {
      connectedHandler = handler;
    },
    onLost() {},
    onReconnected() {},
    publish: () => true,
    jsPublish: async () => ({}),
    healthCheck: () => true,
    close: async () => {},
  };

  return {
    nats,
    subjects,
    fireConnected: () => connectedHandler?.(),
    replaceConnection: (next) => {
      nc = next;
    },
  };
}

test("audit-user resubscribes only when the NATS connection changes", async () => {
  const { nats, subjects, fireConnected, replaceConnection } = makeNats();
  const deps = {
    nats,
    logger: fakeLogger(),
    ws: fakeWs(),
    scheduler: fakeScheduler(),
  };

  const { default: audit } =
    await import("../src/extensions/audit-user/index.js");

  await audit.init(deps);
  assert.deepEqual(subjects, ["user.created", "user.deleted"]);

  fireConnected();
  assert.deepEqual(subjects, ["user.created", "user.deleted"]);

  replaceConnection({ id: 2 });
  fireConnected();
  assert.deepEqual(subjects, [
    "user.created",
    "user.deleted",
    "user.created",
    "user.deleted",
  ]);
});
