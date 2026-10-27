import test from "node:test";
import assert from "node:assert/strict";
import { buildTestApp, withServer } from "./helpers/buildTestApp.js";
import { fakeDbThrowing } from "./helpers/fakes.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function postLog(base, body) {
  return fetch(`${base}/audit/log`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("audit log ignores client-supplied id and generates a UUID", async () => {
  const { app } = await buildTestApp();

  await withServer(app, async (base) => {
    const res = await postLog(base, { id: "attacker", action: "login" });
    assert.equal(res.status, 201);
    const entry = await res.json();
    assert.match(entry.id, UUID_V4);
    assert.notEqual(entry.id, "attacker");
    assert.equal(entry.action, "login");
  });
});

test("audit log rejects unknown fields", async () => {
  const { app } = await buildTestApp();

  await withServer(app, async (base) => {
    const res = await postLog(base, { action: "login", foo: "bar" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /unknown field/);
  });
});

test("audit log rejects a non-string action", async () => {
  const { app } = await buildTestApp();

  await withServer(app, async (base) => {
    const res = await postLog(base, { action: 123 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /action/);
  });
});

test("audit log database failures become generic 500", async () => {
  const { app } = await buildTestApp({ db: fakeDbThrowing("db down") });

  await withServer(app, async (base) => {
    const res = await postLog(base, { action: "login" });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "internal error" });
  });
});
