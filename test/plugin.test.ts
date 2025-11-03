import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { it, describe, expect } from "vitest";
import { evalModule } from "mlly";
import { nodeResolve as rollupNodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { UnwasmPluginOptions, unwasm } from "../src/plugin";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

await rm(r(".tmp"), { recursive: true }).catch(() => {});

describe("plugin:rollup", () => {
  it("inline", async () => {
    const { output } = await _rollupBuild(
      "fixture/static-import.mjs",
      "rollup-inline",
      {},
    );
    const code = output[0].code;
    const mod = await evalModule(code, { url: r("fixture/static-import.mjs") });
    expect(mod.test()).toBe("OK");
  });

  it("esmImport", async () => {
    const name = "rollup-esm";
    const { output } = await _rollupBuild("fixture/dynamic-import.mjs", name, {
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
    const { output } = await _rollupBuild(
      "fixture/module-import.mjs",
      "rollup-module",
      {},
    );
    const code = output[0].code;
    const mod = await evalModule(code, { url: r("fixture/rollup-module.mjs") });
    expect(mod.test()).toBe("OK");
  });

  it("esm-integration", async () => {
    const { output } = await _rollupBuild(
      "fixture/esm-integration.mjs",
      "rollup-inline",
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
      _rollupBuild(
        "fixture/esm-integration-missing-import.mjs",
        "rollup-inline",
        {},
      ),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "MISSING_EXPORT",
      }),
    );
  });
});

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
