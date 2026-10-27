import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sortRoutes } from "../src/libs/routeOrder.js";
import { buildTestApp, withServer } from "./helpers/buildTestApp.js";

test("sortRoutes puts static routes before parameter routes", () => {
  const ordered = sortRoutes([
    { method: "get", path: "/:id" },
    { method: "get", path: "/roles" },
    { method: "get", path: "/policies/:id" },
    { method: "all", path: "/health" },
  ]);

  assert.deepEqual(
    ordered.map((route) => route.path),
    ["/roles", "/health", "/policies/:id", "/:id"],
  );
});

test("static routes still win when route files are read in reverse", async () => {
  const original = fs.readdirSync;
  fs.readdirSync = function patchedReaddir(target, ...args) {
    const entries = original.call(this, target, ...args);
    return String(target).endsWith("routes") ? [...entries].reverse() : entries;
  };

  try {
    const { app } = await buildTestApp();

    await withServer(app, async (base) => {
      let res = await fetch(`${base}/users/roles`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), [{ id: 1, name: "admin" }]);

      res = await fetch(`${base}/products/policies`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), [{ id: 1, title: "Policy 1" }]);
    });
  } finally {
    fs.readdirSync = original;
  }
});
