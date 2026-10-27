function rank(path) {
  let statics = 0;
  let params = 0;
  let wildcards = 0;

  for (const segment of String(path).split("/").filter(Boolean)) {
    if (segment.startsWith(":")) params++;
    else if (segment.startsWith("*")) wildcards++;
    else statics++;
  }

  return { statics, params, wildcards };
}

/**
 * Mount more specific routes first, independent of filesystem read order.
 * Static segments beat parameters; parameters beat wildcards; `all` goes last.
 */
export function sortRoutes(routes) {
  return routes
    .map((route, index) => ({ route, index }))
    .sort((a, b) => {
      const rankA = rank(a.route.path);
      const rankB = rank(b.route.path);

      if (rankA.statics !== rankB.statics) {
        return rankB.statics - rankA.statics;
      }
      if (rankA.params !== rankB.params) {
        return rankA.params - rankB.params;
      }
      if (rankA.wildcards !== rankB.wildcards) {
        return rankA.wildcards - rankB.wildcards;
      }

      const allA = a.route.method === "all" ? 1 : 0;
      const allB = b.route.method === "all" ? 1 : 0;
      if (allA !== allB) return allA - allB;

      return a.index - b.index;
    })
    .map(({ route }) => route);
}
