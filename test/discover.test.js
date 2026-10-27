import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  discover,
  parseRouteFile,
  validateModuleIndex,
} from "../src/libs/bootstrap/discover.js";

const fixtures = path.join(import.meta.dirname, "fixtures", "discover");

function discoverFixture(name) {
  return discover(
    path.join(fixtures, name, "modules"),
    path.join(fixtures, name, "extensions"),
  );
}

test("parseRouteFile accepts valid names and rejects malformed route names", () => {
  assert.deepEqual(parseRouteFile("route.user.js"), {
    name: "user",
    isExtend: false,
  });
  assert.deepEqual(parseRouteFile("route.user.extend.js"), {
    name: "user",
    isExtend: true,
  });
  assert.equal(parseRouteFile("service.user.js"), null);
  assert.throws(
    () => parseRouteFile("route.user.extend.extra.js"),
    /Invalid route filename/,
  );
});

test("validateModuleIndex enforces prefix and init shape", () => {
  assert.doesNotThrow(() => validateModuleIndex("x", { prefix: "/x" }));
  assert.throws(
    () => validateModuleIndex("x", { prefix: "x" }),
    /prefix/,
  );
  assert.throws(
    () => validateModuleIndex("x", { prefix: "/x", init: "nope" }),
    /init/,
  );
});

test("discover loads valid base and extension route groups", async () => {
  const modules = await discoverFixture("valid");
  const inventory = modules.get("inventory");

  assert.ok(inventory);
  assert.equal(inventory.prefix, "/inventory");
  assert.equal(inventory.routeGroups.length, 1);
  assert.equal(inventory.routeGroups[0].groupName, "inventory");
  assert.equal(typeof inventory.routeGroups[0].baseRegister, "function");
  assert.equal(typeof inventory.routeGroups[0].extendRegister, "function");
});

test("discover rejects an invalid module prefix", async () => {
  await assert.rejects(() => discoverFixture("invalid-prefix"), /prefix/);
});

test("discover rejects non-extend route files in the extension root", async () => {
  await assert.rejects(
    () => discoverFixture("invalid-ext-route"),
    /\.extend\.js/,
  );
});

test("discover rejects an invalid init hook", async () => {
  await assert.rejects(() => discoverFixture("invalid-init"), /init/);
});

test("discover rejects an extension init that is not a function", async () => {
  await assert.rejects(
    () => discoverFixture("invalid-ext-init"),
    /Extension init must export default function/,
  );
});
