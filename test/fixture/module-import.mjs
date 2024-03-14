import _sumMod from "@fixture/wasm/sum.wasm?module";

const { sum } = await WebAssembly.instantiate(_sumMod).then((i) => i.exports);

export function test() {
  if (sum(1, 2) !== 3) {
    return "FALED: sum";
  }
  return "OK";
}
