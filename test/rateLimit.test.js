import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDeps } from "./helpers/fakes.js";

installFakeDeps();

const { createRateLimit } =
  await import("../src/extensions/user-management/middleware.extend.js");

function fakeReq(ip) {
  return { ip };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("rate limit rejects requests over the limit and resets after the window", async () => {
  const middleware = createRateLimit({ windowMs: 20, max: 2 });
  const req = fakeReq("203.0.113.10");
  const res = fakeRes();
  let nextCalls = 0;

  middleware(req, res, () => nextCalls++);
  middleware(req, res, () => nextCalls++);
  middleware(req, res, () => nextCalls++);

  assert.equal(nextCalls, 2);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "too many requests" });

  await new Promise((resolve) => setTimeout(resolve, 30));

  const resetRes = fakeRes();
  middleware(req, resetRes, () => nextCalls++);
  assert.equal(nextCalls, 3);
  assert.equal(resetRes.statusCode, 200);
});
