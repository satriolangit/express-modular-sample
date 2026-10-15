import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

async function importModule(filePath) {
  const mod = await import(pathToFileURL(filePath).href);
  return mod.default;
}

async function collectRoutesFromDir(dir, collected) {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir)) {
    if (!/^route\..+\.js$/.test(file)) continue;

    const parsed = parseRouteFile(file);
    if (!parsed) continue;

    const register = await importModule(path.join(dir, file));
    const group = (collected[parsed.name] ??= { base: null, extends: [] });

    if (parsed.isExtend) {
      group.extends.push(register);
    } else {
      group.base = register;
    }
  }
}

export async function discover(modulesDir, extensionsDir) {
  const names = new Set([...listDirs(modulesDir), ...listDirs(extensionsDir)]);

  const modules = new Map();

  for (const name of [...names].sort()) {
    const basePath = path.join(modulesDir, name);
    const extPath = path.join(extensionsDir, name);

    const baseExists = fs.existsSync(basePath);
    const extExists = fs.existsSync(extPath);

    const collected = {};

    if (baseExists) {
      await collectRoutesFromDir(path.join(basePath, "routes"), collected);
    }

    if (extExists) {
      await collectRoutesFromDir(extPath, collected);
      await collectRoutesFromDir(path.join(extPath, "routes"), collected);
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
      index = await importModule(baseIndex);
    } else if (extExists && fs.existsSync(extIndex)) {
      index = await importModule(extIndex);
    }

    // ── Resolve extension init hook ────────────────────
    let extInit = null;
    if (extExists) {
      const extInitPath = path.join(extPath, "init.extend.js");
      if (fs.existsSync(extInitPath)) {
        extInit = await importModule(extInitPath);
      }
    }

    modules.set(name, {
      name,
      index,
      extInit,
      prefix: index?.prefix ?? `/${name}`,
      routeGroups,
    });
  }
  return modules;
}
