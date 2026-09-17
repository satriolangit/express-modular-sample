require("dotenv").config();

const http = require("http");
const express = require("express");
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
    logger.error("nats connect failed", { error: err.message });
    process.exit(1);
  }

  // ────────────────────────────────────────────────
  // POSTGRES (sync — Pool lazy connect)
  // ────────────────────────────────────────────────
  const db = require("./src/libs/db");
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
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Request ID + access log
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

  const httpServer = http.createServer(app);

  // ────────────────────────────────────────────────
  // WEBSOCKET (attach to http.Server)
  // ────────────────────────────────────────────────
  const ws = require("./src/libs/ws");
  ws.init(httpServer);

  // ────────────────────────────────────────────────
  // POPULATE DEPS
  // ────────────────────────────────────────────────
  const deps = require("./src/libs/deps");
  Object.assign(deps, {
    config,
    logger,
    db,
    nats,
    ws,
    http: httpServer,
  });

  logger.info("deps populated");

  // ────────────────────────────────────────────────
  // DISCOVER FEATURES
  // ────────────────────────────────────────────────
  const { discover } = require("./src/libs/bootstrap/discover");
  const { mountFeature } = require("./src/libs/mountFeature");

  const features = discover(
    path.join(__dirname, "src", "features"),
    path.join(__dirname, "src", "extensions"),
  );

  logger.info(`discovered ${features.size} feature(s)`);

  // ────────────────────────────────────────────────
  // INIT HOOK (subscribe NATS, register WS)
  // ────────────────────────────────────────────────
  for (const feature of features.values()) {
    // feature init
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

    // extension init (kalau ada)
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
  // MOUNT ROUTES
  // ────────────────────────────────────────────────
  for (const feature of features.values()) {
    mountFeature(app, feature);
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

    const ok = checks.pg && checks.nats;
    res.status(ok ? 200 : 503).json({
      ok,
      uptimeSec: Math.floor(process.uptime()),
      checks,
    });
  });

  // ────────────────────────────────────────────────
  // GRACEFUL SHUTDOWN
  // ────────────────────────────────────────────────
  setupShutdown({ httpServer, db, nats, ws, logger });

  // ────────────────────────────────────────────────
  // LISTEN
  // ────────────────────────────────────────────────
  httpServer.listen(config.http.port, () => {
    logger.info(`http://localhost:${config.http.port}`);
    logger.info(`ws available on registered paths`);
  });
}

function setupShutdown({ httpServer, db, nats, ws, logger }) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`shutdown initiated`, { signal });

    const forceTimer = setTimeout(() => {
      logger.error("shutdown forced after 15s");
      process.exit(1);
    }, 15_000);
    forceTimer.unref();

    // ── 1. HTTP: stop new connections, wait for in-flight ──
    await new Promise((resolve) => {
      httpServer.close((err) => {
        if (err) logger.warn("http close error", { error: err.message });
        resolve();
      });
    });
    logger.info("http closed");

    // ── 2. WebSocket: close all clients ──
    try {
      await ws.close();
      logger.info("ws closed");
    } catch (err) {
      logger.error("ws close error", { error: err.message });
    }

    // ── 3. NATS: drain pending publish + unsubscribe ──
    try {
      await nats.close();
      logger.info("nats closed");
    } catch (err) {
      logger.error("nats close error", { error: err.message });
    }

    // ── 4. Postgres: end pool ──
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
