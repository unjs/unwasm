import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  declaration: true,
  rollup: { emitCJS: true },
  entries: ["src/plugin", "src/tools"],
  externals: ["unwasm", "rollup"],
  hooks: {
    async "build:before"() {
      const { build } = await import("esbuild");
      await build({
        entryPoints: ["lib/wasm-parser.in.mjs"],
        bundle: true,
        outfile: "lib/wasm-parser.mjs",
        format: "esm",
        platform: "node",
        banner: {
          js: "// webassemblyjs (MIT) - Copyright (c) 2018 Sven Sauleau <sven@sauleau.com>\n",
        },
      });
    },
  },
});
