const METHODS = ["get", "post", "put", "patch", "delete", "all"];

function isOptions(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof v !== "function"
  );
}

function createRouter() {
  const routes = [];
  const r = {};

  for (const m of METHODS) {
    r[m] = (path, ...args) => {
      let opts = {};
      if (args.length && isOptions(args[0])) opts = args.shift();
      routes.push({ method: m, path, handlers: args, opts });
      return r;
    };
  }

  Object.defineProperty(r, "__routes", { value: routes });
  return r;
}

module.exports = { createRouter };
