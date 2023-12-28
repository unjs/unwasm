import { imports } from "./_imports.mjs";

const { rand } = await import("@fixture/wasm/index.wasm").then((r) =>
  r.$init(imports),
);

export function test() {
  return rand(0, 1000) > 0 ? "OK" : "FALED";
}
