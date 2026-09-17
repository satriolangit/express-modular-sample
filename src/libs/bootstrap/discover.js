const fs = require("fs");
const path = require("path");

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => {
    try {
      return fs.statSync(path.join(dir, f)).isDirectory();
    } catch {
      return false;
    }
  });
}

function parseRouteFile(filename) {
  const m = filename.match(/^route\.(.+?)(\.extend)?\.js$/);
  if (!m) return null;
  return { name: m[1], isExtend: !!m[2] };
}

function collectRoutesFromDir(dir, collected) {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir)) {
    if (!/^route\..+\.js$/.test(file)) continue;

    const parsed = parseRouteFile(file);
    if (!parsed) continue;

    const mod = require(path.join(dir, file));
    const group = (collected[parsed.name] ??= { base: null, extends: [] });

    if (parsed.isExtend) {
      group.extends.push(mod);
    } else {
      group.base = mod;
    }
  }
}

function discover(featuresDir, extensionsDir) {
  const names = new Set([...listDirs(featuresDir), ...listDirs(extensionsDir)]);

  const features = new Map();

  for (const name of [...names].sort()) {
    const basePath = path.join(featuresDir, name);
    const extPath = path.join(extensionsDir, name);

    const baseExists = fs.existsSync(basePath);
    const extExists = fs.existsSync(extPath);

    const collected = {};

    if (baseExists) {
      collectRoutesFromDir(path.join(basePath, "routes"), collected);
    }

    if (extExists) {
      collectRoutesFromDir(extPath, collected);
      collectRoutesFromDir(path.join(extPath, "routes"), collected);
    }

    const routeGroups = Object.entries(collected).map(([groupName, g]) => ({
      groupName,
      baseRegister: g.base ? (r) => g.base(r) : null,
      extendRegister: g.extends.length
        ? (r) => g.extends.forEach((fn) => fn(r))
        : null,
    }));

    // ── Resolve index (prefix + init hook) ─────────────
    let index = null;
    const baseIndex = path.join(basePath, "index.js");
    const extIndex = path.join(extPath, "index.js");

    if (baseExists && fs.existsSync(baseIndex)) {
      index = require(baseIndex);
    } else if (extExists && fs.existsSync(extIndex)) {
      index = require(extIndex);
    }

    // ── Resolve extension init hook ────────────────────
    let extInit = null;
    if (extExists) {
      const extInitPath = path.join(extPath, "init.extend.js");
      if (fs.existsSync(extInitPath)) {
        extInit = require(extInitPath);
      }
    }

    features.set(name, {
      name,
      index,
      extInit,
      prefix: index?.prefix ?? `/${name}`,
      routeGroups,
    });
  }
  return features;
}

module.exports = { discover };
