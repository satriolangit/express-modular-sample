import test from "node:test";
import assert from "node:assert/strict";
import { runTx } from "../src/libs/db.js";

test("runTx commits on success", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
    },
  };

  const result = await runTx(client, async () => "ok");

  assert.equal(result, "ok");
  assert.deepEqual(calls, ["BEGIN", "COMMIT"]);
});

test("runTx preserves the original error when rollback fails", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === "ROLLBACK") throw new Error("rollback failed");
    },
  };
  const failure = new Error("business failure");

  await assert.rejects(
    () =>
      runTx(client, async () => {
        throw failure;
      }),
    (err) => err === failure,
  );

  assert.deepEqual(calls, ["BEGIN", "ROLLBACK"]);
});
