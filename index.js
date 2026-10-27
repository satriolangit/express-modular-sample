import "dotenv/config";

import http from "node:http";
import path from "node:path";
import express from "express";

import config, { assertRequiredConfig } from "./src/libs/config.js";
import logger from "./src/libs/logger.js";
import * as nats from "./src/libs/nats.js";
import * as db from "./src/libs/db.js";
import * as ws from "./src/libs/ws.js";
import * as scheduler from "./src/libs/scheduler.js";
import { populate } from "./src/libs/deps.js";
import { discover } from "./src/libs/bootstrap/discover.js";
import { mountModule } from "./src/libs/mountModule.js";
import { computeHealth } from "./src/libs/health.js";

async function main() {
  // ────────────────────────────────────────────────
  // LOGGER (sync — Winston)
  // ────────────────────────────────────────────────
  logger.info("bootstrap starting", {
    app: config.appName,
    env: config.env,
  });

  try {
    assertRequiredConfig();
  } catch (err) {
    logger.error("invalid configuration", { error: err.message });
    process.exit(1);
  }

  // ────────────────────────────────────────────────
  // NATS (async — must await connect)
  // ────────────────────────────────────────────────
  try {
    await nats.init();
  } catch (err) {
    logger.error("nats required but unavailable", { error: err.message });
    process.exit(1);
  }

  if (!nats.isAvailable()) {
    logger.warn("continuing without NATS — some modules may be degraded");
  }

  // ────────────────────────────────────────────────
  // POSTGRES (sync — Pool lazy connect)
  // ────────────────────────────────────────────────
  db.getPool(); // trigger pool creation

  try {
    const ok = await db.healthCheck();
    if (!ok) throw new Error("health check returned false");
    logger.info("postgres ready");
  } catch (err) {
    logger.error("postgres unreachable", { error: err.message });
    process.exit(1);
  }

  // ────────────────────────────────────────────────
  // HTTP SERVER + EXPRESS
  // ────────────────────────────────────────────────
  const app = express();
  app.set("trust proxy", config.http.trustProxy);

  // Request ID + access log — before body parsers so parse errors keep reqId
  app.use((req, res, next) => {
    req.id =
      req.headers["x-request-id"] ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    res.set("X-Request-Id", req.id);

    const start = Date.now();
    res.on("finish", () => {
      logger.info("http", {
        reqId: req.id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  const httpServer = http.createServer(app);

  httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`port ${config.http.port} is already in use`);
    } else {
      logger.error("http server error", { error: err.message });
    }
    process.exit(1);
  });

  // ────────────────────────────────────────────────
  // WEBSOCKET (attach to http.Server)
  // ────────────────────────────────────────────────
  ws.init(httpServer);

  // ────────────────────────────────────────────────
  // POPULATE DEPS
  // ────────────────────────────────────────────────
  const deps = {
    config,
    logger,
    db,
    nats,
    ws,
    scheduler,
    http: httpServer,
  };
  populate(deps);

  logger.info("deps populated");

  // ────────────────────────────────────────────────
  // REGISTER GLOBAL SCHEDULED TASKS
  // ────────────────────────────────────────────────
  scheduler.register({
    name: "global:health-check",
    schedule: "*/5 * * * *", // every 5 minutes
    owner: "app",
    handler: async () => {
      const ok = await db.healthCheck();
      if (!ok) logger.warn("[global] DB health check failed");
    },
  });

  // ────────────────────────────────────────────────
  // DISCOVER MODULES
  // ────────────────────────────────────────────────
  const modules = await discover(
    path.join(import.meta.dirname, "src", "modules"),
    path.join(import.meta.dirname, "src", "extensions"),
  );

  logger.info(`discovered ${modules.size} module(s)`);

  // ────────────────────────────────────────────────
  // INIT HOOK (subscribe NATS, register WS)
  // ────────────────────────────────────────────────
  for (const mod of modules.values()) {
    // module init
    if (typeof mod.index?.init === "function") {
      logger.info(`init module: ${mod.name}`);
      try {
        await mod.index.init(deps);
      } catch (err) {
        logger.error(`module init failed: ${mod.name}`, {
          error: err.message,
          stack: err.stack,
        });
        process.exit(1);
      }
    }

    // extension init
    if (typeof mod.extInit === "function") {
      logger.info(`init extension: ${mod.name}`);
      try {
        await mod.extInit(deps);
      } catch (err) {
        logger.error(`extension init failed: ${mod.name}`, {
          error: err.message,
          stack: err.stack,
        });
        process.exit(1);
      }
    }
  }

  // ────────────────────────────────────────────────
  // MOUNT ROUTES
  // ────────────────────────────────────────────────
  for (const mod of modules.values()) {
    mountModule(app, mod);
  }

  // ────────────────────────────────────────────────
  //  HEALTH CHECK
  // ────────────────────────────────────────────────
  app.get("/health", async (req, res) => {
    const checks = {
      pg: false,
      nats: false,
      ws: false,
    };

    try {
      checks.pg = await db.healthCheck();
    } catch {}
    try {
      checks.nats = await nats.healthCheck();
    } catch {}
    try {
      checks.ws = await ws.healthCheck();
    } catch {}

    const health = computeHealth(checks, {
      natsRequired: config.nats.required,
    });
    res.status(health.ok ? 200 : 503).json({
      ...health,
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  // ────────────────────────────────────────────────
  // ERROR HANDLING (Express 5 forwards async errors here)
  // ────────────────────────────────────────────────
  app.use((err, req, res, next) => {
    logger.error("unhandled request error", {
      reqId: req.id,
      method: req.method,
      path: req.originalUrl,
      error: err.message,
      stack: err.stack,
    });
    if (res.headersSent) return next(err);
    res.status(err.statusCode || 500).json({ error: "internal error" });
  });

  // ────────────────────────────────────────────────
  // GRACEFUL SHUTDOWN
  // ────────────────────────────────────────────────
  setupShutdown({ httpServer, db, nats, ws, logger, scheduler });

  // Nats log
  nats.onLost((err) => {
    logger.warn("NATS connection lost — degraded mode", {
      error: err.message,
      impact: "NATS publish/subscribe disabled until reconnect",
    });
    // optional: metrics, alerting, health probe marking
  });

  nats.onConnected(() => {
    logger.info("NATS connection ready");
  });

  nats.onReconnected(() => {
    logger.info("NATS reconnected via background retry");
  });

  // ────────────────────────────────────────────────
  // LISTEN
  // ────────────────────────────────────────────────
  httpServer.listen(config.http.port, () => {
    logger.info(`http://localhost:${config.http.port}`);
    logger.info(`ws available on registered paths`);

    try {
      scheduler.startAll();
    } catch (err) {
      logger.error("scheduler start failed", { error: err.message });
      process.exit(1);
    }
  });
}

function setupShutdown({ httpServer, db, nats, ws, logger, scheduler }) {
  let shuttingDown = false;

  const shutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`shutdown initiated`, { signal });

    const forceTimer = setTimeout(() => {
      logger.error("shutdown forced after 15s");
      process.exit(1);
    }, 15_000);
    forceTimer.unref();

    // HTTP: stop accepting new connections. Callback di-await terakhir —
    // upgraded WS sockets tidak ditrack HTTP server dan bisa menahan 'close'.
    const httpClosed = new Promise((resolve) => {
      httpServer.close((err) => {
        if (err) logger.warn("http close error", { error: err.message });
        resolve();
      });
    });

    // ── WebSocket: close all clients ──
    try {
      await ws.close();
      logger.info("ws closed");
    } catch (err) {
      logger.error("ws close error", { error: err.message });
    }

    await httpClosed;
    logger.info("http closed");

    // -- Scheduler: stop new runs, wait in-flight  ← NEW
    try {
      await scheduler.stopAll({ waitMs: 10_000 });
      scheduler.destroyAll();
    } catch (err) {
      logger.error("scheduler close error", { error: err.message });
    }

    // ── NATS: drain pending publish + unsubscribe ──
    try {
      await nats.close();
      logger.info("nats closed");
    } catch (err) {
      logger.error("nats close error", { error: err.message });
    }

    // ── Postgres: end pool ──
    try {
      await db.close();
      logger.info("pg closed");
    } catch (err) {
      logger.error("pg close error", { error: err.message });
    }

    logger.info("shutdown complete");
    process.exit(exitCode);
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
    process.exitCode = 1;
    shutdown("uncaughtException", 1);
  });
}

main().catch((err) => {
  console.error("bootstrap fatal:", err);
  process.exit(1);
});
