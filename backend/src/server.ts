import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./routes";
import { EngineError } from "@timeline/shared";

const isProd = process.env.NODE_ENV === "production";

const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
    logger: isProd
      ? { level: process.env.LOG_LEVEL ?? "info" }
      : { level: process.env.LOG_LEVEL ?? "info", transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } } }
  });

  await app.register(cors, { origin: true });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof EngineError) {
      return reply.status(422).send({ error: err.code, message: err.message, details: err.details });
    }
    req.log.error({ err }, "未处理的服务器错误");
    return reply.status(500).send({ error: "E_INTERNAL", message: "服务器内部错误" });
  });

  await registerRoutes(app);

  await app.listen({ port: PORT, host: HOST });
  app.log.info({ port: PORT, host: HOST }, "时间线编排后端已启动");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("启动失败", err);
  process.exit(1);
});
