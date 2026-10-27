import natsLib from "nats";
import config from "./config.js";
import logger from "./logger.js";

const { connect, StringCodec } = natsLib;

// ─────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────
let ctx = null; // { nc, js, jsm, sc } | null
let lastError = null;
let intentionalClose = false;
let backgroundTimer = null;

// Callbacks
const lostHandlers = []; // dipanggil saat connection lost permanen
const reconnectedHandlers = []; // dipanggil saat background retry sukses
const connectedHandlers = []; // dipanggil setiap kali connect sukses (initial + reconnect)

// ─────────────────────────────────────────────────────
// Callback registry
// ─────────────────────────────────────────────────────
export function onLost(handler) {
  if (typeof handler === "function") lostHandlers.push(handler);
}

export function onReconnected(handler) {
  if (typeof handler === "function") reconnectedHandlers.push(handler);
}

export function onConnected(handler) {
  if (typeof handler === "function") connectedHandlers.push(handler);
}

function fire(handlers, ...args) {
  for (const h of handlers) {
    try {
      h(...args);
    } catch (err) {
      logger.error("[nats] callback threw", { error: err.message });
    }
  }
}

// ─────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────
async function cleanupContext() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;

  try {
    if (c.nc && !c.nc.isClosed()) {
      await c.nc.close();
    }
  } catch (err) {
    logger.debug("[nats] cleanup close error", { error: err.message });
  }
  logger.debug("[nats] context cleaned up");
}

// ─────────────────────────────────────────────────────
// Background retry
// ─────────────────────────────────────────────────────
function startBackgroundRetry() {
  if (backgroundTimer) return;

  const intervalMs = config.nats.retryAfterExhaustIntervalMs;
  logger.warn("[nats] starting background retry", { intervalMs });

  backgroundTimer = setInterval(async () => {
    if (ctx) {
      clearInterval(backgroundTimer);
      backgroundTimer = null;
      return;
    }

    logger.debug("[nats] background retry attempt...");

    try {
      const result = await init({ isBackgroundRetry: true });
      if (result) {
        logger.info("[nats] background retry succeeded");
        fire(reconnectedHandlers, result);
        clearInterval(backgroundTimer);
        backgroundTimer = null;
      }
    } catch (err) {
      logger.debug("[nats] background retry failed", { error: err.message });
    }
  }, intervalMs);

  backgroundTimer.unref();
}

function stopBackgroundRetry() {
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
    backgroundTimer = null;
    logger.debug("[nats] background retry stopped");
  }
}

// ─────────────────────────────────────────────────────
// JetStream
// ─────────────────────────────────────────────────────
/**
 * Attach JetStream to an existing NATS connection.
 * A server without JetStream must not take the whole app down.
 */
export async function initJetStream(nc) {
  if (
    !nc ||
    typeof nc.jetstreamManager !== "function" ||
    typeof nc.jetstream !== "function"
  ) {
    return { js: null, jsm: null };
  }

  try {
    const jsm = await nc.jetstreamManager();
    const js = nc.jetstream();
    return { js, jsm };
  } catch (err) {
    logger.warn("[nats] JetStream unavailable — continuing without it", {
      error: err.message,
    });
    return { js: null, jsm: null };
  }
}

// ─────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────
export async function init({ isBackgroundRetry = false } = {}) {
  if (ctx) return ctx;

  if (isBackgroundRetry) {
    // reset flag supaya close monitor bekerja normal lagi
    intentionalClose = false;
  } else {
    intentionalClose = false;
    logger.info("[nats] connecting", {
      servers: config.nats.servers,
      maxReconnectAttempts: config.nats.maxReconnectAttempts,
    });
  }

  let nc;
  try {
    nc = await connect({
      servers: config.nats.servers,
      name: config.nats.name,

      maxReconnectAttempts: config.nats.maxReconnectAttempts,
      reconnectTimeWait: config.nats.reconnectTimeWaitMs,
      reconnectJitter: 100,
      reconnectJitterTLS: 1_000,
      pingInterval: 20_000,
      maxPingOut: 3,
      timeout: 5_000,
    });
  } catch (err) {
    lastError = err;

    if (config.nats.required) {
      logger.error("[nats] connect failed (required)", { error: err.message });
      throw err;
    }

    if (!isBackgroundRetry) {
      logger.warn("[nats] initial connect failed — degraded mode", {
        error: err.message,
        servers: config.nats.servers,
      });

      if (config.nats.autoRetryAfterExhaust) {
        startBackgroundRetry();
      }
    }

    return null;
  }

  // ── Status monitor ─────────────────────────────────
  (async () => {
    for await (const s of nc.status()) {
      switch (s.type) {
        case "disconnect":
          logger.warn("[nats] disconnected", {
            server: s.data,
            willRetry: config.nats.maxReconnectAttempts !== 0,
          });
          break;
        case "reconnect":
          logger.info("[nats] reconnected (inline)", { server: s.data });
          break;
        case "error":
          logger.error("[nats] status error", { error: String(s.data) });
          break;
        case "ldm":
          logger.warn("[nats] lame duck mode", { server: s.data });
          break;
        default:
          logger.debug("[nats] status", { type: s.type });
      }
    }
  })().catch((err) =>
    logger.debug("[nats] status loop ended", { error: err.message }),
  );

  // ── Permanent close monitor ────────────────────────
  (async () => {
    for await (const _ of nc.closed()) {
      if (intentionalClose) {
        logger.info("[nats] connection closed (intentional)");
        return;
      }

      const err = new Error(
        `NATS connection lost after ${config.nats.maxReconnectAttempts} reconnect attempts`,
      );

      logger.error("[nats] connection lost permanently", {
        maxReconnectAttempts: config.nats.maxReconnectAttempts,
        servers: config.nats.servers,
        hint: "NATS client will shut down. Application continues in degraded mode.",
      });

      await cleanupContext();
      lastError = err;

      // Notify module code (non-fatal)
      fire(lostHandlers, err);

      // Start background retry
      if (config.nats.autoRetryAfterExhaust) {
        startBackgroundRetry();
      } else {
        logger.warn("[nats] NATS client shut down — restart app to reconnect");
      }
    }
  })().catch((err) =>
    logger.debug("[nats] closed loop ended", { error: err.message }),
  );

  // ── JetStream ──────────────────────────────────────
  let js = null;
  let jsm = null;
  if (config.nats.jetstream) {
    ({ js, jsm } = await initJetStream(nc));
  }

  ctx = { nc, js, jsm, sc: StringCodec() };
  lastError = null;

  logger.info("[nats] connected");

  // Notify module code (untuk re-subscribe saat reconnect)
  if (isBackgroundRetry) {
    logger.info("[nats] notifying modules to re-subscribe");
    fire(connectedHandlers, ctx);
  } else {
    // Initial connect juga fire — supaya module bisa register di sini
    fire(connectedHandlers, ctx);
  }

  return ctx;
}

// ─────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────
export function get() {
  if (!ctx) throw new Error("nats not available");
  return ctx;
}

export function isAvailable() {
  return ctx !== null && !ctx.nc.isClosed();
}

function lastErrorFn() {
  return lastError;
}

export function publish(subject, payload) {
  if (!isAvailable()) {
    logger.debug("[nats] publish skipped (unavailable)", { subject });
    return false;
  }
  try {
    const { nc, sc } = ctx;
    nc.publish(subject, sc.encode(JSON.stringify(payload)));
    return true;
  } catch (err) {
    logger.error("[nats] publish failed", { subject, error: err.message });
    return false;
  }
}

export async function jsPublish(subject, payload) {
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

export function subscribeJson(subject, opts = {}) {
  if (!isAvailable()) {
    logger.warn("[nats] subscribe skipped (unavailable)", { subject });
    return {
      async *[Symbol.asyncIterator]() {},
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

export async function consume(streamName, durableName) {
  if (!isAvailable() || !ctx.js) {
    throw new Error("nats JetStream not available");
  }
  return ctx.js.consumers.get(streamName, durableName);
}

export function healthCheck() {
  return isAvailable();
}

export function jetstreamAvailable() {
  return isAvailable() && Boolean(ctx?.js);
}

export async function close() {
  intentionalClose = true;
  stopBackgroundRetry();

  if (!ctx) {
    logger.info("[nats] close called — already unavailable");
    return;
  }

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

export { lastErrorFn as lastError };
