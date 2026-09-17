const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.resolve(ROOT, "..", "extension-api", "src");
const DEST = path.join(ROOT, "src", "extensions");

if (!fs.existsSync(SRC)) {
  console.error(`✗ Extension source not found: ${SRC}`);
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });

const extPkg = path.resolve(ROOT, "..", "extension-api", "package.json");
if (fs.existsSync(extPkg)) {
  fs.copyFileSync(extPkg, path.join(DEST, "package.json"));
}

console.log(`✓ Copied extensions to ${path.relative(ROOT, DEST)}`);
