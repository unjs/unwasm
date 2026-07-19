import { sum } from "./does-not-exist.wasm";

export function test() {
  return sum(1, 2);
}
