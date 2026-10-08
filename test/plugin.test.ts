import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { it, describe, expect } from "vitest";
import { evalModule } from "mlly";
import { nodeResolve as rollupNodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { rolldown } from "rolldown";
import { build as viteBuild } from "vite";
import { UnwasmPluginOptions, unwasm } from "../src/plugin";

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

    it("sourcePhaseImport", async () => {
      const name = `${builder}-source-phase-import`;
      const { output } = await buildFn("fixture/dynamic-import.mjs", name, {
        sourcePhaseImport: true,
      });

      const esmImport = (output as any[])
        .map((o) => ("code" in o ? o.code.match(/["'](\.\/wasm\/.+wasm)["']/)?.[1] : undefined))
        .find(Boolean);
      expect(esmImport).match(/\.\/wasm\/\w+-[\da-f]+\.wasm/);
      expect(existsSync(r(`.tmp/${name}/${esmImport}`))).toBe(true);

      // Evaluate in a Node.js child_process (Vitest transforms mangle `import.source`)
      const stdout = await _evalNode(name);
      expect(stdout).toBe("OK");
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
      expect(causes.map((c) => c.code)).toContain("MISSING_EXPORT");
    });
  });
}

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

async function _evalNode(name: string) {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    `
import { test } from ${JSON.stringify(new URL(`.tmp/${name}/index.mjs`, import.meta.url))};
console.log(await test());
`,
  ]);
  return stdout.trim();
}
