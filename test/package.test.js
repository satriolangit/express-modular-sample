import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("package.base.json declares the supported Node floor", () => {
  const file = path.join(import.meta.dirname, "..", "package.base.json");
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));

  assert.equal(pkg.engines?.node, ">=20.11");
});
