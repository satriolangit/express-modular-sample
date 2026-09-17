const { connect, StringCodec } = require("nats");
const config = require("./config");
const logger = require("./logger");

let ctx = null; // { nc, js, jsm, sc } atau null
let lastError = null; // Error terakhir kalau init gagal

async function init() {
  if (ctx) return ctx;

  logger.info("[nats] connecting", { servers: config.nats.servers });

  try {
    const nc = await connect({
      servers: config.nats.servers,
      name: config.nats.name,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2_000,
      reconnectJitter: 100,
      pingInterval: 20_000,
      maxPingOut: 3,
      // timeout connect supaya tidak hang lama saat server down
      timeout: 5_000,
    });

    // ── Status monitor ─────────────────────────────
    (async () => {
      for await (const s of nc.status()) {
        switch (s.type) {
          case "disconnect":
            logger.warn("[nats] disconnected", { server: s.data });
            break;
          case "reconnect":
            logger.info("[nats] reconnected", { server: s.data });
            break;
          case "error":
            logger.error("[nats] status error", { error: String(s.data) });
            break;
          default:
            logger.debug("[nats] status", { type: s.type });
        }
      }
    })().catch((err) =>
      logger.error("[nats] status loop error", { error: err.message }),
    );

    // ── JetStream (opsional) ───────────────────────
    let js = null;
    let jsm = null;
    if (config.nats.jetstream) {
      jsm = await nc.jetstreamManager();
      js = nc.jetstream();
    }

    ctx = { nc, js, jsm, sc: StringCodec() };
    lastError = null;
    logger.info("[nats] connected");
    return ctx;
  } catch (err) {
    lastError = err;
    ctx = null;

    if (config.nats.required) {
      logger.error("[nats] connect failed (required)", { error: err.message });
      throw err;
    }

    logger.warn("[nats] connect failed — running in degraded mode", {
      error: err.message,
      servers: config.nats.servers,
      hint: "Set NATS_REQUIRED=true to fail-fast on NATS unavailability",
    });
    return null;
  }
}

function isAvailable() {
  return ctx !== null && !ctx.nc.isClosed();
}

function get() {
  if (!ctx) throw new Error("nats not available");
  return ctx;
}

// function lastError() {
//   return lastError;
// }

// ── Publish helpers (safe — no-op if unavailable) ───
function publish(subject, payload) {
  if (!isAvailable()) {
    logger.debug("[nats] publish skipped (unavailable)", { subject });
    return false;
  }
  const { nc, sc } = ctx;
  try {
    nc.publish(subject, sc.encode(JSON.stringify(payload)));
    return true;
  } catch (err) {
    logger.error("[nats] publish failed", { subject, error: err.message });
    return false;
  }
}

async function jsPublish(subject, payload) {
  if (!isAvailable() || !ctx.js) {
    logger.debug("[nats] jsPublish skipped (unavailable)", { subject });
    return null;
  }
  try {
    const { js, sc } = ctx;
    return await js.publish(subject, sc.encode(JSON.stringify(payload)));
  } catch (err) {
    logger.error("[nats] jsPublish failed", { subject, error: err.message });
    return null;
  }
}

function subscribeJson(subject, opts = {}) {
  if (!isAvailable()) {
    logger.warn("[nats] subscribe skipped (unavailable)", { subject });
    return {
      async *[Symbol.asyncIterator]() {
        /* never yields */
      },
      unsubscribe() {},
    };
  }
  const { nc, sc } = ctx;
  const sub = nc.subscribe(subject, opts);

  return {
    async *[Symbol.asyncIterator]() {
      for await (const m of sub) {
        let data;
        try {
          data = JSON.parse(sc.decode(m.data));
        } catch (err) {
          logger.error("[nats] invalid JSON", { subject, error: err.message });
          continue;
        }
        yield { data, raw: m, subject: m.subject };
      }
    },
    unsubscribe() {
      sub.unsubscribe();
    },
  };
}

async function consume(streamName, durableName, opts = {}) {
  if (!isAvailable() || !ctx.js) {
    throw new Error("nats JetStream not available");
  }
  const { js } = ctx;
  return js.consumers.get(streamName, durableName);
}

function healthCheck() {
  return isAvailable();
}

async function close() {
  if (!ctx) return;
  logger.info("[nats] draining");
  try {
    await ctx.nc.drain();
  } catch (err) {
    logger.error("[nats] drain error", { error: err.message });
    try {
      await ctx.nc.close();
    } catch {}
  }
  ctx = null;
  logger.info("[nats] closed");
}

module.exports = {
  init,
  get,
  isAvailable,
  lastError,
  publish,
  jsPublish,
  subscribeJson,
  consume,
  healthCheck,
  close,
};
