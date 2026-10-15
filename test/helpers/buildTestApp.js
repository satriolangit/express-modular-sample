import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { discover } from "../../src/libs/bootstrap/discover.js";
import { mountFeature } from "../../src/libs/mountFeature.js";
import { installFakeDeps } from "./fakes.js";

const ROOT = path.join(import.meta.dirname, "..", "..");

/**
 * Build an Express app with all features/extensions mounted against fake deps.
 * Assumes `src/extensions/` has been populated (`npm run poc:copy`).
 */
export async function buildTestApp(overrides = {}) {
  const extensionsDir = path.join(ROOT, "src", "extensions");
  if (!fs.existsSync(path.join(extensionsDir, "user-management"))) {
    throw new Error(
      "src/extensions/ belum di-populate — jalankan `npm run poc:copy` dulu",
    );
  }

  const fakes = installFakeDeps(overrides);

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  const features = await discover(
    path.join(ROOT, "src", "features"),
    extensionsDir,
  );

  for (const feature of features.values()) {
    if (typeof feature.index?.init === "function") {
      await feature.index.init(fakes);
    }
    if (typeof feature.extInit === "function") {
      await feature.extInit(fakes);
    }
    mountFeature(app, feature);
  }

  // Error middleware — parity with index.js (Express 5 forwards async errors)
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.statusCode || 500).json({ error: "internal error" });
  });

  return { app, fakes, features };
}

/**
 * Run `fn(baseUrl)` against `app` listening on an ephemeral port.
 */
export async function withServer(app, fn) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}
