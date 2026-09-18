# Developer Guide: Base-API & Extension-API

**Version**: 5.0
**Audience**: Backend developers contributing to `base-api` or `extension-api`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Folder Structure](#2-folder-structure)
3. [Setup & Run](#3-setup--run)
4. [Shared Infrastructure Clients](#4-shared-infrastructure-clients)
5. [Development in Base-API](#5-development-in-base-api)
6. [Development in Extension-API](#6-development-in-extension-api)
7. [Route Merging Modes](#7-route-merging-modes)
8. [Middleware](#8-middleware)
9. [Service & Repository](#9-service--repository)
10. [Dependency Injection & `deps`](#10-dependency-injection--deps)
11. [Feature Init Hooks](#11-feature-init-hooks)
12. [WebSocket Development](#12-websocket-development)
13. [NATS JetStream & Reconnection](#13-nats-jetstream--reconnection)
14. [Scheduler](#14-scheduler)
15. [Package Management](#15-package-management)
16. [CI/CD Flow](#16-cicd-flow)
17. [Graceful Shutdown](#17-graceful-shutdown)
18. [Conventions & Best Practices](#18-conventions--best-practices)
19. [Troubleshooting](#19-troubleshooting)
20. [Quick Reference](#20-quick-reference)

---

## 1. Architecture Overview

### Core Concept

The system consists of **2 repositories**:

| Repo            | Purpose                                                                     | Owner                  |
| --------------- | --------------------------------------------------------------------------- | ---------------------- |
| `base-api`      | Core application. Standard features used by all clients.                    | Platform team          |
| `extension-api` | Per-client customization. Overrides or adds features without touching base. | Client / solution team |

At build time, `extension-api/src/` is **copied** into `base-api/src/extensions/`, then `base-api` performs a two-level merge:

1. **Route level** — extension routes override/append base routes
2. **Package level** — extension dependencies are merged into the final `package.json`

The base **never knows** what exists in extensions. Conversely, extensions **know everything** about the base (they can `require()` base files).

### Build & Runtime Flow

```
┌─────────────────────┐      ┌─────────────────────┐
│  base-api           │      │  extension-api      │
│  ├── src/features   │      │  ├── src/           │
│  ├── package.base   │      │  │   └── <feature>/ │
│  └── (package.json) │      │  └── package.json   │
└──────────┬──────────┘      └──────────┬──────────┘
           │                            │
           │        ┌───────────────────┘
           │        │ 1. copy src/* → base/src/extensions/
           │        │ 2. copy package.json → base/src/extensions/
           │        ▼
           │  ┌──────────────────────────────┐
           │  │  base-api/src/extensions/    │
           │  └──────────────┬───────────────┘
           │                 │
           │     3. generate package.json
           │        (package.base.json + extensions)
           │     4. npm install
           │     5. node index.js
           ▼                 ▼
       ┌───────────────────────────────────────────────────┐
       │  Bootstrap Sequence (async)                       │
       │  config → logger → nats → pg → http → ws → sched  │
       │         → deps → discover → init hooks → start    │
       │         → mount routes → listen                   │
       └───────────────────────────────────────────────────┘
```

### Guiding Principles

| Principle                           | Implication                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| **Base stays clean of clients**     | No file in `features/` mentions a specific client                                      |
| **Extensions know base**            | Extensions may `require()` from `features/`                                            |
| **Routes are the composition root** | Route files `require` services/repos/middleware                                        |
| **Infra is shared**                 | All features access `deps.db`, `deps.nats`, `deps.ws`, `deps.scheduler`, `deps.logger` |
| **Explicit over implicit**          | Extensions `require()` base services directly; no auto-wiring magic                    |
| **Graceful degradation**            | NATS optional unless `NATS_REQUIRED=true`; auto-reconnect via background retry         |
| **Graceful shutdown**               | Every async client + scheduler stopped cleanly on SIGTERM/SIGINT                       |

---

## 2. Folder Structure

### Base-API

```
base-api/
├── index.js                          # Async bootstrap entry point
├── package.base.json                 # SOURCE OF TRUTH — edit this
├── package.json                      # GENERATED — do not edit (gitignored)
├── docker-compose.yml
├── .env.example
├── .gitignore
├── sql/
│   └── schema.sql
├── scripts/
│   ├── merge-package.js
│   ├── poc-copy-extensions.js
│   └── ws-smoke.js
├── src/
│   ├── libs/
│   │   ├── deps.js
│   │   ├── config.js
│   │   ├── logger.js
│   │   ├── db.js
│   │   ├── nats.js                   # NATS + JetStream + auto-reconnect
│   │   ├── ws.js
│   │   ├── scheduler.js
│   │   ├── routeCollector.js
│   │   ├── mergeRoutes.js
│   │   ├── mountFeature.js
│   │   └── bootstrap/
│   │       └── discover.js
│   ├── features/
│   │   └── <feature-name>/
│   │       ├── index.js
│   │       ├── routes/route.<group>.js
│   │       ├── services/service.<name>.js
│   │       ├── repositories/repo.<name>.js
│   │       └── middleware.js
│   └── extensions/                   # Populated by CI (gitignored)
│       └── <feature-name>/
│           ├── index.js              # extension-only feature
│           ├── route.<group>.extend.js
│           ├── init.extend.js
│           ├── middleware.extend.js
│           ├── routes/route.<group>.js
│           ├── services/service.<name>.js
│           └── repositories/repo.<name>.js
```

### Extension-API

```
extension-api/
├── package.json
└── src/
    └── <feature-name>/
        ├── index.js
        ├── route.<group>.extend.js
        ├── init.extend.js
        ├── middleware.extend.js
        ├── routes/route.<group>.js
        ├── services/service.<name>.js
        └── repositories/repo.<name>.js
```

### File Ownership Matrix

| File                         | Who edits | Committed?         | Purpose                         |
| ---------------------------- | --------- | ------------------ | ------------------------------- |
| `package.base.json`          | Developer | ✅ Yes             | Base dependencies + scripts     |
| `package.json`               | Script    | ❌ No (gitignored) | Final package used by npm       |
| `package-lock.json`          | npm       | ❌ No (gitignored) | Lock file, regenerated          |
| `src/extensions/**`          | CI        | ❌ No (gitignored) | Extension code, copied at build |
| `.package-merge-report.json` | Script    | ❌ No (gitignored) | Merge audit report              |

---

## 3. Setup & Run

### Prerequisites

- Node.js >= 18
- npm >= 9
- Docker (for local Postgres + NATS)

### First-Time Setup

```bash
git clone <base-api-url>
cd base-api
cp .env.example .env

npm run merge:ext
npm install

docker compose up -d

nats stream add USERS --subjects="user.created" --defaults
nats consumer add USERS user-management-worker --pull --defaults

npm start
```

### Setup with Extension

```bash
git clone <base-api-url>
git clone <extension-api-url>
cd base-api
cp .env.example .env

node scripts/poc-copy-extensions.js
npm run merge:ext
npm install
npm start
```

Or:

```bash
./run-poc.sh
```

### Environment Variables

| Variable                        | Default               | Purpose                                   |
| ------------------------------- | --------------------- | ----------------------------------------- |
| `PORT`                          | 3000                  | HTTP port                                 |
| `NODE_ENV`                      | development           | Runtime mode                              |
| `LOG_LEVEL`                     | info                  | Winston log level                         |
| `PG_HOST`                       | localhost             | Postgres host                             |
| `PG_PORT`                       | 5432                  | Postgres port                             |
| `PG_USER`                       | postgres              | Postgres user                             |
| `PG_PASSWORD`                   | postgres              | Postgres password                         |
| `PG_DATABASE`                   | app                   | Postgres database                         |
| `PG_POOL_MAX`                   | 20                    | Max pool connections                      |
| `NATS_SERVERS`                  | nats://localhost:4222 | NATS server URL                           |
| `NATS_NAME`                     | base-api              | NATS client name                          |
| `NATS_JETSTREAM`                | true                  | Enable JetStream                          |
| `NATS_REQUIRED`                 | false                 | Fail-fast if NATS unavailable at startup  |
| `NATS_MAX_RECONNECT`            | 5                     | Inline reconnect attempts (-1 = infinite) |
| `NATS_RECONNECT_WAIT_MS`        | 2000                  | Wait between inline reconnect attempts    |
| `NATS_AUTO_RETRY_AFTER_EXHAUST` | **true**              | Background retry after max attempts       |
| `NATS_RETRY_AFTER_EXHAUST_MS`   | 30000                 | Background retry interval                 |
| `WS_HEARTBEAT_MS`               | 30000                 | WS heartbeat interval                     |
| `WS_MAX_PAYLOAD`                | 1048576               | Max WS message size (bytes)               |
| `SCHEDULER_ENABLED`             | true                  | Enable/disable all scheduled tasks        |
| `SCHEDULER_TZ`                  | UTC                   | Default timezone for cron tasks           |
| `API_KEY`                       | poc-secret-key        | Example config value                      |

---

## 4. Shared Infrastructure Clients

All features and extensions access five shared clients via the `deps` bag:

| Client                      | `deps.X`         | Type            | Init          | Optional? |
| --------------------------- | ---------------- | --------------- | ------------- | --------- |
| **Winston**                 | `deps.logger`    | Logger          | Sync          | No        |
| **Postgres** (`pg.Pool`)    | `deps.db`        | Connection pool | Sync (lazy)   | No        |
| **NATS JetStream**          | `deps.nats`      | Async client    | **Await**     | **Yes**   |
| **WebSocket**               | `deps.ws`        | Routing module  | Sync (attach) | No        |
| **Scheduler** (`node-cron`) | `deps.scheduler` | Task manager    | Sync          | No        |

Plus `deps.config` and `deps.http`.

### 4.1 Logger (Winston)

```js
const { logger } = require("../../libs/deps");

logger.info("message", { key: "value" });
logger.warn("warning");
logger.error("error", { error: err.message, stack: err.stack });
logger.debug("debug", { requestId: req.id });

const log = logger.child({ feature: "user-management" });
log.info("context attached automatically");
```

### 4.2 Postgres

```js
const { db } = require("../../../libs/deps");

const { rows, rowCount } = await db.query(
  "SELECT id, name FROM users WHERE id = $1",
  [userId],
);

await db.tx(async (client) => {
  await client.query("INSERT INTO users (name) VALUES ($1)", ["Alice"]);
  await client.query("INSERT INTO audit_logs (action) VALUES ($1)", ["create"]);
});

const ok = await db.healthCheck();
```

**Rules**:

- Always use `$1, $2` placeholders
- Never `require('pg')` directly
- Never call `db.close()` from a feature

### 4.3 NATS JetStream (Optional)

See [Section 13](#13-nats-jetstream--reconnection) for full details on reconnection, callbacks, and patterns.

Quick reference:

```js
const { nats } = require("../../../libs/deps");

// Check availability first
if (nats.isAvailable()) {
  nats.publish("user.viewed", { id: 123 });
  await nats.jsPublish("user.created", { id: user.id });
}

// Register re-subscription hook
nats.onConnected(() => {
  /* re-setup subscriptions */
});
```

### 4.4 WebSocket

```js
const { ws } = require("../../libs/deps");

ws.register(
  "/ws/users",
  (socket, req) => {
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.on("message", (raw) => {
      socket.send(JSON.stringify({ echo: JSON.parse(raw.toString()) }));
    });
  },
  { owner: "user-management" },
);

ws.broadcast("/ws/users", { type: "notice", text: "..." });
ws.listChannels();
```

### 4.5 Scheduler

```js
const { scheduler } = require("../../libs/deps");

scheduler.register({
  name: "feature:task-name",
  schedule: "*/5 * * * *",
  owner: "feature-name",
  handler: async () => {
    /* ... */
  },
});

scheduler.list();
scheduler.trigger("feature:task-name");
```

See [Section 14](#14-scheduler).

### 4.6 Access Rules

```js
// ✅ Correct — require at top, access inside function body
const { db, logger, nats, ws, scheduler } = require("../../../libs/deps");

async function processUser(id) {
  logger.debug("processing", { id });
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
  await nats.jsPublish("user.processed", { id });
  return rows[0];
}
```

```js
// ❌ Wrong — accesses deps at top-level module
const { db } = require("../../../libs/deps");
const users = db.query("SELECT 1"); // db is null here!
```

---

## 5. Development in Base-API

### 5.1 Creating a New Feature

**Step 1** — Folder structure:

```
src/features/interaction-management/
├── index.js
├── routes/route.interaction.js
├── services/service.interaction.js
└── repositories/repo.interaction.js
```

**Step 2** — Declare prefix + init hook:

```js
// src/features/interaction-management/index.js
module.exports = {
  prefix: "/interactions",

  async init(deps) {
    const { logger, scheduler, nats } = deps;
    logger.info("[interaction-management] init");

    // Setup function idempotent untuk NATS
    function setupNats() {
      if (!nats.isAvailable()) return;
      const sub = nats.subscribeJson("interaction.created");
      (async () => {
        for await (const { data } of sub) {
          logger.info("[interaction-management] event", data);
        }
      })().catch((err) => logger.debug("sub ended", { error: err.message }));
    }

    nats.onConnected(setupNats);
    if (nats.isAvailable()) setupNats();

    // Scheduler
    scheduler.register({
      name: "interaction-management:purge-old",
      schedule: "0 3 * * *",
      owner: "interaction-management",
      handler: async () => {
        const { db } = require("../../../libs/deps");
        const { rowCount } = await db.query(
          "DELETE FROM interactions WHERE created_at < NOW() - INTERVAL '180 days'",
        );
        logger.info("[interaction-management] purged", { count: rowCount });
      },
    });
  },
};
```

**Step 3** — Repository:

```js
// src/features/interaction-management/repositories/repo.interaction.js
const { db } = require("../../../libs/deps");

module.exports = {
  async findById(id) {
    const { rows } = await db.query(
      "SELECT * FROM interactions WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  },
  async findAll() {
    const { rows } = await db.query("SELECT * FROM interactions ORDER BY id");
    return rows;
  },
};
```

**Step 4** — Service:

```js
// src/features/interaction-management/services/service.interaction.js
const repo = require("../repositories/repo.interaction");
const { logger } = require("../../../libs/deps");

async function get(id) {
  logger.debug("interaction.get", { id });
  const item = await repo.findById(Number(id));
  if (!item) throw new Error("Interaction not found");
  return item;
}

async function list() {
  return repo.findAll();
}

module.exports = { get, list };
```

**Step 5** — Route:

```js
// src/features/interaction-management/routes/route.interaction.js
const service = require("../services/service.interaction");
const { logger } = require("../../../libs/deps");

module.exports = function registerInteraction(r) {
  r.get("/", async (req, res) => {
    try {
      res.json(await service.list());
    } catch (err) {
      logger.error("list failed", { error: err.message });
      res.status(500).json({ error: "internal error" });
    }
  });

  r.get("/:id", async (req, res) => {
    try {
      res.json(await service.get(req.params.id));
    } catch (err) {
      if (err.message === "Interaction not found") {
        return res.status(404).json({ error: err.message });
      }
      logger.error("get failed", { error: err.message });
      res.status(500).json({ error: "internal error" });
    }
  });
};
```

### 5.2 Adding a New Route File

Create `src/features/<feature>/routes/route.<group>.js`. No registration needed.

### 5.3 Feature with Multiple Route Files

```
features/product-management/
├── index.js                            { prefix: '/products' }
├── routes/
│   ├── route.product.js                → group "product"
│   └── route.policy.js                 → group "policy"
```

Each group mounts to the same prefix. Differentiate via path inside the file.

---

## 6. Development in Extension-API

### 6.1 Extending an Existing Route

**Create** `src/user-management/route.user.extend.js`:

```js
const userServiceBase = require("../../features/user-management/services/service.user");

module.exports = function extendUser(r) {
  r.get("/:id", async (req, res) => {
    const user = await userServiceBase.getUser(req.params.id);
    res.json({ ...user, extended: true });
  });
};
```

**Group matching**:

| File name              | Group  |
| ---------------------- | ------ |
| `route.user.extend.js` | `user` |
| `route.role.extend.js` | `role` |

Group name **must** match the base file `route.<group>.js`.

### 6.2 Adding a New Route

```js
const userServiceBase = require("../../features/user-management/services/service.user");
const mw = require("./middleware.extend");

module.exports = function extendUser(r) {
  r.get("/:id/summary", mw.auth, async (req, res) => {
    const user = await userServiceBase.getUser(req.params.id);
    res.json({ id: user.id, name: user.name });
  });
};
```

### 6.3 Adding a New Feature (Client-Specific)

An **extension-only feature** does not exist in `features/`. Everything is defined under `extensions/`.

```
extensions/audit-user/
├── index.js                    ← REQUIRED
├── routes/route.audit.js
├── services/service.audit.js
└── repositories/repo.audit.js
```

**Rules**:

- Route files: `routes/route.<group>.js` — **not** `.extend.js`
- `index.js` required — declares `prefix` and `init(deps)`
- **Do not** create `init.extend.js` — that's for extending base features

**Step 1** — `index.js`:

```js
// extensions/audit-user/index.js
const { logger } = require("../../libs/deps");

module.exports = {
  prefix: "/audit",

  async init(deps) {
    const { nats, ws, scheduler, logger } = deps;

    logger.info("[audit-user] init");

    // ── NATS — with reconnect-safe pattern ───────────
    const setupNats = () => {
      if (!nats.isAvailable()) return;

      logger.info("[audit-user] setting up NATS subscriptions");

      const createdSub = nats.subscribeJson("user.created");
      (async () => {
        for await (const { data } of createdSub) {
          logger.info("[audit-user] user.created", data);
        }
      })().catch((err) =>
        logger.debug("[audit-user] sub ended", { error: err.message }),
      );

      // JetStream consumer
      (async () => {
        try {
          const consumer = await nats.consume("USERS", "audit-user-worker");
          const messages = await consumer.consume();
          for await (const m of messages) {
            try {
              const data = JSON.parse(nats.get().sc.decode(m.data));
              logger.info("[audit-user] js message", data);
              m.ack();
            } catch (err) {
              logger.error("[audit-user] js handler", { error: err.message });
              m.nak();
            }
          }
        } catch (err) {
          logger.warn("[audit-user] JS consumer setup failed", {
            error: err.message,
          });
        }
      })();
    };

    nats.onConnected(setupNats);
    if (nats.isAvailable()) setupNats();

    // ── WebSocket ────────────────────────────────────
    ws.register(
      "/ws/audit",
      (socket, req) => {
        logger.info("[audit-user] ws connected");
        socket.send(JSON.stringify({ type: "welcome", feature: "audit-user" }));

        socket.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.action === "ping") {
              return socket.send(
                JSON.stringify({ type: "pong", at: Date.now() }),
              );
            }
            socket.send(JSON.stringify({ type: "echo", echo: msg }));
          } catch (err) {
            socket.send(JSON.stringify({ error: "invalid json" }));
          }
        });

        socket.on("close", () => logger.info("[audit-user] ws closed"));
      },
      { owner: "audit-user" },
    );

    // ── Scheduler ────────────────────────────────────
    scheduler.register({
      name: "audit-user:flush-buffer",
      schedule: "*/5 * * * *",
      owner: "audit-user",
      handler: async () => {
        const { db } = require("../../libs/deps");
        const { rowCount } = await db.query(
          "UPDATE audit_logs SET synced = true WHERE synced = false",
        );
        logger.info("[audit-user] flushed", { count: rowCount });
      },
    });
  },
};
```

**Step 2** — Route:

```js
// extensions/audit-user/routes/route.audit.js
const service = require("../services/service.audit");
const { logger, nats, ws } = require("../../../libs/deps");

module.exports = function registerAudit(r) {
  r.get("/logs", async (req, res) => {
    try {
      res.json(await service.list(req.query));
    } catch (err) {
      logger.error("list failed", { error: err.message });
      res.status(500).json({ error: "internal error" });
    }
  });

  r.post("/log", async (req, res) => {
    try {
      const entry = await service.record(req.body);
      await nats.jsPublish("audit.logged", entry);
      ws.broadcast("/ws/audit", { type: "audit", entry });
      res.status(201).json(entry);
    } catch (err) {
      logger.error("record failed", { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  r.post("/notify", async (req, res) => {
    const sent = ws.broadcast("/ws/audit", {
      type: "notice",
      text: req.body.text ?? "",
    });
    res.json({ ok: true, sent });
  });
};
```

**Step 3** — Service & repo: standard pattern.

**Require path table**:

| File location                    | Path to `libs/`  | Path to `features/`  |
| -------------------------------- | ---------------- | -------------------- |
| `extensions/X/index.js`          | `../../libs/`    | `../../features/`    |
| `extensions/X/routes/*.js`       | `../../../libs/` | `../../../features/` |
| `extensions/X/services/*.js`     | `../../../libs/` | `../../../features/` |
| `extensions/X/repositories/*.js` | `../../../libs/` | `../../../features/` |

### 6.4 Requiring Base Services from Extension

```js
// extensions/audit-user/services/service.enrich.js
const userServiceBase = require("../../../features/user-management/services/service.user");
const { logger } = require("../../../libs/deps");

async function enrich(entry) {
  if (!entry.user_id) return entry;
  try {
    const user = await userServiceBase.getUser(entry.user_id);
    return { ...entry, userName: user.name };
  } catch (err) {
    logger.warn("enrich failed", { userId: entry.user_id, error: err.message });
    return entry;
  }
}

module.exports = { enrich };
```

### 6.5 Extension Helper Services

Extensions can have any number of helper services under the extension folder. Route requires them explicitly.

### 6.6 Base Feature vs Extension-Only Feature

| Aspect                  | Base feature                | Extension-only feature                  |
| ----------------------- | --------------------------- | --------------------------------------- |
| Location                | `features/<name>/`          | `extensions/<name>/`                    |
| Route file              | `routes/route.<group>.js`   | `routes/route.<group>.js`               |
| Route extend file       | —                           | **None**                                |
| `index.js`              | Optional                    | **Required**                            |
| `init.extend.js`        | —                           | **Do not use**                          |
| Require to libs         | `../../../libs/deps`        | `../../../libs/deps`                    |
| Require to base service | `../<sibling>/services/...` | `../../../features/<name>/services/...` |
| NATS / WS / Scheduler   | In `init`                   | In `init`                               |

### 6.7 Common Pitfalls (Extension-Only Features)

**❌ Wrong require path**

```js
// ❌ From extensions/audit-user/services/service.audit.js
const { db } = require("../../libs/deps");

// ✅
const { db } = require("../../../libs/deps");
```

**❌ Using `init.extend.js` for a new feature**

```
extensions/audit-user/
├── index.js              ← has { prefix, init(deps) }
└── init.extend.js        ← DO NOT create
```

**❌ Registering a WS path that already exists**

Use a unique path (`/ws/audit`), not `/ws/users`.

**❌ Registering a scheduler task name that already exists**

Namespace it — `audit-user:cleanup`.

**❌ NATS subscribe at module top-level**

Subscribe inside `init(deps)` or via `nats.onConnected(...)`.

**❌ Using `.extend.js` for a new feature route**

Use plain `route.<group>.js`.

---

## 7. Route Merging Modes

### Mode 1: Overwrite (Default)

```js
r.get("/:id", async (req, res) => {
  /* replaces base entirely */
});
```

### Mode 2: Prepend

Base handler stays, extension adds middleware in front.

```js
r.get("/:id", { prepend: [mw.auth, mw.requestLogger] });
```

**Do not write a handler** in prepend mode — it is ignored.

### Mode 3: Merge Middleware

```js
r.post("/", { mergeMiddleware: true }, mw.auth, async (req, res) => {
  res.json({ created: true });
});
```

### Mode 4: Prepend + Merge

```js
r.post(
  "/",
  { prepend: [mw.ipWhitelist], mergeMiddleware: true },
  mw.auth,
  handler,
);
```

### Decision Table

| Need                                    | Mode      | Syntax                                                 |
| --------------------------------------- | --------- | ------------------------------------------------------ |
| Total replace                           | Overwrite | `r.get(path, ...handlers)`                             |
| Add front middleware, keep base handler | Prepend   | `r.get(path, { prepend: [mw] })`                       |
| Base + ext middleware, new handler      | Merge     | `r.get(path, { mergeMiddleware: true }, ...)`          |
| Both                                    | Combined  | `r.get(path, { prepend, mergeMiddleware: true }, ...)` |
| New route                               | Automatic | `r.get(newPath, ...)`                                  |

### Handler Detection

The **last handler** in the argument list is the terminal handler; all previous ones are middleware.

---

## 8. Middleware

### 8.1 Base Middleware

```js
// features/<feature>/middleware.js
const { logger } = require("../../../libs/deps");

module.exports = {
  validateId: (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    next();
  },
  logRequest: (req, res, next) => {
    logger.debug(`${req.method} ${req.originalUrl}`);
    next();
  },
};
```

### 8.2 Extension Middleware

```js
// extensions/<feature>/middleware.extend.js
const { logger, nats, config } = require("../../libs/deps");

module.exports = {
  auth: (req, res, next) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "missing token" });
    req.user = { id: 1, name: "Alice", role: "admin" };
    next();
  },

  requireRole: (role) => (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: "forbidden", need: role });
    }
    next();
  },

  requestLogger: (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info("http", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
        userId: req.user?.id,
      });
    });
    next();
  },

  validateBody: (schema) => (req, res, next) => {
    const errors = [];
    for (const [field, expected] of Object.entries(schema)) {
      const value = req.body?.[field];
      if (value === undefined) errors.push({ field, error: "required" });
      else if (typeof value !== expected)
        errors.push({ field, error: `must be ${expected}` });
    }
    if (errors.length)
      return res
        .status(400)
        .json({ error: "validation failed", details: errors });
    next();
  },

  asyncHandler: (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  },

  publishAuditEvent: (action) => async (req, res, next) => {
    // Safe — no-op if NATS unavailable
    await nats.jsPublish("audit.event", {
      action,
      userId: req.user?.id,
      path: req.originalUrl,
    });
    next();
  },
};
```

### 8.3 Reuse Across Features

```js
const userMw = require("../user-management/middleware.extend");
```

### 8.4 Attach Points

| Where                           | Syntax                                   | When                |
| ------------------------------- | ---------------------------------------- | ------------------- |
| Single route                    | `r.get(path, mw, handler)`               | Default             |
| All routes below in a collector | `r.use(mw)`                              | Feature-wide policy |
| Global error handler            | `app.use(mw.errorHandler)` in `index.js` | Cross-feature       |

### 8.5 Anti-Patterns

```js
// ❌ Middleware accessing deps at top-level
const { db } = require('../../libs/deps');
const cached = db.query('SELECT 1');

// ✅ Access inside body
async function warm(req, res, next) { req.data = await db.query(...); next(); }
```

```js
// ❌ Register global middleware from extension
app.use(require("./extensions/user-management/middleware.extend").auth);

// ✅ Scope to routes only
r.get("/x", mw.auth, handler);
```

---

## 9. Service & Repository

### 9.1 Self-Instantiating Pattern

```js
// Repo
const { db } = require("../../../libs/deps");

module.exports = {
  async findById(id) {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ?? null;
  },
};

// Service
const repo = require("../repositories/repo.user");
const { logger, nats } = require("../../../libs/deps");

async function createUser({ name, email }) {
  if (!name || !email) throw new Error("name and email required");
  const user = await repo.create({ name, email });

  // Publish is safe even if NATS is down
  await nats.jsPublish("user.created", { id: user.id, name, email });

  return user;
}

module.exports = { createUser };
```

### 9.2 Why Self-Instantiating?

Routes are the composition root. Routes need services at require time. There's no DI container — the `deps` bag is the injection mechanism.

**Consequence**: `deps` must be populated **before** features are required.

### 9.3 Extension Services

```js
const userRepo = require("../../features/user-management/repositories/repo.user");
const roleRepo = require("../../features/user-management/repositories/repo.role");
const { logger } = require("../../libs/deps");

async function enrich(user) {
  logger.debug("helper.enrich", { id: user.id });
  const roles = await roleRepo.findByUserId(user.id);
  return { ...user, roles: roles.map((r) => r.name), enriched: true };
}

module.exports = { enrich };
```

### 9.4 Transaction Example

```js
async function transferBalance(fromId, toId, amount) {
  return db.tx(async (client) => {
    await client.query(
      "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
      [amount, fromId],
    );
    await client.query(
      "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
      [amount, toId],
    );
  });
}
```

### 9.5 When to Use a Service vs Inline

| Service             | Inline in route         |
| ------------------- | ----------------------- |
| Logic > 10 lines    | Trivial logic           |
| Used by > 1 route   | Single-use              |
| Needs mocking       | No test coverage needed |
| Reused by scheduler | One-off                 |

**Rule of thumb**: if the route needs `try/catch`, move the logic into a service.

---

## 10. Dependency Injection & `deps`

### 10.1 Contents

```js
// src/libs/deps.js
module.exports = {
  config: null,
  logger: null,
  db: null,
  nats: null,
  ws: null,
  scheduler: null,
  http: null,
};
```

### 10.2 Bootstrap Order

```js
async function main() {
  const config = require('./src/libs/config');                     // 1
  const logger = require('./src/libs/logger');                     // 2

  const nats = require('./src/libs/nats');
  try { await nats.init(); }
  catch (err) {
    if (config.nats.required) { logger.error('nats required'); process.exit(1); }
    logger.warn('continuing without NATS');
  }                                                                 // 3 (await)

  const db = require('./src/libs/db'); db.getPool();
  await db.healthCheck();                                           // 4

  const app = express();
  const httpServer = http.createServer(app);                        // 5

  const ws = require('./src/libs/ws'); ws.init(httpServer);         // 6
  const scheduler = require('./src/libs/scheduler');                // 7

  const deps = require('./src/libs/deps');
  Object.assign(deps, {
    config, logger, db, nats, ws, scheduler, http: httpServer,
  });                                                               // 8

  // 8b. Global scheduled tasks
  scheduler.register({ name: 'global:health-check', schedule: '*/5 * * * *', handler: async () => { /* ... */ } });

  // 8c. Global NATS callbacks (optional)
  nats.onLost((err) => logger.warn('nats lost', { error: err.message }));
  nats.onConnected(() => logger.info('nats ready'));

  const { discover } = require('./src/libs/bootstrap/discover');
  const features = discover(...);                                   // 9

  for (const f of features.values()) {
    if (f.index?.init) await f.index.init(deps);                    // 10 (await)
    if (f.extInit)     await f.extInit(deps);
  }

  for (const f of features.values()) mountFeature(app, f);          // 11

  scheduler.startAll();                                             // 12

  httpServer.listen(config.http.port);                              // 13
}
```

### 10.3 Access Rules

```js
// ✅ Require at top, access inside function body
const { db } = require("../../../libs/deps");
async function list() {
  return db.query("SELECT * FROM users");
}
```

```js
// ❌ Access at module top-level
const { db } = require("../../../libs/deps");
const users = db.query("SELECT 1"); // db is null
```

---

## 11. Feature Init Hooks

A feature's `index.js` can declare an async `init(deps)` that runs **before** routes are mounted.

### 11.1 Base Feature Init

```js
// features/user-management/index.js
module.exports = {
  prefix: "/users",

  async init(deps) {
    const { nats, ws, scheduler, logger } = deps;

    logger.info("[user-management] init");

    // ── NATS — reconnect-safe pattern ───────────────
    const setupNats = () => {
      if (!nats.isAvailable()) return;

      logger.info("[user-management] setting up NATS");

      const sub = nats.subscribeJson("user.created");
      (async () => {
        for await (const { data } of sub) {
          logger.info("[user-management] event", data);
        }
      })().catch((err) => logger.debug("sub ended", { error: err.message }));

      (async () => {
        try {
          const consumer = await nats.consume(
            "USERS",
            "user-management-worker",
          );
          const messages = await consumer.consume();
          for await (const m of messages) {
            try {
              const data = JSON.parse(nats.get().sc.decode(m.data));
              m.ack();
            } catch (err) {
              m.nak();
            }
          }
        } catch (err) {
          logger.warn("JS consumer failed", { error: err.message });
        }
      })();
    };

    nats.onConnected(setupNats);
    if (nats.isAvailable()) setupNats();

    // ── WebSocket ───────────────────────────────────
    ws.register(
      "/ws/users",
      (socket, req) => {
        socket.send(JSON.stringify({ type: "welcome" }));
        socket.on("message", (raw) => {
          socket.send(JSON.stringify({ echo: JSON.parse(raw.toString()) }));
        });
      },
      { owner: "user-management" },
    );

    // ── Scheduler ───────────────────────────────────
    scheduler.register({
      name: "user-management:cleanup-inactive",
      schedule: "0 * * * *",
      owner: "user-management",
      handler: async () => {
        const { db } = require("../../../libs/deps");
        const { rowCount } = await db.query(
          "UPDATE users SET status = 'inactive' " +
            "WHERE last_login_at < NOW() - INTERVAL '90 days'",
        );
        logger.info("[user-management] marked inactive", { count: rowCount });
      },
    });
  },
};
```

### 11.2 Extension Init — Two Cases

#### Case A — Extending a base feature (`init.extend.js`)

```js
// extensions/user-management/init.extend.js
module.exports = async function initUserExt(deps) {
  const { nats, ws, scheduler, logger } = deps;

  logger.info("[user-management.ext] init");

  // NATS — reconnect-safe pattern
  const setupNats = () => {
    if (!nats.isAvailable()) return;
    const sub = nats.subscribeJson("user.client-event");
    (async () => {
      for await (const { data } of sub) {
        logger.info("[user-management.ext] client event", data);
      }
    })().catch((err) => logger.debug("sub ended", { error: err.message }));
  };

  nats.onConnected(setupNats);
  if (nats.isAvailable()) setupNats();

  ws.register(
    "/ws/users-ext",
    (socket) => {
      socket.send(JSON.stringify({ source: "extension" }));
    },
    { owner: "user-management.ext" },
  );

  scheduler.register({
    name: "user-management.ext:daily-report",
    schedule: "30 6 * * *",
    timezone: "Asia/Jakarta",
    owner: "user-management.ext",
    handler: async () => {
      logger.info("[user-management.ext] daily report");
    },
  });
};
```

#### Case B — Extension-only feature (`index.js`)

See [Section 6.3](#63-adding-a-new-feature-client-specific) for the full walkthrough.

**How the bootstrap knows which case**:

- Discovered from `features/` → uses `index.init(deps)` if present
- Discovered only from `extensions/` → uses `index.init(deps)` (required)
- If `extensions/<feature>/init.extend.js` exists → also called as `extInit(deps)`

### 11.3 Init Order

Features are initialized in **alphabetical order**. Prefix folder names (`01-user-management`) if order matters.

### 11.4 Init Failure Handling

If `init()` throws, bootstrap exits with code 1. For features that **require** NATS:

```js
async init(deps) {
  if (!deps.nats.isAvailable()) {
    throw new Error('[my-feature] requires NATS, but it is unavailable');
  }
}
```

---

## 12. WebSocket Development

### 12.1 Path-Based Routing

| Path            | Owner               | Purpose                     |
| --------------- | ------------------- | --------------------------- |
| `/ws/users`     | user-management     | User live updates           |
| `/ws/users-ext` | user-management.ext | Client-specific user events |
| `/ws/audit`     | audit-user          | Audit live updates          |

### 12.2 Server → Client / Client → Server

```js
ws.register("/ws/orders", (socket, req) => {
  socket.send(JSON.stringify({ type: "welcome", at: Date.now() }));

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      socket.send(JSON.stringify({ ok: true, echo: msg }));
    } catch (err) {
      socket.send(JSON.stringify({ error: "invalid json" }));
    }
  });

  socket.on("close", (code) => logger.info("closed", { code }));
  socket.on("error", (err) => logger.error("ws error", { error: err.message }));
});
```

### 12.3 Broadcast

```js
ws.broadcast("/ws/orders", { type: "price-update", price: 42.5 });
```

### 12.4 Rules

- Path must start with `/`
- Path must be unique
- Heartbeat (ping/pong) is automatic
- Only register from `init(deps)` (before `httpServer.listen`)

### 12.5 Testing WebSocket

**Manual**:

```bash
npm install -g wscat
wscat -c ws://localhost:3000/ws/users
```

**Smoke test** — `scripts/ws-smoke.js`:

```js
const WebSocket = require("ws");

const BASE = process.env.WS_BASE || "ws://localhost:3000";
const PATHS = ["/ws/users", "/ws/users-ext", "/ws/audit"];

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
      `${r.ok ? "✓" : "✗"} ${path}  ${r.error ?? `${r.messages.length} message(s)`}`,
    );
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
})();
```

**Automated (Jest)**:

```js
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("connect timeout")), 3000);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForMessage(ws, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const onMsg = (raw) => {
      const data = JSON.parse(raw.toString());
      if (predicate(data)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(data);
      }
    };
    ws.on("message", onMsg);
  });
}

test("welcome + echo", async () => {
  const ws = await connect("ws://localhost:3000/ws/users");
  await waitForMessage(ws, (d) => d.type === "welcome");
  ws.send(JSON.stringify({ hello: "world" }));
  const echo = await waitForMessage(ws, (d) => d.echo);
  expect(echo.echo).toEqual({ hello: "world" });
  ws.close();
});
```

**Debug endpoint**:

```js
app.get("/debug/ws", (req, res) => res.json(deps.ws.listChannels()));
```

---

## 13. NATS JetStream & Reconnection

### 13.1 Core NATS vs JetStream

|                    | Core NATS                            | JetStream                        |
| ------------------ | ------------------------------------ | -------------------------------- |
| Persistence        | No                                   | Yes                              |
| Delivery guarantee | At-most-once                         | At-least-once                    |
| Use case           | Fire-and-forget events               | Durable work queues              |
| API                | `nats.publish`, `nats.subscribeJson` | `nats.jsPublish`, `nats.consume` |

### 13.2 Publishing

```js
// Fire-and-forget (returns false if unavailable)
nats.publish("user.viewed", { id: 123 });

// Durable (returns null if unavailable)
await nats.jsPublish("user.created", { id: user.id, email: user.email });
```

### 13.3 Subscribing — Reconnect-Safe Pattern

**The recommended pattern** for all NATS subscriptions in features and extensions:

```js
async init(deps) {
  const { nats, logger } = deps;

  // ── Step 1: define setup function (idempotent) ───
  function setupNatsSubscriptions() {
    if (!nats.isAvailable()) return;

    logger.info('[my-feature] setting up NATS subscriptions');

    // Core NATS
    const sub = nats.subscribeJson('user.created');
    (async () => {
      for await (const { data } of sub) {
        logger.info('[my-feature] event', data);
      }
    })().catch((err) => logger.debug('sub ended', { error: err.message }));

    // JetStream consumer
    (async () => {
      try {
        const consumer = await nats.consume('USERS', 'my-feature-worker');
        const messages = await consumer.consume();
        for await (const m of messages) {
          try {
            const data = JSON.parse(nats.get().sc.decode(m.data));
            m.ack();
          } catch (err) {
            m.nak();
          }
        }
      } catch (err) {
        logger.warn('[my-feature] JS consumer failed', { error: err.message });
      }
    })();
  }

  // ── Step 2: register callback ────────────────────
  nats.onConnected(setupNatsSubscriptions);

  // ── Step 3: handle case already connected ────────
  if (nats.isAvailable()) {
    setupNatsSubscriptions();
  }
}
```

**Why this pattern?** After NATS exhausts inline reconnects and succeeds via background retry, existing subscriptions are **gone**. The `onConnected` callback fires every time `init()` succeeds — including background reconnects — allowing features to re-subscribe automatically.

### 13.4 Ack Semantics

| Method     | Meaning                                 |
| ---------- | --------------------------------------- |
| `m.ack()`  | Success — do not redeliver              |
| `m.nak()`  | Retry — redeliver (up to `max-deliver`) |
| `m.term()` | Give up — do not redeliver              |

### 13.5 Reconnection Behavior

NATS reconnection has **two phases**:

| Phase          | Trigger              | Interval                            | Max Attempts             | Behavior on Exhaust             |
| -------------- | -------------------- | ----------------------------------- | ------------------------ | ------------------------------- |
| **Inline**     | Disconnect           | `NATS_RECONNECT_WAIT_MS` (2s)       | `NATS_MAX_RECONNECT` (5) | Client shutdown + fire `onLost` |
| **Background** | After inline exhaust | `NATS_RETRY_AFTER_EXHAUST_MS` (30s) | Infinite                 | Runs until reconnect succeeds   |

**Full lifecycle**:

```
Connected
   ↓ disconnect
Inline retry 1..5 (every 2s)
   ↓ fail
Log "connection lost permanently"
Fire onLost callbacks
Cleanup NATS context (ctx = null)
Start background retry loop (every 30s)
   ↓ NATS server comes back
Background retry succeeds
ctx = new connection
Fire onConnected callbacks → features re-subscribe
```

### 13.6 Reconnection Callbacks

Three callback registration methods on `deps.nats`:

| Callback                 | When it fires                                                 | Use for                              |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------ |
| `nats.onConnected(fn)`   | Every successful `init()` (initial + background retry)        | Re-subscribe, re-register consumers  |
| `nats.onLost(fn)`        | When inline retries exhausted, before background retry starts | Alerting, metrics, notify WS clients |
| `nats.onReconnected(fn)` | After background retry succeeds                               | Logging, metrics                     |

**Example**:

```js
// In feature init or root index.js
nats.onConnected(() => {
  logger.info("NATS ready — setup subscriptions");
  setupSubscriptions();
});

nats.onLost((err) => {
  logger.error("NATS lost", { error: err.message });
  // optional: alert, notify via WS
});

nats.onReconnected(() => {
  logger.info("NATS recovered via background retry");
});
```

### 13.7 Configuration

| Env                             | Default  | Purpose                                                     |
| ------------------------------- | -------- | ----------------------------------------------------------- |
| `NATS_MAX_RECONNECT`            | 5        | Inline reconnect attempts (`-1` = infinite, `0` = no retry) |
| `NATS_RECONNECT_WAIT_MS`        | 2000     | Wait between inline retries                                 |
| `NATS_AUTO_RETRY_AFTER_EXHAUST` | **true** | Enable background retry                                     |
| `NATS_RETRY_AFTER_EXHAUST_MS`   | 30000    | Background retry interval                                   |
| `NATS_REQUIRED`                 | false    | Fail-fast if NATS unavailable at startup                    |

**Behavior matrix**:

| `MAX_RECONNECT` | `AUTO_RETRY`     | Result                                                               |
| --------------- | ---------------- | -------------------------------------------------------------------- |
| `5`             | `true` (default) | Retry 5x → background retry every 30s → reconnect when server up     |
| `5`             | `false`          | Retry 5x → NATS client shutdown → app in degraded mode until restart |
| `-1`            | any              | Inline retry forever, never shutdown                                 |
| `0`             | `true`           | No inline retry → background retry starts immediately on disconnect  |

### 13.8 Degraded Mode

When NATS is unavailable:

| Operation                 | Behavior                                    |
| ------------------------- | ------------------------------------------- |
| `nats.publish(...)`       | No-op, returns `false`, logs at debug level |
| `nats.jsPublish(...)`     | No-op, returns `null`, logs at debug level  |
| `nats.subscribeJson(...)` | Returns empty iterator (never yields)       |
| `nats.consume(...)`       | Throws — guard with `isAvailable()`         |
| `nats.isAvailable()`      | `false`                                     |
| `/health`                 | Returns 200 with `checks.nats = false`      |

Application **stays running** in degraded mode.

### 13.9 Stream Setup

```bash
nats stream add USERS \
  --subjects="user.created" --storage=file --retention=limits \
  --max-age=7d --replicas=1 --defaults

nats consumer add USERS user-management-worker \
  --pull --deliver=all --ack=explicit --max-deliver=5 --defaults
```

### 13.10 Rules

| ✅ Do                                          | ❌ Don't                                     |
| ---------------------------------------------- | -------------------------------------------- |
| Subscribe inside `init(deps)`                  | Subscribe at module top-level                |
| Use `nats.onConnected(setup)` for re-subscribe | Assume subscription persists after reconnect |
| Guard with `nats.isAvailable()`                | Assume NATS is always up                     |
| Always `ack()` / `nak()`                       | Leave messages unacked (infinite redelivery) |
| Use `jsPublish` for durable events             | Use `publish` for critical events            |

### 13.11 Verifying Reconnection

```bash
# 1. Start NATS + app
docker compose up -d nats
npm start

# 2. Verify subscription works
nats pub user.created '{"id":1,"name":"Alice"}'
# → [user-management] user.created {"id":1,"name":"Alice"}

# 3. Stop NATS — wait for exhaust
docker compose stop nats
sleep 15
# → [nats] connection lost permanently
# → [nats] starting background retry

# 4. Start NATS again — wait for retry tick
docker compose start nats
sleep 35
# → [nats] connected
# → [nats] background retry succeeded
# → [user-management] setting up NATS subscriptions  ← onConnected fired

# 5. Verify subscription restored
nats pub user.created '{"id":2,"name":"Bob"}'
# → [user-management] user.created {"id":2,"name":"Bob"}   ← works!
```

If step 5 shows the log, reconnection + re-subscription works.

---

## 14. Scheduler

### 14.1 API Reference

```js
deps.scheduler.register({
  name: "unique-task-name",
  schedule: "*/5 * * * *",
  handler: async () => {
    /* ... */
  },
  timezone: "Asia/Jakarta",
  runOnInit: false,
  owner: "feature-name",
});
```

| Method                | Purpose                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `register(opts)`      | Register task (not started yet)                                          |
| `startAll()`          | Start all registered tasks                                               |
| `stopAll({ waitMs })` | Stop scheduling + wait in-flight (default 10s)                           |
| `destroyAll()`        | Fully clean up                                                           |
| `trigger(name)`       | Manually run a task                                                      |
| `list()`              | `[{ name, schedule, timezone, owner, isRunning, lastRunAt, lastError }]` |

### 14.2 Cron Expression Basics

```
 ┌───── minute (0-59)
 │ ┌───── hour (0-23)
 │ │ ┌───── day of month (1-31)
 │ │ │ ┌───── month (1-12)
 │ │ │ │ ┌───── day of week (0-6, 0=Sunday)
 * * * * *
```

| Expression    | Meaning         |
| ------------- | --------------- |
| `* * * * *`   | Every minute    |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *`   | Hourly          |
| `0 3 * * *`   | Daily at 03:00  |
| `0 8 * * 1`   | Monday 08:00    |

### 14.3 Global Task

```js
// index.js — before feature discovery
scheduler.register({
  name: "global:health-check",
  schedule: "*/5 * * * *",
  owner: "app",
  handler: async () => {
    const ok = await db.healthCheck();
    if (!ok) logger.warn("[global] DB health check failed");
  },
});
```

### 14.4 Feature / Extension Task

See [Section 11](#11-feature-init-hooks) — register from `init(deps)` or `init.extend.js`.

### 14.5 Task Guidelines

**DO**:

- Keep tasks **idempotent**
- Use unique names with namespace (`feature:task-name`)
- `await` handler's async work
- Log start + completion with counts
- Extract heavy logic into a service

**DON'T**:

- Register from module top-level
- `require('node-cron')` directly
- Assume exactly-once execution
- Do unbounded work

### 14.6 Overlap & Failure

| Scenario                        | Behavior                                     |
| ------------------------------- | -------------------------------------------- |
| Task still running at next tick | Tick **skipped** with warning                |
| Task throws                     | Logged, `lastError` updated, next tick fires |
| Server restarts mid-task        | Re-runs on next schedule — make idempotent   |

### 14.7 Debug Endpoint (dev only)

```js
if (config.env !== "production") {
  app.get("/debug/scheduler", (req, res) => res.json(scheduler.list()));
  app.post("/debug/scheduler/:name/trigger", async (req, res) => {
    try {
      await scheduler.trigger(req.params.name);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });
}
```

### 14.8 Configuration

| Env                 | Default | Purpose                          |
| ------------------- | ------- | -------------------------------- |
| `SCHEDULER_ENABLED` | `true`  | Set `false` to disable all tasks |
| `SCHEDULER_TZ`      | `UTC`   | Default timezone                 |

### 14.9 Rules

| ✅ Do                                         | ❌ Don't                            |
| --------------------------------------------- | ----------------------------------- |
| Register from `init(deps)` or root `index.js` | Register at module top-level        |
| Use `deps.scheduler.register()`               | `require('node-cron')` in a feature |
| Namespace task names                          | Reuse names across features         |
| Make handlers idempotent                      | Assume exactly-once                 |
| Guard NATS with `isAvailable()`               | Assume NATS is up                   |

---

## 15. Package Management

### 15.1 Source vs Output

```
package.base.json          ← you edit this (committed)
       │
       │  merge-package.js
       │
       ├─── src/extensions/package.json  (from CI copy, gitignored)
       │
       ▼
   package.json            ← generated, gitignored
```

**Golden rule**: Never edit `package.json`. Always edit `package.base.json`.

### 15.2 The Source File — `package.base.json`

```json
{
  "name": "base-api",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "merge:ext": "node scripts/merge-package.js",
    "merge:ext:dry": "node scripts/merge-package.js --dry-run",
    "poc:copy": "node scripts/poc-copy-extensions.js",
    "test:ws": "node scripts/ws-smoke.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.11.5",
    "winston": "^3.13.0",
    "nats": "^2.28.2",
    "ws": "^8.17.0",
    "node-cron": "^3.0.3"
  }
}
```

### 15.3 The Extension Package — `src/extensions/package.json`

```json
{
  "dependencies": {
    "uuid": "^9.0.0"
  },
  "overrides": {
    "some-transitive": "^3.0.0"
  }
}
```

Do not include `name`, `version`, `scripts`.

### 15.4 Fields Merged

| Field                                                   | Merged? |
| ------------------------------------------------------- | ------- |
| `dependencies`                                          | ✅      |
| `devDependencies`                                       | ✅      |
| `peerDependencies`                                      | ✅      |
| `optionalDependencies`                                  | ✅      |
| `overrides`                                             | ✅      |
| `resolutions`                                           | ✅      |
| `name`, `version`, `scripts`, `engines`, `main`, `type` | ❌      |

### 15.5 Commands

| Command                 | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `npm run merge:ext`     | Generate `package.json` from base + extension |
| `npm run merge:ext:dry` | Preview changes                               |

**No `--rollback`** — to reset:

```bash
rm package.json
npm run merge:ext
```

### 15.6 Conflict Strategy

| Value                      | Behavior                               |
| -------------------------- | -------------------------------------- |
| `extension-wins` (default) | Extension wins; warn on major mismatch |
| `base-wins`                | Base version preserved                 |
| `strict`                   | Fail on any conflict                   |

```bash
MERGE_STRATEGY=strict npm run merge:ext
```

### 15.7 Output

```
[merge-package] Strategy: extension-wins
[merge-package] Source:   package.base.json
[merge-package] Output:   package.json
[merge-package] Ext:      src/extensions/package.json
[merge-package] Changes: +1 added, =0 same, !0 conflicts (0 MAJOR)
[merge-package] ✓ package.json generated
[merge-package] ✓ Report → .package-merge-report.json
[merge-package] ✓ Removed stale lock: package-lock.json
```

### 15.8 Lock File Handling

`merge-package.js` deletes lock files automatically. **You must run `npm install` after merge.**

### 15.9 Common Scenarios

**Add a base dependency**:

```bash
# 1. Edit package.base.json
npm run merge:ext
npm install
```

**Extension adds a dependency**:

```bash
# 1. Edit extension-api/package.json
node scripts/poc-copy-extensions.js
npm run merge:ext
npm install
```

**Extension removed**:

```bash
rm -rf src/extensions
npm run merge:ext
npm install
```

### 15.10 `.gitignore`

```gitignore
node_modules/
src/extensions/
package.json
package-lock.json
.package-merge-report.json
```

### 15.11 Do Not Do These

| ❌                             | Why                                |
| ------------------------------ | ---------------------------------- |
| Edit `package.json` directly   | Overwritten on next merge          |
| Commit `package.json`          | Generated file — creates conflicts |
| Commit `package-lock.json`     | Regenerated after merge            |
| Skip `npm install` after merge | Extension deps won't be installed  |

---

## 16. CI/CD Flow

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: app
        ports: ["5432:5432"]
      nats:
        image: nats:2.10-alpine
        ports:
          - "4222:4222"
          - "8222:8222"

    steps:
      - uses: actions/checkout@v4
        with: { repository: org/base-api, path: base-api }

      - uses: actions/checkout@v4
        with: { repository: org/extension-api, path: extension-api }

      - uses: actions/setup-node@v4
        with: { node-version: "20" }

      - name: Copy extension sources
        run: |
          mkdir -p base-api/src/extensions
          cp -r extension-api/src/* base-api/src/extensions/
          cp    extension-api/package.json base-api/src/extensions/package.json

      - name: Generate package.json (dry-run)
        working-directory: base-api
        run: npm run merge:ext:dry

      - name: Generate package.json
        working-directory: base-api
        env: { MERGE_STRATEGY: extension-wins }
        run: npm run merge:ext

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: merge-report
          path: base-api/.package-merge-report.json

      - name: npm install
        working-directory: base-api
        run: npm install

      - name: Test
        working-directory: base-api
        env:
          SCHEDULER_ENABLED: "false" # don't wait for cron in tests
          NATS_AUTO_RETRY_AFTER_EXHAUST: "false" # don't spawn background loop in tests
        run: npm test

      - name: Start server
        working-directory: base-api
        env:
          SCHEDULER_ENABLED: "false"
        run: |
          npm start &
          echo $! > server.pid
          sleep 3

      - name: WebSocket smoke test
        working-directory: base-api
        run: node scripts/ws-smoke.js

      - name: Stop server
        working-directory: base-api
        run: kill $(cat server.pid) || true
```

### Recommended Strategy

| Phase               | Strategy                                   |
| ------------------- | ------------------------------------------ |
| Early (1-2 sprints) | `extension-wins` + monitor MAJOR conflicts |
| Stable              | `strict` — fail-fast on any conflict       |

---

## 17. Graceful Shutdown

On SIGTERM/SIGINT, shutdown order:

1. `httpServer.close()` — stop new connections, wait in-flight
2. `scheduler.stopAll()` + `destroyAll()` — stop new runs, wait in-flight (max 10s)
3. `ws.close()` — close all WebSocket clients
4. `nats.close()` — drain + suppress lost handler + stop background retry
5. `db.close()` — end pg pool
6. `process.exit(0)`

**Force-exit timer**: 15 seconds.

**Why scheduler before WS/NATS/PG?** Tasks may be mid-flight using those clients.

### 17.1 Verifying Shutdown

```bash
kill -TERM <pid>

# Expected:
# shutdown initiated {"signal":"SIGTERM"}
# http closed
# [scheduler] waiting for in-flight tasks {"count":1}
# [scheduler] task done {...}
# [scheduler] stopped {"total":6}
# scheduler stopped
# ws closed
# [nats] draining
# [nats] closed
# [nats] connection closed (intentional)
# [pg] closing pool
# pg closed
# shutdown complete
```

**Note**: `connection closed (intentional)` — the `intentionalClose` flag suppresses `onLost` handlers during shutdown.

### 17.2 Rules

**Never**:

- Call `process.exit()` inside a feature
- Call `db.close()` / `nats.nc.close()` / `scheduler.destroyAll()` directly
- Ignore SIGTERM

---

## 18. Conventions & Best Practices

### 18.1 Naming

| Location                           | Convention                | Example                      |
| ---------------------------------- | ------------------------- | ---------------------------- |
| Feature folder                     | kebab-case                | `user-management`            |
| Base route file                    | `route.<group>.js`        | `route.user.js`              |
| Extension route file (extend)      | `route.<group>.extend.js` | `route.user.extend.js`       |
| Extension route file (new feature) | `route.<group>.js`        | `route.audit.js`             |
| Service file (base)                | `service.<name>.js`       | `service.user.js`            |
| Service file (ext)                 | `<name>.js`               | `service.helper.js`          |
| Repo file                          | `repo.<name>.js`          | `repo.user.js`               |
| Middleware (base)                  | `middleware.js`           | —                            |
| Middleware (ext)                   | `middleware.extend.js`    | —                            |
| Init hook (extend base)            | `init.extend.js`          | —                            |
| Init hook (extension-only)         | `index.js` → `init(deps)` | —                            |
| Route register fn                  | `register<Group>`         | `registerUser`               |
| Route extend fn                    | `extend<Group>`           | `extendUser`                 |
| Scheduler task (feature)           | `<feature>:<action>`      | `user-management:cleanup`    |
| Scheduler task (extension)         | `<feature>.ext:<action>`  | `user-management.ext:report` |
| Scheduler task (extension-only)    | `<feature>:<action>`      | `audit-user:flush-buffer`    |
| Scheduler task (global)            | `global:<action>`         | `global:health-check`        |
| WS path (feature)                  | `/ws/<feature>`           | `/ws/users`                  |
| WS path (extension)                | `/ws/<feature>-ext`       | `/ws/users-ext`              |
| WS path (extension-only)           | `/ws/<feature>`           | `/ws/audit`                  |
| NATS subject                       | `<domain>.<event>`        | `user.created`               |
| JetStream stream                   | UPPERCASE                 | `USERS`                      |
| Durable consumer                   | `<feature>-worker`        | `audit-user-worker`          |

### 18.2 Route Function Signature

```js
// ✅ Required
module.exports = function registerUser(r) {
  r.get("/", handler);
};

// ✅ Valid
module.exports = (r) => {
  r.get("/", handler);
};

// ❌ Wrong
module.exports = express.Router();
module.exports = { registerUser };
module.exports = registerUser(r);
```

### 18.3 Handler Placement

Always place the handler **last**:

```js
r.get("/x", mwA, mwB, handler); // ✅
r.get("/x", handler, mwA, mwB); // ❌
```

### 18.4 Do Not Do These

| ❌                                                             | Why                               |
| -------------------------------------------------------------- | --------------------------------- |
| Copy extensions into `features/`                               | Base gets dirty                   |
| Register global middleware from extensions                     | No scope control                  |
| Access `deps.db` / `deps.nats` / `deps.scheduler` at top-level | Deps not ready                    |
| `require()` routes from services/middleware                    | Circular dependency               |
| Free-form route filenames                                      | Loader will not discover          |
| `module.exports = router;`                                     | Loader expects function           |
| Handler in the middle of the chain                             | Merge mis-detects terminal        |
| `process.exit()` in a feature                                  | Root handles shutdown             |
| `console.log` in features                                      | Bypass Winston                    |
| Register same WS path twice                                    | Throws at init                    |
| Register same scheduler task name twice                        | Throws at init                    |
| Subscribe to NATS at module top-level                          | Runs before deps ready            |
| Subscribe to NATS without `onConnected` re-subscribe           | Subscription lost after reconnect |
| Edit `package.json` directly                                   | Overwritten on next merge         |
| `require('node-cron')` in a feature                            | Use `deps.scheduler`              |
| Use `init.extend.js` for extension-only features               | Use `index.js`                    |
| Name route file `.extend.js` for a new feature                 | Overrides base route instead      |

### 18.5 Git Workflow

**Base-API**:

- Branches: `feature/<name>`, `fix/<name>`
- Never commit `package.json`, `package-lock.json`, `src/extensions/`, `.package-merge-report.json`
- Commit `package.base.json` when adding/removing deps

**Extension-API**:

- Branches: `client/<name>/feature/<name>`
- Every PR must have tests verifying overrides
- Commit `package.json` in the extension repo

---

## 19. Troubleshooting

### 19.1 `Cannot find module 'uuid'`

**Cause**: `package.json` merged but `npm install` not run.
**Fix**: `npm install`.

### 19.2 `Cannot read property 'get' of undefined`

**Cause**: Route file used `module.exports = fn(r)`.
**Fix**: `module.exports = fn;`.

### 19.3 `deps.db is null`

**Cause**: deps accessed at module top-level.
**Fix**: Move access inside function bodies.

### 19.4 Route Extension Not Mounted

Check:

1. Filename pattern: `route.<group>.extend.js`
2. Location: `extensions/<feature>/`
3. Extension copied? `ls base-api/src/extensions/`
4. Bootstrap output shows `[overwrite]` or `[new]`

### 19.5 Override Not Taking Effect

- `method + path` differs subtly (missing `/`)
- Group name mismatch
- `prepend` mode used but extension wrote a handler

### 19.6 NATS Connect Failed at Startup

**Symptom**: `[nats] connect failed — running in degraded mode`

**Behavior**: server starts anyway (unless `NATS_REQUIRED=true`).

**Fix**:

```bash
docker compose up -d nats
nats server check connection
```

### 19.7 NATS Connection Lost During Runtime

**Symptom**: `[nats] connection lost permanently`

**Behavior**:

- If `NATS_AUTO_RETRY_AFTER_EXHAUST=true` (default): background retry every 30s
- If `false`: NATS client shutdown, app in degraded mode until restart

**Verify**:

```bash
# Watch logs
docker compose stop nats
sleep 15
# → [nats] starting background retry

docker compose start nats
sleep 35
# → [nats] connected
```

### 19.8 NATS Reconnected but Subscriptions Not Working

**Cause**: Feature didn't use `nats.onConnected(setup)` pattern.

**Fix**: Refactor feature's `init`:

```js
// ❌ Wrong — subscription lost after reconnect
if (nats.isAvailable()) {
  const sub = nats.subscribeJson("user.created");
  // ...
}

// ✅ Correct — re-subscribe on every connect
nats.onConnected(setupNats);
if (nats.isAvailable()) setupNats();
```

### 19.9 `scheduler is not defined` at Shutdown

**Cause**: `setupShutdown` didn't destructure `scheduler`.

**Fix**:

```js
function setupShutdown({ httpServer, db, nats, ws, scheduler, logger }) {
  //                                        ^^^^^^^^^ destructure here
}
```

And ensure `main()` passes it:

```js
const shutdown = setupShutdown({ httpServer, db, nats, ws, scheduler, logger });
```

### 19.10 JetStream Consumer Not Receiving

- Stream `USERS` exists? `nats stream ls`
- Durable name correct? `nats consumer ls USERS`
- Consumer `deliver` policy includes past messages? `--deliver=all`

### 19.11 WebSocket 404 on Upgrade

**Cause**: Path not registered.
**Fix**: `deps.ws.listChannels()` after bootstrap.

### 19.12 WebSocket Disconnecting Frequently

**Fix**: Increase `WS_HEARTBEAT_MS`, ensure proxy `proxy_read_timeout` > heartbeat.

### 19.13 Postgres Pool Exhausted

- Never hold a `client` outside `db.tx()`
- Always `client.release()` in `finally`
- Increase `PG_POOL_MAX`

### 19.14 Shutdown Hangs

**Cause**: In-flight HTTP request or slow scheduler task.
**Fix**: 15s force timer exits anyway. Check log to see which step hung.

### 19.15 `✗ Missing package.json`

**Cause**: Old script version — reads `package.json` instead of `package.base.json`.

**Fix**:

```bash
grep "package.base.json" scripts/merge-package.js
# must output: const SRC_PKG = path.join(ROOT, 'package.base.json');
```

### 19.16 `✗ Source not found: package.base.json`

**Cause**: Migration incomplete.

**Fix**: `mv package.json package.base.json` (if exists), remove deprecated scripts.

### 19.17 Scheduler: `task already registered`

**Fix**: Namespace task names `<feature>:<action>`. Check `scheduler.list()`.

### 19.18 Scheduler: `invalid cron expression`

**Fix**: Validate with [crontab.guru](https://crontab.guru). `node-cron` uses 5 fields.

### 19.19 Scheduler Task Not Firing

Check:

- `SCHEDULER_ENABLED` not `false`
- Bootstrap log: `[scheduler] started { name, schedule }`
- Timezone: `SCHEDULER_TZ` or per-task

Test:

```bash
curl -X POST http://localhost:3000/debug/scheduler/<name>/trigger
```

### 19.20 Extension-Only Feature Not Discovered

Check:

1. Folder at `extensions/<feature>/`
2. `index.js` with `prefix`
3. `routes/route.<group>.js`
4. Bootstrap: `init feature: <name>`

### 19.21 Route from Extension-Only Feature Returns 404

**Cause**: Route file named `.extend.js`.
**Fix**: Rename to `route.<group>.js`.

### 19.22 WS Path Conflict

**Symptom**: `Error: WS path already registered`

**Fix**: Use unique path per feature.

### 19.23 Extension-Only Feature Init Hook Not Running

Check:

1. `index.js` exports `{ prefix, async init(deps) { ... } }`
2. Bootstrap log: `init feature: <name>`
3. No error during init

### 19.24 Extension-Only Can't Find Base Service

**Cause**: Wrong relative path.

**Fix**: From `extensions/audit-user/services/*.js`:

```js
const userServiceBase = require("../../../features/user-management/services/service.user");
```

### 19.25 Scheduler Tasks for Extension-Only Feature Not Firing

Check:

1. Registered inside `index.js` → `init(deps)`
2. `SCHEDULER_ENABLED` not `false`
3. Task name unique
4. Bootstrap log: `[scheduler] started {...}`

### 19.26 Full Reset

```bash
cd base-api
rm -rf src/extensions node_modules
rm -f package.json package-lock.json .package-merge-report.json
npm run merge:ext
npm install
docker compose down -v && docker compose up -d
```

---

## 20. Quick Reference

### 20.1 Common Commands

| Command                 | Purpose                        |
| ----------------------- | ------------------------------ |
| `npm start`             | Start server                   |
| `npm install`           | Install deps                   |
| `docker compose up -d`  | Start Postgres + NATS          |
| `npm run poc:copy`      | Copy extensions (dev)          |
| `npm run merge:ext`     | Generate `package.json`        |
| `npm run merge:ext:dry` | Preview merge                  |
| `npm run test:ws`       | WebSocket smoke test           |
| `./run-poc.sh`          | Copy + merge + install + start |

### 20.2 Shared Infra — Cheat Sheet

```js
const { config, logger, db, nats, ws, scheduler, http } = require('../../libs/deps');

// ── Logger ─────────────────────────────────────
logger.info('msg', { meta });
logger.error('err', { error: err.message, stack: err.stack });
const child = logger.child({ feature: 'x' });

// ── Postgres ───────────────────────────────────
const { rows, rowCount } = await db.query('SELECT ... WHERE id = $1', [id]);
await db.tx(async (client) => { await client.query('INSERT ...'); });
const ok = await db.healthCheck();

// ── NATS ───────────────────────────────────────
// Setup function idempotent
function setupNats() {
  if (!nats.isAvailable()) return;

  nats.publish('subject', { ... });                  // fire-and-forget
  nats.jsPublish('subject', { ... });                // durable (await)

  const sub = nats.subscribeJson('subject');
  for await (const { data } of sub) { /* ... */ }

  // JetStream consumer
  (async () => {
    const consumer = await nats.consume('STREAM', 'durable');
    const messages = await consumer.consume();
    for await (const m of messages) {
      m.ack();     // or m.nak() / m.term()
    }
  })();
}

// Register re-subscribe hook — WAJIB
nats.onConnected(setupNats);
if (nats.isAvailable()) setupNats();

// Non-fatal callbacks
nats.onLost((err) => logger.error('nats lost', { error: err.message }));
nats.onReconnected(() => logger.info('nats recovered'));

// ── WebSocket ──────────────────────────────────
ws.register('/ws/path', (socket, req) => { ... }, { owner: 'x' });
ws.broadcast('/ws/path', { ... });
ws.listChannels();

// ── Scheduler ──────────────────────────────────
scheduler.register({
  name:     'feature:task',
  schedule: '*/5 * * * *',
  owner:    'feature',
  handler:  async () => { ... },
});
scheduler.list();
scheduler.trigger('feature:task');
```

### 20.3 Route Mode Cheat Sheet

```js
// Overwrite
r.get("/:id", mw.auth, handler);

// Prepend (base handler stays)
r.get("/:id", { prepend: [mw.auth] });

// Merge middleware, new handler
r.get("/:id", { mergeMiddleware: true }, mw.auth, handler);

// Prepend + merge
r.get(
  "/:id",
  { prepend: [mw.whitelist], mergeMiddleware: true },
  mw.auth,
  handler,
);
```

### 20.4 NATS Reconnection Cheat Sheet

| Env                             | Default | Meaning                   |
| ------------------------------- | ------- | ------------------------- |
| `NATS_MAX_RECONNECT`            | 5       | Inline retry attempts     |
| `NATS_RECONNECT_WAIT_MS`        | 2000    | Inline retry interval     |
| `NATS_AUTO_RETRY_AFTER_EXHAUST` | true    | Background retry on/off   |
| `NATS_RETRY_AFTER_EXHAUST_MS`   | 30000   | Background retry interval |

| Callback                 | When                            |
| ------------------------ | ------------------------------- |
| `nats.onConnected(fn)`   | Every successful init           |
| `nats.onLost(fn)`        | After inline retries exhausted  |
| `nats.onReconnected(fn)` | After background retry succeeds |

### 20.5 Cron Cheat Sheet

| Expression    | Meaning         |
| ------------- | --------------- |
| `* * * * *`   | Every minute    |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *`   | Hourly          |
| `0 3 * * *`   | Daily 03:00     |
| `0 8 * * 1`   | Monday 08:00    |

### 20.6 Package Commands

```bash
npm run merge:ext                     # regenerate package.json
npm run merge:ext:dry                 # preview
rm package.json && npm run merge:ext  # reset
```

### 20.7 Templates

**Base route**:

```js
const service = require('../services/service.<name>');
const { logger } = require('../../../libs/deps');

module.exports = function register<Group>(r) {
  r.get('/', async (req, res) => {
    try {
      res.json(await service.list());
    } catch (err) {
      logger.error('list failed', { error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  });
};
```

**Extension route (extend)**:

```js
const serviceBase = require('../../features/<feature>/services/service.<name>');
const helper      = require('./service.<helper>');
const mw          = require('./middleware.extend');

module.exports = function extend<Group>(r) {
  r.get('/:id',
    mw.auth,
    mw.requestLogger,
    mw.asyncHandler(async (req, res) => {
      const base = await serviceBase.get(req.params.id);
      res.json(await helper.enrich(base));
    })
  );
};
```

**Feature index with init (NATS-safe)**:

```js
module.exports = {
  prefix: "/<feature>",

  async init(deps) {
    const { nats, ws, scheduler, logger } = deps;
    logger.info("[<feature>] init");

    // NATS setup (idempotent)
    const setupNats = () => {
      if (!nats.isAvailable()) return;
      const sub = nats.subscribeJson("<subject>");
      (async () => {
        for await (const { data } of sub) logger.info("event", data);
      })().catch((err) => logger.debug("sub ended", { error: err.message }));
    };

    nats.onConnected(setupNats);
    if (nats.isAvailable()) setupNats();

    // WS
    ws.register(
      "/ws/<feature>",
      (socket) => {
        socket.send(JSON.stringify({ hello: true }));
      },
      { owner: "<feature>" },
    );

    // Scheduler
    scheduler.register({
      name: "<feature>:tick",
      schedule: "*/5 * * * *",
      owner: "<feature>",
      handler: async () => {
        logger.debug("[<feature>] tick");
      },
    });
  },
};
```

**Extension init (extend case — `init.extend.js`)**:

```js
module.exports = async function init<Feature>Ext(deps) {
  const { nats, ws, scheduler, logger } = deps;
  logger.info('[<feature>.ext] init');

  const setupNats = () => {
    if (!nats.isAvailable()) return;
    const sub = nats.subscribeJson('<ext-subject>');
    (async () => {
      for await (const { data } of sub) logger.info('ext event', data);
    })().catch((err) => logger.debug('sub ended', { error: err.message }));
  };

  nats.onConnected(setupNats);
  if (nats.isAvailable()) setupNats();

  ws.register('/ws/<feature>-ext', (socket) => { /* ... */ }, { owner: '<feature>.ext' });
  scheduler.register({ name: '<feature>.ext:task', /* ... */ });
};
```

**Extension-only feature index (`index.js`)**:

```js
module.exports = {
  prefix: "/<feature>",

  async init(deps) {
    const { nats, ws, scheduler, logger } = deps;
    logger.info("[<feature>] init");

    const setupNats = () => {
      if (!nats.isAvailable()) return;
      const sub = nats.subscribeJson("<subject>");
      (async () => {
        for await (const { data } of sub) logger.info("event", data);
      })().catch((err) => logger.debug("sub ended", { error: err.message }));
    };

    nats.onConnected(setupNats);
    if (nats.isAvailable()) setupNats();

    ws.register(
      "/ws/<feature>",
      (socket) => {
        /* ... */
      },
      { owner: "<feature>" },
    );
    scheduler.register({ name: "<feature>:task" /* ... */ });
  },
};
```

### 20.8 Files & Ownership

| File                          | Edit?             | Commit?         |
| ----------------------------- | ----------------- | --------------- |
| `package.base.json`           | ✅                | ✅              |
| `package.json`                | ❌ (generated)    | ❌ (gitignored) |
| `package-lock.json`           | ❌                | ❌              |
| `src/extensions/package.json` | In extension repo | ❌ (gitignored) |
| `.package-merge-report.json`  | ❌                | ❌              |

### 20.9 Typical Workflows

**Add a dependency**:

```
Edit package.base.json → npm run merge:ext → npm install → npm start
```

**Extension added/updated**:

```
npm run poc:copy → npm run merge:ext → npm install → npm start
```

**Add a scheduled task**:

```
Edit feature init hook → npm start → verify /debug/scheduler
```

**Add an extension-only feature**:

```
Create extensions/<feature>/index.js + routes/ + services/ + repositories/
→ npm run poc:copy → npm run merge:ext → npm install → npm start
```

**Add NATS subscription (reconnect-safe)**:

```js
async init(deps) {
  const setupNats = () => {
    if (!deps.nats.isAvailable()) return;
    const sub = deps.nats.subscribeJson('<subject>');
    // ...
  };
  deps.nats.onConnected(setupNats);
  if (deps.nats.isAvailable()) setupNats();
}
```

**Something broken in package.json**:

```
rm package.json → npm run merge:ext → npm install
```

### 20.10 Glossary

| Term                       | Meaning                                                        |
| -------------------------- | -------------------------------------------------------------- |
| **Feature**                | Business domain folder                                         |
| **Extension-only feature** | Feature that exists only in `extensions/`                      |
| **Group**                  | Sub-domain within a feature                                    |
| **Base**                   | Standard feature in `base-api`                                 |
| **Extension**              | Client customization in `extension-api`                        |
| **Prefix**                 | Feature URL root                                               |
| **Collector**              | Object holding routes before mounting                          |
| **Merge**                  | Combining base + extension routes                              |
| **Mode**                   | Overwrite / prepend / merge / new                              |
| **deps**                   | Shared dependency bag                                          |
| **Init hook**              | Async `init(deps)` in feature's `index.js` or `init.extend.js` |
| **Consumer**               | JetStream durable consumer                                     |
| **Channel**                | WebSocket path registration                                    |
| **Task**                   | Scheduled cron job                                             |
| **Degraded mode**          | Running without NATS                                           |
| **Inline reconnect**       | NATS client's internal reconnect (fast, limited)               |
| **Background retry**       | Our own retry loop (slow, infinite)                            |
| **Source of truth**        | `package.base.json` (deps) or `features/` (routes)             |

---

## Contact & Contribution

- **Repo base-api**: `<internal-url>`
- **Repo extension-api**: `<internal-url>`
- **Slack**: `#api-platform`
- **Issue tracker**: `<internal-url>`

For architectural questions or breaking changes, contact the platform team first.

---

**Document version**: 5.0
**Last updated**: 2026-09-18

**Changelog**:

- **v5.0** — Full rewrite adding NATS auto-reconnect with background retry and re-subscribe pattern. Section 13 significantly expanded with reconnection lifecycle, callbacks (`onConnected`, `onLost`, `onReconnected`), and reconnect-safe subscription pattern. New env vars: `NATS_AUTO_RETRY_AFTER_EXHAUST`, `NATS_RETRY_AFTER_EXHAUST_MS`. All feature/extension init templates updated to use reconnect-safe NATS pattern. Added 4 troubleshooting entries (19.7, 19.8, 19.9, 19.14). Updated naming conventions and quick reference.
- **v4.1** — Full rewrite consolidating all prior updates. Complete walkthrough for extension-only features.
- **v4.0** — Full rewrite with scheduler support.
- **v3.1** — Added scheduler support at three levels.
- **v3.0** — Added NATS optional/degraded mode.
- **v2.1** — Split `package.json` into `package.base.json` (source) and `package.json` (generated).
- **v2.0** — Added shared infra clients (Postgres, Winston, NATS JetStream, WebSocket), feature init hooks, graceful shutdown.
- **v1.0** — Initial release.
