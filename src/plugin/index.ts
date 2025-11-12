import { promises as fs, existsSync } from "node:fs";
import { basename } from "pathe";
import MagicString from "magic-string";
import type { RenderedChunk, Plugin } from "rollup";
import { parseWasm } from "../tools";
import { getWasmESMBinding, getWasmModuleBinding } from "./runtime/binding";
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

export function unwasm(opts: UnwasmPluginOptions): Plugin {
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
    resolveId: {
      order: "pre",
      async handler(id, importer) {
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
    load: {
      order: "pre",
      async handler(id) {
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
    },
    transform: {
      order: "pre",
      async handler(code, id) {
        if (!WASM_ID_RE.test(id)) {
          return;
        }

        const buff = Buffer.from(code, "binary");

        let isModule = id.endsWith("?module");

        const name = `wasm/${basename(id.split("?")[0], ".wasm")}-${sha1(buff)}.wasm`;

        let parsed: ReturnType<typeof parse> = {
          imports: {},
          exports: ["default"],
        };

        if (!isModule) {
          try {
            parsed = parse(name, buff);
          } catch (error) {
            this.warn({
              id,
              cause: error as Error,
              message: `Failed to parse WASM module. Falling back to Module mode.`,
            });
            isModule = true;
          }
        }

        const asset = (assets[name] = <WasmAsset>{
          name,
          id,
          source: buff,
          imports: parsed.imports,
          exports: parsed.exports,
        });

        const _code = isModule
          ? await getWasmModuleBinding(asset, opts)
          : await getWasmESMBinding(asset, opts).catch((error) => {
              this.warn({
                id,
                cause: error as Error,
                message: `Failed to load WASM module. Falling back to Module mode.`,
              });
              return getWasmModuleBinding(asset, opts);
            });

        return {
          code: _code,
          map: { mappings: "" },
        };
      },
    },
    renderChunk(code: string, chunk: RenderedChunk) {
      if (!opts.esmImport) {
        return;
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
        const nestedLevel =
          chunk.fileName.split("/").filter(Boolean /* handle // */).length - 1;
        const relativeId =
          (nestedLevel ? "../".repeat(nestedLevel) : "./") + asset.name;
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
}

/** @deprecated use unwasm export */
export const rollup = unwasm;
