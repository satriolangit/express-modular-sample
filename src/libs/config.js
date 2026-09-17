module.exports = {
  appName: "base-api",
  env: process.env.NODE_ENV || "development",

  http: {
    port: Number(process.env.PORT) || 3000,
  },

  pg: {
    host: process.env.PG_HOST || "8.215.75.12",
    port: Number(process.env.PG_PORT) || 5439,
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "cx123456!",
    database: process.env.PG_DATABASE || "arsi_system_db",
    poolMax: Number(process.env.PG_POOL_MAX) || 20,
    idleTimeoutMs: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30_000,
    connectionTimeoutMs: Number(process.env.PG_CONN_TIMEOUT_MS) || 5_000,
  },

  nats: {
    servers: process.env.NATS_SERVERS || "nats://localhost:4222",
    name: process.env.NATS_NAME || "base-api",
    // disable JetStream kalau tidak dipakai
    jetstream: process.env.NATS_JETSTREAM !== "false",
  },

  ws: {
    heartbeatMs: Number(process.env.WS_HEARTBEAT_MS) || 30_000,
    maxPayload: Number(process.env.WS_MAX_PAYLOAD) || 1_048_576, // 1 MB
  },

  logLevel: process.env.LOG_LEVEL || "info",

  // another env variable
  apiKey: process.env.API_KEY || "poc-secret-key",
};
