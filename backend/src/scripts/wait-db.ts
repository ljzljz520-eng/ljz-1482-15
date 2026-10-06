import { PrismaClient } from "@prisma/client";
import { logger } from "../logger.js";

const prisma = new PrismaClient();
const deadline = Date.now() + 60_000;

async function waitForDb(): Promise<void> {
  while (Date.now() < deadline) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info("PostgreSQL 已就绪");
      await prisma.$disconnect();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("等待 PostgreSQL 超时（60s）");
}

waitForDb().catch((err) => {
  logger.error({ err }, "数据库等待失败");
  process.exit(1);
});
