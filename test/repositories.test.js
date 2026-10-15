import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDeps, fakeDb } from "./helpers/fakes.js";

test("repositories/services use $1 placeholders and extract rows", async () => {
  const fake = fakeDb();
  installFakeDeps({ db: fake });

  const { default: repoUser } =
    await import("../src/modules/user-management/repositories/repo.user.js");
  const { default: repoRole } =
    await import("../src/modules/user-management/repositories/repo.role.js");
  const { default: repoProduct } =
    await import("../src/modules/product-management/repositories/repo.product.js");
  const { default: servicePolicy } =
    await import("../src/modules/product-management/services/service.policy.js");
  const { default: repoAudit } =
    await import("../src/extensions/audit-user/repositories/repo.audit.js");

  // ── findById: row object, bukan pg.Result ─────────
  assert.deepEqual(await repoUser.findById(1), { id: 1, name: "Alice" });
  const byId = fake.calls.find(
    (c) => /FROM app_user\b/.test(c.sql) && /WHERE id/.test(c.sql),
  );
  assert.match(byId.sql, /\$1/);
  assert.doesNotMatch(byId.sql, /\?/);
  assert.deepEqual(byId.params, [1]);

  // ── findAll / findByUserId: array baris ───────────
  assert.deepEqual(await repoUser.findAll(), [{ id: 1, name: "Alice" }]);
  assert.deepEqual(await repoRole.findAll(), [{ id: 1, name: "admin" }]);
  assert.deepEqual(await repoRole.findByUserId(1), [
    { id: 10, user_id: 1, role_id: 1, name: "admin" },
  ]);
  assert.deepEqual(await repoProduct.findAll(), [
    { id: 1, name: "Product 1" },
  ]);
  assert.deepEqual(await repoProduct.findById(1), {
    id: 1,
    name: "Product 1",
  });

  const roleByUser = fake.calls.find(
    (c) => /app_user_role/.test(c.sql) && /where aur\.user_id/i.test(c.sql),
  );
  assert.match(roleByUser.sql, /\$1/);
  assert.deepEqual(roleByUser.params, [1]);

  // ── policy service ────────────────────────────────
  assert.deepEqual(await servicePolicy.get(1), { id: 1, title: "Policy 1" });
  assert.deepEqual(await servicePolicy.list(), [{ id: 1, title: "Policy 1" }]);
  const policyById = fake.calls.find(
    (c) => /FROM policies\b/.test(c.sql) && /WHERE id/.test(c.sql),
  );
  assert.match(policyById.sql, /\$1/);
  assert.doesNotMatch(policyById.sql, /\?/);

  // ── audit repo ────────────────────────────────────
  assert.deepEqual(await repoAudit.findByUser(1), [
    { id: "a1", user_id: 1, action: "test" },
  ]);
  assert.deepEqual(await repoAudit.findAll(), [
    { id: "a1", user_id: 1, action: "test" },
  ]);
  const auditByUser = fake.calls.find(
    (c) => /FROM audit_logs\b/.test(c.sql) && /WHERE user_id/.test(c.sql),
  );
  assert.match(auditByUser.sql, /\$1/);

  // ── audit insert → db.insert(table, row) ──────────
  await repoAudit.insert({ id: "a1", user_id: 1 });
  const insertCall = fake.calls.find((c) => c.table === "audit_logs");
  assert.ok(insertCall, "db.insert dipanggil dengan table audit_logs");
  assert.deepEqual(insertCall.row, { id: "a1", user_id: 1 });
});

test("buildInsertSQL generates parameterized INSERT with RETURNING", async () => {
  installFakeDeps();
  const { buildInsertSQL } = await import("../src/libs/db.js");

  assert.equal(
    buildInsertSQL("audit_logs", ["id", "user_id"]),
    "INSERT INTO audit_logs (id, user_id) VALUES ($1, $2) RETURNING *",
  );

  assert.throws(() => buildInsertSQL("audit_logs; DROP TABLE x", ["id"]));
  assert.throws(() => buildInsertSQL("audit_logs", ['id" --']));
  assert.throws(() => buildInsertSQL("audit_logs", []));
});
