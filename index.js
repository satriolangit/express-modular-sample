const express = require("express");
const path = require("path");

// ─── 1. ISI DEPS DULU (sebelum require feature apapun) ───
const deps = require("./src/libs/deps");
deps.db = require("./src/libs/db");
deps.logger = require("./src/libs/logger");
deps.config = require("./src/libs/config");

// ─── 2. require feature loader ───
const { discover } = require("./src/libs/bootstrap/discover");
const { mountFeature } = require("./src/libs/mountFeature");

const app = express();
app.use(express.json());

console.log("\n=== Mounting features ===\n");

const features = discover(
  path.join(__dirname, "src", "features"),
  path.join(__dirname, "src", "extensions"),
);

for (const feature of features.values()) {
  mountFeature(app, feature);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
