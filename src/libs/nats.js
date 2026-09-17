const { connect, StringCodec } = require("nats");
const config = require("./config");
const logger = require("./logger");

let ctx = null; // { nc, js, jsm, sc }

async function init() {
  if (ctx) return ctx;

  logger.info("[nats] connecting", { servers: config.nats.servers });

  const nc = await connect({
    servers: config.nats.servers,
    name: config.nats.name,
    maxReconnectAttempts: -1, // reconnect selamanya
    reconnectTimeWait: 2_000,
    reconnectJitter: 100,
    pingInterval: 20_000,
    maxPingOut: 3,
  });

  // ── Status monitor ─────────────────────────────────
  (async () => {
    for await (const s of nc.status()) {
      switch (s.type) {
        case "disconnect":
          logger.warn("[nats] disconnected", { server: s.data });
          break;
        case "reconnect":
          logger.info("[nats] reconnected", { server: s.data });
          break;
        case "update":
          logger.debug("[nats] server update", { server: s.data });
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

  // ── Closed handler ─────────────────────────────────
  (async () => {
    for await (const _ of nc.closed()) {
      logger.warn("[nats] connection closed");
    }
  })().catch((err) =>
    logger.error("[nats] closed loop error", { error: err.message }),
  );

  // ── JetStream ──────────────────────────────────────
  let js = null;
  let jsm = null;
  if (config.nats.jetstream) {
    jsm = await nc.jetstreamManager();
    js = nc.jetstream();
  }

  ctx = {
    nc,
    js,
    jsm,
    sc: StringCodec(),
  };

  logger.info("[nats] connected");
  return ctx;
}

function get() {
  if (!ctx) throw new Error("nats not initialized");
  return ctx;
}

/**
 * Convenience: publish JSON to a subject (core NATS, fire-and-forget).
 */
function publish(subject, payload) {
  const { nc, sc } = get();
  nc.publish(subject, sc.encode(JSON.stringify(payload)));
}

/**
 * Convenience: publish JSON to a JetStream subject (durable, at-least-once).
 */
async function jsPublish(subject, payload) {
  const { js, sc } = get();
  return js.publish(subject, sc.encode(JSON.stringify(payload)));
}

/**
 * Convenience: subscribe with JSON decoding.
 * Returns an async iterator.
 *
 *   const sub = nats.subscribeJson('user.created');
 *   for await (const msg of sub) {
 *     console.log(msg.data);          // parsed object
 *     msg.raw;                        // raw NATS msg
 *   }
 */
function subscribeJson(subject, opts = {}) {
  const { nc, sc } = get();
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

/**
 * Convenience: durable JetStream consumer.
 *
 *   const consumer = await nats.consume('STREAM', 'durable-name');
 *   const messages = await consumer.consume();
 *   for await (const m of messages) {
 *     const data = JSON.parse(sc.decode(m.data));
 *     m.ack();  // or m.nak() / m.term()
 *   }
 */
async function consume(streamName, durableName, opts = {}) {
  const { jsm, js } = get();
  const consumer = await js.consumers.get(streamName, durableName);
  return consumer;
}

async function healthCheck() {
  if (!ctx) return false;
  return !ctx.nc.isClosed();
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
  publish,
  jsPublish,
  subscribeJson,
  consume,
  healthCheck,
  close,
};
