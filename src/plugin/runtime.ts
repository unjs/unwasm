import {
  UMWASM_HELPERS_ID,
  UNWASM_EXTERNAL_PREFIX,
  WasmAsset,
  UnwasmPluginOptions,
} from "./shared";

// https://marketplace.visualstudio.com/items?itemName=Tobermory.es6-string-html
const js = String.raw;

export function getWasmBinding(asset: WasmAsset, opts: UnwasmPluginOptions) {
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

  return js`
import { createUnwasmModule } from "${UMWASM_HELPERS_ID}";
${envCode}
const _mod = createUnwasmModule(_instantiate);

export const $init = _mod.$init.bind(_mod);
export const exports = _mod;

export default _mod;
`;
}

export function getPluginUtils() {
  return js`
export function debug(...args) {
  console.log('[wasm]', ...args);
}

function getExports(input) {
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

export function createUnwasmModule(_instantiator) {
  const _exports = Object.create(null);
  let _loaded;
  let _promise;

  const $init = (imports) => {
    if (_loaded) {
      return Promise.resolve(_proxy);
    }
    if (_promise) {
      return _promise;
    }
    return _promise = _instantiator(imports)
      .then(r => {
        Object.assign(_exports, getExports(r));
        _loaded = true;
        _promise = undefined;
        return _proxy;
      })
      .catch(error => {
        _promise = undefined;
        console.error('[wasm]', error);
        throw error;
      });
  }

  const $exports = new Proxy(_exports, {
    get(_, prop) {
      if (_loaded) {
        return _exports[prop];
      }
      return (...args) => {
        return _loaded
          ? _exports[prop]?.(...args)
          : $init().then(() => $exports[prop]?.(...args));
      };
    },
  });

  const _instance = {
    $init,
    $exports,
  };

  const _proxy = new Proxy(_instance, {
    get(_, prop) {
      // Reserve all to avoid future breaking changes
      if (prop.startsWith('$')) {
        return _instance[prop];
      }
      return $exports[prop];
    }
  });

  return _proxy;
}
  `;
}
