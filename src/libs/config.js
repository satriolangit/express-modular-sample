const config = {
  appName: "base-api",
  env: process.env.NODE_ENV || "development",

  http: {
    port: Number(process.env.PORT) || 3000,
  },

  pg: {
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    poolMax: Number(process.env.PG_POOL_MAX) || 20,
    idleTimeoutMs: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30_000,
    connectionTimeoutMs: Number(process.env.PG_CONN_TIMEOUT_MS) || 5_000,
  },

  nats: {
    servers: process.env.NATS_SERVERS || "nats://localhost:4222",
    name: process.env.NATS_NAME || "base-api",
    jetstream: process.env.NATS_JETSTREAM !== "false",
    required: process.env.NATS_REQUIRED === "true",

    // ── Reconnect ───────────────────────────────────────
    maxReconnectAttempts: Number(process.env.NATS_MAX_RECONNECT ?? 5),
    reconnectTimeWaitMs: Number(process.env.NATS_RECONNECT_WAIT_MS ?? 2_000),

    // ── Background retry after exhaust ──────────────────
    autoRetryAfterExhaust: process.env.NATS_AUTO_RETRY_AFTER_EXHAUST === "true",
    retryAfterExhaustIntervalMs: Number(
      process.env.NATS_RETRY_AFTER_EXHAUST_MS ?? 30_000,
    ),
  },

  ws: {
    heartbeatMs: Number(process.env.WS_HEARTBEAT_MS) || 30_000,
    maxPayload: Number(process.env.WS_MAX_PAYLOAD) || 1_048_576, // 1 MB
  },

  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED !== "false",
    timezone: process.env.SCHEDULER_TZ || "UTC",
  },

  logLevel: process.env.LOG_LEVEL || "info",

  // another env variable
  apiKey: process.env.API_KEY,
};

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

/**
 * Fail fast when required production configuration is missing.
 * Kept separate from module evaluation so tests can import config with fakes.
 */
export function assertRequiredConfig(cfg = config) {
  const missing = [];
  const pg = cfg?.pg ?? {};

  if (isBlank(pg.host)) missing.push("PG_HOST");
  if (!Number.isInteger(Number(pg.port)) || Number(pg.port) <= 0) {
    missing.push("PG_PORT");
  }
  if (isBlank(pg.user)) missing.push("PG_USER");
  if (isBlank(pg.password)) missing.push("PG_PASSWORD");
  if (isBlank(pg.database)) missing.push("PG_DATABASE");

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}

export default config;
