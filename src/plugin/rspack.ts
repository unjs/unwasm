import { promises as fs, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Compilation, Compiler } from "@rspack/core";
import { parseWasm } from "../tools";
import { getWasmESMBinding, getWasmModuleBinding } from "./runtime/binding";
import { getPluginUtils } from "./runtime/utils";
import {
  sha1,
  UMWASM_HELPERS_ID,
  UNWASM_EXTERNAL_PREFIX,
  UnwasmPluginOptions,
  WasmAsset,
} from "./shared";

export type { UnwasmPluginOptions } from "./shared";

const WASM_ID_RE = /\.wasm(?:\?.*)?$/i;

/**
 * Rspack module identifiers travel through the native (Rust) side, so the `\0`
 * prefixes the Rollup plugin uses for virtual ids are replaced with plain,
 * filesystem-safe schemes before the generated code reaches the bundler.
 */
const EXTERNAL_PREFIX = "unwasm-external:";
const EXTERNAL_RE = /unwasm-external:([^"']+)/gu;

const PLUGIN_NAME = "unwasm";

/** `moduleFallback` marks a binary whose interface could not be parsed. */
type RspackWasmAsset = WasmAsset & { moduleFallback?: boolean };

/**
 * WebAssembly support for [rspack](https://rspack.rs).
 *
 * ```js
 * // rspack.config.mjs
 * import { unwasmRspack } from "unwasm/plugin/rspack";
 *
 * export default {
 *   plugins: [unwasmRspack({ esmImport: true })],
 * };
 * ```
 */
export function unwasmRspack(opts: UnwasmPluginOptions = {}): UnwasmRspackPlugin {
  return new UnwasmRspackPlugin(opts);
}

export class UnwasmRspackPlugin {
  readonly name = PLUGIN_NAME;

  constructor(private readonly opts: UnwasmPluginOptions = {}) {}

  apply(compiler: Compiler): void {
    const opts = this.opts;
    const { experiments, ExternalsPlugin, sources } = compiler.rspack;

    // Emitted wasm binaries, keyed by their content-hashed output name.
    const assets: Record<string, RspackWasmAsset> = Object.create(null);

    const helpersId = join(compiler.context, `${UMWASM_HELPERS_ID.slice(1)}.mjs`);

    // Generated bindings are served from an in-memory layer instead of a loader,
    // which keeps the whole plugin in a single module and lets the (async) parse
    // step run during resolution. The virtual file store only exists once the
    // compiler is created, so the always-present helpers module is seeded here.
    const virtualModules = new experiments.VirtualModulesPlugin({
      [helpersId]: getPluginUtils(),
    });
    virtualModules.apply(compiler);

    if (opts.esmImport) {
      // Keep `import("unwasm-external:<name>")` in the output untouched; the
      // specifier is rewritten to a relative asset path in `processAssets`.
      // `module-import` keeps dynamic imports dynamic instead of hoisting them.
      new ExternalsPlugin("module-import", [new RegExp("^" + EXTERNAL_PREFIX)]).apply(compiler);
    }

    /** Rewrite the shared binding output to identifiers rspack can resolve. */
    const rewriteIds = (code: string) =>
      code
        .replaceAll(UMWASM_HELPERS_ID, helpersId.replaceAll("\\", "/"))
        .replaceAll(UNWASM_EXTERNAL_PREFIX, EXTERNAL_PREFIX);

    compiler.hooks.compilation.tap(
      PLUGIN_NAME,
      (compilation, { normalModuleFactory: moduleFactory }) => {
        const resolver = moduleFactory.getResolver("normal", {});

        moduleFactory.hooks.beforeResolve.tapPromise(PLUGIN_NAME, async (data) => {
          const request = data.request;

          // `unwasm-external:wasm/<name>.wasm` also matches `WASM_ID_RE`.
          if (request.startsWith(EXTERNAL_PREFIX) || !WASM_ID_RE.test(request)) {
            return;
          }

          const [bareRequest, query = ""] = splitQuery(request);
          const resolved = resolver.resolveSync({}, data.context, bareRequest);
          if (!resolved || !existsSync(resolved)) {
            return;
          }

          data.fileDependencies.push(resolved);

          const source = await fs.readFile(resolved);
          const isModule = query === "module";
          const asset = registerAsset(assets, resolved, source, isModule, compilation);

          const code = rewriteIds(
            isModule || asset.moduleFallback
              ? await getWasmModuleBinding(asset, opts)
              : await getWasmESMBinding(asset, opts).catch(async (error) => {
                  warn(
                    compilation,
                    opts,
                    `Failed to load the WebAssembly module "${resolved}"; falling back to module mode: ${(error as Error).message}`,
                  );
                  return getWasmModuleBinding(asset, opts);
                }),
          );

          // Generated bindings sit next to the binary so that relative imports
          // and `node_modules` lookups from within them keep resolving.
          const virtualId = join(
            dirname(resolved),
            `${basename(resolved)}${isModule ? ".module" : ""}.unwasm.mjs`,
          );
          virtualModules.writeModule(virtualId, code);
          data.request = virtualId;
        });

        compilation.hooks.processAssets.tap(
          {
            name: PLUGIN_NAME,
            stage: compiler.rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
          },
          () => {
            if (!opts.esmImport) {
              return;
            }

            for (const asset of Object.values(assets)) {
              compilation.emitAsset(asset.name, new sources.RawSource(asset.source));
            }

            for (const [fileName, source] of Object.entries(compilation.assets)) {
              if (!fileName.endsWith(".js") && !fileName.endsWith(".mjs")) {
                continue;
              }
              const code = source.source().toString();
              if (!code.includes(EXTERNAL_PREFIX)) {
                continue;
              }
              // Output filenames are `/`-separated regardless of platform.
              const nestedLevel = fileName.split("/").filter(Boolean).length - 1;
              const prefix = nestedLevel > 0 ? "../".repeat(nestedLevel) : "./";
              const rewritten = code.replaceAll(EXTERNAL_RE, (match, name: string) => {
                if (!assets[name]) {
                  warn(compilation, opts, `Failed to resolve WASM import: ${JSON.stringify(name)}`);
                  return match;
                }
                return prefix + name;
              });
              compilation.updateAsset(fileName, new sources.RawSource(rewritten));
            }
          },
        );
      },
    );
  }
}

// --- Utils ---

function splitQuery(id: string): [string, string?] {
  const index = id.indexOf("?");
  return index === -1 ? [id] : [id.slice(0, index), id.slice(index + 1)];
}

function warn(compilation: Compilation, opts: UnwasmPluginOptions, message: string) {
  if (!opts.silent) {
    compilation.warnings.push(new Error(`[unwasm] ${message}`) as any);
  }
}

/**
 * Parse `source` and record it as an emittable asset.
 *
 * `moduleFallback` is set when the interface could not be read, in which case the
 * caller degrades to a plain `WebAssembly.Module` binding.
 */
function registerAsset(
  assets: Record<string, RspackWasmAsset>,
  id: string,
  source: Buffer,
  isModule: boolean,
  compilation: Compilation,
): RspackWasmAsset {
  const name = `wasm/${basename(splitQuery(id)[0], ".wasm")}-${sha1(source)}.wasm`;

  const cached = assets[name];
  if (cached) {
    return cached;
  }

  const imports: Record<string, string[]> = Object.create(null);
  const exports: string[] = [];
  let moduleFallback = false;

  if (isModule) {
    exports.push("default");
  } else {
    try {
      const parsed = parseWasm(source, { name });
      for (const mod of parsed.modules) {
        exports.push(...mod.exports.map((e) => e.name));
        for (const imp of mod.imports) {
          (imports[imp.module] ||= []).push(imp.name);
        }
      }
    } catch (error) {
      compilation.warnings.push(
        new Error(
          `[unwasm] Failed to parse the WebAssembly module "${id}"; falling back to module mode.`,
          { cause: error },
        ) as any,
      );
      moduleFallback = true;
    }
  }

  return (assets[name] = { name, id, source, imports, exports, moduleFallback });
}
