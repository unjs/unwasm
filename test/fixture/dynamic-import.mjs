const { rand } = await import("@fixture/wasm/rand.wasm");
const { sum } = await import("@fixture/wasm/sum.wasm");

export function test() {
  // Seems a bug with Miniflare and two async functions...
  // if (sum(1, 2) !== 3) {
  //   return "FALED: sum";
  // }
  if (!(rand(0, 1000) > 0)) {
    return "FALED: rand";
  }
  return "OK";
}
