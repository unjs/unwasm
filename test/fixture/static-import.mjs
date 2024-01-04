import { sum } from "@fixture/wasm/sum.wasm";
import { rand } from "@fixture/wasm/rand.wasm";

export function test() {
  if (sum(1, 2) !== 3) {
    return "FALED: sum";
  }
  if (!(rand(0, 1000) > 0)) {
    return "FALED: rand";
  }
  return "OK";
}
