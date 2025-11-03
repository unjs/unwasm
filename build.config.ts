import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: ["src/plugin/index", "src/tools/index"],
  hooks: {
    async start() {
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
