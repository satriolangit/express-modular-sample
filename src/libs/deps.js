/**
 * Shared dependency bag.
 * Populated by root index.js BEFORE any feature is required.
 *
 * Access rules:
 *   ✅ const { db, logger } = require('./libs/deps');       // top-level require
 *   ✅ async function foo() { await db.query(...) }         // access inside body
 *   ❌ const rows = db.query(...)  at module top-level      // db is null at require time
 */

module.exports = {
  config: null, // object       — src/libs/config.js
  logger: null, // winston.Logger
  db: null, // object       — src/libs/db.js (getPool, query, tx, ...)
  nats: null, // object       — src/libs/nats.js (init, get, publish, ...)
  ws: null, // object       — src/libs/ws.js (init, register, broadcast, ...)
  http: null, // http.Server  — untuk shutdown / attach tambahan
};
