import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  declaration: true,
  entries: ["src/plugin"],
  externals: ["unwasm", "rollup"],
});
