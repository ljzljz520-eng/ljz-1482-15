import pino from "pino";

/**
 * 结构化日志，输出到 stdout，可通过 docker compose logs 直接观测。
 * 严禁使用 console.log / print。
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "timeline-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV !== "production"
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } } }
    : {})
});
