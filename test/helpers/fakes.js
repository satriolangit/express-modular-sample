import { populate } from "../../src/libs/deps.js";

export function fakeLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
    child() {
      return this;
    },
  };
}

export function fakeDb() {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/^\s*INSERT INTO audit_logs/i.test(sql)) {
      return { rows: [{ id: params[0] ?? "a1", _inserted: true }], rowCount: 1 };
    }
    if (/app_user_role/i.test(sql)) {
      return {
        rows: [{ id: 10, user_id: 1, role_id: 1, name: "admin" }],
        rowCount: 1,
      };
    }
    if (/FROM app_user\b/i.test(sql)) {
      return { rows: [{ id: 1, name: "Alice" }], rowCount: 1 };
    }
    if (/FROM app_role\b/i.test(sql)) {
      return { rows: [{ id: 1, name: "admin" }], rowCount: 1 };
    }
    if (/FROM products\b/i.test(sql)) {
      return { rows: [{ id: 1, name: "Product 1" }], rowCount: 1 };
    }
    if (/FROM policies\b/i.test(sql)) {
      return { rows: [{ id: 1, title: "Policy 1" }], rowCount: 1 };
    }
    if (/FROM audit_logs\b/i.test(sql)) {
      return { rows: [{ id: "a1", user_id: 1, action: "test" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    calls,
    query,
    async tx(fn) {
      return fn({ query });
    },
    async healthCheck() {
      return true;
    },
    async close() {},
    getPool() {
      return null;
    },
    async insert(table, row) {
      calls.push({ table, row });
      return { ...row, _inserted: true };
    },
  };
}

export function fakeDbThrowing(message = "db down") {
  const query = async () => {
    throw new Error(message);
  };
  return {
    calls: [],
    query,
    async tx(fn) {
      return fn({ query });
    },
    async healthCheck() {
      return false;
    },
    async close() {},
    getPool() {
      return null;
    },
    async insert() {
      throw new Error(message);
    },
  };
}

export function fakeNats() {
  return {
    isAvailable: () => true,
    get: () => ({ sc: { decode: (d) => d } }),
    publish: () => true,
    jsPublish: async () => ({ seq: 1 }),
    subscribeJson: () => ({
      async *[Symbol.asyncIterator]() {},
      unsubscribe() {},
    }),
    consume: async () => ({
      consume: async () => ({ async *[Symbol.asyncIterator]() {} }),
    }),
    onConnected() {},
    onLost() {},
    onReconnected() {},
    healthCheck: () => true,
    close: async () => {},
  };
}

export function fakeWs() {
  const registered = [];
  return {
    registered,
    init() {},
    register(path, handler, opts = {}) {
      registered.push({ path, owner: opts.owner });
    },
    unregister() {},
    listChannels: () => [],
    broadcast: () => 0,
    get: () => null,
    healthCheck: async () => true,
    close: async () => {},
  };
}

export function fakeScheduler() {
  const tasks = [];
  return {
    tasks,
    register(opts) {
      tasks.push(opts);
      return { start() {}, stop() {}, destroy() {} };
    },
    startAll() {},
    stopAll: async () => {},
    destroyAll() {},
    trigger: async () => {},
    list: () => [],
  };
}

export function fakeConfig() {
  return {
    appName: "base-api",
    env: "test",
    http: { port: 0 },
    ws: { heartbeatMs: 30_000, maxPayload: 1_048_576 },
    scheduler: { enabled: false, timezone: "UTC" },
  };
}

/**
 * Populate the real deps singleton with fakes. Because deps.js uses live
 * bindings, consumers see the latest population without re-import tricks.
 */
export function installFakeDeps(overrides = {}) {
  const fakes = {
    config: fakeConfig(),
    logger: fakeLogger(),
    db: fakeDb(),
    nats: fakeNats(),
    ws: fakeWs(),
    scheduler: fakeScheduler(),
    http: null,
    ...overrides,
  };
  populate(fakes);
  return fakes;
}
