import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  declaration: true,
  entries: ["src/plugin", "src/tools"],
  externals: ["unwasm", "rollup"],
});
