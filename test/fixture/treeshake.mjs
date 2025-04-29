import { functionOne } from "@fixture/wasm/treeshake.wasm";

export function test() {
  if (functionOne(1) !== 42) {
    return "FAILED: call export";
  }
  return "OK";
}
