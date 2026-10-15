import pg from "pg";
import config from "./config.js";
import logger from "./logger.js";

const { Pool } = pg;

let pool = null;

export function getPool() {
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
export async function query(sql, params = []) {
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
export async function tx(fn) {
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

export async function healthCheck() {
  const { rows } = await getPool().query("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}

// ─────────────────────────────────────────────────────
// Insert helper (parameterized values, generated column list)
// ─────────────────────────────────────────────────────
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

export function buildInsertSQL(table, columns) {
  if (!IDENTIFIER.test(table)) {
    throw new Error(`[pg] invalid table name: ${table}`);
  }
  if (columns.length === 0) {
    throw new Error("[pg] insert requires at least one column");
  }
  for (const col of columns) {
    if (!IDENTIFIER.test(col)) {
      throw new Error(`[pg] invalid column name: ${col}`);
    }
  }
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`;
}

/**
 * Insert a row built from object keys. Values are always parameterized;
 * table/column names are validated identifiers.
 * Usage: const row = await insert('audit_logs', { id, user_id, action });
 */
export async function insert(table, row) {
  const columns = Object.keys(row ?? {});
  const params = columns.map((col) => row[col]);
  const { rows } = await query(buildInsertSQL(table, columns), params);
  return rows[0];
}

export async function close() {
  if (pool) {
    logger.info("[pg] closing pool");
    await pool.end();
    pool = null;
  }
}
