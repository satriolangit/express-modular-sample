function key(rt) {
  return `${rt.method} ${rt.path}`;
}

function applyExtend(base, ext) {
  const { prepend = [], mergeMiddleware = false } = ext.opts || {};

  const baseMw = base.handlers.slice(0, -1);
  const baseTerminal = base.handlers.slice(-1);

  const extMw = ext.handlers.slice(0, -1);
  const extTerminal = ext.handlers.slice(-1);
  const terminal = extTerminal.length ? extTerminal : baseTerminal;

  const hasPrepend = Array.isArray(prepend) && prepend.length > 0;

  if (!hasPrepend && !mergeMiddleware) {
    return { ...ext, opts: { ...ext.opts, _mode: "overwrite" } };
  }
  if (hasPrepend && !mergeMiddleware) {
    return {
      ...ext,
      handlers: [...prepend, ...baseMw, ...terminal],
      opts: { ...ext.opts, _mode: "prepend" },
    };
  }
  if (!hasPrepend && mergeMiddleware) {
    return {
      ...ext,
      handlers: [...baseMw, ...extMw, ...terminal],
      opts: { ...ext.opts, _mode: "merge" },
    };
  }
  return {
    ...ext,
    handlers: [...prepend, ...baseMw, ...extMw, ...terminal],
    opts: { ...ext.opts, _mode: "prepend+merge" },
  };
}

export function mergeRoutes(layers) {
  const registry = new Map();

  for (const rt of layers.base ?? []) {
    registry.set(key(rt), rt);
  }

  const otherTypes = Object.keys(layers)
    .filter((t) => t !== "base")
    .sort();

  for (const type of otherTypes) {
    for (const ext of layers[type]) {
      const k = key(ext);
      const base = registry.get(k);

      if (!base) {
        registry.set(k, { ...ext, opts: { ...ext.opts, _mode: "new" } });
        continue;
      }
      registry.set(k, applyExtend(base, ext));
    }
  }

  return [...registry.values()];
}
