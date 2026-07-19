export function getPluginUtils() {
  // --- Shared utils for the generated code ---
  return /* js */ `
export function debug(...args) {
  console.log('[unwasm] [debug]', ...args);
}

export function getExports(input) {
  return input?.instance?.exports || input?.exports || input;
}

// Only \`Func\` imports accept a plain JS value; the others must be the matching
// \`WebAssembly.*\` object. The engine rejects a mismatch with a \`LinkError\` that
// names neither the module the value came from nor the constructor it needed,
// so imports are checked here first to fail with something actionable.
const _importKinds = {
  Func: ["a function", (value) => typeof value === "function"],
  Memory: ["a WebAssembly.Memory", (value) => value instanceof WebAssembly.Memory],
  Table: ["a WebAssembly.Table", (value) => value instanceof WebAssembly.Table],
  // An immutable global may also be imported as a plain number, and the binary
  // does not tell us which kind this is, so numbers are allowed through to the
  // engine rather than rejected here.
  Global: [
    "a WebAssembly.Global or a number",
    (value) =>
      value instanceof WebAssembly.Global || typeof value === "number" || typeof value === "bigint",
  ],
  // \`WebAssembly.Tag\` is missing wherever exceptions are unsupported; there is
  // nothing to validate against, so the engine has the final say.
  Tag: [
    "a WebAssembly.Tag",
    (value) => typeof WebAssembly.Tag !== "function" || value instanceof WebAssembly.Tag,
  ],
};

function _describe(value) {
  if (value === undefined) {
    return "undefined (the module exports no such name)";
  }
  if (value === null) {
    return "null";
  }
  return value.constructor?.name || typeof value;
}

export function checkImports(imports, expected, id) {
  for (const [module, name, kind] of expected) {
    const check = _importKinds[kind];
    const value = imports?.[module]?.[name];
    if (!check || check[1](value)) {
      continue;
    }
    throw new TypeError(
      \`[unwasm] Invalid import \\\`\${module}\\\` -> \\\`\${name}\\\` for \\\`\${id}\\\`: expected \${check[0]}, got \${_describe(value)}.\`,
    );
  }
  return imports;
}

export function base64ToUint8Array(str) {
  const data = atob(str);
  const size = data.length;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = data.charCodeAt(i);
  }
  return bytes;
}

export function createLazyWasmModule(_instantiator) {
  const _exports = Object.create(null);
  let _loaded;
  let _promise;

  const init = (imports) => {
    if (_loaded) {
      return Promise.resolve(exportsProxy);
    }
    if (_promise) {
      return _promise;
    }
    return _promise = _instantiator(imports)
      .then(r => {
        Object.assign(_exports, getExports(r));
        _loaded = true;
        _promise = undefined;
        return exportsProxy;
      })
      .catch(error => {
        _promise = undefined;
        console.error('[wasm] [error]', error);
        throw error;
      });
  }

  const exportsProxy = new Proxy(_exports, {
    get(_, prop) {
      if (_loaded) {
        return _exports[prop];
      }
      return (...args) => {
        return _loaded
          ? _exports[prop]?.(...args)
          : init().then(() => _exports[prop]?.(...args));
      };
    },
  });


  const lazyProxy = new Proxy(() => {}, {
    get(_, prop) {
      return exportsProxy[prop];
    },
    apply(_, __, args) {
      return init(args[0])
    },
  });

  return lazyProxy;
}
  `;
}
