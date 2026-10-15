/**
 * Shared dependency bag (live bindings).
 * Populated by root index.js BEFORE any module is dynamically imported.
 *
 * Access rules:
 *   ✅ import { db, logger } from './libs/deps.js';  // live binding — selalu nilai terbaru
 *   ✅ async function foo() { await db.query(...) }   // access inside body
 *   ❌ const rows = db.query(...)  at module top-level // db is null at module evaluation time
 */

export let config = null; // object       — src/libs/config.js
export let logger = null; // winston.Logger
export let db = null; // object       — src/libs/db.js (getPool, query, tx, ...)
export let nats = null; // object       — src/libs/nats.js (init, get, publish, ...)
export let ws = null; // object       — src/libs/ws.js (init, register, broadcast, ...)
export let scheduler = null; // object       — src/libs/scheduler.js
export let http = null; // http.Server  — untuk shutdown / attach tambahan

/**
 * Populate the dependency bag. Only keys present in `values` are replaced,
 * so callers can partially override (useful for tests).
 */
export function populate(values = {}) {
  if ("config" in values) config = values.config;
  if ("logger" in values) logger = values.logger;
  if ("db" in values) db = values.db;
  if ("nats" in values) nats = values.nats;
  if ("ws" in values) ws = values.ws;
  if ("scheduler" in values) scheduler = values.scheduler;
  if ("http" in values) http = values.http;
}
