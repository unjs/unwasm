import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: ["src/plugin/index", "src/plugin/rspack", "src/tools/index"],
});
