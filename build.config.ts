import { cp } from "node:fs/promises";
import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: ["src/plugin/index", "src/plugin/rspack", "src/tools/index"],
  hooks: {
    // Rspack resolves loaders by path, so this one ships as a standalone file
    // next to the bundled plugin instead of being inlined into it.
    async end() {
      await cp("src/plugin/rspack-loader.cjs", "dist/plugin/rspack-loader.cjs");
    },
  },
});
