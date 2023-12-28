import {
  UMWASM_HELPERS_ID,
  UNWASM_EXTERNAL_PREFIX,
  WasmAsset,
  UnwasmPluginOptions,
} from "./shared";

// https://marketplace.visualstudio.com/items?itemName=Tobermory.es6-string-html
const js = String.raw;

export function getWasmBinding(asset: WasmAsset, opts: UnwasmPluginOptions) {
  // --- Environment dependent code to initialize the wasm module using inlined base 64 or dynamic import ---
  const envCode: string = opts.esmImport
    ? js`
async function _instantiate(imports) {
  const _mod = await import("${UNWASM_EXTERNAL_PREFIX}${asset.id}").then(r => r.default || r);
  return WebAssembly.instantiate(_mod, imports)
}
  `
    : js`
import { base64ToUint8Array } from "${UMWASM_HELPERS_ID}";

function _instantiate(imports) {
  const _data = base64ToUint8Array("${asset.source.toString("base64")}")
  return WebAssembly.instantiate(_data, imports)
}
  `;

  // --- Binding code to export the wasm module exports ---
  const canTopAwait =
    opts.lazy !== true && Object.keys(asset.imports).length === 0;

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

export const $init = () => $exports;

export default $exports;
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

export const $init = _mod.$init.bind(_mod);

export default _mod;
    `;
  }
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
