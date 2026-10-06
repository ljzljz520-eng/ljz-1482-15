import { createHash } from "node:crypto";
import { canonicalStringify } from "./canonical.js";

/** Node 专用同步哈希（服务端热路径与种子脚本使用），不进入浏览器打包 */
export function hashDocSync(doc: unknown): string {
  return createHash("sha256").update(canonicalStringify(doc)).digest("hex");
}
