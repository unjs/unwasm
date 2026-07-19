import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { it, describe, expect } from "vitest";
import { evalModule } from "mlly";
import { nodeResolve as rollupNodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { rolldown } from "rolldown";
import { build as viteBuild } from "vite";
import { rspack } from "@rspack/core";
import { UnwasmPluginOptions, unwasm } from "../src/plugin";
import { unwasmRspack } from "../src/plugin/rspack";
import { dirname } from "node:path";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

await rm(r(".tmp"), { recursive: true }).catch(() => {});

const builds = [
  { builder: "rollup", buildFn: _rollupBuild },
  { builder: "rolldown", buildFn: _rolldownBuild },
  { builder: "vite", buildFn: _viteBuild },
  { builder: "rspack", buildFn: _rspackBuild },
];

for (const { builder, buildFn } of builds) {
  describe(`plugin:${builder}`, () => {
    it("inline", async () => {
      const { output } = await buildFn("fixture/static-import.mjs", `${builder}-inline`, {});
      const code = output[0].code;
      const mod = await evalModule(code, {
        url: r("fixture/static-import.mjs"),
      });
      expect(mod.test()).toBe("OK");
    });

    it("esmImport", async () => {
      const name = `${builder}-esm-import`;
      const { output } = await buildFn("fixture/dynamic-import.mjs", name, {
        esmImport: true,
      });

      // Chunk order differs per builder; find the chunk referencing the emitted wasm.
      const esmImport = (output as any[])
        .map((o) => ("code" in o ? o.code.match(/["'](\.\/wasm\/.+wasm)["']/)?.[1] : undefined))
        .find(Boolean);
      expect(esmImport).match(/\.\/wasm\/\w+-[\da-f]+\.wasm/);
      expect(existsSync(r(`.tmp/${name}/${esmImport}`))).toBe(true);

      const resText = await _evalCloudflare(name).then((r) => r.text());
      expect(resText).toBe("OK");
    });

    it("module", async () => {
      const { output } = await buildFn("fixture/module-import.mjs", `${builder}-module`, {});
      const code = output[0].code;
      const mod = await evalModule(code, {
        url: r(`fixture/${builder}-module.mjs`),
      });
      expect(mod.test()).toBe("OK");
    });

    it("esm-integration", async () => {
      const { output } = await buildFn("fixture/esm-integration.mjs", `${builder}-inline`, {});
      const code = output[0].code;
      const mod = await evalModule(code, {
        url: r("fixture/esm-integration.mjs"),
      });
      expect(mod.test()).toBe("OK");
    });

    it("esm-integration-missing-import", async () => {
      const error = await buildFn(
        "fixture/esm-integration-missing-import.mjs",
        `${builder}-inline`,
        {},
      ).catch((error_) => error_);
      // Rolldown-based builders aggregate build errors into `errors`.
      const causes = [error, ...(error.errors || [])];
      // Rollup-family builders tag this as `MISSING_EXPORT`; rspack reports an
      // `ESModulesLinkingError` with no code, so match on either signal.
      const reasons = causes.map((c) => `${c.code ?? ""} ${c.message ?? ""}`);
      expect(reasons.some((r) => r.includes("MISSING_EXPORT") || r.includes("was not found"))).toBe(
        true,
      );
      expect(reasons.some((r) => r.includes("badImportName"))).toBe(true);
    });
  });
}

// Behaviour specific to the rspack integration, kept out of the shared matrix.
describe("plugin:rspack (specifics)", () => {
  it("distinguishes ?module from a plain import of the same binary", async () => {
    const { output } = await _rspackBuild("fixture/mixed-module-import.mjs", "rspack-mixed", {});
    const mod = await evalModule(output[0].code, { url: r("fixture/mixed-module-import.mjs") });
    expect(await mod.test()).toBe("OK");
  });

  it("leaves unresolvable imports to rspack's own diagnostics", async () => {
    const error = await _rspackBuild("fixture/missing-wasm.mjs", "rspack-missing", {}).catch(
      (error_) => error_,
    );
    expect(error.message).toContain("Module not found");
    expect(error.message).toContain("does-not-exist.wasm");
  });

  // Regression guard: the plugin must not depend on `asyncChunks` being off.
  // `[name]` is required because `modern-module` emits a separate runtime chunk.
  it("supports code splitting with rspack's default async chunks", async () => {
    const dir = r(".tmp/rspack-async");
    const stats = await _rspack({
      entry: r("fixture/dynamic-import.mjs"),
      context: r("fixture"),
      target: ["node", "es2022"],
      output: {
        path: dir,
        filename: "[name].mjs",
        chunkFilename: "[name].mjs",
        chunkFormat: "module",
        library: { type: "modern-module" },
        clean: true,
      },
      plugins: [unwasmRspack({})],
    });
    expect(stats.toJson({ errors: true }).errors).toEqual([]);
    const mod = await import(pathToFileURL(`${dir}/main.mjs`).href);
    expect(await mod.test()).toBe("OK");
  });

  it("rebuilds and re-emits when a watched .wasm changes", async () => {
    const dir = r(".tmp/rspack-watch");
    const src = r(".tmp/rspack-watch-src");
    await mkdir(src, { recursive: true });
    await copyFile(r("node_modules/@fixture/wasm/sum.wasm"), `${src}/live.wasm`);
    await writeFile(
      `${src}/entry.mjs`,
      `import { sum } from "./live.wasm";\nexport function test() { return sum(1, 2); }\n`,
    );

    const compiler = _rspack.compiler({
      entry: `${src}/entry.mjs`,
      context: src,
      target: ["node", "es2022"],
      output: {
        path: dir,
        filename: "[name].mjs",
        chunkFilename: "[name].mjs",
        chunkFormat: "module",
        library: { type: "modern-module" },
        clean: true,
      },
      plugins: [unwasmRspack({ esmImport: true })],
    });

    const emitted: string[][] = [];
    await new Promise<void>((resolve, reject) => {
      let swapped = false;
      const timer = setTimeout(
        () => watching.close(() => reject(new Error("watch timed out"))),
        20_000,
      );
      const watching = compiler.watch({ poll: 100 }, (error) => {
        if (error) {
          return;
        }
        emitted.push(existsSync(`${dir}/wasm`) ? readdirSync(`${dir}/wasm`).sort() : []);
        if (!swapped) {
          swapped = true;
          // `sum.wasm` -> `rand.wasm`: different content, so a different hash.
          setTimeout(
            () => copyFile(r("node_modules/@fixture/wasm/rand.wasm"), `${src}/live.wasm`),
            250,
          );
        } else if (emitted.at(-1)?.[0]?.includes("fda84bbd")) {
          clearTimeout(timer);
          watching.close(() => resolve());
        }
      });
    });

    // The rebuilt output references only the new binary; the stale one is gone.
    expect(emitted[0]).toEqual(["live-b2a806ed07e1d223.wasm"]);
    expect(emitted.at(-1)).toEqual(["live-fda84bbdf82c157b.wasm"]);
    const code = await readFile(`${dir}/main.mjs`, "utf8");
    expect(code).toContain("wasm/live-fda84bbdf82c157b.wasm");
    expect(code).not.toContain("live-b2a806ed07e1d223");
  }, 30_000);
});

// --- Utils ---

/** Promisified single-shot rspack build with the shared defaults. */
function _rspack(config: any) {
  return new Promise<any>((resolve, reject) =>
    rspack(_rspackConfig(config), (error, stats) => (error ? reject(error) : resolve(stats))),
  );
}
_rspack.compiler = (config: any) => rspack(_rspackConfig(config));

function _rspackConfig(config: any) {
  return {
    mode: "development",
    devtool: false,
    optimization: { minimize: false, splitChunks: false },
    ...config,
  };
}

async function _rollupBuild(entry: string, name: string, pluginOpts: UnwasmPluginOptions) {
  const build = await rollup({
    input: r(entry),
    plugins: [rollupNodeResolve({}), unwasm(pluginOpts)],
  });
  return await build.write({
    format: "esm",
    entryFileNames: "index.mjs",
    chunkFileNames: "[name].mjs",
    dir: r(`.tmp/${name}`),
  });
}

async function _rolldownBuild(entry: string, name: string, pluginOpts: UnwasmPluginOptions) {
  const build = await rolldown({
    input: r(entry),
    plugins: [unwasm(pluginOpts) as any],
  });
  return await build.write({
    format: "esm",
    entryFileNames: "index.mjs",
    chunkFileNames: "[name].mjs",
    dir: r(`.tmp/${name}`),
  });
}

async function _viteBuild(entry: string, name: string, pluginOpts: UnwasmPluginOptions) {
  const build = await viteBuild({
    logLevel: "warn",
    root: dirname(r(entry)),
    plugins: [unwasm(pluginOpts)],
    build: {
      lib: { entry: r(entry), formats: ["es"] },
      rollupOptions: {
        output: {
          format: "esm",
          entryFileNames: "index.mjs",
          chunkFileNames: "[name].mjs",
          dir: r(`.tmp/${name}`),
        },
      },
      minify: false,
      emptyOutDir: true,
      outDir: r(`.tmp/${name}`),
    },
  });
  return (build as any)[0];
}

async function _rspackBuild(entry: string, name: string, pluginOpts: UnwasmPluginOptions) {
  const stats = await new Promise<any>((resolve, reject) => {
    rspack(
      {
        entry: r(entry),
        mode: "development",
        devtool: false,
        target: ["web", "es2022"],
        context: dirname(r(entry)),
        output: {
          path: r(`.tmp/${name}`),
          filename: "index.mjs",
          chunkFilename: "[name].mjs",
          chunkFormat: "module",
          // `modern-module` emits runtime-free ESM, closest to the other builders.
          library: { type: "modern-module" },
          // Single initial chunk, for two reasons: the constant `filename` above
          // would otherwise collide with `modern-module`'s separate runtime
          // chunk, and rspack's async chunk loader uses a computed `import()`
          // that Miniflare's static module scan cannot follow. Async chunks are
          // covered separately in the rspack-specific tests below.
          asyncChunks: false,
          clean: true,
        },
        optimization: { minimize: false, splitChunks: false },
        plugins: [unwasmRspack(pluginOpts)],
      },
      (error, stats_) => (error ? reject(error) : resolve(stats_)),
    );
  });

  const { errors, assets } = stats.toJson({ errors: true, assets: true });
  if (errors?.length) {
    // Mirror rolldown's aggregated shape so the shared assertions apply.
    throw Object.assign(new Error(errors[0].message), { errors, code: errors[0].code });
  }

  // Entry chunk first, matching the other builders' output ordering.
  const names: string[] = assets
    .map((a: any) => a.name)
    .filter((n: string) => !n.endsWith(".wasm"))
    .sort((a: string, b: string) => Number(b === "index.mjs") - Number(a === "index.mjs"));

  return {
    output: await Promise.all(
      names.map(async (fileName) => ({
        fileName,
        code: await readFile(r(`.tmp/${name}/${fileName}`), "utf8"),
      })),
    ),
  };
}

async function _evalCloudflare(name: string) {
  const { Miniflare } = await import("miniflare");
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"] }],
    scriptPath: r(`.tmp/${name}/_mf.mjs`),
    script: `
import { test } from "./index.mjs";
export default {
  async fetch(request, env, ctx) {
    return new Response(await test());
  }
}
`,
  });
  const res = await mf.dispatchFetch("http://localhost");
  await mf.dispose();
  return res;
}
