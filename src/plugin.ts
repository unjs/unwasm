import { promises as fs, existsSync } from "node:fs";
import { basename } from "pathe";
import MagicString from "magic-string";
import type { RenderedChunk, Plugin as RollupPlugin } from "rollup";
import { createUnplugin } from "unplugin";
import { sha1 } from "./_utils";

const WASM_EXTERNAL_ID = "\0unwasm:external:";

export interface WasmOptions {
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

const unplugin = createUnplugin<WasmOptions>((opts) => {
  type WasmAsset = {
    name: string;
    source: Buffer;
  };

  const assets: Record<string, WasmAsset> = Object.create(null);

  return {
    name: "unwasm",
    rollup: {
      async resolveId(id, importer) {
        if (id.startsWith(WASM_EXTERNAL_ID)) {
          return {
            id,
            external: true,
          };
        }
        if (id.endsWith(".wasm")) {
          const r = await this.resolve(id, importer, { skipSelf: true });
          if (r?.id && r?.id !== id) {
            return {
              id: r.id.startsWith("file://") ? r.id.slice(7) : r.id,
              external: false,
              moduleSideEffects: false,
              syntheticNamedExports: false,
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
      let _dataStr: string;
      if (opts.esmImport) {
        _dataStr = `await import("${WASM_EXTERNAL_ID}${id}").then(r => r?.default || r)`;
      } else {
        const base64Str = asset.source.toString("base64");
        _dataStr = `(()=>{const d=atob("${base64Str}");const s=d.length;const b=new Uint8Array(s);for(let i=0;i<s;i++)b[i]=d.charCodeAt(i);return b})()`;
      }
      let _str = `await WebAssembly.instantiate(${_dataStr}, { env: { "Math.random": () => Math.random, "Math.floor": () => Math.floor } }).then(r => r?.exports||r?.instance?.exports || r);`;
      if (opts.lazy) {
        _str = `(()=>{const e=async()=>{return ${_str}};let _p;const p=()=>{if(!_p)_p=e();return _p;};return {then:cb=>p().then(cb),catch:cb=>p().catch(cb)}})()`;
      }
      return {
        code: `export default ${_str};`,
        map: { mappings: "" },
        syntheticNamedExports: true,
      };
    },
    renderChunk(code: string, chunk: RenderedChunk) {
      if (
        !chunk.moduleIds.some((id) => id.endsWith(".wasm")) ||
        !code.includes(WASM_EXTERNAL_ID)
      ) {
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
      const ReplaceRE = new RegExp(`${WASM_EXTERNAL_ID}([^"']+)`, "g");
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

const rollup = unplugin.rollup as (opts: WasmOptions) => RollupPlugin;

export default {
  rollup,
};
