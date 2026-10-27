import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROUTE_FILE = /^route\.([a-z0-9-]+)(\.extend)?\.js$/;
const ROUTE_LIKE = /^route\..*\.js$/;

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

export function parseRouteFile(filename) {
  if (!ROUTE_LIKE.test(filename)) return null;

  const match = filename.match(ROUTE_FILE);
  if (!match) {
    throw new Error(
      `Invalid route filename: ${filename} ` +
        "(expected route.<group>[.extend].js with letters, digits, or dashes)",
    );
  }

  return { name: match[1], isExtend: Boolean(match[2]) };
}

export function validateModuleIndex(name, index) {
  if (index === null || index === undefined) return null;

  if (typeof index !== "object" || Array.isArray(index)) {
    throw new Error(`Module index must export an object: ${name}`);
  }
  if (typeof index.prefix !== "string" || !index.prefix.startsWith("/")) {
    throw new Error(`Module prefix must start with "/": ${name}`);
  }
  if (index.init !== undefined && typeof index.init !== "function") {
    throw new Error(`Module init must be a function: ${name}`);
  }

  return index;
}

async function importModule(filePath) {
  const mod = await import(pathToFileURL(filePath).href);
  return mod.default;
}

async function collectRoutesFromDir(
  dir,
  collected,
  { requireExtend = false } = {},
) {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir)) {
    if (!ROUTE_LIKE.test(file)) continue;

    const parsed = parseRouteFile(file);
    if (!parsed) continue;

    if (requireExtend && !parsed.isExtend) {
      throw new Error(
        `Extension route file must end with .extend.js: ${path.join(dir, file)}`,
      );
    }

    const register = await importModule(path.join(dir, file));
    if (typeof register !== "function") {
      throw new Error(
        `Route file must export default function: ${path.join(dir, file)}`,
      );
    }

    const group = (collected[parsed.name] ??= { base: null, extends: [] });

    if (parsed.isExtend) {
      group.extends.push(register);
    } else {
      if (group.base) {
        throw new Error(
          `Duplicate base route group "${parsed.name}" in ${dir}`,
        );
      }
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

    const collected = Object.create(null);

    if (baseExists) {
      await collectRoutesFromDir(path.join(basePath, "routes"), collected);
    }

    if (extExists) {
      await collectRoutesFromDir(extPath, collected, { requireExtend: true });
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
      index = validateModuleIndex(name, await importModule(baseIndex));
    } else if (extExists && fs.existsSync(extIndex)) {
      index = validateModuleIndex(name, await importModule(extIndex));
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
