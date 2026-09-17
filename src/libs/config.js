module.exports = {
  appName: "base-api",
  env: process.env.NODE_ENV || "development",

  pg: {
    host: process.env.PG_HOST || "localhost",
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "postgres",
    database: process.env.PG_DATABASE || "app",
    poolMax: Number(process.env.PG_POOL_MAX) || 20,
  },

  nats: {
    servers: process.env.NATS_SERVERS || "nats://localhost:4222",
    name: process.env.NATS_NAME || "base-api",
  },

  ws: {
    path: process.env.WS_PATH || "/ws",
  },

  logLevel: process.env.LOG_LEVEL || "info",
};
