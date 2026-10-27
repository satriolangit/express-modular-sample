# CONTRACT — Composition Rules for base-api & extension-api

> **Bahasa Indonesia: [CONTRACT.md](../CONTRACT.md) | English**

> **This document answers:** "What rules must not be broken?"
> To understand how the system works, read [ARCHITECTURE.md](./ARCHITECTURE.md).
> For a step-by-step tutorial, read [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md).

**Audience:** developers who know basic JavaScript + `async/await` and are new to this repo.

Every chapter contains: rules, ✅ examples, ❌ examples, and the **consequences of a violation**. This contract explains *why* code may or may not be written in a certain way — read it before changing anything in `src/`.

---

## Table of Contents

1. [Module Contract](#1-module-contract)
2. [Extension Contract](#2-extension-contract)
3. [Route Merge Contract](#3-route-merge-contract)
4. [deps Contract](#4-deps-contract)
5. [WebSocket Contract](#5-websocket-contract)
6. [NATS Contract](#6-nats-contract)
7. [Scheduler Contract](#7-scheduler-contract)
8. [Package Contract](#8-package-contract)
9. [Test Contract](#9-test-contract)
10. [Error Contract](#10-error-contract)

## Summary — If You Only Remember 10 Things

| # | Quick rules |
| --- | --- |
| 1 | All code is ESM (`import`/`export default`). No `require`/`module.exports`. |
| 2 | Module = a folder in `src/modules/<name>/` with `index.js` (`export default { prefix, init }`). |
| 3 | Route files are named `route.<group>.js`; extensions are named `route.<group>.extend.js`. |
| 4 | Never access `db`/`nats`/`ws`/`scheduler` at module top-level — only inside functions. |
| 5 | Never edit `src/extensions/` in base-api — it is generated output. Edit in the extension repo. |
| 6 | WS paths (`/ws/...`) and scheduler task names must be unique and namespaced per module. |
| 7 | Subscribe to NATS via the `onConnected` pattern + check `isAvailable()`; never at top-level. |
| 8 | `package.base.json` is the source of truth; `package.json` is generated. |
| 9 | `node scripts/copy-extensions.js` before `npm test` (tests need `src/extensions/`); on a fresh clone run the `node scripts/...` bootstrap first. |
| 10 | Static routes (`/roles`, `/policies`) must be evaluated before parameter routes (`/:id`). |

---

## 1. Module Contract

**Goal:** every module can be discovered (`discover`), initialized (`init`), and mounted (`mountModule`) without manual registration in a central file.

### Required structure

```text
src/modules/<module-name>/
├── index.js                      # REQUIRED — module metadata
├── routes/
│   ├── route.<group>.js          # one file per route group
│   └── route.<group>.js
├── services/
│   └── service.<x>.js
└── repositories/
    └── repo.<x>.js
```

### Rules

| Rule | Detail |
| --- | --- |
| Folder name | Lowercase, separated by `-` (`user-management`). This becomes the module name and the fallback prefix (`/user-management`). |
| `index.js` | `export default { prefix, init }`. `prefix` is a string starting with `/`. `init(deps)` is optional and may be async. |
| Route file | The name **must** follow the format `route.<group>.js`. `<group>` may only contain letters/numbers/`-`. |
| Route file contents | `export default function registerUser(r) { r.get(...), r.post(...), ... }` |
| Available methods | `get`, `post`, `put`, `patch`, `delete`, `all` (all lowercase) |
| Route path | Relative to the module prefix. `"/"` = prefix root; `"/:id"` = parameter; `"/roles"` = static. |
| Module system | Pure ESM. No `require`, `module.exports`, `__dirname`. |
| Infrastructure access | Via the `deps` param of `init`, or `import { db, logger } from "../../../libs/deps.js"` — used **inside a function**, not at top-level. |
| Validation | `discover()` rejects a `prefix` without `/`, a non-function `init`, and route files that do not export a default function. |

### ✅ Correct example

```js
// src/modules/user-management/index.js
export default {
  prefix: "/users",

  async init(deps) {
    const { logger } = deps;
    logger.info("[user-management] init");
    // register WS, subscribe NATS, scheduler — see the relevant contracts
  },
};
```

```js
// src/modules/user-management/routes/route.user.js
import userService from "../services/service.user.js";

export default function registerUser(r) {
  r.get("/", async (req, res) => {
    res.json(await userService.listUsers());
  });
}
```

### ❌ Wrong example

```js
// ❌ CommonJS — will not be loaded as ESM
module.exports = { prefix: "/users" };

// ❌ Filename not recognized by discover()
//    src/modules/user-management/routes/users.js

// ❌ Prefix without a leading slash
export default { prefix: "users" };

// ❌ Accessing db at top-level — evaluated before populate()
import { db } from "../../../libs/deps.js";
const pool = db.getPool();        // TypeError: Cannot read properties of null

// ❌ require in the middle of code
const uuid = require("uuid");
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| Route file not named `route.<group>.js` | The route is never found; a mysterious 404 appears |
| `require`/`module.exports` | Crash at boot: `require is not defined` / a module with no export |
| Prefix without `/` | Boot crash at `app.use()` |
| Accessing deps at top-level | `TypeError` null at boot — and it only surfaces in the module "lucky" enough to be evaluated too early |
| Folder name duplicated in the extension | Not an error — but the module and the extension are treated as one (merged) module. Make sure that is really what you want |

---

## 2. Extension Contract

**Goal:** an extension attaches to a core module without modifying that module's files, and survives when the extension is copied again.

### Two forms of extension

| Form | What it is for | Key files |
| --- | --- | --- |
| **Extend a core module** | Override/add routes, middleware, and helpers on an existing module | `route.<group>.extend.js`, `init.extend.js` |
| **Extension-only module** | A new module that exists only for a particular client | `index.js` + `routes/` (do not create `init.extend.js`) |

### Rules

| Rule | Detail |
| --- | --- |
| Where to write | Always in the **extension-api** repo. `base-api/src/extensions/` is a copy result (gitignored) — changes there will be lost. |
| Route file name | In the extension root it must be `route.<group>.extend.js`; `discover()` rejects `route.<group>.js` there. Extension-only modules use the `routes/route.<group>.js` subfolder. |
| Importing base libs | `../../libs/deps.js` (from the extension module's root folder); from the `routes/` or `services/` subfolder add one level: `../../../libs/deps.js` |
| Importing core module code | `../../modules/<module>/services/<file>.js` — reference the base code, do not copy it |
| Extension init hook | `init.extend.js` → `export default async function initXxx(deps) {}` |
| Module system | ESM; the extension's `package.json` must have `"type": "module"` |
| Additional dependencies | Declare them in the extension's `package.json` — they are merged automatically during `merge:ext` |

### ✅ Correct example

```js
// extension-api/src/user-management/route.user.extend.js
import userServiceBase from "../../modules/user-management/services/service.user.js";
import mw from "./middleware.extend.js";

export default function extendUser(r) {
  // Overwrite GET /users/:id — add auth + logger + rate limit
  r.get("/:id", mw.auth, mw.requestLogger, mw.rateLimit, async (req, res) => {
    try {
      res.json(await userServiceBase.getUser(req.params.id));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });
}
```

```js
// extension-api/src/user-management/init.extend.js
export default async function initUserExt(deps) {
  const { logger } = deps;
  logger.info("[user-management.ext] init");
  // subscribe NATS / register WS — see the respective contracts
}
```

### ❌ Wrong example

```js
// ❌ Import uses the old term/folder
import x from "../../features/user-management/services/service.user.js";

// ❌ require() in an extension
const uuid = require("uuid");

// ❌ Editing a copied file directly
//    base-api/src/extensions/user-management/route.user.extend.js

// ❌ init.extend.js in an extension-only module
//    extension-api/src/audit-user/init.extend.js
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| Editing in `src/extensions/` | Lost on the next `poc:copy` |
| Wrong import path | Boot crash when `discover()` loads the file — one wrong file and the whole application fails to start |
| `init.extend.js` in an extension-only module | `getExtInit` is still loaded and called; both `index.init` and `extInit` run — confusing and usually unwanted |
| Copying core module code instead of importing | Two sources of truth; bug fixes in the base are not carried over |

---

## 3. Route Merge Contract

**Goal:** merge core module and extension route definitions deterministically.

### Route identity

A route is identified by **`method + path`** (path relative to the module prefix):

```text
GET /:id        ← route.user.js (base)
GET /:id        ← route.user.extend.js (extension)   → MATCH → merged
DELETE /:id     ← route.user.extend.js               → no base → new route
GET /roles      ← route.role.js                      → no extension → left as-is
```

### Merge modes

| Extension condition | Mode | Final handler |
| --- | --- | --- |
| No options (default) | `overwrite` | Extension handler (base discarded entirely) |
| `{ prepend: [...] }` | `prepend` | `prepend → middlewareBase → handlerBase` |
| `{ mergeMiddleware: true }` | `merge` | `middlewareBase → middlewareExt → handler` |
| `{ mergeMiddleware: true, keepBaseHandler: true }` | `merge+keep` | `middlewareBase → middlewareExt → handlerBase` |
| `{ prepend: [...], mergeMiddleware: true }` | `prepend+merge` | `prepend → middlewareBase → middlewareExt → handler` |
| `{ prepend: [...], mergeMiddleware: true, keepBaseHandler: true }` | `prepend+merge+keep` | `prepend → middlewareBase → middlewareExt → handlerBase` |
| No matching base | `new` | The extension route as-is |

Notes:
- "Handler" = the **last** element of the handler list; the rest are treated as middleware.
- `overwrite` discards the base middleware. If the base middleware is still needed, use `prepend` (do not copy its code again).
- `mergeMiddleware` still treats the extension's last handler as terminal. If the extension contains only middleware, use `keepBaseHandler: true`; all extension handlers are treated as middleware and the base handler is kept.

### Route ordering rule

Express matches routes **in order** and stops at the first match. However, `mountModule` now **sorts the final routes deterministically** before mounting: static segments first, then parameters, wildcards, and method `all` last. File/group read order no longer decides the result.

1. **Static routes are always evaluated before parameter routes** with the same segment. `/users/roles` will not be swallowed by `/:id`.
2. **Still write static routes before parameter routes** in the same file so declaration order stays clear:

```js
// route.user.js — declaration order stays clear
export default function registerUser(r) {
  r.get("/roles", listRolesHandler);   // ✅ static first
  r.get("/:id", getUserHandler);       // parameter later
}
```

3. **Tests lock this behavior:** `test/routeOrder.test.js` tests the sorter directly and re-tests with `fs.readdirSync` reversed.

> Rule of thumb: when adding a new static route, check the route table at boot. The final order is sorted, but the route table is still the easiest evidence to read.

4. **Duplicate `method + path` within one group** → the last one silently wins. **Duplicates across groups/files** → both are installed; Express uses the first match. There is no error — so it is the developer's responsibility to make sure there are no accidental duplicates.

### ✅ Correct example

```js
// route.product.extend.js — a new route with no clash
r.post("/policies", mw.auth, handler);
```

```js
// Override + keep the existing base middleware
r.get("/:id", { prepend: [mw.auth] });
// result: mw.auth → middlewareBase → handlerBase
```

### ❌ Wrong example

```js
// ❌ A static route registered after the parameter in a group evaluated earlier
r.get("/:id", getUserHandler);
r.get("/roles", listRolesHandler);   // never reached for /users/roles

// ❌ Copying the base handler again when you only want to add middleware
r.get("/:id", async (req, res) => { /* copy-paste the base body + additions */ });

// ❌ Two different files registering "GET /" for the same prefix
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| Static route "swallowed" by `/:id` | A strange 404 (`User not found` for a path that is clearly not an id) |
| Overwriting when the base middleware is needed | Base auth/validation disappears from the endpoint |
| Accidental duplicates | Behavior depends on boot order; hard-to-reproduce bugs |

---

## 4. deps Contract

**Goal:** all modules share a single infra instance without importing each other directly.

### How it works in brief

`src/libs/deps.js` exports a **live binding**:

```js
export let db = null;
export function populate(values) { if ("db" in values) db = values.db; /* ... */ }
```

`index.js` calls `populate({ config, logger, db, nats, ws, scheduler, http })` **before** `discover()`. Because the binding is live, every module that has been or will be loaded automatically sees the latest value.

### Rules

| Rule | Detail |
| --- | --- |
| How to import | `import { db, logger, nats, ws, scheduler } from "../../../libs/deps.js"` (adjust the number of `../`) |
| When to access | Inside a function body (`init`, handler, service, repo). The value is read when the function is **called**; by then deps are already populated. |
| What is forbidden | Taking the *value* of deps at module top-level: `const pool = db.getPool()` or `const myLogger = logger` in module scope |
| `populate()` | Only called in `index.js` (production) and test helpers. Modules must not call `populate()`. |
| Partial | `populate()` only replaces the keys it is given — safe for partial overrides in tests |

### ✅ Correct example

```js
import { db } from "../../../libs/deps.js";

export default {
  async findById(id) {
    const { rows } = await db.query("SELECT * FROM app_user WHERE id = $1", [id]);
    return rows[0] ?? null;
  },
};
```

```js
// service: logger is used when the function is called
import { logger } from "../../../libs/deps.js";

async function getUser(id) {
  logger.debug("service.user.getUser", id);   // ✅ when called, logger is already populated
  // ...
}
```

### ❌ Wrong example

```js
// ❌ Evaluated at import time — deps may not be populated yet
import { db, logger } from "../../../libs/deps.js";
const pool = db.getPool();          // TypeError: Cannot read properties of null
const log = logger;                 // null forever (copied by value)

// ❌ A module calling populate()
import { populate } from "../../../libs/deps.js";
populate({ db: myCustomDb });       // only test helpers & index.js may do this
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| deps values copied at top-level | Permanent `null` — the error only shows up under certain runtime conditions and is hard to trace |
| `populate()` from a module | The bootstrap order breaks; other modules may see half-finished state |

---

## 5. WebSocket Contract

**Goal:** many modules share a single WebSocket server, each with its own channel.

### Rules

| Rule | Detail |
| --- | --- |
| Registration | `ws.register(path, handler, { owner })` — from the module's `init(deps)` |
| Path | Globally unique, convention `/ws/<module>` (examples: `/ws/users`, `/ws/users-ext`, `/ws/audit`) |
| Duplicates | `register()` **throws** — two modules must not use the same path |
| Handler | `(socket, req) => {}`; call `socket.send(JSON.stringify(...))` to send |
| Incoming messages | `socket.on("message", raw => ...)` — `raw` is a Buffer; always validate the JSON |
| Outgoing payload | Convention `{ type: "...", ... }`; the welcome message uses the `module` key: `{ type: "welcome", module: "user-management" }` |
| Broadcast | `ws.broadcast(path, payload)` → the number of clients reached; `JSON.stringify` is applied automatically |
| Limit | Maximum payload 1 MB (`WS_MAX_PAYLOAD`); clients that do not `pong` are terminated automatically |
| Malformed upgrade | Invalid URL → `400` and the socket is closed; the process stays alive |
| Errors | Mistakes inside an async handler are **not** caught automatically — handle them yourself (try/catch) |

### ✅ Correct example

```js
async init(deps) {
  const { ws, logger } = deps;

  ws.register(
    "/ws/inventory",
    (socket, req) => {
      socket.send(JSON.stringify({ type: "welcome", module: "inventory" }));

      socket.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          socket.send(JSON.stringify({ echo: msg }));
        } catch {
          socket.send(JSON.stringify({ error: "invalid json" }));
        }
      });
    },
    { owner: "inventory-management" },
  );
}
```

### ❌ Wrong example

```js
// ❌ Path already used by another module — throws at boot
ws.register("/ws/users", handler, { owner: "audit" });

// ❌ Path without a namespace (prone to clashes)
ws.register("/events", handler);

// ❌ Registering at module top-level — runs before ws.init()
ws.register("/ws/x", handler);

// ❌ Assuming async errors are caught automatically
socket.on("message", async (raw) => {
  await doSomethingMayThrow(raw);    // the rejection is invisible in the logs
});
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| Duplicate path | Boot crash with a clear message (*WS path already registered*) — deliberately fail-fast |
| Registration at top-level | `channels` is not ready yet / the handler is registered before the server exists |
| Invalid JSON not validated | An error in the handler; the connection may close without a clear message |

---

## 6. NATS Contract

**Goal:** event communication between modules that stays correct after a reconnect.

### Rules

| Rule | Detail |
| --- | --- |
| Subject naming | `<entity>.<action>`, lowercase: `user.created`, `user.deleted`, `audit.logged` |
| Subscribe | Always through an idempotent `setup()` function, registered with `onConnected` + called directly if already connected |
| Core publish | `nats.publish(subject, payload)` — fire-and-forget; returns `false` if NATS is unavailable. Safe to call at any time. |
| JetStream publish | `nats.jsPublish(subject, payload)` — persistent; returns `null` on failure. `await` the result. |
| JetStream consume | `await nats.consume(stream, durableName)` → `consumer.consume()`; ack (`m.ack()`) on success, `m.nak()` on failure |
| Durable name | Unique per consumer: `user-management-worker`, `audit-user-worker` |
| Decoding JetStream messages | `JSON.parse(nats.get().sc.decode(m.data))` |
| JetStream optional | If the NATS server does not enable JetStream, the app still boots; `jsPublish`/`consume` become no-ops/throws handled by the module |
| Background retry | Only runs when `NATS_AUTO_RETRY_AFTER_EXHAUST=true`; `onConnected` is called again after a successful reconnect |
| Prohibitions | Subscribing at module top-level; calling `nats.get()` without checking availability |

### Required pattern (reconnect-safe)

```js
async init(deps) {
  const { nats, logger } = deps;

  function setup() {
    if (!nats.isAvailable()) return;

    // Core NATS
    const sub = nats.subscribeJson("user.created");
    (async () => {
      for await (const { data } of sub) {
        logger.info("[inventory] user.created", data);
      }
    })().catch((err) => logger.debug("[inventory] sub ended", { error: err.message }));

    // JetStream
    (async () => {
      try {
        const consumer = await nats.consume("USERS", "inventory-worker");
        const messages = await consumer.consume();
        for await (const m of messages) {
          try {
            const data = JSON.parse(nats.get().sc.decode(m.data));
            // ... process
            m.ack();
          } catch (err) {
            logger.error("[inventory] js handler", { error: err.message });
            m.nak();
          }
        }
      } catch (err) {
        logger.warn("[inventory] JS consumer setup failed", { error: err.message });
      }
    })();
  }

  nats.onConnected(setup);          // called again on every reconnect
  if (nats.isAvailable()) setup();  // bootstrap case: already connected from the start
}
```

**Why must it be like this?** After the connection drops permanently and the background retry successfully reconnects, all old subscriptions die along with it. `onConnected` is called on every successful connection, so `setup()` is called again and the subscriptions are recreated. `setup()` must be idempotent — creating new subscribers from the new connection, not duplicating state.

### ✅ / ❌ Quick comparison

```js
// ✅ publish is safe at any time — a no-op if NATS is down
nats.publish("user.created", { id: 1 });

// ❌ can throw "nats not available" in degraded mode
const { nc } = nats.get();
nc.publish("user.created", "{}");
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| Subscribing without checking `isAvailable()` | An error in degraded mode; the subscription is never created |
| Not using the `onConnected` pattern | After a reconnect, events silently stop arriving (the subtlest bug in this system) |
| Duplicate durable name across consumers | Two consumers fight over the same messages |
| Forgetting `ack`/`nak` | Messages are redelivered endlessly |

---

## 7. Scheduler Contract

**Goal:** scheduled tasks that do not clash with each other and do not hold up shutdown.

### Rules

| Rule | Detail |
| --- | --- |
| Task name | **Globally** unique, convention `<module>:<task>` — examples `audit-user:flush-buffer`, `global:health-check` |
| Cron | Standard 5 fields (`*/5 * * * *`); validated at registration — a wrong expression = throw |
| Timezone | Default `UTC` (`SCHEDULER_TZ`); can be overridden per task |
| Handler | Must be async-safe; the scheduler catches and logs errors (a failed task ≠ an app crash) |
| Overlap | A task still running at the next tick → the tick is skipped (there is a warning log) — the task design must support this |
| `runOnInit` | Run once during `startAll()` (after `listen`); does not run when the scheduler is disabled |
| Shutdown | `stopAll({ waitMs })` waits for in-flight tasks for at most `waitMs` (default 10 s at shutdown) — handlers should finish well under that |

### ✅ Correct example

```js
async init(deps) {
  const { scheduler, logger } = deps;

  scheduler.register({
    name: "inventory:daily-report",       // module namespace
    schedule: "0 7 * * *",                // every day at 07:00 UTC
    owner: "inventory-management",
    handler: async () => {
      logger.info("[inventory] daily report");
      // the work...
    },
  });
}
```

### ❌ Wrong example

```js
// ❌ Generic name — two modules may clash
scheduler.register({ name: "cleanup", schedule: "* * * * *", handler: () => {} });

// ❌ Invalid cron expression → throws at init → boot exits
scheduler.register({ name: "x:y", schedule: "every hour", handler: () => {} });

// ❌ A heavy task every minute with no protection (ticks will be skipped / pile up)
scheduler.register({ name: "x:heavy", schedule: "* * * * *", handler: heavyWork });
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| Duplicate name | Boot crash (`task already registered`) |
| Invalid cron | Boot crash during module init |
| Hanging handler | Shutdown waits until `waitMs`, then continues with the task unfinished |

---

## 8. Package Contract

**Goal:** the dependency set merged from base + extension can always be regenerated; no mysterious version clashes.

### Rules

| Rule | Detail |
| --- | --- |
| Source of truth | `package.base.json` (base) and `package.json` (extension). **Edit and commit both.** |
| Generated files | `package.json` (base, **not tracked**, gitignored) and `src/extensions/` — do not edit manually |
| Generate | `node scripts/merge-package.js` (or `npm run merge:ext` once `package.json` exists) — `--dry-run` to preview |
| Merged sections | `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, `resolutions` |
| Conflict strategy | `MERGE_STRATEGY=extension-wins` (default) \| `base-wins` \| `strict` |
| Major mismatch | Reported with a ⚠️ mark — the extension still wins, but the base may break |
| Lockfile | Removed automatically during generation (to avoid an out-of-sync lock) |
| Scripts | Taken from the base; extensions must not change `scripts` |

An additional dependency from the extension (for example `uuid`) automatically enters the merged `package.json` — this is how an extension adds a library without touching the base repo.

> On a fresh clone, `package.json` does not exist yet. Run `node scripts/copy-extensions.js` then `node scripts/merge-package.js` before `npm install`/`npm test`.

### ✅ Correct flow

```bash
# Adding a new dependency for the extension:
# 1. Edit package.json in the extension repo → add it to "dependencies"
# 2. In the base:
npm run merge:ext      # package.json (base) is regenerated
npm install            # install the merged dependencies
```

### ❌ Wrong example

```bash
# ❌ npm install uuid directly in the base without declaring it in package.base.json
#    → gone as soon as `merge:ext` runs again

# ❌ Editing package.json (base) manually
#    → overwritten by the merge; its source of truth is package.base.json
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| Installing without declaring | The dependency "disappears" after regenerating |
| Editing the base `package.json` | Changes are overwritten; confusing ("I already edited it, why did it revert") |
| `MERGE_STRATEGY=strict` in CI | The build fails when there is a conflict — that is the point, fail-fast |

---

## 9. Test Contract

**Goal:** tests that are fast, need no external infrastructure, and do not accumulate state across files.

### Rules

| Rule | Detail |
| --- | --- |
| Runner | `node:test` + `node:assert/strict` — `npm test` (`node --test "test/**/*.test.js"`) |
| Prerequisite | `npm run poc:copy` first — route/extension tests need `src/extensions/` (the helper gives a clear message if it is missing) |
| Isolation | Each test file runs in a separate process spawned by Node; deps are populated per test |
| Fake deps | Use `installFakeDeps()` from `test/helpers/fakes.js` — do not connect to a real PG/NATS |
| Database | The fake db matches SQL patterns; adding a new query means adding a pattern in `fakes.js` |
| App for tests | `buildTestApp()` (discover + init + mount + error middleware) + `withServer()` (listen on port 0 + `fetch`) |
| Browser/HTTP | Use Node's built-in `fetch` — no extra libraries |

### ✅ Correct test example

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildTestApp, withServer } from "./helpers/buildTestApp.js";

test("GET /users returns the user list", async () => {
  const { app } = await buildTestApp();

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/users`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: 1, name: "Alice" }]);
  });
});
```

```js
// To test the error path (db down):
const { app } = await buildTestApp({ db: fakeDbThrowing("db down") });
```

### ❌ Wrong example

```js
// ❌ Importing a module without installFakeDeps → deps are still null
const { default: repoUser } = await import("../src/modules/.../repo.user.js");
await db.query("...");               // TypeError: null

// ❌ A test that hits a real PostgreSQL/NATS
const pool = new pg.Pool({ host: "<pg-host>", ... });

// ❌ Relying on order/state across test files
```

### Checklist when adding a new module

- [ ] Tests in `test/` import the module via `discover()` (buildTestApp) or directly with fake deps
- [ ] Run `node scripts/copy-extensions.js` before `npm test`
- [ ] If you add new SQL, add a pattern in `fakeDb()` so that route tests can take the success path
- [ ] Verify the route table printed by `mountModule` matches expectations (especially the static vs `/:id` order)

---

## 10. Error Contract

**Goal:** every error has a consistent response shape and log flow.

### Rules

| Condition | Response | Notes |
| --- | --- | --- |
| Unhandled error in an async handler | `500 { "error": "internal error" }` | Express 5 forwards rejections automatically to the error middleware; details + stack go to the log only |
| Resource not found | `404 { "error": "<message>" }` | The service throws `NotFoundError`; the route maps it via `handleRouteError()`, example `"User not found"` |
| Invalid input | `400 { "error": "<message>" }` | Example: the `validateBody` middleware |
| Forbidden | `403 { "error": "forbidden", "need": "<role>" }` | From `requireRole` |
| Too many requests | `429 { "error": "too many requests" }` | From `rateLimit` |
| Success | A raw JSON body | No envelope; array = array; object = object |
| Health | `200/503 { ok, degraded, uptimeSec, checks }` | `checks` contains `pg`, `nats`, `jetstream`, `ws`; `ok = checks.pg && (checks.nats \|\| !NATS_REQUIRED)`; `degraded = !checks.nats \|\| !checks.jetstream` |

Additional rules:
- A domain "not found" is thrown as `NotFoundError` and mapped by `handleRouteError()` to 404. Other errors (DB, bugs) bubble to the error middleware → `500 { "error": "internal error" }`.
- Never send `stack` or raw internal messages to the client.
- Always log with context: `logger.error("...", { reqId, error: err.message })`.
- Never swallow an error without a log (an empty try/catch).
- Express 5: a `try/catch` wrapper is **not needed** just to avoid a hanging request — but still use `try/catch` if you want to map a domain error to a specific status code.

### ✅ Correct example

```js
// Mapping a domain error to 404
r.get("/:id", async (req, res) => {
  try {
    res.json(await userService.getUser(req.params.id));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Letting an unexpected error bubble up to the global error middleware (500 + log)
r.get("/", async (req, res) => {
  res.json(await userService.listUsers());   // error → 500 { error: "internal error" }
});
```

### ❌ Wrong example

```js
// ❌ Swallowing the error
try { await danger(); } catch (e) {}

// ❌ Leaking internal details
res.status(500).json({ error: err.stack, query: sql });

// ❌ throwing a string
throw "user not found";        // it has no .message; hard to debug

// ❌ forgetting the response → the request hangs (even though there is no error)
if (!ok) { console.log("skip"); }   // no res.*
```

### Consequences of a violation

| Violation | Consequence |
| --- | --- |
| Leaking stack/SQL to the client | Information disclosure |
| Swallowing errors | Invisible bugs; a debugging nightmare |
| Double response / forgetting the response | `ERR_HTTP_HEADERS_SENT` / a hanging request |

---

**Related documents:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the system works
- [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md) — hands-on tutorial
