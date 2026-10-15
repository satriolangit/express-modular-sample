import cron from "node-cron";
import config from "./config.js";
import logger from "./logger.js";

const tasks = new Map(); // name → { task, meta, state, handler }
const pending = new Set(); // Set<Promise> — in-flight runs

/**
 * Register a scheduled task.
 *
 * @param {object} opts
 * @param {string} opts.name       - unique task identifier
 * @param {string} opts.schedule   - cron expression ('*\/5 * * * *')
 * @param {Function} opts.handler  - async () => void
 * @param {string} [opts.timezone] - IANA tz; default config.scheduler.timezone
 * @param {boolean} [opts.runOnInit] - run once at startup
 * @param {string} [opts.owner]    - module/extension name (for logs)
 * @returns {import('node-cron').ScheduledTask}
 */
export function register({
  name,
  schedule,
  handler,
  timezone,
  runOnInit,
  owner = "app",
}) {
  if (!name || typeof name !== "string") {
    throw new Error("scheduler.register: name is required");
  }
  if (tasks.has(name)) {
    throw new Error(`scheduler.register: task already registered: ${name}`);
  }
  if (typeof handler !== "function") {
    throw new Error(`scheduler.register: handler must be function: ${name}`);
  }
  if (!cron.validate(schedule)) {
    throw new Error(
      `scheduler.register: invalid cron expression "${schedule}" (${name})`,
    );
  }

  const tz = timezone || config.scheduler.timezone;
  const state = { running: false, lastRunAt: null, lastError: null };

  async function runOnce() {
    if (state.running) {
      logger.warn("[scheduler] task still running — skipping this tick", {
        name,
        owner,
      });
      return;
    }
    state.running = true;
    state.lastRunAt = new Date().toISOString();

    const start = Date.now();
    const p = (async () => {
      try {
        logger.debug("[scheduler] task start", { name, owner });
        await handler();
        state.lastError = null;
        logger.info("[scheduler] task done", {
          name,
          owner,
          durationMs: Date.now() - start,
        });
      } catch (err) {
        state.lastError = err.message;
        logger.error("[scheduler] task failed", {
          name,
          owner,
          durationMs: Date.now() - start,
          error: err.message,
          stack: err.stack,
        });
      } finally {
        state.running = false;
      }
    })();

    pending.add(p);
    try {
      await p;
    } finally {
      pending.delete(p);
    }
  }

  const task = cron.schedule(schedule, runOnce, {
    scheduled: false, // we start manually via startAll()
    timezone: tz,
    name,
  });

  tasks.set(name, {
    task,
    meta: { name, schedule, timezone: tz, owner, runOnInit: !!runOnInit },
    state,
    handler,
  });

  if (runOnInit) {
    setImmediate(() => {
      runOnce();
    });
  }

  logger.debug("[scheduler] registered", {
    name,
    schedule,
    timezone: tz,
    owner,
  });
  return task;
}

/**
 * Start all registered tasks. Called once after bootstrap init.
 */
export function startAll() {
  if (!config.scheduler.enabled) {
    logger.warn(
      "[scheduler] disabled via SCHEDULER_ENABLED=false — no tasks started",
    );
    return;
  }
  for (const [name, entry] of tasks) {
    entry.task.start();
    logger.info("[scheduler] started", {
      name,
      schedule: entry.meta.schedule,
      timezone: entry.meta.timezone,
      owner: entry.meta.owner,
    });
  }
}

/**
 * Stop scheduling new runs and wait for in-flight tasks (up to waitMs).
 */
export async function stopAll({ waitMs = 10_000 } = {}) {
  for (const entry of tasks.values()) {
    try {
      entry.task.stop();
    } catch {}
  }

  if (pending.size > 0) {
    logger.info("[scheduler] waiting for in-flight tasks", {
      count: pending.size,
    });
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise((r) => setTimeout(r, waitMs)),
    ]);
  }
  logger.info("[scheduler] stopped", { total: tasks.size });
}

/**
 * Fully destroy all tasks. Call after stopAll() in shutdown.
 */
export function destroyAll() {
  for (const entry of tasks.values()) {
    try {
      entry.task.destroy();
    } catch {}
  }
  tasks.clear();
}

/**
 * Manually trigger a task by name (useful for testing / admin endpoints).
 */
export async function trigger(name) {
  const entry = tasks.get(name);
  if (!entry) throw new Error(`scheduler.trigger: task not found: ${name}`);
  await entry.handler();
}

export function list() {
  return [...tasks.values()].map((e) => ({
    ...e.meta,
    isRunning: e.state.running,
    lastRunAt: e.state.lastRunAt,
    lastError: e.state.lastError,
  }));
}

export function get(name) {
  return tasks.get(name);
}
