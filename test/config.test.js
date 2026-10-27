import test from "node:test";
import assert from "node:assert/strict";
import { assertRequiredConfig } from "../src/libs/config.js";

const validPg = {
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "secret",
  database: "app_db",
};

test("assertRequiredConfig rejects an empty PG_PASSWORD", () => {
  assert.throws(
    () => assertRequiredConfig({ pg: { ...validPg, password: "" } }),
    /PG_PASSWORD/,
  );
});

test("assertRequiredConfig accepts a complete pg config", () => {
  assert.doesNotThrow(() => assertRequiredConfig({ pg: validPg }));
});

test("assertRequiredConfig rejects an invalid PG_PORT", () => {
  assert.throws(
    () => assertRequiredConfig({ pg: { ...validPg, port: Number.NaN } }),
    /PG_PORT/,
  );
});
