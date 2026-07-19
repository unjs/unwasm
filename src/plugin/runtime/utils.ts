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
// The engine tests for an internal slot, which \`instanceof\` cannot see across
// realms: a Memory from a vm context, iframe or worker is still a valid import.
// The brand check is realm agnostic, so those keep working.
const _is = (value, brand) =>
  Object.prototype.toString.call(value) === "[object WebAssembly." + brand + "]";

// A reference typed global takes any JS value (\`externref\`) or null
// (\`funcref\`), so only numeric globals can be checked at all.
const _numericGlobals = new Set(["i32", "i64", "f32", "f64", "v128"]);

const _importKinds = {
  Func: ["a function", (value) => typeof value === "function"],
  Memory: ["a WebAssembly.Memory", (value) => _is(value, "Memory")],
  Table: ["a WebAssembly.Table", (value) => _is(value, "Table")],
  // An immutable numeric global may also be imported as a plain number, and the
  // binary does not say whether this one is mutable, so numbers are allowed
  // through to the engine rather than rejected here.
  Global: [
    "a WebAssembly.Global or a number",
    (value, valueType) =>
      !_numericGlobals.has(valueType) ||
      _is(value, "Global") ||
      typeof value === "number" ||
      typeof value === "bigint",
  ],
  // \`WebAssembly.Tag\` is missing wherever exceptions are unsupported; there is
  // nothing to validate against, so the engine has the final say.
  Tag: ["a WebAssembly.Tag", (value) => typeof WebAssembly.Tag !== "function" || _is(value, "Tag")],
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
  for (const [module, name, kind, valueType] of expected) {
    const check = _importKinds[kind];
    const value = imports?.[module]?.[name];
    if (!check || check[1](value, valueType)) {
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
