import unjs from "eslint-config-unjs";

// https://github.com/unjs/eslint-config
export default unjs({
  ignores: [
    "examples",
    "lib",
    "**/.tmp/**"
  ],
  rules: {},
});
