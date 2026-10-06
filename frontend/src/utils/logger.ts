/**
 * 前端轻量结构化日志（开发环境输出，生产环境只保留 warn/error）。
 */
const isDev = import.meta.env.DEV;

export const logger = {
  info(...args: unknown[]) {
    if (isDev) console.info("[timeline]", ...args);
  },
  warn(...args: unknown[]) {
    console.warn("[timeline]", ...args);
  },
  error(...args: unknown[]) {
    console.error("[timeline]", ...args);
  },
  debug(...args: unknown[]) {
    if (isDev) console.debug("[timeline]", ...args);
  }
};
