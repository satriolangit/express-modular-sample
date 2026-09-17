#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_PKG = path.join(ROOT, "package.json");
const EXT_PKG = path.join(ROOT, "src", "extensions", "package.json");

const STRATEGY = process.env.MERGE_STRATEGY || "extension-wins";
const DRY = process.argv.includes("--dry-run");
const ROLLBACK = process.argv.includes("--rollback");

const SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
];

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, o) =>
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");

function major(v) {
  const m = String(v)
    .replace(/^[^\d]*/, "")
    .match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

if (!fs.existsSync(BASE_PKG)) {
  console.error(`✗ Missing ${path.relative(ROOT, BASE_PKG)}`);
  process.exit(1);
}

if (!fs.existsSync(EXT_PKG)) {
  fs.copyFileSync(BASE_PKG, OUT_PKG);
  console.log("package.json generated (no extension)");
  process.exit(0);
}

const basePkg = readJson(BASE_PKG);
const extPkg = readJson(EXT_PKG);
const merged = { ...basePkg };
const report = [];

for (const section of SECTIONS) {
  const baseDeps = basePkg[section] || {};
  const extDeps = extPkg[section] || {};
  const out = { ...baseDeps };

  for (const [name, extVer] of Object.entries(extDeps)) {
    const baseVer = baseDeps[name];

    if (baseVer === undefined) {
      out[name] = extVer;
      report.push({ section, name, action: "added", to: extVer });
    } else if (baseVer === extVer) {
      report.push({ section, name, action: "same", v: baseVer });
    } else {
      const majorMismatch = major(baseVer) !== major(extVer);

      if (STRATEGY === "strict") {
        throw new Error(
          `Conflict: ${section}.${name} base=${baseVer} ext=${extVer}`,
        );
      }
      if (STRATEGY === "base-wins") {
        report.push({
          section,
          name,
          action: "kept-base",
          base: baseVer,
          ext: extVer,
        });
      } else {
        out[name] = extVer;
        report.push({
          section,
          name,
          action: majorMismatch ? "ext-wins-MAJOR" : "ext-wins",
          base: baseVer,
          ext: extVer,
        });
      }
    }
  }

  if (Object.keys(out).length) merged[section] = out;
}

const conflicts = report.filter(
  (r) =>
    r.action === "ext-wins" ||
    r.action === "ext-wins-MAJOR" ||
    r.action === "kept-base",
);

console.log(`Strategy: ${STRATEGY}${DRY ? " (dry-run)" : ""}`);
console.log(
  `Changes: +${report.filter((r) => r.action === "added").length} ` +
    `=${report.filter((r) => r.action === "same").length} ` +
    `!${conflicts.length} ` +
    `(MAJOR: ${report.filter((r) => r.action.endsWith("MAJOR")).length})`,
);

for (const r of conflicts) {
  const flag = r.action.endsWith("MAJOR") ? " MAJOR" : "";
  console.log(
    `  ${r.section}.${r.name}: base=${r.base} ext=${r.ext} → ${r.action}${flag}`,
  );
}

if (DRY) {
  console.log("Dry-run: no files changed");
  process.exit(0);
}

writeJson(BASE_PKG, merged);
console.log("✓ package.json merged");

for (const l of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]) {
  const p = path.join(ROOT, l);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log(`Removed ${l}`);
  }
}
