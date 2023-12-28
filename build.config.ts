import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  declaration: true,
  entries: ["src/plugin/index"],
  externals: ["unwasm", "rollup"],
});
