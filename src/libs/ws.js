import { WebSocketServer, WebSocket } from "ws";
import config from "./config.js";
import logger from "./logger.js";

let wss = null;
const channels = new Map(); // path → { handler, owner }
const heartbeats = new WeakMap(); // socket → { isAlive }

export function init(httpServer) {
  if (wss) return wss;

  wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.ws.maxPayload,
  });

  // ── Manual upgrade routing ─────────────────────────
  httpServer.on("upgrade", (req, socket, head) => {
    try {
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
    } catch (err) {
      logger.warn("[ws] invalid upgrade request", { error: err.message });
      try {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      } catch {}
      socket.destroy();
    }
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
export function register(path, handler, opts = {}) {
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

export function unregister(path) {
  channels.delete(path);
}

export function listChannels() {
  return [...channels.entries()].map(([path, { owner }]) => ({ path, owner }));
}

export function broadcast(path, payload) {
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

export function get() {
  return wss;
}

export async function healthCheck() {
  if (!wss) return false;
  return true;
}

export async function close() {
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
