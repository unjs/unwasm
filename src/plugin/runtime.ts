import { readPackageJSON } from "pkg-types";
import {
  genSafeVariableName,
  genObjectFromRaw,
  genString,
  genImport,
} from "knitwork";
import {
  UMWASM_HELPERS_ID,
  UNWASM_EXTERNAL_PREFIX,
  WasmAsset,
  UnwasmPluginOptions,
} from "./shared";

// https://marketplace.visualstudio.com/items?itemName=Tobermory.es6-string-html
const js = String.raw;

/**
 * Returns ESM compatible exports binding
 */
export async function getWasmESMBinding(
  asset: WasmAsset,
  opts: UnwasmPluginOptions,
) {
  // -- Auto load imports --
  const autoImports = await getWasmImports(asset, opts);

  // --- Environment dependent code to initialize the wasm module using inlined base 64 or dynamic import ---
  const envCode: string = opts.esmImport
    ? js`
${autoImports.code};

async function _instantiate(imports = _imports) {
  const _mod = await import("${UNWASM_EXTERNAL_PREFIX}${asset.name}").then(r => r.default || r);
  return WebAssembly.instantiate(_mod, imports)
}
  `
    : js`
import { base64ToUint8Array } from "${UMWASM_HELPERS_ID}";
${autoImports.code};

function _instantiate(imports = _imports) {
  const _data = base64ToUint8Array("${asset.source.toString("base64")}")
  return WebAssembly.instantiate(_data, imports)
}
  `;

  // --- Binding code to export the wasm module exports ---
  const canTopAwait = opts.lazy !== true && autoImports.resolved;

  // eslint-disable-next-line unicorn/prefer-ternary
  if (canTopAwait) {
    // -- Non proxied exports when no imports are needed and we can have top-level await ---
    return js`
import { getExports } from "${UMWASM_HELPERS_ID}";
${envCode}

const $exports = getExports(await _instantiate());

${asset.exports
  .map((name) => `export const ${name} = $exports.${name};`)
  .join("\n")}

const defaultExport = () => $exports;
${asset.exports.map((name) => `defaultExport["${name}"] = $exports.${name};`).join("\n")}
export default defaultExport;
    `;
  } else {
    // --- Proxied exports when imports are needed or we can't have top-level await ---
    return js`
import { createLazyWasmModule } from "${UMWASM_HELPERS_ID}";
${envCode}

const _mod = createLazyWasmModule(_instantiate);

${asset.exports
  .map((name) => `export const ${name} = _mod.${name};`)
  .join("\n")}

export default _mod;
    `;
  }
}

/**
 * Returns WebAssembly.Module binding for compatibility
 */
export function getWasmModuleBinding(
  asset: WasmAsset,
  opts: UnwasmPluginOptions,
) {
  return opts.esmImport
    ? js`
const _mod = ${opts.lazy === true ? "" : `await`} import("${UNWASM_EXTERNAL_PREFIX}${asset.name}").then(r => r.default || r);
export default _mod;
  `
    : js`
import { base64ToUint8Array } from "${UMWASM_HELPERS_ID}";
const _data = base64ToUint8Array("${asset.source.toString("base64")}");
const _mod = new WebAssembly.Module(_data);
export default _mod;
  `;
}

export function getPluginUtils() {
  // --- Shared utils for the generated code ---
  return js`
export function debug(...args) {
  console.log('[wasm] [debug]', ...args);
}

export function getExports(input) {
  return input?.instance?.exports || input?.exports || input;
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

export async function getWasmImports(
  asset: WasmAsset,
  _opts: UnwasmPluginOptions, // eslint-disable-line @typescript-eslint/no-unused-vars
) {
  const importNames = Object.keys(asset.imports || {});
  if (importNames.length === 0) {
    return {
      code: "const _imports = { /* no imports */ }",
      resolved: true,
    };
  }

  // Try to resolve from nearest package.json
  const pkgJSON = await readPackageJSON(asset.id);

  let resolved = true;

  const imports: string[] = [];
  const importsObject: Record<string, Record<string, string>> = {};

  for (const moduleName of importNames) {
    const importNames = asset.imports[moduleName];
    const pkgImport =
      pkgJSON.imports?.[moduleName] || pkgJSON.imports?.[`#${moduleName}`];

    const importName = "_imports_" + genSafeVariableName(moduleName);

    if (pkgImport) {
      imports.push(genImport(pkgImport, { name: "*", as: importName }));
    } else {
      resolved = false;
    }

    importsObject[moduleName] = Object.fromEntries(
      importNames.map((name) => [
        name,
        pkgImport
          ? `${importName}[${genString(name)}]`
          : `() => { throw new Error(${genString(moduleName + "." + importName)} + " is not provided!")}`,
      ]),
    );
  }

  const code = `${imports.join("\n")}\n\nconst _imports = ${genObjectFromRaw(importsObject)}`;

  return {
    code,
    resolved,
  };
}
