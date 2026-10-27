import express from "express";
import { createRouter } from "./routeCollector.js";
import { mergeRoutes } from "./mergeRoutes.js";
import { sortRoutes } from "./routeOrder.js";

export function mountModule(app, { name, prefix, routeGroups }) {
  const finalRouter = express.Router();
  const routes = [];

  for (const { groupName, baseRegister, extendRegister } of routeGroups) {
    const baseCollector = createRouter();
    baseRegister?.(baseCollector);

    const extCollector = createRouter();
    extendRegister?.(extCollector);

    const merged = mergeRoutes({
      base: baseCollector.__routes,
      extend: extCollector.__routes,
    });

    for (const rt of merged) {
      routes.push({ ...rt, groupName });
    }
  }

  const ordered = sortRoutes(routes);

  console.log(`  Module: ${name}  →  ${prefix}`);

  for (const rt of ordered) {
    finalRouter[rt.method](rt.path, ...rt.handlers);

    const mode = rt.opts?._mode ? ` [${rt.opts._mode}]` : "";
    const shownPath = `${prefix}${rt.path === "/" ? "" : rt.path}`;
    console.log(
      `      [${rt.groupName}] ${rt.method.toUpperCase().padEnd(7)} ${shownPath}${mode}`,
    );
  }

  app.use(prefix, finalRouter);
  console.log(`  ✓ ${ordered.length} routes mounted\n`);
}
