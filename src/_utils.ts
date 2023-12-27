import { createHash } from "node:crypto";

export function sha1(source: Buffer) {
  return createHash("sha1").update(source).digest("hex").slice(0, 16);
}
