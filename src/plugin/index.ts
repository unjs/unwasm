import { promises as fs, existsSync } from "node:fs";
import { basename } from "pathe";
import MagicString from "magic-string";
import type { RenderedChunk, Plugin as RollupPlugin } from "rollup";
import { createUnplugin } from "unplugin";
import {
  sha1,
  UMWASM_HELPERS_ID,
  UNWASM_EXTERNAL_PREFIX,
  UnwasmPluginOptions,
  WasmAsset,
} from "./shared";
import { getPluginUtils, getWasmBinding } from "./runtime";

const unplugin = createUnplugin<UnwasmPluginOptions>((opts) => {
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
      assets[id] = <WasmAsset>{ name, id, source };
      // TODO: Can we parse wasm to extract exports and avoid syntheticNamedExports?
      return `export default "UNWASM DUMMY EXPORT";`;
    },
    transform(_code, id) {
      if (!id.endsWith(".wasm")) {
        return;
      }
      const asset = assets[id];
      if (!asset) {
        return;
      }

      return {
        code: getWasmBinding(asset, opts),
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

export const rollup = unplugin.rollup as (
  opts: UnwasmPluginOptions,
) => RollupPlugin;

export default {
  rollup,
};
