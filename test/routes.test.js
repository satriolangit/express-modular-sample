import test from "node:test";
import assert from "node:assert/strict";
import { buildTestApp, withServer } from "./helpers/buildTestApp.js";
import { fakeDbThrowing } from "./helpers/fakes.js";

test("base + extension routes respond correctly", async () => {
  const { app } = await buildTestApp();

  await withServer(app, async (base) => {
    // ── users ───────────────────────────────────────
    let res = await fetch(`${base}/users`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: 1, name: "Alice" }]);

    // GET /users/:id → extension overwrite (auth + enrich)
    res = await fetch(`${base}/users/1`);
    assert.equal(res.status, 200);
    const enriched = await res.json();
    assert.equal(enriched.enriched, true);
    assert.equal(enriched.name, "Alice");
    assert.deepEqual(enriched.roles, ["admin"]);

    // Static /users/roles harus menang atas /users/:id
    res = await fetch(`${base}/users/roles`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: 1, name: "admin" }]);

    // DELETE /users/:id → extension route baru
    res = await fetch(`${base}/users/1`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: "1", by: "Catherine" });

    // ── products ────────────────────────────────────
    res = await fetch(`${base}/products`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: 1, name: "Product 1" }]);

    res = await fetch(`${base}/products/1`);
    assert.equal(res.status, 200);
    const product = await res.json();
    assert.equal(product.source, "extension");
    assert.equal(product.name, "Product 1");

    // Static /products/policies harus menang atas /products/:id
    res = await fetch(`${base}/products/policies`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: 1, title: "Policy 1" }]);

    // POST /products/policies → extension route baru
    res = await fetch(`${base}/products/policies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { created: true, body: { title: "x" } });

    // ── policies (base route, ikut prefix product-management) ──
    res = await fetch(`${base}/products/policies/1`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 1, title: "Policy 1" });

    // ── audit (extension-only module) ───────────────
    res = await fetch(`${base}/audit/logs`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [
      { id: "a1", user_id: 1, action: "test" },
    ]);

    res = await fetch(`${base}/audit/users/1`);
    assert.equal(res.status, 200);

    res = await fetch(`${base}/audit/log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test" }),
    });
    assert.equal(res.status, 201);
    const entry = await res.json();
    assert.equal(entry.action, "test");
    assert.ok(entry.id, "entry.id dari uuid dibuat");

    res = await fetch(`${base}/audit/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, sent: 0 });

    // ── unknown route → 404 ─────────────────────────
    res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  });
});

test("async db errors become JSON 500 instead of hanging", async () => {
  const { app } = await buildTestApp({ db: fakeDbThrowing("db down") });

  await withServer(app, async (base) => {
    for (const path of [
      "/users",
      "/users/roles",
      "/products",
      "/products/policies",
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 500, `${path} harus 500`);
      assert.deepEqual(await res.json(), { error: "internal error" });
    }
  });
});
