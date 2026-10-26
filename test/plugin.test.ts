import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { it, describe, expect } from "vitest";
import { evalModule } from "mlly";
import { nodeResolve as rollupNodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { rolldown } from "rolldown";
import { build as viteBuild } from "vite";
import { UnwasmPluginOptions, unwasm } from "../src/plugin";
import { dirname } from "node:path";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

await rm(r(".tmp"), { recursive: true }).catch(() => {});

const builds = [
  { builder: "rollup", buildFn: _rollupBuild },
  { builder: "rolldown", buildFn: _rolldownBuild },
  { builder: "vite", buildFn: _viteBuild },
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

    it("assetURLs", async () => {
      const name = `${builder}-asset-url`;
      const { output } = await buildFn("fixture/asset-url.mjs", name, {
        assetURLs: true,
      });

      const assets = (output as any[]).filter((o) => o.type === "asset").map((o) => o.fileName);
      // Vite lib builds don't hash asset names
      expect(assets).toContainEqual(expect.stringMatching(/data(-[\w-]+)?\.txt$/));
      expect(assets).toContainEqual(expect.stringMatching(/sum(-[\w-]+)?\.wasm$/));

      // Import from disk so `import.meta.url` points to the output directory
      const mod = await import(r(`.tmp/${name}/index.mjs`));
      expect(await mod.test(readFile)).toBe("OK");
    });

    it("esm-integration-missing-import", async () => {
      const error = await buildFn(
        "fixture/esm-integration-missing-import.mjs",
        `${builder}-inline`,
        {},
      ).catch((error_) => error_);
      // Rolldown-based builders aggregate build errors into `errors`.
      const causes = [error, ...(error.errors || [])];
      expect(causes.map((c) => c.code)).toContain("MISSING_EXPORT");
    });
  });
}

describe("plugin:sync", () => {
  // Hosts running hooks inside sync loader hooks (e.g. env-runner's self
  // runner) return `this.resolve()` results directly and can't await hooks.
  it("hooks do not return promises with a sync resolve", () => {
    const plugin = unwasm({});
    const wasmPath = r("../examples/add-esmi.wasm");
    const ctx = {
      resolve: (id: string) => ({ id: "file://" + id, external: false, meta: {} }),
      addWatchFile: () => {},
      emitFile: () => "",
      warn: () => {},
    };

    const resolved = plugin.resolveId.handler.call(ctx, wasmPath, undefined);
    expect(resolved).not.toBeInstanceOf(Promise);
    expect(resolved).toMatchObject({ id: wasmPath, external: false });

    const loaded = plugin.load.handler.call(ctx, wasmPath);
    expect(typeof loaded).toBe("string");

    const transformed = plugin.transform.handler.call(ctx, loaded as string, wasmPath);
    expect(transformed).not.toBeInstanceOf(Promise);
    expect((transformed as { code: string }).code).toContain("export const addImported");
  });
});

describe("plugin:assetURLs", () => {
  const id = r("node_modules/@fixture/asset-url/dist/index.mjs");
  const code = readFileSync(id, "utf8");
  const transform = (opts: UnwasmPluginOptions, ref: string) => {
    const plugin = unwasm(opts);
    const ctx = {
      addWatchFile: () => {},
      emitFile: () => ref,
      warn: () => {},
    };
    return plugin.transform.handler.call(ctx as any, code, id) as { code: string } | undefined;
  };

  it("rewrites static URLs to existing non-JS files", () => {
    const result = transform({ assetURLs: true }, "ref");
    expect(result?.code.match(/new URL\(import\.meta\.ROLLUP_FILE_URL_ref\)/g)).toHaveLength(2);
    expect(result?.code).toContain('new URL("./missing.bin", import.meta.url)');
    expect(result?.code).toContain('new URL("./worker.mjs", import.meta.url)');
    expect(result?.code).toContain("new URL(`./${name}.bin`, import.meta.url)");
  });

  it("keeps original URLs when files can't be emitted", () => {
    expect(transform({ assetURLs: true }, "")).toBeUndefined();
  });

  it("is disabled by default", () => {
    expect(unwasm({}).transform.filter.id.toString()).toBe(/\.wasm(?:\?.*)?$/i.toString());
    expect(transform({}, "ref")).toBeUndefined();
  });
});

// --- Utils ---

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
    // Resolve emitted file URLs relative to `import.meta.url`
    base: "./",
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
