export async function test() {
  // Avoid top-level await because of miniflare curren't limitation.
  // https://github.com/cloudflare/miniflare/issues/753
  const { rand } = await import("@fixture/wasm/rand.wasm");
  const { sum } = await import("@fixture/wasm/sum.wasm");

  if (sum(1, 2) !== 3) {
    return "FALED: sum";
  }
  if (!(rand(0, 1000) > 0)) {
    return "FALED: rand";
  }
  return "OK";
}
