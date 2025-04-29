import { promises as fs, existsSync } from "node:fs";
import { basename } from "pathe";
import MagicString from "magic-string";
import type { RenderedChunk, Plugin as RollupPlugin } from "rollup";
import { createUnplugin } from "unplugin";
import { parseWasm } from "../tools";
import { getWasmESMBinding, getWasmModuleBinding } from "./runtime/binding";
import { treeshake, filterExports } from "./runtime/treeshake";
import { getPluginUtils } from "./runtime/utils";
import {
  sha1,
  UMWASM_HELPERS_ID,
  UNWASM_EXTERNAL_PREFIX,
  UNWASM_EXTERNAL_RE,
  UnwasmPluginOptions,
  WasmAsset,
} from "./shared";

export type { UnwasmPluginOptions } from "./shared";

const WASM_ID_RE = /\.wasm\??.*$/i;

const unplugin = createUnplugin<UnwasmPluginOptions>((opts) => {
  const assets: Record<string, WasmAsset> = Object.create(null);

  type ParseCacheEntry = Pick<WasmAsset, "imports" | "exports">;
  const _parseCache: Record<string, ParseCacheEntry> = Object.create(null);
  function parse(name: string, source: Buffer) {
    if (_parseCache[name]) {
      return _parseCache[name];
    }
    const imports: Record<string, string[]> = Object.create(null);
    const exports: string[] = [];

    try {
      const parsed = parseWasm(source, { name });
      for (const mod of parsed.modules) {
        exports.push(...mod.exports.map((e) => e.name));
        for (const imp of mod.imports) {
          if (!imports[imp.module]) {
            imports[imp.module] = [];
          }
          imports[imp.module].push(imp.name);
        }
      }
    } catch (error) {
      console.warn(`[unwasm] Failed to parse WASM module ${name}:`, error);
    }

    _parseCache[name] = {
      imports,
      exports,
    };
    return _parseCache[name];
  }

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
        if (WASM_ID_RE.test(id)) {
          const r = await this.resolve(id, importer, { skipSelf: true });
          if (r?.id && r.id !== id) {
            return {
              id: r.id.startsWith("file://") ? r.id.slice(7) : r.id,
              external: false,
              moduleSideEffects: false,
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

      if (!WASM_ID_RE.test(id)) {
        return;
      }

      const idPath = id.split("?")[0];
      if (!existsSync(idPath)) {
        return;
      }

      this.addWatchFile(idPath);

      const buff = await fs.readFile(idPath);
      return buff.toString("binary");
    },
    async transform(code, id) {
      if (!WASM_ID_RE.test(id)) {
        return;
      }

      const buff = Buffer.from(code, "binary");

      const isModule = id.endsWith("?module");

      const name = `wasm/${basename(id.split("?")[0], ".wasm")}-${sha1(buff)}.wasm`;

      const parsed = isModule
        ? { imports: [], exports: ["default"] }
        : parse(name, buff);

      const asset = (assets[name] = <WasmAsset>{
        name,
        id,
        source: buff,
        imports: parsed.imports,
        exports: parsed.exports,
      });

      return {
        code: isModule
          ? await getWasmModuleBinding(asset, opts)
          : await getWasmESMBinding(asset, opts),
        map: { mappings: "" },
      };
    },
    renderChunk(code: string, chunk: RenderedChunk) {
      if (chunk.type === "chunk" && opts.treeshake) {
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (!WASM_ID_RE.test(id)) {
            continue;
          }
          // Find the asset and tree shake it.
          let assetKey;
          for (const [key, value] of Object.entries(assets)) {
            if (value.id === id) {
              assetKey = key;
              break;
            }
          }
          if (!assetKey) {
            throw new Error("Could not find asset.");
          }
          const asset = assets[assetKey];
          const buffer = treeshake(
            asset.source,
            filterExports(asset.exports, module.removedExports),
            opts,
          );
          asset.source = buffer;
        }
      }

      if (
        !(
          chunk.moduleIds.some((id) => WASM_ID_RE.test(id)) ||
          chunk.imports.some((id) => WASM_ID_RE.test(id))
        )
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
        let relativeId;
        if (opts.esmImport) {
          const nestedLevel =
            chunk.fileName.split("/").filter(Boolean /* handle // */).length -
            1;
          relativeId =
            (nestedLevel ? "../".repeat(nestedLevel) : "./") + asset.name;
        } else {
          relativeId = asset.source.toString("base64");
        }
        return {
          relativeId,
          asset,
        };
      };
      for (const match of code.matchAll(UNWASM_EXTERNAL_RE)) {
        const resolved = resolveImport(match[2]);
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
