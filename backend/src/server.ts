import Fastify from "fastify";
import cors from "@fastify/cors";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { mediaRoutes } from "./routes/media.js";
import { timelineRoutes } from "./routes/timelines.js";
import { renderRoutes } from "./routes/render.js";
import { collabRoutes } from "./routes/collab.js";
import { prisma } from "./db/prisma.js";
import { logger } from "./logger.js";

const app = Fastify({
  logger: logger as never
});

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

app.decorate("prisma", prisma);

app.register(cors, {
  origin: true,
  credentials: true
});

app.register(authPlugin);

// 统一错误处理：不把堆栈泄漏给前端，结构化日志保留现场
app.setErrorHandler((err, req, reply) => {
  if (err.statusCode === 400 || err.validation) {
    logger.warn({ err: err.message, url: req.url }, "请求参数错误");
    return reply.code(400).send({ message: "请求参数不合法", detail: err.message });
  }
  if (err.code === "P2025") {
    return reply.code(404).send({ message: "资源不存在" });
  }
  // 数据库触发器拒绝悬空引用等约束错误
  if (typeof err.message === "string" && /timeline_doc_integrity|violates|constraint/i.test(err.message)) {
    logger.error({ err: err.message }, "数据库完整性约束拒绝写入");
    return reply
      .code(422)
      .send({ message: "数据库拒绝写入：文档存在悬空引用或完整性冲突", detail: err.message });
  }
  logger.error({ err, url: req.url }, "未处理异常");
  return reply.code(500).send({ message: "服务器内部错误，请稍后重试" });
});

app.get("/health", async () => ({ ok: true, service: "timeline-backend", timeBase: { ticksPerSecond: 240000 } }));

await app.register(authRoutes);
await app.register(mediaRoutes);
await app.register(timelineRoutes);
await app.register(renderRoutes);
await app.register(collabRoutes);

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  logger.info({ port, host }, "多轨时间线后端已启动");
} catch (err) {
  logger.error({ err }, "启动失败");
  process.exit(1);
}

const shutdown = async () => {
  logger.info("收到退出信号，关闭数据库连接…");
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
