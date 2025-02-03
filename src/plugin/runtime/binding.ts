import {
  UMWASM_HELPERS_ID,
  UNWASM_EXTERNAL_PREFIX,
  WasmAsset,
  UnwasmPluginOptions,
} from "../shared";
import { getWasmImports } from "./imports";

/* Generate the binding code for the wasm module */
export async function getWasmESMBinding(
  asset: WasmAsset,
  opts: UnwasmPluginOptions,
) {
  const autoImports = await getWasmImports(asset, opts);

  const instantiateCode: string = opts.esmImport
    ? getESMImportInstantiate(asset, autoImports.code)
    : getBase64Instantiate(asset, autoImports.code);

  return opts.lazy !== true && autoImports.resolved
    ? getExports(asset, instantiateCode)
    : getLazyExports(asset, instantiateCode);
}

/** Generate WebAssembly.Module binding for compatibility */
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

/** Get the code to instantiate module with direct import */
function getESMImportInstantiate(asset: WasmAsset, importsCode: string) {
  return /* js */ `
${importsCode}

async function _instantiate(imports = _imports) {
const _mod = await import("${UNWASM_EXTERNAL_PREFIX}${asset.name}").then(r => r.default || r);
return WebAssembly.instantiate(_mod, imports)
}
  `;
}

/** Get the code to instantiate module from inlined base64 data */
function getBase64Instantiate(asset: WasmAsset, importsCode: string) {
  return /* js */ `
import { base64ToUint8Array } from "${UMWASM_HELPERS_ID}";

${importsCode}

function _instantiate(imports = _imports) {
  const _data = base64ToUint8Array("${asset.source.toString("base64")}")
  return WebAssembly.instantiate(_data, imports)  }
  `;
}

/** Get the exports code with top level await support */
function getExports(asset: WasmAsset, instantiateCode: string) {
  return /* js */ `
import { getExports } from "${UMWASM_HELPERS_ID}";

${instantiateCode}

const $exports = getExports(await _instantiate());

${asset.exports
  .map((name) => `export const ${name} = $exports.${name};`)
  .join("\n")}

const defaultExport = () => $exports;
${asset.exports.map((name) => `defaultExport["${name}"] = $exports.${name};`).join("\n")}
export default defaultExport;
      `;
}

/** Proxied exports when imports are needed or we can't have top-level await */
function getLazyExports(asset: WasmAsset, instantiateCode: string) {
  return /* js */ `
import { createLazyWasmModule } from "${UMWASM_HELPERS_ID}";

${instantiateCode}

const _mod = createLazyWasmModule(_instantiate);

${asset.exports
  .map((name) => `export const ${name} = _mod.${name};`)
  .join("\n")}

export default _mod;
      `;
}
