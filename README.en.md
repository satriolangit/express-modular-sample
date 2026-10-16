# base-api — Modular API Starter (Express 5 + ESM)

> **Bahasa Indonesia: [README.md](README.md) | English**

The core application (*base*) of the modular base + extension architecture: one Express app, many feature `modules`, and a separate `extension` repo for per-client customization. See [ARCHITECTURE.md](docs/en/ARCHITECTURE.md) for the full picture.

- **Runtime:** Node.js ≥ 20.11 (22 recommended), ESM (`"type": "module"`)
- **HTTP:** Express 5
- **Infra:** PostgreSQL (required), NATS + JetStream (optional), WebSocket, node-cron
- **Tests:** `node:test` + fake deps — no database needed (4/4 passing)
- **Status:** POC / starter — see [limitations](docs/en/ARCHITECTURE.md#9-current-design-limitations-poc)

## Quickstart (5 minutes)

```bash
# 0. Place the extension repo next to this repo:
#    modular-api-workspace/
#    ├── express-modular-sample/            ← this repo
#    └── express-modular-extension-sample/

# 1. Set up PostgreSQL (example via Docker) — the app refuses to start without it
docker run --name pg-poc -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=arsi_system_db -p 5432:5432 -d postgres:16

# 2. Adjust .env (PG_HOST=localhost, PG_PASSWORD=pass, etc.)

# 3. The four core commands
npm run poc:copy    # copy extension → src/extensions/
npm run merge:ext   # generate the merged package.json
npm install
npm start           # watch the route table in the terminal

# 4. Verify
curl -s http://localhost:3000/health
curl -s http://localhost:3000/users/1
```

Want NATS too? `docker run --name nats-poc -p 4222:4222 -d nats:latest -js` (without NATS, the app still runs in *degraded mode*).

## Tests

```bash
npm run poc:copy   # required — tests use src/extensions/
npm test           # node --test "test/**/*.test.js"
```

## Structure at a Glance

```text
index.js                # bootstrap: config → infra → deps → discover → init → mount → listen
package.base.json       # source of truth for dependencies (package.json is generated)
scripts/
  copy-extensions.js    # extension-api/src → src/extensions/
  merge-package.js      # package.base.json + extension → package.json
src/
  libs/                 # infra + composition engine (db, nats, ws, scheduler, discover, mountModule)
  modules/              # feature modules (user-management, product-management)
  extensions/           # GENERATED from the extension repo (gitignored)
test/                   # node:test + fake deps
```

## Documentation Map

| Document | Contents |
| --- | --- |
| [docs/en/DEVELOPER-GUIDE.md](docs/en/DEVELOPER-GUIDE.md) | **Start here if you're new.** Setup, tests, 6 tutorials (module, extension, WS, NATS, scheduler) + exercises |
| [docs/en/ARCHITECTURE.md](docs/en/ARCHITECTURE.md) | How the system works: bootstrap, route composition, lifecycles, build pipeline, shutdown |
| [docs/en/CONTRACT.md](docs/en/CONTRACT.md) | Mandatory rules (module, extension, merge, deps, WS, NATS, package, test, error) |

Versi Bahasa Indonesia: [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/CONTRACT.md](docs/CONTRACT.md)

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Run the server |
| `npm test` | Run all tests |
| `npm run poc:copy` | Copy the extension into `src/extensions/` |
| `npm run merge:ext` | Generate `package.json` from `package.base.json` + extension |
| `npm run merge:ext:dry` | Preview the merge without writing files |
