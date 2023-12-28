// @ts-nocheck https://www.assemblyscript.org

export function rand(min: f64, max: f64): f64 {
  return Math.floor(Math.random() * (max - min + 1));
}
