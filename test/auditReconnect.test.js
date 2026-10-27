import test from "node:test";
import assert from "node:assert/strict";
import { fakeLogger, fakeScheduler, fakeWs } from "./helpers/fakes.js";

function makeNats({ available = true } = {}) {
  const subjects = [];
  let connectedHandler = null;
  let nc = { id: 1 };
  let consumeCalls = 0;
  let isUp = available;

  const nats = {
    isAvailable: () => isUp,
    get: () => ({ nc, sc: { decode: (data) => data } }),
    subscribeJson(subject) {
      subjects.push(subject);
      return {
        async *[Symbol.asyncIterator]() {},
        unsubscribe() {},
      };
    },
    async consume() {
      consumeCalls++;
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
    getConsumeCalls: () => consumeCalls,
    fireConnected: () => connectedHandler?.(),
    replaceConnection: (next) => {
      nc = next;
    },
    setAvailable: (value) => {
      isUp = value;
    },
  };
}

function depsFor(nats) {
  return {
    nats,
    logger: fakeLogger(),
    ws: fakeWs(),
    scheduler: fakeScheduler(),
  };
}

test("audit-user resubscribes only when the NATS connection changes", async () => {
  const {
    nats,
    subjects,
    getConsumeCalls,
    fireConnected,
    replaceConnection,
  } = makeNats();

  const { default: audit } =
    await import("../src/extensions/audit-user/index.js");

  await audit.init(depsFor(nats));
  assert.deepEqual(subjects, ["user.created", "user.deleted"]);
  assert.equal(getConsumeCalls(), 1);

  fireConnected();
  assert.deepEqual(subjects, ["user.created", "user.deleted"]);
  assert.equal(getConsumeCalls(), 1);

  replaceConnection({ id: 2 });
  fireConnected();
  assert.deepEqual(subjects, [
    "user.created",
    "user.deleted",
    "user.created",
    "user.deleted",
  ]);
  assert.equal(getConsumeCalls(), 2);
});

test("audit-user subscribes after NATS becomes available", async () => {
  const { nats, subjects, getConsumeCalls, fireConnected, setAvailable } =
    makeNats({ available: false });

  const { default: audit } =
    await import("../src/extensions/audit-user/index.js");

  await audit.init(depsFor(nats));
  assert.deepEqual(subjects, []);
  assert.equal(getConsumeCalls(), 0);

  setAvailable(true);
  fireConnected();

  assert.deepEqual(subjects, ["user.created", "user.deleted"]);
  assert.equal(getConsumeCalls(), 1);
});
