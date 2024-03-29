import {
  UMWASM_HELPERS_ID,
  UNWASM_EXTERNAL_PREFIX,
  WasmAsset,
  UnwasmPluginOptions,
} from "../shared";
import { getWasmImports } from "./imports";

/**
 * Returns ESM compatible exports binding
 */
export async function getWasmESMBinding(
  asset: WasmAsset,
  opts: UnwasmPluginOptions,
) {
  // -- Auto load imports --
  const autoImports = await getWasmImports(asset, opts);

  // --- Environment dependent code to initialize the wasm module using inlined base64 or dynamic import ---
  const envCode: string = opts.esmImport
    ? /* js */ `
${autoImports.code};

async function _instantiate(imports = _imports) {
  const _mod = await import("${UNWASM_EXTERNAL_PREFIX}${asset.name}").then(r => r.default || r);
  return WebAssembly.instantiate(_mod, imports)
}
  `
    : /* js */ `
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
    return /* js */ `
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
    return /* js */ `
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
    ? /* js */ `
const _mod = ${opts.lazy === true ? "" : `await`} import("${UNWASM_EXTERNAL_PREFIX}${asset.name}").then(r => r.default || r);
export default _mod;
  `
    : /* js */ `
import { base64ToUint8Array } from "${UMWASM_HELPERS_ID}";
const _data = base64ToUint8Array("${asset.source.toString("base64")}");
const _mod = new WebAssembly.Module(_data);
export default _mod;
  `;
}
