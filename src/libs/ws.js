const { WebSocketServer, WebSocket } = require("ws");
const config = require("./config");
const logger = require("./logger");

let wss = null;
const channels = new Map(); // path → { handler, owner }
const heartbeats = new WeakMap(); // socket → { isAlive }

function init(httpServer) {
  if (wss) return wss;

  wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.ws.maxPayload,
  });

  // ── Manual upgrade routing ─────────────────────────
  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url, `http://${req.headers.host || "x"}`)
      .pathname;
    const entry = channels.get(pathname);

    if (!entry) {
      logger.warn("[ws] upgrade to unknown path", { path: pathname });
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.__path = pathname;
      ws.__owner = entry.owner;

      // ── Heartbeat setup ────────────────────────────
      heartbeats.set(ws, { isAlive: true });
      ws.on("pong", () => {
        heartbeats.set(ws, { isAlive: true });
      });

      ws.on("error", (err) => {
        logger.error("[ws] socket error", {
          path: pathname,
          error: err.message,
        });
      });

      try {
        entry.handler(ws, req);
      } catch (err) {
        logger.error("[ws] handler threw", {
          path: pathname,
          error: err.message,
        });
        ws.close(1011, "handler error");
      }
    });
  });

  // ── Global heartbeat interval ──────────────────────
  const interval = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      const state = heartbeats.get(ws);
      if (state && state.isAlive === false) {
        logger.debug("[ws] terminating dead client", { path: ws.__path });
        ws.terminate();
        continue;
      }
      if (state) state.isAlive = false;
      try {
        ws.ping();
      } catch {}
    }
  }, config.ws.heartbeatMs);
  interval.unref();

  wss.on("close", () => clearInterval(interval));

  logger.info("[ws] server initialized");
  return wss;
}

/**
 * Register a WS handler for a specific path.
 * Throws if path is already registered — prevents accidental conflicts.
 */
function register(path, handler, opts = {}) {
  if (!path.startsWith("/")) {
    throw new Error(`WS path must start with "/": ${path}`);
  }
  if (channels.has(path)) {
    throw new Error(
      `WS path already registered: ${path} ` +
        `(owner: ${channels.get(path).owner})`,
    );
  }
  channels.set(path, { handler, owner: opts.owner ?? "unknown" });
  logger.debug("[ws] registered", { path, owner: opts.owner });
}

function unregister(path) {
  channels.delete(path);
}

function listChannels() {
  return [...channels.entries()].map(([path, { owner }]) => ({ path, owner }));
}

function broadcast(path, payload) {
  if (!wss) return 0;
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  let count = 0;
  for (const ws of wss.clients) {
    if (ws.__path === path && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data);
        count++;
      } catch {}
    }
  }
  return count;
}

function get() {
  return wss;
}

async function healthCheck() {
  if (!wss) return false;
  return true;
}

async function close() {
  if (!wss) return;
  logger.info("[ws] closing server");

  // Beri tahu semua client, tunggu mereka close
  for (const ws of wss.clients) {
    try {
      ws.close(1001, "server shutting down");
    } catch {}
  }

  // Force close setelah grace period
  const forceTimer = setTimeout(() => {
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch {}
    }
  }, 5_000);
  forceTimer.unref();

  await new Promise((resolve) => wss.close(resolve));
  clearTimeout(forceTimer);

  wss = null;
  channels.clear();
  logger.info("[ws] closed");
}

module.exports = {
  init,
  register,
  unregister,
  listChannels,
  broadcast,
  get,
  healthCheck,
  close,
};
