const express = require("express");
const { createRouter } = require("./routeCollector");
const { mergeRoutes } = require("./mergeRoutes");

function mountFeature(app, { name, prefix, routeGroups }) {
  const finalRouter = express.Router();
  let totalRoutes = 0;

  console.log(`  Feature: ${name}  →  ${prefix}`);

  for (const { groupName, baseRegister, extendRegister } of routeGroups) {
    const baseCollector = createRouter();
    baseRegister?.(baseCollector);

    const extCollector = createRouter();
    extendRegister?.(extCollector);

    const merged = mergeRoutes({
      base: baseCollector.__routes,
      extend: extCollector.__routes,
    });

    if (merged.length === 0) continue;

    console.log(`    [${groupName}]`);

    for (const rt of merged) {
      finalRouter[rt.method](rt.path, ...rt.handlers);

      const mode = rt.opts?._mode ? ` [${rt.opts._mode}]` : "";
      const shownPath = `${prefix}${rt.path === "/" ? "" : rt.path}`;
      console.log(
        `      ${rt.method.toUpperCase().padEnd(7)} ${shownPath}${mode}`,
      );

      totalRoutes++;
    }
  }

  app.use(prefix, finalRouter);
  console.log(`  ✓ ${totalRoutes} routes mounted\n`);
}

module.exports = { mountFeature };
