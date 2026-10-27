import test from "node:test";
import assert from "node:assert/strict";
import { isLikelyMiddleware, mergeRoutes } from "../src/libs/mergeRoutes.js";

const baseMw = (req, res, next) => next();
const baseHandler = (req, res) => res.end();
const extMw = (req, res, next) => next();
const extHandler = (req, res) => res.end();
const prependMw = (req, res, next) => next();

function route(handlers, opts = {}) {
  return { method: "get", path: "/x", handlers, opts };
}

test("mergeMiddleware without keepBaseHandler keeps legacy behavior", () => {
  const [merged] = mergeRoutes({
    base: [route([baseMw, baseHandler])],
    extend: [route([extMw], { mergeMiddleware: true })],
  });

  assert.equal(merged.opts._mode, "merge");
  assert.deepEqual(merged.handlers, [baseMw, extMw]);
});

test("keepBaseHandler treats extension handlers as middleware", () => {
  const [merged] = mergeRoutes({
    base: [route([baseMw, baseHandler])],
    extend: [
      route([extMw], { mergeMiddleware: true, keepBaseHandler: true }),
    ],
  });

  assert.equal(merged.opts._mode, "merge+keep");
  assert.deepEqual(merged.handlers, [baseMw, extMw, baseHandler]);
});

test("keepBaseHandler composes with prepend", () => {
  const [merged] = mergeRoutes({
    base: [route([baseMw, baseHandler])],
    extend: [
      route([extMw], {
        prepend: [prependMw],
        mergeMiddleware: true,
        keepBaseHandler: true,
      }),
    ],
  });

  assert.equal(merged.opts._mode, "prepend+merge+keep");
  assert.deepEqual(merged.handlers, [
    prependMw,
    baseMw,
    extMw,
    baseHandler,
  ]);
});

test("isLikelyMiddleware detects Express middleware arity", () => {
  assert.equal(isLikelyMiddleware((req, res, next) => next()), true);
  assert.equal(isLikelyMiddleware((req, res) => res.end()), false);
  assert.equal(isLikelyMiddleware("not a function"), false);
});
