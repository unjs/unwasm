import { promises as fs, existsSync } from "node:fs";
import { basename } from "pathe";
import MagicString from "magic-string";
import type { RenderedChunk, Plugin as RollupPlugin } from "rollup";
import { createUnplugin } from "unplugin";
import { sha1 } from "./_utils";

const UNWASM_EXTERNAL_PREFIX = "\0unwasm:external:";
const UMWASM_HELPERS_ID = "\0unwasm:helpers";

export interface UnwasmPluginOptions {
  /**
   * Direct import the wasm file instead of bundling, required in Cloudflare Workers
   *
   * @default false
   */
  esmImport?: boolean;

  /**
   * Import `.wasm` files using a lazily evaluated promise for compatibility with runtimes without top-level await support
   *
   * @default false
   */
  lazy?: boolean;
}

const unplugin = createUnplugin<UnwasmPluginOptions>((opts) => {
  type WasmAsset = {
    name: string;
    source: Buffer;
  };

  const assets: Record<string, WasmAsset> = Object.create(null);

  return {
    name: "unwasm",
    rollup: {
      async resolveId(id, importer) {
        if (id === UMWASM_HELPERS_ID) {
          return id;
        }
        if (id.startsWith(UNWASM_EXTERNAL_PREFIX)) {
          return {
            id,
            external: true,
          };
        }
        if (id.endsWith(".wasm")) {
          const r = await this.resolve(id, importer, { skipSelf: true });
          if (r?.id && r.id !== id) {
            return {
              id: r.id.startsWith("file://") ? r.id.slice(7) : r.id,
              external: false,
              moduleSideEffects: false,
              syntheticNamedExports: true,
            };
          }
        }
      },
      generateBundle() {
        if (opts.esmImport) {
          for (const asset of Object.values(assets)) {
            this.emitFile({
              type: "asset",
              source: asset.source,
              fileName: asset.name,
            });
          }
        }
      },
    },
    async load(id) {
      if (id === UMWASM_HELPERS_ID) {
        return getPluginUtils();
      }
      if (!id.endsWith(".wasm") || !existsSync(id)) {
        return;
      }
      const source = await fs.readFile(id);
      const name = `wasm/${basename(id, ".wasm")}-${sha1(source)}.wasm`;
      assets[id] = <WasmAsset>{ name, source };
      // TODO: Can we parse wasm to extract exports and avoid syntheticNamedExports?
      return `export default "WASM";`; // dummy
    },
    transform(_code, id) {
      if (!id.endsWith(".wasm")) {
        return;
      }
      const asset = assets[id];
      if (!asset) {
        return;
      }

      const envCode: string = opts.esmImport
        ? `
async function _instantiate(imports) {
  const _mod = await import("${UNWASM_EXTERNAL_PREFIX}${id}").then(r => r.default || r);
  return WebAssembly.instantiate(_mod, imports)
}
`
        : `
import { base64ToUint8Array } from "${UMWASM_HELPERS_ID}";

function _instantiate(imports) {
  const _mod = base64ToUint8Array("${asset.source.toString("base64")}")
  return WebAssembly.instantiate(_mod, imports)
}
        `;

      const code = `${envCode}
const _defaultImports = Object.create(null);

// TODO: For testing only
Object.assign(_defaultImports, { env: { "seed": () =>  () => Date.now() * Math.random() } })

const instancePromises = new WeakMap();
function instantiate(imports = _defaultImports) {
  let p = instancePromises.get(imports);
  if (!p) {
    p = _instantiate(imports);
    instancePromises.set(imports, p);
  }
  return p;
}

const _instance = instantiate();
const _exports = _instance.then(r => r?.instance?.exports || r?.exports || r);

export default ${opts.lazy ? "" : "await "} _exports;
      `;

      return {
        code,
        map: { mappings: "" },
        syntheticNamedExports: true,
      };
    },
    renderChunk(code: string, chunk: RenderedChunk) {
      if (!opts.esmImport) {
        return;
      }

      if (
        !(
          chunk.moduleIds.some((id) => id.endsWith(".wasm")) ||
          chunk.imports.some((id) => id.endsWith(".wasm"))
        ) ||
        !code.includes(UNWASM_EXTERNAL_PREFIX)
      ) {
        console.log(chunk);
        return;
      }
      const s = new MagicString(code);
      const resolveImport = (id: string) => {
        if (typeof id !== "string") {
          return;
        }
        const asset = assets[id];
        if (!asset) {
          return;
        }
        const nestedLevel = chunk.fileName.split("/").length - 1;
        const relativeId =
          (nestedLevel ? "../".repeat(nestedLevel) : "./") + asset.name;
        return {
          relativeId,
          asset,
        };
      };
      const ReplaceRE = new RegExp(`${UNWASM_EXTERNAL_PREFIX}([^"']+)`, "g");
      for (const match of code.matchAll(ReplaceRE)) {
        const resolved = resolveImport(match[1]);
        const index = match.index as number;
        const len = match[0].length;
        if (!resolved || !index) {
          console.warn(
            `Failed to resolve WASM import: ${JSON.stringify(match[1])}`,
          );
          continue;
        }
        s.overwrite(index, index + len, resolved.relativeId);
      }
      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: s.generateMap({ includeContent: true }),
        };
      }
    },
  };
});

export function getPluginUtils() {
  return `
export function base64ToUint8Array(str) {
  const data = atob(str);
  const size = data.length;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = data.charCodeAt(i);
  }
  return bytes;
}
  `;
}

const rollup = unplugin.rollup as (opts: UnwasmPluginOptions) => RollupPlugin;

export default {
  rollup,
};
