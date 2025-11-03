import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { it, describe, expect } from "vitest";
import { evalModule } from "mlly";
import { nodeResolve as rollupNodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { build as viteBuild } from "vite";
import { UnwasmPluginOptions, unwasm } from "../src/plugin";
import { dirname } from "pathe";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

await rm(r(".tmp"), { recursive: true }).catch(() => {});

const builds = [
  { builder: "rollup", buildFn: _rollupBuild },
  { builder: "vite", buildFn: _viteBuild },
];

for (const { builder, buildFn } of builds) {
  describe(`plugin:${builder}`, () => {
    it("inline", async () => {
      const { output } = await buildFn(
        "fixture/static-import.mjs",
        `${builder}-inline`,
        {},
      );
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

      const code = (output[1] && "code" in output[1] && output[1].code) || "";
      const esmImport = code.match(/["'](.+wasm)["']/)?.[1];
      expect(esmImport).match(/\.\/wasm\/\w+-[\da-f]+\.wasm/);
      expect(existsSync(r(`.tmp/${name}/${esmImport}`))).toBe(true);

      const resText = await _evalCloudflare(name).then((r) => r.text());
      expect(resText).toBe("OK");
    });

    it("module", async () => {
      const { output } = await buildFn(
        "fixture/module-import.mjs",
        `${builder}-module`,
        {},
      );
      const code = output[0].code;
      const mod = await evalModule(code, {
        url: r(`fixture/${builder}-module.mjs`),
      });
      expect(mod.test()).toBe("OK");
    });

    it("esm-integration", async () => {
      const { output } = await buildFn(
        "fixture/esm-integration.mjs",
        `${builder}-inline`,
        {},
      );
      const code = output[0].code;
      const mod = await evalModule(code, {
        url: r("fixture/esm-integration.mjs"),
      });
      expect(mod.test()).toBe("OK");
    });

    it("esm-integration-missing-import", async () => {
      await expect(() =>
        buildFn(
          "fixture/esm-integration-missing-import.mjs",
          `${builder}-inline`,
          {},
        ),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "MISSING_EXPORT",
        }),
      );
    });
  });
}

// --- Utils ---

async function _rollupBuild(
  entry: string,
  name: string,
  pluginOpts: UnwasmPluginOptions,
) {
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

async function _viteBuild(
  entry: string,
  name: string,
  pluginOpts: UnwasmPluginOptions,
) {
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
