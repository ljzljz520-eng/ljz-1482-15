/**
 * 文档内容指纹：revision 是乐观锁的第一道防线（并发拖动基线冲突检测），
 * 内容哈希是第二道——撤销/重放时用于确认“逆操作的前提仍然成立”，
 * 遇到他人编辑后必须重算可逆条件，而不能盲目回滚。
 *
 * 同构实现：浏览器使用 Web Crypto，Node 使用 node:crypto（动态 require，
 * 静态分析不会把 node 内置模块打进浏览器包）。
 */
import { canonicalStringify } from "./canonical.js";

export async function hashDoc(doc: unknown): Promise<string> {
  const text = canonicalStringify(doc);
  if (globalThis.crypto?.subtle) {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const nodeCrypto = await import("node:crypto");
  return nodeCrypto.createHash("sha256").update(text).digest("hex");
}

export { canonicalStringify };
