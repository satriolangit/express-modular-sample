import test from "node:test";
import assert from "node:assert/strict";
import { buildTestApp, withServer } from "./helpers/buildTestApp.js";
import { fakeDb, fakeDbThrowing, installFakeDeps } from "./helpers/fakes.js";

test("database failures on resource routes become generic 500", async () => {
  const { app } = await buildTestApp({ db: fakeDbThrowing("db down") });

  await withServer(app, async (base) => {
    for (const path of ["/users/1", "/products/1", "/products/policies/1"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 500, `${path} harus 500`);
      assert.deepEqual(await res.json(), { error: "internal error" });
    }
  });
});

test("missing user row becomes NotFoundError", async () => {
  installFakeDeps({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });

  const { default: userService } =
    await import("../src/modules/user-management/services/service.user.js");

  await assert.rejects(() => userService.getUser(1), {
    name: "NotFoundError",
    message: "User not found",
  });
});

test("GET /users/:id returns 404 when the user does not exist", async () => {
  const db = fakeDb();
  const originalQuery = db.query;
  db.query = async (sql, params) => {
    if (/FROM app_user\b/i.test(sql) && /WHERE id/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    return originalQuery(sql, params);
  };

  const { app } = await buildTestApp({ db });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/users/1`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "User not found" });
  });
});
