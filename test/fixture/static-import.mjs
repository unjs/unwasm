import { imports } from "./_imports.mjs";
import { rand, $init } from "@fixture/wasm/index.wasm";

await $init(imports);

export function test() {
  return rand(0, 1000) > 0 ? "OK" : "FALED";
}
