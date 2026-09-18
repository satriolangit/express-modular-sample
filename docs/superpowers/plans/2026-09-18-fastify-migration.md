# Migrasi Express → Fastify (base-api + extension-api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti Express dengan Fastify v5 secara idiomatik (`request/reply`, `preHandler`) di `base-api` + `extension-api` pada Node 22, tanpa mengubah mekanisme komposisi base+extension (collector, merge modes, discovery, WS, NATS, scheduler).

**Architecture:**
- `routeCollector` + `mergeRoutes` + `discover` dipertahankan (framework-agnostic). Yang berubah: `mountFeature` memetakan hasil merge → `fastify.route({ method, url, preHandler, handler })` di dalam plugin ber-prefix.
- Bootstrap dipecah: `src/app.js` (`createApp`) untuk hooks/health/error handling + testable via `app.inject()`, `index.js` untuk infra + listen + graceful shutdown.
- `ws.js` tetap custom (registry channel, heartbeat, broadcast), di-attach ke `fastify.server` — bukan `@fastify/websocket`.
- Handler/middleware ditulis ulang ke signature Fastify. Kontrak extension (`module.exports = (r) => { r.get(path, ...preHandlers, handler) }`) dan merge modes (`prepend`, `mergeMiddleware`) tidak berubah.

**Tech Stack:** Node 22, Fastify 5.12.5, `@fastify/formbody` 9.x, `qs` 6.x, `node:test` + `app.inject()` (tanpa Jest), winston/pg/nats/node-cron/ws tetap.

## Global Constraints

- Node `>=22` (`engines`), Fastify `^5.12.5`; **Express dihapus total** dari `package.base.json` dan seluruh source.
- Kontrak extension tetap: `module.exports = (r) => { r.get(path, ...preHandlers, handler) }`; merge modes `prepend` / `mergeMiddleware` / overwrite / new tidak berubah.
- Handler dan middleware Fastify-style: `async (request, reply)`, respons via `return reply.code(n).send(body)`. Tidak ada `next()`.
- Tidak ada dependency runtime baru selain `fastify`, `@fastify/formbody`, `qs`. Pino tidak dipakai (`logger: false`); logging tetap Winston.
- Fastify v5: opsi router (`ignoreTrailingSlash`, `querystringParser`) lewat `routerOptions`; `requestIdHeader` default `false`; `bodyLimit` default 1 MiB.
- Upgraded (WebSocket) sockets tidak ditrack HTTP server dan membuat `server.close()` menggantung → **wajib** ditutup di hook `preClose` sebelum close selesai.
- Test memakai `node:test` + `app.inject()`; `npm test` mengasumsikan `src/extensions/` sudah ter-copy — jalankan `npm run poc:copy` dulu (extension gitignored, test extension butuh `uuid`).
- Commit per task. `package.json`, `package-lock.json`, `src/extensions/` tetap gitignored (jangan commit).
- Sebelum mengedit simbol: jalankan `gitnexus_impact` (AGENTS.md). Sebelum commit: `gitnexus_detect_changes` di `base-api`.

**Dua repo:**
- `base-api` — https://…/base-api (git repo, branch saat ini `feature/manageDependencies`, working tree kotor).
- `extension-api` — https://…/extension-api (git repo, branch saat ini `feature/manageDependenxies`, working tree kotor).

---

## Task 1: Preflight & Dependencies

**Files:**
- Modify: `base-api/package.base.json`
- Tidak berubah: `extension-api/package.json` (tidak butuh fastify; hanya `uuid`)

**Interfaces:**
- Produces: `fastify@^5.12.5`, `@fastify/formbody@^9.0.0`, `qs@^6.13.0` terpasang di `base-api/node_modules`; `engines.node >= 22`; script `test` + `test:ws`.

- [ ] **Step 1: Konfirmasi WIP ke user, lalu buat branch di kedua repo**

```bash
# base-api
git switch -c feature/fastify-migration
# extension-api
git switch -c feature/fastify-migration
```

Catatan: working tree kotor; bawa perubahan yang ada ke branch baru ATAU commit/stash dulu sesuai keputusan user. Jangan hapus pekerjaan user.

- [ ] **Step 2: Update `package.base.json`**

Ganti seluruh isi menjadi:

```json
{
  "name": "base-api",
  "version": "1.0.0",
  "main": "index.js",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node index.js",
    "merge:ext": "node scripts/merge-package.js",
    "merge:ext:dry": "node scripts/merge-package.js --dry-run",
    "poc:copy": "node scripts/copy-extensions.js",
    "test": "node --test test/",
    "test:ws": "node scripts/ws-smoke.js"
  },
  "dependencies": {
    "@fastify/formbody": "^9.0.0",
    "dotenv": "^17.4.2",
    "fastify": "^5.12.5",
    "nats": "^2.28.2",
    "node-cron": "^3.0.3",
    "pg": "^8.11.5",
    "qs": "^6.13.0",
    "winston": "^3.13.0",
    "ws": "^8.17.0"
  }
}
```

- [ ] **Step 3: Regenerate & install**

Run:
```bash
npm run poc:copy
npm run merge:ext
npm install
```
Expected: `package.json` berisi dependencies di atas (tanpa `express`), `uuid` dari extension tetap ikut.

- [ ] **Step 4: Verifikasi dependency**

Run:
```bash
node -e "console.log(require('fastify/package.json').version)"
node -e "require('@fastify/formbody'); require('qs'); console.log('ok')"
```
Expected: `5.12.5` dan `ok`.

- [ ] **Step 5: Commit**

```bash
git add package.base.json
git commit -m "chore: swap express for fastify v5 deps, node >=22, add test scripts"
```

---

## Task 2: `createApp` Factory (TDD)

**Files:**
- Create: `base-api/src/app.js`
- Create: `base-api/test/app.test.js`
- Create: `base-api/test/helpers/buildTestApp.js`

**Interfaces:**
- Produces: `createApp({ config, logger, deps, fastifyOptions? }) → FastifyInstance`. Instance memiliki: `/health`, `setNotFoundHandler` JSON `{ error: "not found" }`, `setErrorHandler` JSON `{ error: message }`, hook `onRequest` (header `x-request-id`), hook `onResponse` (access log Winston), hook `preClose` (`await deps.ws.close()`).
- Produces: `installFakeDeps(overrides?) → deps` (mengisi singleton `src/libs/deps`), `buildTestApp() → app` (discover + mount semua feature/extension).
- Consumes: `src/libs/deps.js` (singleton), `src/libs/bootstrap/discover.js`, `src/libs/mountFeature.js` (Task 3, masih versi Express sampai Task 3 selesai — test Task 2 tidak memanggil `buildTestApp`).

- [ ] **Step 1: Write the failing test**

`base-api/test/app.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { installFakeDeps } = require("./helpers/buildTestApp");

test("GET /health returns 200 with checks", async () => {
  const deps = installFakeDeps();
  const app = createApp({ config: deps.config, logger: deps.logger, deps });
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().checks, { pg: true, nats: true, ws: true });
  await app.close();
});

test("GET /health returns 503 when a dependency is down", async () => {
  const deps = installFakeDeps();
  deps.db.healthCheck = async () => false;
  const app = createApp({ config: deps.config, logger: deps.logger, deps });
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().ok, false);
  await app.close();
});

test("echoes incoming x-request-id and generates one when absent", async () => {
  const deps = installFakeDeps();
  const app = createApp({ config: deps.config, logger: deps.logger, deps });

  let res = await app.inject({
    method: "GET",
    url: "/health",
    headers: { "x-request-id": "abc-123" },
  });
  assert.equal(res.headers["x-request-id"], "abc-123");

  res = await app.inject({ method: "GET", url: "/health" });
  assert.match(res.headers["x-request-id"], /^\d+-[a-z0-9]+$/);

  await app.close();
});

test("trailing slash matches the same route", async () => {
  const deps = installFakeDeps();
  const app = createApp({ config: deps.config, logger: deps.logger, deps });
  const res = await app.inject({ method: "GET", url: "/health/" });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test("unknown route returns JSON 404", async () => {
  const deps = installFakeDeps();
  const app = createApp({ config: deps.config, logger: deps.logger, deps });
  const res = await app.inject({ method: "GET", url: "/nope" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "not found" });
  await app.close();
});

test("urlencoded body is parsed (formbody parity)", async () => {
  const deps = installFakeDeps();
  const app = createApp({ config: deps.config, logger: deps.logger, deps });
  app.post("/echo-form", async (request, reply) =>
    reply.send({ body: request.body })
  );
  const res = await app.inject({
    method: "POST",
    url: "/echo-form",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "a=1&b=two",
  });
  assert.deepEqual(res.json(), { body: { a: "1", b: "two" } });
  await app.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/app.test.js`
Expected: FAIL — `Cannot find module '../src/app'`.

- [ ] **Step 3: Create test helper**

`base-api/test/helpers/buildTestApp.js`:

```js
const path = require("path");
const { createApp } = require("../../src/app");
const { discover } = require("../../src/libs/bootstrap/discover");
const { mountFeature } = require("../../src/libs/mountFeature");

const ROOT = path.join(__dirname, "..", "..");

function fakeLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
    child() {
      return this;
    },
  };
}

function fakeDb() {
  const query = async (sql) => {
    if (/app_user_role/.test(sql)) return { rows: [{ id: 1, name: "admin" }], rowCount: 1 };
    if (/FROM app_user\b/.test(sql)) return { rows: [{ id: 1, name: "Alice" }], rowCount: 1 };
    if (/FROM app_role\b/.test(sql)) return { rows: [{ id: 1, name: "admin" }], rowCount: 1 };
    if (/FROM products\b/.test(sql)) return { rows: [{ id: 1, name: "Product 1" }], rowCount: 1 };
    if (/FROM policies\b/.test(sql)) return { rows: [{ id: 1, title: "Policy 1" }], rowCount: 1 };
    if (/FROM audit_logs\b/.test(sql)) return { rows: [{ id: "a1", user_id: 1 }], rowCount: 1 };
    if (/INSERT INTO audit_logs/.test(sql)) return { rows: [{ id: "a1", user_id: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return {
    query,
    async tx(fn) {
      return fn({ query });
    },
    async healthCheck() {
      return true;
    },
    async close() {},
    getPool() {
      return null;
    },
  };
}

function fakeNats() {
  return {
    isAvailable: () => true,
    get: () => ({ sc: { decode: (d) => d } }),
    publish: () => true,
    jsPublish: async () => ({ seq: 1 }),
    subscribeJson: () => ({
      async *[Symbol.asyncIterator]() {},
      unsubscribe() {},
    }),
    consume: async () => ({
      consume: async () => ({ async *[Symbol.asyncIterator]() {} }),
    }),
    onConnected() {},
    onLost() {},
    onReconnected() {},
    healthCheck: () => true,
    close: async () => {},
  };
}

function fakeWs() {
  return {
    init() {},
    register() {},
    broadcast: () => 0,
    listChannels: () => [],
    get: () => null,
    healthCheck: async () => true,
    close: async () => {},
  };
}

function fakeScheduler() {
  return {
    register() {},
    startAll() {},
    stopAll: async () => {},
    destroyAll() {},
    trigger: async () => {},
    list: () => [],
  };
}

/**
 * Populate the REAL deps singleton (`src/libs/deps`) because feature/service/
 * middleware modules destructure `{ db, logger }` at require time.
 * Must be called BEFORE discover()/require of route modules.
 */
function installFakeDeps(overrides = {}) {
  const deps = require("../../src/libs/deps");
  Object.assign(deps, {
    config: { http: { port: 0 }, ws: {}, scheduler: {} },
    logger: fakeLogger(),
    db: fakeDb(),
    nats: fakeNats(),
    ws: fakeWs(),
    scheduler: fakeScheduler(),
    http: null,
    ...overrides,
  });
  return deps;
}

function buildTestApp() {
  const deps = installFakeDeps();
  const app = createApp({ config: deps.config, logger: deps.logger, deps });
  deps.http = app.server;
  const features = discover(
    path.join(ROOT, "src", "features"),
    path.join(ROOT, "src", "extensions")
  );
  for (const feature of features.values()) mountFeature(app, feature);
  return app;
}

module.exports = {
  buildTestApp,
  installFakeDeps,
  fakeLogger,
  fakeDb,
  fakeNats,
  fakeWs,
  fakeScheduler,
  ROOT,
};
```

- [ ] **Step 4: Create `src/app.js`**

```js
const Fastify = require("fastify");
const formbody = require("@fastify/formbody");
const qs = require("qs");

function genReqId(req) {
  return (
    req.headers["x-request-id"] ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function createApp({ config, logger, deps, fastifyOptions = {} }) {
  const app = Fastify({
    logger: false,
    requestIdHeader: "x-request-id",
    genReqId,
    bodyLimit: 1024 * 1024,
    routerOptions: {
      ignoreTrailingSlash: true,
      querystringParser: (str) => qs.parse(str),
    },
    ...fastifyOptions,
  });

  app.register(formbody);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    logger.info("http", {
      reqId: request.id,
      method: request.method,
      path: request.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: "not found" });
  });

  app.setErrorHandler((err, request, reply) => {
    logger.error("unhandled error", {
      reqId: request.id,
      error: err.message,
      stack: err.stack,
    });
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  // WebSocket clients must be closed BEFORE server.close() completes:
  // upgraded sockets are not tracked by the HTTP server and would hang it.
  app.addHook("preClose", async () => {
    if (deps.ws?.close) await deps.ws.close();
  });

  app.get("/health", async (request, reply) => {
    const checks = { pg: false, nats: false, ws: false };
    try {
      checks.pg = await deps.db.healthCheck();
    } catch {}
    try {
      checks.nats = await deps.nats.healthCheck();
    } catch {}
    try {
      checks.ws = await deps.ws.healthCheck();
    } catch {}

    const ok = checks.pg && checks.nats;
    return reply.code(ok ? 200 : 503).send({
      ok,
      uptimeSec: Math.floor(process.uptime()),
      checks,
    });
  });

  return app;
}

module.exports = { createApp, genReqId };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/app.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app.js test/app.test.js test/helpers/buildTestApp.js
git commit -m "feat: add fastify app factory with hooks, health, error handling"
```

---

## Task 3: `mountFeature` → Fastify Plugin (TDD)

**Files:**
- Modify: `base-api/src/libs/mountFeature.js` (rewrite seluruh isi)
- Create: `base-api/test/mountFeature.test.js`

**Interfaces:**
- Consumes: `createRouter` (`src/libs/routeCollector.js`), `mergeRoutes` (`src/libs/mergeRoutes.js`) — **tidak diubah**.
- Produces: `mountFeature(app, { name, prefix, routeGroups }) → void`; mendaftarkan plugin ber-prefix ke Fastify. Setiap route hasil merge: elemen terakhir `handlers` → `handler`, sisanya → `preHandler` array; `method: "all"` → `instance.all(url, { preHandler }, handler)`.

- [ ] **Step 1: Write the failing test**

`base-api/test/mountFeature.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { mountFeature } = require("../src/libs/mountFeature");

function fixtureFeature() {
  return {
    name: "fixture",
    prefix: "/f",
    routeGroups: [
      {
        groupName: "base",
        baseRegister: (r) => {
          r.get("/plain", async (request, reply) => reply.send({ who: "base" }));
          r.get("/prepended", async (request, reply) =>
            reply.send({ who: "base", order: request.order ?? [] })
          );
          r.get(
            "/merged",
            async (request) => {
              request.order = ["base-mw"];
            },
            async (request, reply) => reply.send({ order: request.order })
          );
        },
        extendRegister: (r) => {
          r.get("/plain", async (request, reply) => reply.send({ who: "ext" }));
          r.get("/prepended", {
            prepend: [
              async (request) => {
                request.order = ["ext-pre"];
              },
            ],
          });
          r.get(
            "/merged",
            {
              prepend: [
                async (request) => {
                  request.order = ["ext-pre"];
                },
              ],
              mergeMiddleware: true,
            },
            async (request) => {
              request.order.push("ext-mw");
            },
            async (request, reply) => reply.send({ order: request.order })
          );
          r.get("/brand-new", async (request, reply) =>
            reply.send({ who: "ext-new" })
          );
        },
      },
    ],
  };
}

test("overwrite mode replaces base handler", async () => {
  const app = Fastify({ logger: false });
  mountFeature(app, fixtureFeature());
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/f/plain" });
  assert.deepEqual(res.json(), { who: "ext" });
  await app.close();
});

test("prepend mode keeps base handler and runs ext mw first", async () => {
  const app = Fastify({ logger: false });
  mountFeature(app, fixtureFeature());
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/f/prepended" });
  assert.deepEqual(res.json(), { who: "base", order: ["ext-pre"] });
  await app.close();
});

test("merge middleware mode composes pre + base + ext in order", async () => {
  const app = Fastify({ logger: false });
  mountFeature(app, fixtureFeature());
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/f/merged" });
  assert.deepEqual(res.json(), { order: ["ext-pre", "base-mw", "ext-mw"] });
  await app.close();
});

test("new extension route is mounted", async () => {
  const app = Fastify({ logger: false });
  mountFeature(app, fixtureFeature());
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/f/brand-new" });
  assert.deepEqual(res.json(), { who: "ext-new" });
  await app.close();
});

test("duplicate route registration throws", async () => {
  const app = Fastify({ logger: false });
  mountFeature(app, fixtureFeature());
  const feature = fixtureFeature();
  mountFeature(app, feature); // same prefix + same paths
  await assert.rejects(() => app.ready(), /already declared|DUPLICATED/i);
  await app.close().catch(() => {});
});
```

Catatan: test terakhir memverifikasi perilaku Fastify `FST_ERR_DUPLICATED_ROUTE` (Express diam-diam first-wins). Merge registry mencegah duplikasi **di dalam** satu group; duplikasi antar-group/antar-feature dengan prefix sama akan throw — ini disengaja dan harus didokumentasikan (Task 9).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mountFeature.test.js`
Expected: FAIL — route 404 / mount tidak terjadi (mountFeature masih `express.Router()`).

- [ ] **Step 3: Rewrite `src/libs/mountFeature.js`**

```js
const { createRouter } = require("./routeCollector");
const { mergeRoutes } = require("./mergeRoutes");

function registerRoutes(instance, { name, prefix, routeGroups }) {
  let total = 0;

  console.log(`  Feature: ${name}  →  ${prefix}`);

  for (const { groupName, baseRegister, extendRegister } of routeGroups) {
    const baseCollector = createRouter();
    baseRegister?.(baseCollector);

    const extCollector = createRouter();
    extendRegister?.(extCollector);

    const merged = mergeRoutes({
      base: baseCollector.__routes,
      extend: extCollector.__routes,
    });

    if (merged.length === 0) continue;

    console.log(`    [${groupName}]`);

    for (const rt of merged) {
      if (rt.handlers.length === 0) continue;

      const handler = rt.handlers[rt.handlers.length - 1];
      const preHandler = rt.handlers.slice(0, -1);
      const url = rt.path || "/";
      const mode = rt.opts?._mode ? ` [${rt.opts._mode}]` : "";

      if (rt.method === "all") {
        instance.all(url, { preHandler }, handler);
      } else {
        instance.route({
          method: rt.method.toUpperCase(),
          url,
          preHandler,
          handler,
        });
      }

      const shownPath = `${prefix}${url === "/" ? "" : url}`;
      console.log(`      ${rt.method.toUpperCase().padEnd(7)} ${shownPath}${mode}`);

      total++;
    }
  }

  console.log(`  ✓ ${total} routes mounted\n`);
}

function mountFeature(app, feature) {
  app.register(
    async (instance) => {
      registerRoutes(instance, feature);
    },
    { prefix: feature.prefix }
  );
}

module.exports = { mountFeature };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mountFeature.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/libs/mountFeature.js test/mountFeature.test.js
git commit -m "refactor: mount merged routes as encapsulated fastify plugin"
```

---

## Task 4: Companion Fixes — Data Layer (pre-existing bugs, blocker verifikasi)

Bug ini **bukan** akibat migrasi Fastify, tapi membuat semua endpoint berbasis PG gagal (pg tidak mendukung `?`; `pg.Result` tidak bisa didestruktur sebagai array; `db.insert` tidak ada). Tanpa fix ini, test integrasi Task 5/6 tidak bisa hijau dan verifikasi manual tidak bermakna.

**Files:**
- Modify: `base-api/src/features/user-management/repositories/repo.user.js`
- Modify: `base-api/src/features/user-management/repositories/repo.role.js`
- Modify: `base-api/src/features/product-management/repositories/repo.product.js`
- Modify: `base-api/src/features/product-management/services/service.policy.js`
- Modify: `base-api/src/extensions/audit-user/repositories/repo.audit.js` (dan salinan identik di `extension-api/src/audit-user/repositories/repo.audit.js`)
- Modify: `base-api/src/extensions/audit-user/index.js` (hapus referensi `rowCount` undefined)
- Create: `base-api/test/repositories.test.js`

**Interfaces:**
- Produces: repo/service mengembalikan object/array baris (bukan `pg.Result`); semua SQL memakai placeholder `$1, $2`; `repo.audit.insert(row)` melakukan `INSERT ... RETURNING *`.

- [ ] **Step 1: Write the failing test**

`base-api/test/repositories.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { installFakeDeps } = require("./helpers/buildTestApp");

test("repositories use pg placeholders and extract rows", async () => {
  const calls = [];
  installFakeDeps({
    db: {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ id: 1, name: "Alice" }], rowCount: 1 };
      },
      async tx(fn) {
        return fn({ query: this.query });
      },
      async healthCheck() {
        return true;
      },
      async close() {},
    },
  });

  const repoUser = require("../src/features/user-management/repositories/repo.user");
  const repoRole = require("../src/features/user-management/repositories/repo.role");
  const repoProduct = require("../src/features/product-management/repositories/repo.product");
  const repoAudit = require("../src/extensions/audit-user/repositories/repo.audit");
  const servicePolicy = require("../src/features/product-management/services/service.policy");

  assert.deepEqual(await repoUser.findById(1), { id: 1, name: "Alice" });
  const byId = calls.find((c) => /FROM app_user\b[\s\S]*WHERE id/.test(c.sql));
  assert.match(byId.sql, /\$1/);
  assert.doesNotMatch(byId.sql, /\?/);
  assert.deepEqual(byId.params, [1]);

  assert.deepEqual(await repoUser.findAll(), [{ id: 1, name: "Alice" }]);
  assert.deepEqual(await repoRole.findAll(), [{ id: 1, name: "Alice" }]);
  assert.deepEqual(await repoRole.findByUserId(1), [{ id: 1, name: "Alice" }]);
  assert.deepEqual(await repoProduct.findAll(), [{ id: 1, name: "Alice" }]);
  assert.deepEqual(await repoProduct.findById(1), { id: 1, name: "Alice" });
  assert.deepEqual(await repoAudit.findByUser(1), [{ id: 1, name: "Alice" }]);
  assert.deepEqual(await repoAudit.findAll(), [{ id: 1, name: "Alice" }]);
  assert.deepEqual(await servicePolicy.get(1), { id: 1, name: "Alice" });
  assert.deepEqual(await servicePolicy.list(), [{ id: 1, name: "Alice" }]);

  await repoAudit.insert({ id: "a1", user_id: 1 });
  const insert = calls.find((c) => /INSERT INTO audit_logs/.test(c.sql));
  assert.match(insert.sql, /VALUES \(\$1, \$2\)/);
  assert.deepEqual(insert.params, ["a1", 1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/repositories.test.js`
Expected: FAIL — `repoUser.findById` melempar `TypeError: ... is not iterable` / SQL memakai `?` / `db.insert is not a function`.

- [ ] **Step 3: Fix repositories & service**

`repo.user.js`:

```js
const { db } = require("../../../libs/deps");

module.exports = {
  async findById(id) {
    const { rows } = await db.query("SELECT * FROM app_user WHERE id = $1", [id]);
    return rows[0] ?? null;
  },
  async findAll() {
    const { rows } = await db.query("SELECT * FROM app_user");
    return rows;
  },
};
```

`repo.role.js`:

```js
const { db } = require("../../../libs/deps");

module.exports = {
  async findByUserId(userId) {
    const { rows } = await db.query(
      `select *
from app_user_role aur left join app_role ar on aur.role_id = ar.id
where aur.user_id = $1`,
      [userId]
    );
    return rows;
  },
  async findAll() {
    const { rows } = await db.query("select * from app_role");
    return rows;
  },
};
```

`repo.product.js`:

```js
const { db } = require("../../../libs/deps");

module.exports = {
  async findById(id) {
    const { rows } = await db.query("SELECT * FROM products WHERE id = $1", [id]);
    return rows[0] ?? null;
  },
  async findAll() {
    const { rows } = await db.query("SELECT * FROM products");
    return rows;
  },
};
```

`service.policy.js`:

```js
const { db } = require("../../../libs/deps");

async function get(id) {
  const { rows } = await db.query("SELECT * FROM policies WHERE id = $1", [
    Number(id),
  ]);
  if (!rows[0]) throw new Error("Policy not found");
  return rows[0];
}

async function list() {
  const { rows } = await db.query("SELECT * FROM policies");
  return rows;
}

module.exports = { get, list };
```

`repo.audit.js` (sama untuk `base-api/src/extensions/...` dan `extension-api/src/...`):

```js
const { db } = require("../../../libs/deps");

module.exports = {
  async findByUser(userId) {
    const { rows } = await db.query(
      "SELECT * FROM audit_logs WHERE user_id = $1",
      [userId]
    );
    return rows;
  },
  async findAll() {
    const { rows } = await db.query("SELECT * FROM audit_logs");
    return rows;
  },
  async insert(row) {
    const cols = Object.keys(row);
    const values = Object.values(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await db.query(
      `INSERT INTO audit_logs (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return rows[0];
  },
};
```

`src/extensions/audit-user/index.js` — ganti handler scheduler:

```js
  initScheduler(scheduler, logger) {
    scheduler.register({
      name: "audit-user:flush-buffer",
      schedule: "*/5 * * * *",
      owner: "audit-user",
      handler: () => {
        logger.info("[audit-user] flushed buffer");
      },
    });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/repositories.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features src/extensions test/repositories.test.js
git commit -m "fix: pre-existing pg data-layer bugs (placeholders, rows extraction, missing insert)"
```

Catatan: sinkronkan `extension-api/src/audit-user/repositories/repo.audit.js` saat Task 6 dan commit di repo extension.

---

## Task 5: Rewrite Base Feature Routes (4 file)

**Files:**
- Modify: `base-api/src/features/user-management/routes/route.user.js`
- Modify: `base-api/src/features/user-management/routes/route.role.js`
- Modify: `base-api/src/features/product-management/routes/route.product.js`
- Modify: `base-api/src/features/product-management/routes/route.policy.js`
- Create: `base-api/test/features.routes.test.js`

**Interfaces:**
- Consumes: `buildTestApp()` (Task 2/3), fake deps (Task 2), repo fixes (Task 4).
- Produces: handler Fastify `async (request, reply)` untuk seluruh endpoint base; `request.params`/`request.query`/`request.body`; error mapping tetap `{ error: e.message }`.

- [ ] **Step 1: Write the failing test**

`base-api/test/features.routes.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTestApp } = require("./helpers/buildTestApp");

test("base feature routes respond via fastify", async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  let res = await app.inject({ method: "GET", url: "/users" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), [{ id: 1, name: "Alice" }]);

  res = await app.inject({ method: "GET", url: "/users/1" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: "/users/roles" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: "/products" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: "/products/1" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: "/products/policies" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: "/policies" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: "/policies/1" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: "/users/" });
  assert.equal(res.statusCode, 200, "trailing slash must match");

  res = await app.inject({ method: "GET", url: "/nope" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "not found" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/features.routes.test.js`
Expected: FAIL — handler masih `(req, res)` Express; `res.json is not a function` → 500.

- [ ] **Step 3: Rewrite route files**

`route.user.js`:

```js
const userService = require("../services/service.user");

module.exports = function registerUser(r) {
  r.get("/", async (request, reply) => {
    return reply.send(await userService.listUsers());
  });

  r.get("/:id", async (request, reply) => {
    try {
      return reply.send(await userService.getUser(request.params.id));
    } catch (e) {
      return reply.code(404).send({ error: e.message });
    }
  });
};
```

`route.role.js`:

```js
const roleService = require("../services/service.role");

module.exports = function registerRole(r) {
  r.get("/roles", async (request, reply) => {
    return reply.send(await roleService.listRoles());
  });
};
```

`route.product.js`:

```js
const productService = require("../services/service.product");

module.exports = function registerProduct(r) {
  r.get("/", async (request, reply) => {
    return reply.send(await productService.list());
  });

  r.get("/:id", async (request, reply) => {
    try {
      return reply.send(await productService.get(request.params.id));
    } catch (e) {
      return reply.code(404).send({ error: e.message });
    }
  });
};
```

`route.policy.js`:

```js
const policyService = require("../services/service.policy");

module.exports = function registerPolicy(r) {
  r.get("/policies", async (request, reply) => {
    return reply.send(await policyService.list());
  });

  r.get("/policies/:id", async (request, reply) => {
    try {
      return reply.send(await policyService.get(request.params.id));
    } catch (e) {
      return reply.code(404).send({ error: e.message });
    }
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/features.routes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features test/features.routes.test.js
git commit -m "refactor: rewrite base feature routes to fastify request/reply"
```

---

## Task 6: Rewrite Extension (extension-api) + Sync

**Files (extension-api):**
- Modify: `extension-api/src/user-management/middleware.extend.js`
- Modify: `extension-api/src/user-management/route.user.extend.js`
- Modify: `extension-api/src/product-management/route.product.extend.js`
- Modify: `extension-api/src/product-management/route.policy.extend.js`
- Modify: `extension-api/src/audit-user/routes/route.audit.js`
- Modify: `extension-api/src/audit-user/repositories/repo.audit.js` (samakan dengan Task 4)

**Files (base-api):**
- Create: `base-api/test/extensions.routes.test.js`
- Regenerated: `base-api/src/extensions/**` (via `npm run poc:copy`)

**Interfaces:**
- Consumes: kontrak collector dari Task 3 (`preHandlers` + `handler`), fake deps Task 2.
- Produces: middleware async Fastify `(request, reply)`; `requireRole`/`rateLimit`/`validateBody` mengirim respons via `return reply.code(...).send(...)`; `auth` men-set `request.user`; `requestLogger` memakai `reply.raw.on("finish")`.

- [ ] **Step 1: Write the failing test (base-api)**

`base-api/test/extensions.routes.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTestApp } = require("./helpers/buildTestApp");

test("extension routes respond via fastify", async (t) => {
  const app = buildTestApp();
  t.after(() => app.close());

  let res = await app.inject({ method: "GET", url: "/users/1" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().enriched, true);

  res = await app.inject({ method: "DELETE", url: "/users/1" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { deleted: "1", by: "Catherine" });

  res = await app.inject({ method: "GET", url: "/products/1" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().source, "extension");

  res = await app.inject({
    method: "POST",
    url: "/products/policies",
    payload: { title: "x" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().body, { title: "x" });

  res = await app.inject({ method: "GET", url: "/audit/logs" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({ method: "GET", url: "/audit/users/1" });
  assert.equal(res.statusCode, 200);

  res = await app.inject({
    method: "POST",
    url: "/audit/log",
    payload: { action: "test" },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().id, "a1");

  res = await app.inject({
    method: "POST",
    url: "/audit/notify",
    payload: { text: "hi" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, sent: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run poc:copy && node --test test/extensions.routes.test.js`
Expected: FAIL — middleware extension masih `(req, res, next)`.

- [ ] **Step 3: Rewrite middleware & route extension (extension-api)**

`middleware.extend.js`:

```js
const { logger } = require("../../libs/deps");

module.exports = {
  // ── Auth ─────────────────────────────────────
  auth: async (request) => {
    // POC: hardcoded user. Real: verify JWT / session
    request.user = { id: 1, name: "Catherine", role: "admin" };
    logger.debug("[mw.auth] authenticated", request.user.id);
  },

  // ── Authorization ────────────────────────────
  requireRole: (role) => async (request, reply) => {
    if (request.user?.role !== role) {
      return reply.code(403).send({ error: "forbidden", need: role });
    }
  },

  // ── Logging ──────────────────────────────────
  requestLogger: async (request, reply) => {
    const start = Date.now();
    reply.raw.on("finish", () => {
      logger.info(
        `[mw.log] ${request.method} ${request.url} ` +
          `${reply.raw.statusCode} ${Date.now() - start}ms`
      );
    });
  },

  // ── Rate limit (fake, in-memory) ─────────────
  rateLimit: (() => {
    const hits = new Map();
    return async (request, reply) => {
      const key = request.ip;
      const now = Date.now();
      const windowMs = 60_000;
      const max = 100;

      const entry = hits.get(key) ?? { count: 0, reset: now + windowMs };
      if (now > entry.reset) {
        entry.count = 0;
        entry.reset = now + windowMs;
      }

      entry.count++;
      hits.set(key, entry);

      if (entry.count > max) {
        return reply.code(429).send({ error: "too many requests" });
      }
    };
  })(),

  // ── Validation ───────────────────────────────
  validateBody: (schema) => async (request, reply) => {
    // POC: very simple schema { fieldName: 'string'|'number' }
    for (const [field, type] of Object.entries(schema)) {
      if (typeof request.body?.[field] !== type) {
        return reply
          .code(400)
          .send({ error: `field "${field}" must be ${type}` });
      }
    }
  },
};
```

`route.user.extend.js`:

```js
const userServiceBase = require("../../features/user-management/services/service.user");
const helperService = require("./service.helper");
const mw = require("./middleware.extend");

module.exports = function extendUser(r) {
  // Replace GET /users/:id — auth + logger + rateLimit + handler baru
  r.get(
    "/:id",
    mw.auth,
    mw.requestLogger,
    mw.rateLimit,
    async (request, reply) => {
      try {
        const base = await userServiceBase.getUser(request.params.id);
        return reply.send(await helperService.enrich(base));
      } catch (e) {
        return reply.code(404).send({ error: e.message });
      }
    }
  );

  // Route baru — hanya auth + requireRole
  r.delete("/:id", mw.auth, mw.requireRole("admin"), async (request, reply) => {
    return reply.send({ deleted: request.params.id, by: request.user.name });
  });
};
```

`route.product.extend.js`:

```js
const productServiceBase = require("../../features/product-management/services/service.product");
const mw = require("../user-management/middleware.extend");

module.exports = function extendProduct(r) {
  // Replace GET /products/:id → dengan auth + tag source
  r.get("/:id", mw.auth, async (request, reply) => {
    try {
      const p = await productServiceBase.get(request.params.id);
      return reply.send({ ...p, source: "extension" });
    } catch (e) {
      return reply.code(404).send({ error: e.message });
    }
  });
};
```

`route.policy.extend.js`:

```js
const mw = require("../user-management/middleware.extend");

module.exports = function extendPolicy(r) {
  // Route baru: POST /products/policies
  r.post("/policies", mw.auth, async (request, reply) => {
    return reply.send({ created: true, body: request.body });
  });
};
```

`route.audit.js`:

```js
// extensions/audit-user/routes/route.audit.js
const service = require("../services/service.audit");
const { logger, nats, ws } = require("../../../libs/deps");

module.exports = function registerAudit(r) {
  // ─── GET /audit/logs ────────────────────────────────
  r.get("/logs", async (request, reply) => {
    try {
      const logs = await service.list(request.query);
      return reply.send(logs);
    } catch (err) {
      logger.error("list logs failed", { error: err.message });
      return reply.code(500).send({ error: "internal error" });
    }
  });

  // ─── GET /audit/users/:id ───────────────────────────
  r.get("/users/:id", async (request, reply) => {
    try {
      const logs = await service.byUser(Number(request.params.id));
      return reply.send(logs);
    } catch (err) {
      logger.error("byUser failed", { error: err.message });
      return reply.code(500).send({ error: "internal error" });
    }
  });

  // ─── POST /audit/log ────────────────────────────────
  // Record + publish NATS + broadcast WS
  r.post("/log", async (request, reply) => {
    try {
      const entry = await service.record(request.body);

      // NATS publish (safe — no-op kalau unavailable)
      await nats.jsPublish("audit.logged", entry);

      // WS broadcast ke semua client /ws/audit
      ws.broadcast("/ws/audit", { type: "audit", entry });

      return reply.code(201).send(entry);
    } catch (err) {
      logger.error("record failed", { error: err.message });
      return reply.code(400).send({ error: err.message });
    }
  });

  // ─── POST /audit/notify ─────────────────────────────
  // Admin trigger: kirim notifikasi WS ke semua client
  r.post("/notify", async (request, reply) => {
    const count = ws.broadcast("/ws/audit", {
      type: "notice",
      text: request.body.text ?? "",
      at: new Date().toISOString(),
    });
    return reply.send({ ok: true, sent: count });
  });
};
```

`repo.audit.js` — samakan dengan versi Task 4.

- [ ] **Step 4: Commit di extension-api, lalu sync ke base-api**

```bash
# extension-api
git add src
git commit -m "refactor: migrate extension routes/middleware to fastify"

# base-api
npm run poc:copy
git add src/extensions
git commit -m "chore: sync extensions for fastify migration"
```

Catatan: `src/extensions/` gitignored di base-api — commit ini hanya masuk bila `.gitignore` mengizinkan; jika tidak, langkah commit di base-api dilewati (file tetap ada di working tree untuk test).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/extensions.routes.test.js`
Expected: PASS.

---

## Task 7: Bootstrap `index.js` + WS + Graceful Shutdown

**Files:**
- Modify: `base-api/index.js` (rewrite)
- Modify: `base-api/src/libs/deps.js` (komentar)
- Create: `base-api/test/ws.integration.test.js`

**Interfaces:**
- Consumes: `createApp` (Task 2, sudah punya hook `preClose` → `deps.ws.close()`), `mountFeature` (Task 3), route/middleware baru (Task 5/6).
- Produces: `index.js` bootstrap: infra → `createApp` → `ws.init(app.server)` → deps (termasuk `http: app.server`) → init hooks → `scheduler.startAll()` → mount → `setupShutdown({ app, db, nats, logger, scheduler })` → `app.listen({ port, host: "0.0.0.0" })`.
- Produces: shutdown order — `app.close()` dipanggil (memicu `preClose` → WS ditutup), scheduler `stopAll` paralel, lalu `await closing` → `nats.close()` → `db.close()` → exit 0.

- [ ] **Step 1: Write the failing test**

`base-api/test/ws.integration.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { installFakeDeps } = require("./helpers/buildTestApp");
const { createApp } = require("../src/app");

test("ws upgrade works and app.close() completes with open client", async () => {
  const deps = installFakeDeps();
  const realWs = require("../src/libs/ws");
  deps.ws = realWs;

  const app = createApp({ config: deps.config, logger: deps.logger, deps });
  realWs.init(app.server);

  const feature = require("../src/features/user-management");
  await feature.init(deps);

  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address();

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws/users`);
  const welcome = await new Promise((resolve, reject) => {
    client.on("message", (raw) => resolve(JSON.parse(raw.toString())));
    client.on("error", reject);
  });
  assert.equal(welcome.type, "welcome");
  assert.equal(welcome.feature, "user-management");

  client.send(JSON.stringify({ hello: "world" }));
  const echo = await new Promise((resolve) =>
    client.on("message", (raw) => resolve(JSON.parse(raw.toString())))
  );
  assert.deepEqual(echo.echo, { hello: "world" });

  // Harus selesai cepat: preClose menutup upgraded socket sebelum server.close.
  const closed = app.close();
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("app.close() timed out")), 2000)
  );
  await Promise.race([closed, timeout]);
});
```

Catatan: test ini memakai `config`/`logger` real milik modul `ws.js`; output log Winston akan muncul. Jalankan dengan `LOG_LEVEL=error node --test test/` bila berisik.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ws.integration.test.js`
Expected: FAIL — `feature.init` memanggil `ws.register` OK, tapi `app.close()` menggantung (timeout 2s) ATAU welcome tidak diterima (tergantung status `index.js` lama tidak dipakai test; test ini bisa langsung hijau karena `createApp` sudah punya preClose + `ws.js` attach langsung). Bila sudah hijau sebelum `index.js` diubah, ini evidence bahwa komponen inti sudah benar — lanjut Step 3 untuk bootstrap.

- [ ] **Step 3: Rewrite `index.js`**

```js
require("dotenv").config();

const path = require("path");

async function main() {
  // ────────────────────────────────────────────────
  // CONFIG
  // ────────────────────────────────────────────────
  const config = require("./src/libs/config");

  // ────────────────────────────────────────────────
  // LOGGER (sync — Winston)
  // ────────────────────────────────────────────────
  const logger = require("./src/libs/logger");
  logger.info("bootstrap starting", {
    app: config.appName,
    env: config.env,
  });

  // ────────────────────────────────────────────────
  // NATS (async — must await connect)
  // ────────────────────────────────────────────────
  const nats = require("./src/libs/nats");
  try {
    await nats.init();
  } catch (err) {
    logger.error("nats required but unavailable", { error: err.message });
    process.exit(1);
  }

  if (!nats.isAvailable()) {
    logger.warn("continuing without NATS — some features may be degraded");
  }

  // ────────────────────────────────────────────────
  // POSTGRES (sync — Pool lazy connect)
  // ────────────────────────────────────────────────
  const db = require("./src/libs/db");
  db.getPool();

  try {
    const ok = await db.healthCheck();
    if (!ok) throw new Error("health check returned false");
    logger.info("postgres ready");
  } catch (err) {
    logger.error("postgres unreachable", { error: err.message });
    process.exit(1);
  }

  // ────────────────────────────────────────────────
  // FASTIFY APP
  // ────────────────────────────────────────────────
  const deps = require("./src/libs/deps");
  const { createApp } = require("./src/app");
  const app = createApp({ config, logger, deps });

  // ────────────────────────────────────────────────
  // WEBSOCKET (attach ke fastify's http server)
  // ────────────────────────────────────────────────
  const ws = require("./src/libs/ws");
  ws.init(app.server);

  // ────────────────────────────────────────────────
  // SCHEDULER
  // ────────────────────────────────────────────────
  const scheduler = require("./src/libs/scheduler");

  // ────────────────────────────────────────────────
  // POPULATE DEPS
  // ────────────────────────────────────────────────
  Object.assign(deps, {
    config,
    logger,
    db,
    nats,
    ws,
    scheduler,
    http: app.server,
  });

  logger.info("deps populated");

  nats.onLost((err) => {
    logger.warn("NATS connection lost — application in degraded mode", {
      error: err.message,
      impact: "NATS publish/subscribe disabled until reconnect",
    });
  });

  nats.onConnected(() => {
    logger.info("NATS connection ready");
  });

  nats.onReconnected(() => {
    logger.info("NATS reconnected via background retry");
  });

  // ────────────────────────────────────────────────
  // REGISTER GLOBAL SCHEDULED TASKS
  // ────────────────────────────────────────────────
  scheduler.register({
    name: "global:health-check",
    schedule: "*/5 * * * *",
    owner: "app",
    handler: async () => {
      const ok = await db.healthCheck();
      if (!ok) logger.warn("[global] DB health check failed");
    },
  });

  // ────────────────────────────────────────────────
  // DISCOVER FEATURES
  // ────────────────────────────────────────────────
  const { discover } = require("./src/libs/bootstrap/discover");
  const { mountFeature } = require("./src/libs/mountFeature");

  const features = discover(
    path.join(__dirname, "src", "features"),
    path.join(__dirname, "src", "extensions")
  );

  logger.info(`discovered ${features.size} feature(s)`);

  // ────────────────────────────────────────────────
  // INIT HOOK (subscribe NATS, register WS)
  // ────────────────────────────────────────────────
  for (const feature of features.values()) {
    if (typeof feature.index?.init === "function") {
      logger.info(`init feature: ${feature.name}`);
      try {
        await feature.index.init(deps);
      } catch (err) {
        logger.error(`init failed: ${feature.name}`, {
          error: err.message,
          stack: err.stack,
        });
        process.exit(1);
      }
    }

    if (typeof feature.extInit === "function") {
      logger.info(`init extension: ${feature.name}`);
      try {
        await feature.extInit(deps);
      } catch (err) {
        logger.error(`extension init failed: ${feature.name}`, {
          error: err.message,
          stack: err.stack,
        });
        process.exit(1);
      }
    }
  }

  // ────────────────────────────────────────────────
  // START SCHEDULED TASKS
  // ────────────────────────────────────────────────
  scheduler.startAll();

  // ────────────────────────────────────────────────
  // MOUNT ROUTES
  // ────────────────────────────────────────────────
  for (const feature of features.values()) {
    mountFeature(app, feature);
  }

  // ────────────────────────────────────────────────
  // GRACEFUL SHUTDOWN
  // ────────────────────────────────────────────────
  setupShutdown({ app, db, nats, logger, scheduler });

  // ────────────────────────────────────────────────
  // LISTEN
  // ────────────────────────────────────────────────
  await app.listen({ port: config.http.port, host: "0.0.0.0" });
  logger.info(`http://localhost:${config.http.port}`);
  logger.info("ws available on registered paths");
}

function setupShutdown({ app, db, nats, logger, scheduler }) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("shutdown initiated", { signal });

    const forceTimer = setTimeout(() => {
      logger.error("shutdown forced after 15s");
      process.exit(1);
    }, 15_000);
    forceTimer.unref();

    // HTTP + WS: createApp() memasang hook preClose yang menutup WS lebih dulu.
    // Tanpa itu, upgraded socket membuat server.close() menggantung.
    const closing = app.close();

    // Scheduler: stop new runs, wait in-flight
    try {
      await scheduler.stopAll({ waitMs: 10_000 });
      scheduler.destroyAll();
    } catch (err) {
      logger.error("scheduler close error", { error: err.message });
    }

    try {
      await closing;
      logger.info("http closed");
    } catch (err) {
      logger.error("http close error", { error: err.message });
    }

    // NATS: drain pending publish + unsubscribe
    try {
      await nats.close();
      logger.info("nats closed");
    } catch (err) {
      logger.error("nats close error", { error: err.message });
    }

    // Postgres: end pool
    try {
      await db.close();
      logger.info("pg closed");
    } catch (err) {
      logger.error("pg close error", { error: err.message });
    }

    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandledRejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on("uncaughtException", (err) => {
    logger.error("uncaughtException", { error: err.message, stack: err.stack });
    shutdown("uncaughtException");
  });
}

main().catch((err) => {
  console.error("bootstrap fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 4: Update komentar `src/libs/deps.js`**

```js
  http: null, // http.Server — fastify.server (attach/observability)
```

- [ ] **Step 5: Run seluruh test**

Run: `LOG_LEVEL=error npm test`
Expected: PASS semua (app, mountFeature, repositories, features, extensions, ws).

- [ ] **Step 6: Commit**

```bash
git add index.js src/libs/deps.js test/ws.integration.test.js
git commit -m "feat: fastify bootstrap with ws on app.server and preClose shutdown"
```

---

## Task 8: WS Smoke Script

**Files:**
- Create: `base-api/scripts/ws-smoke.js` (dirujuk dev-guide tetapi belum ada)

**Interfaces:**
- Consumes: server berjalan (`npm start`).
- Produces: script exit code 0 bila semua path tersambung; env `WS_BASE` (default `ws://localhost:3000`), `WS_PATHS` (default `/ws/users,/ws/users-ext,/ws/audit`).

- [ ] **Step 1: Create script**

```js
const WebSocket = require("ws");

const BASE = process.env.WS_BASE || "ws://localhost:3000";
const PATHS = (process.env.WS_PATHS || "/ws/users,/ws/users-ext,/ws/audit").split(
  ","
);

async function testPath(path) {
  return new Promise((resolve) => {
    const ws = new WebSocket(BASE + path);
    const result = { path, ok: false, messages: [], error: null };
    const timeout = setTimeout(() => {
      result.error = "timeout";
      ws.terminate();
      resolve(result);
    }, 5000);

    ws.on("open", () => {
      result.ok = true;
    });
    ws.on("message", (raw) => {
      result.messages.push(JSON.parse(raw.toString()));
      clearTimeout(timeout);
      ws.close();
      resolve(result);
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      result.error = err.message;
      resolve(result);
    });
  });
}

(async () => {
  let failed = 0;
  for (const path of PATHS) {
    const r = await testPath(path);
    console.log(
      `${r.ok ? "✓" : "✗"} ${path}  ${
        r.error ?? `${r.messages.length} message(s)`
      }`
    );
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
})();
```

- [ ] **Step 2: Verify against a live server**

Run:
```bash
docker compose up -d
npm start &
sleep 3
npm run test:ws
kill %1
```
Expected: tiga baris `✓`; exit code 0. (Bila PG/NATS tidak tersedia, server exit sebelum listen — jalankan `docker compose` dulu.)

- [ ] **Step 3: Commit**

```bash
git add scripts/ws-smoke.js
git commit -m "chore: add missing ws smoke script"
```

---

## Task 9: Docs — dev-guide v6.0

**Files:**
- Modify: `base-api/dev-guide.md`
- Modify (opsional, bila ada referensi): `base-api/run-poc.sh` (tidak ada perubahan express — verifikasi saja)

**Interfaces:**
- Produces: dev-guide yang konsisten dengan Fastify v5: tidak ada contoh `(req, res)`, `res.json`, `next()`, `express`, `httpServer.close()`.

- [ ] **Step 1: Update metadata**

- Header: `**Version**: 6.0`.
- Changelog tambah entri `**v6.0**` — migrasi Express → Fastify v5, Node ≥22, handler `(request, reply)`, middleware async preHandler, `src/app.js`, WS di `fastify.server`, shutdown `preClose`, `npm test` via `node:test`, `scripts/ws-smoke.js`, catatan FST_ERR_DUPLICATED_ROUTE.

- [ ] **Step 2: Update section per section**

| Section | Perubahan |
| --- | --- |
| §1 Architecture Overview | Diagram bootstrap: `express` → `fastify`; tambah catatan Node ≥22 + Fastify v5; `deps.http` = `fastify.server` |
| §2 Folder Structure | Tambah `src/app.js`, `test/`, `test/helpers/buildTestApp.js`, `scripts/ws-smoke.js` |
| §3 Setup & Run | Prasyarat Node ≥22; dependencies fastify/formbody/qs; `npm test` |
| §5 Development in Base-API | Semua template route → `async (request, reply)`, `reply.send` / `reply.code().send` |
| §6 Development in Extension-API | Semua template route → Fastify; `mw` tetap dipakai sebagai preHandler |
| §7 Route Merging Modes | Tambah catatan: `prepend`/`mergeMiddleware` tetap; handler terakhir → `handler`, sisanya → `preHandler`; jelaskan duplikasi route di Fastify throw (`FST_ERR_DUPLICATED_ROUTE`) |
| §8 Middleware | Rewrite: signature `async (request, reply)`; hapus `next()`; `req.originalUrl` → `request.url`; `res.on("finish")` → `reply.raw.on("finish")`; hapus klaim `r.use` (tidak diimplementasi collector) |
| §10 Dependency Injection & deps | Ganti kode bootstrap `express()` → `createApp()` + `ws.init(app.server)` + `app.listen()` |
| §12.5 Testing WebSocket | `app.get('/debug/ws', ...)` → style Fastify; `scripts/ws-smoke.js` sesuai Task 8 |
| §14.7 Debug Endpoint | Route debug scheduler → style Fastify |
| §16 CI/CD Flow | `node-version: "22"`; tambah `npm run poc:copy` sebelum `npm test` |
| §17 Graceful Shutdown | Urutan baru: `app.close()` (preClose menutup WS) → scheduler → NATS → PG; jelaskan kenapa WS harus di `preClose` |
| §18 Conventions | §18.2 signature route → Fastify handler; tabel anti-pattern diperbarui |
| §19 Troubleshooting | Tambah: (a) `FST_ERR_DUPLICATED_ROUTE`, (b) route trailing slash 404 bila `ignoreTrailingSlash` dimatikan, (c) `app.close()` menggantung karena WS client, (d) `Unsupported Media Type` untuk urlencoded (formbody), (e) `TypeError: ... is not iterable` pada repo lama (arahkan ke Task 4) |
| §20 Quick Reference | Semua template (route, extension route, feature init, extension init, extension-only init) → Fastify; tambah `npm test` |
| §8.4 / §12.5 / §14.7 | `httpServer` → `app.server`; `app.get` → `fastify.get` |

- [ ] **Step 3: Verifikasi tidak ada sisa Express**

Run:
```bash
rg -n "express|res\.(json|status|send|set)|next\(\)|httpServer\.close" dev-guide.md
```
Expected: hanya baris catatan migrasi/perbandingan (jika ada) — tidak ada contoh kode Express.

- [ ] **Step 4: Commit**

```bash
git add dev-guide.md
git commit -m "docs: dev-guide v6.0 for fastify migration"
```

---

## Task 10: Final Verification

**Files:** tidak ada file baru; perbaikan bila verifikasi menemukan masalah.

- [ ] **Step 1: Full test & dependency check**

Run:
```bash
npm run poc:copy
npm run merge:ext:dry
npm run merge:ext
npm install
LOG_LEVEL=error npm test
```
Expected: semua PASS; `package.json` tidak punya `express`.

- [ ] **Step 2: Tidak ada sisa Express di source**

Run:
```bash
rg -n "require\(['\"]express['\"]\)|express\.Router|express\.json|express\.urlencoded" --glob '!node_modules' --glob '!package-lock.json'
```
Expected: 0 match.

- [ ] **Step 3: Manual end-to-end**

Run:
```bash
docker compose up -d
npm start &
sleep 3
curl -s http://localhost:3000/health
curl -si http://localhost:3000/users | head -5
curl -s http://localhost:3000/users/
curl -s http://localhost:3000/users/1
curl -s http://localhost:3000/users/roles
curl -s http://localhost:3000/products
curl -s http://localhost:3000/products/1
curl -s -X POST http://localhost:3000/products/policies -H 'content-type: application/json' -d '{"title":"x"}'
curl -s http://localhost:3000/policies
curl -s http://localhost:3000/audit/logs
curl -s -X POST http://localhost:3000/audit/log -H 'content-type: application/json' -d '{"action":"test"}'
curl -s -X POST http://localhost:3000/audit/notify -H 'content-type: application/json' -d '{"text":"hi"}'
curl -si http://localhost:3000/nope | head -3
npm run test:ws
```
Expected:
- `/health` → 200 `{ ok: true, ... }`.
- Header `x-request-id` ada di response.
- `/users/` (trailing slash) → 200.
- `/nope` → 404 JSON `{ "error": "not found" }`.
- `npm run test:ws` → tiga `✓`.

- [ ] **Step 4: Graceful shutdown dengan WS client terbuka**

Run:
```bash
node -e "const WebSocket=require('ws');const c=new WebSocket('ws://localhost:3000/ws/users');c.on('message',()=>setTimeout(()=>{},60000))" &
node -e "setTimeout(()=>{},60000)" &  # placeholder; gunakan terminal kedua untuk wscat bila perlu
kill -TERM $(pgrep -f "node index.js")
```
Expected (log urut): `shutdown initiated` → `ws closed` → `http closed` → `...` → `nats closed` → `pg closed` → `shutdown complete`; proses keluar < 15s tanpa `shutdown forced`.

- [ ] **Step 5: GitNexus change detection**

Run (MCP tool, dari root repo base-api): `gitnexus_detect_changes()`
Expected: symbol yang berubah hanya seputar app/mountFeature/index/route/middleware yang direncanakan; tidak ada process tak terduga.

- [ ] **Step 6: Commit sisa perbaikan (bila ada)**

```bash
git add -A ':!package.json' ':!package-lock.json' ':!src/extensions'
git commit -m "chore: final fastify migration verification fixes"
```
(Atau commit spesifik per file yang diperbaiki.)

---

## Referensi Cepat — Perubahan Signature

| Express | Fastify |
| --- | --- |
| `(req, res) => {}` | `async (request, reply) => {}` |
| `res.json(x)` | `return reply.send(x)` |
| `res.status(404).json(x)` | `return reply.code(404).send(x)` |
| `res.set('X-Request-Id', v)` | `reply.header('x-request-id', v)` |
| `res.on('finish', fn)` | `reply.raw.on('finish', fn)` |
| `(req, res, next)` middleware | `async (request, reply)` preHandler; kirim respons = selesai, tidak ada `next()` |
| `req.params` / `req.query` / `req.body` | `request.params` / `request.query` / `request.body` |
| `req.ip` | `request.ip` |
| `req.originalUrl` | `request.url` |
| `req.socket` | `request.socket` |
| `httpServer` | `app.server` |
| `httpServer.close()` | `await app.close()` (+ `preClose` untuk WS) |
| `app.use(prefix, router)` | `app.register(plugin, { prefix })` |
| `express.json({ limit: '1mb' })` | `Fastify({ bodyLimit: 1024 * 1024 })` (default 1 MiB) |
| `express.urlencoded({ extended: true })` | `@fastify/formbody` |
| Query `qs` (extended) | `routerOptions.querystringParser: (str) => qs.parse(str)` |
| Trailing slash toleran | `routerOptions.ignoreTrailingSlash: true` |
| Duplikat route: first wins | **throw `FST_ERR_DUPLICATED_ROUTE`** |
| Error async tanpa catch: hang | 500 JSON otomatis |

---

## Self-Review Checklist (sudah dijalankan)

- **Spec coverage:** semua file ber-Express terpetakan — `index.js` (Task 7), `mountFeature.js` (Task 3), `routeCollector.js`/`mergeRoutes.js` sengaja tidak berubah, 4 route base (Task 5), 5 file extension (Task 6), `ws.js` (kompatibel, Task 7), `deps.js` (Task 7), `package.base.json` (Task 1), dev-guide (Task 9). Bug data-layer pemblokir diangkat eksplisit (Task 4).
- **Placeholder scan:** tidak ada TBD/TODO; semua langkah berisi kode/command aktual.
- **Type consistency:** `createApp({ config, logger, deps, fastifyOptions? })`, `mountFeature(app, feature)`, `installFakeDeps(overrides?)`, `buildTestApp()` konsisten antar task; mapping `preHandler` + `handler` konsisten antara Task 3 (mount) dan Task 5/6 (handler).

---

**Setelah plan disetujui — pilihan eksekusi:**

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development`; subagent baru per task + review dua tahap.
2. **Inline Execution** — `superpowers:executing-plans`; eksekusi batch dengan checkpoint review.
