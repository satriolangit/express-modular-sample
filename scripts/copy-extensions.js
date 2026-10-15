#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Resolve the extension source repo.
 * Priority: EXT_DIR env → sibling "extension-api" → sibling
 * "express-modular-extension-sample" (workspace naming).
 */
function resolveExtensionDir() {
  if (process.env.EXT_DIR) {
    return path.resolve(process.env.EXT_DIR);
  }
  const candidates = [
    path.resolve(ROOT, "..", "extension-api"),
    path.resolve(ROOT, "..", "express-modular-extension-sample"),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "src")));
}

const extDir = resolveExtensionDir();
if (!extDir) {
  console.error(
    "✗ Extension source not found. Set EXT_DIR or place " +
      '"extension-api" / "express-modular-extension-sample" next to the base repo.',
  );
  process.exit(1);
}

const SRC = path.join(extDir, "src");
const DEST = path.join(ROOT, "src", "extensions");

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });

const extPkg = path.join(extDir, "package.json");
if (fs.existsSync(extPkg)) {
  fs.copyFileSync(extPkg, path.join(DEST, "package.json"));
}

console.log(
  `✓ Copied extensions from ${path.relative(ROOT, SRC)} to ${path.relative(ROOT, DEST)}`,
);
