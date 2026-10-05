/** 生成带前缀的短 id（非加密场景足够；真实部署也可换 uuid） */
let counter = 0;
export function genId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
