import _mod from "@fixture/wasm/sum.wasm?module";
import { sum } from "@fixture/wasm/sum.wasm";

export async function test() {
  const { exports } = await WebAssembly.instantiate(_mod, {});
  return exports.sum(2, 3) === 5 && sum(4, 5) === 9 ? "OK" : "FAILED: mixed";
}
