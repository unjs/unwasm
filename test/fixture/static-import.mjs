import { imports } from "./_imports.mjs";

// eslint-disable-next-line import/named
import { rand, $init } from "@fixture/wasm/examples/rand.wasm";

await $init(imports);

export function test() {
  return rand(0, 1000) > 0 ? "OK" : "FALED";
}
