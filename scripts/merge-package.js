#!/usr/bin/env node
/**
 * Generate package.json from package.base.json + extension package.json.
 *
 * Source of truth: package.base.json  (edit this, commit this)
 * Generated file:  package.json       (gitignored, do not edit manually)
 *
 * Usage:
 *   node scripts/merge-package.js             # generate package.json
 *   node scripts/merge-package.js --dry-run   # preview only, no writes
 *
 * Env:
 *   MERGE_STRATEGY=extension-wins | base-wins | strict
 *                  (default: extension-wins)
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "..");
const SRC_PKG = path.join(ROOT, "package.base.json");
const OUT_PKG = path.join(ROOT, "package.json");
const EXT_PKG = path.join(ROOT, "src", "extensions", "package.json");
const REPORT = path.join(ROOT, ".package-merge-report.json");
const LOCK_PATHS = [
  path.join(ROOT, "package-lock.json"),
  path.join(ROOT, "yarn.lock"),
  path.join(ROOT, "pnpm-lock.yaml"),
];

// ─────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────
const STRATEGY = process.env.MERGE_STRATEGY || "extension-wins";
const DRY_RUN = process.argv.includes("--dry-run");

const MERGEABLE_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
  "resolutions",
];

const VALID_STRATEGIES = ["extension-wins", "base-wins", "strict"];

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────
function log(...args) {
  console.log("[merge-package]", ...args);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function majorVersion(range) {
  const m = String(range)
    .replace(/^[^\d]*/, "")
    .match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function sortedEntries(obj) {
  return Object.entries(obj || {}).sort(([a], [b]) => a.localeCompare(b));
}

function removeStaleLocks() {
  for (const lock of LOCK_PATHS) {
    if (fs.existsSync(lock)) {
      fs.unlinkSync(lock);
      log(`✓ Removed stale lock: ${path.basename(lock)}`);
    }
  }
}

// ─────────────────────────────────────────────────────
// Merge
// ─────────────────────────────────────────────────────
function mergeSection(baseDeps, extDeps, sectionName, report) {
  const merged = { ...baseDeps };

  for (const [name, extVer] of sortedEntries(extDeps)) {
    const baseVer = baseDeps[name];

    // Not in base → add
    if (baseVer === undefined) {
      merged[name] = extVer;
      report.push({ section: sectionName, name, action: "added", to: extVer });
      continue;
    }

    // Identical → skip
    if (baseVer === extVer) {
      report.push({
        section: sectionName,
        name,
        action: "same",
        version: baseVer,
      });
      continue;
    }

    // Conflict
    const baseMajor = majorVersion(baseVer);
    const extMajor = majorVersion(extVer);
    const majorMismatch =
      baseMajor !== null && extMajor !== null && baseMajor !== extMajor;

    if (STRATEGY === "strict") {
      throw new Error(
        `Conflict in ${sectionName}: ${name} (base=${baseVer}, ext=${extVer})`,
      );
    }

    if (STRATEGY === "base-wins") {
      report.push({
        section: sectionName,
        name,
        action: majorMismatch
          ? "conflict-base-wins-MAJOR"
          : "conflict-base-wins",
        base: baseVer,
        ext: extVer,
        kept: baseVer,
      });
      continue;
    }

    // extension-wins (default)
    merged[name] = extVer;
    report.push({
      section: sectionName,
      name,
      action: majorMismatch ? "conflict-ext-wins-MAJOR" : "conflict-ext-wins",
      base: baseVer,
      ext: extVer,
      kept: extVer,
    });
  }

  return merged;
}

// ─────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────
function main() {
  // ── Validate ─────────────────────────────────────
  if (!VALID_STRATEGIES.includes(STRATEGY)) {
    log(`✗ Invalid MERGE_STRATEGY: "${STRATEGY}"`);
    log(`  Must be one of: ${VALID_STRATEGIES.join(" | ")}`);
    process.exit(1);
  }

  if (!fs.existsSync(SRC_PKG)) {
    log(`✗ Source not found: ${path.relative(ROOT, SRC_PKG)}`);
    log(`  Create "package.base.json" as the source of truth.`);
    process.exit(1);
  }

  log(`Strategy: ${STRATEGY}${DRY_RUN ? " (dry-run)" : ""}`);
  log(`Source:   ${path.relative(ROOT, SRC_PKG)}`);
  log(`Output:   ${path.relative(ROOT, OUT_PKG)}`);

  // ── Load source ──────────────────────────────────
  const basePkg = readJson(SRC_PKG);

  // ── No extension → straight copy ─────────────────
  if (!fs.existsSync(EXT_PKG)) {
    log(`ℹ No extension package.json — copying source as-is`);

    if (DRY_RUN) {
      log("Dry-run: no files changed");
      return;
    }

    writeJson(OUT_PKG, basePkg);
    log(`✓ package.json generated`);
    removeStaleLocks();
    return;
  }

  // ── Merge with extension ─────────────────────────
  const extPkg = readJson(EXT_PKG);
  log(`Ext:      ${path.relative(ROOT, EXT_PKG)}`);

  const merged = { ...basePkg };
  const report = [];

  for (const section of MERGEABLE_SECTIONS) {
    const result = mergeSection(
      basePkg[section] || {},
      extPkg[section] || {},
      section,
      report,
    );
    if (Object.keys(result).length > 0) {
      merged[section] = result;
    }
  }

  // ── Summary ──────────────────────────────────────
  const summary = {
    total: report.length,
    added: report.filter((r) => r.action === "added").length,
    same: report.filter((r) => r.action === "same").length,
    conflicts: report.filter((r) => r.action.startsWith("conflict")).length,
    majorConflicts: report.filter((r) => r.action.endsWith("MAJOR")).length,
  };

  log(
    `Changes: +${summary.added} added, ` +
      `=${summary.same} same, ` +
      `!${summary.conflicts} conflicts ` +
      `(${summary.majorConflicts} MAJOR)`,
  );

  // ── Print conflicts ──────────────────────────────
  if (summary.conflicts > 0) {
    console.log("");
    log("Conflicts detail:");
    for (const r of report.filter((r) => r.action.startsWith("conflict"))) {
      const flag = r.action.endsWith("MAJOR") ? "  ⚠️  MAJOR MISMATCH" : "";
      console.log(
        `  ${r.section}.${r.name}: ` +
          `base=${r.base} ext=${r.ext} → kept=${r.kept}${flag}`,
      );
    }
    console.log("");
  }

  if (DRY_RUN) {
    log("Dry-run: no files changed");
    return;
  }

  // ── Write output ─────────────────────────────────
  writeJson(OUT_PKG, merged);
  log(`✓ package.json generated`);

  // ── Write report ─────────────────────────────────
  writeJson(REPORT, {
    generatedAt: new Date().toISOString(),
    strategy: STRATEGY,
    source: path.relative(ROOT, SRC_PKG),
    output: path.relative(ROOT, OUT_PKG),
    summary,
    changes: report,
  });
  log(`✓ Report → ${path.relative(ROOT, REPORT)}`);

  // ── Cleanup locks ────────────────────────────────
  removeStaleLocks();

  // ── Warnings ─────────────────────────────────────
  if (summary.majorConflicts > 0 && STRATEGY === "extension-wins") {
    log("");
    log("⚠️  Major version mismatch detected.");
    log("   Extension wins, but base may break.");
    log("   Consider:");
    log(
      "   - Adding `overrides` in extension package.json to pin transitive deps",
    );
    log("   - Updating base to a compatible version");
    log("   - Setting MERGE_STRATEGY=strict to fail-fast in CI");
  }
}

// ─────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────
try {
  main();
} catch (err) {
  console.error("[merge-package] ✗", err.message);
  process.exit(1);
}
