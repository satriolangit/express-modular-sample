const { Pool } = require("pg");
const config = require("./config");
const logger = require("./logger");

let pool = null;

function getPool() {
  if (pool) return pool;

  pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    database: config.pg.database,
    max: config.pg.poolMax,
    idleTimeoutMillis: config.pg.idleTimeoutMs,
    connectionTimeoutMillis: config.pg.connectionTimeoutMs,
  });

  pool.on("connect", () => {
    logger.debug("[pg] client connected");
  });

  pool.on("acquire", () => {
    logger.debug("[pg] client acquired");
  });

  pool.on("remove", () => {
    logger.debug("[pg] client removed");
  });

  pool.on("error", (err) => {
    // idle client error — pool recovers, jangan crash
    logger.error("[pg] idle client error", { error: err.message });
  });

  return pool;
}

/**
 * Convenience wrapper: query with logging + error enrichment.
 * Usage: const { rows, rowCount } = await query('SELECT ...', [args])
 */
async function query(sql, params = []) {
  const start = Date.now();
  try {
    const result = await getPool().query(sql, params);
    logger.debug("[pg] query", {
      durationMs: Date.now() - start,
      rowCount: result.rowCount,
    });
    return result;
  } catch (err) {
    logger.error("[pg] query error", {
      error: err.message,
      durationMs: Date.now() - start,
    });
    throw err;
  }
}

/**
 * Transaction helper.
 * Usage:
 *   await tx(async (client) => {
 *     await client.query('INSERT ...');
 *     await client.query('UPDATE ...');
 *   });
 */
async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  const { rows } = await getPool().query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}

async function close() {
  if (pool) {
    logger.info("[pg] closing pool");
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  query,
  tx,
  healthCheck,
  close,
};
