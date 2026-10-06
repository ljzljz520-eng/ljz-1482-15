import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";

interface IdemRequest {
  headers: Record<string, unknown>;
  authUser?: { id: string };
}

/**
 * 幂等包装：处理“保存响应丢失”。
 * 客户端用同一个 Idempotency-Key 重试时，直接返回首次响应，
 * 不会把同一操作应用两次（不会产生两个 revision / 两步撤销）。
 */
export async function idempotent(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<{ status?: number; body: unknown }>
): Promise<void> {
  const key = req.headers["idempotency-key"];
  const userId = (req as IdemRequest).authUser?.id;
  if (typeof key !== "string" || !key || key.length < 8) {
    const r = await handler();
    reply.code(r.status ?? 200).send(r.body);
    return;
  }

  const existing = await prisma.idempotentRequest.findUnique({ where: { key } });
  if (existing) {
    logger.info({ key }, "命中幂等键，重放首次响应（响应丢失后的安全重试）");
    reply.code(existing.statusCode).send(existing.response);
    return;
  }

  const r = await handler();
  const status = r.status ?? 200;
  if (status < 500 && userId) {
    const uid: string = userId;
    await prisma.idempotentRequest
      .create({
        data: {
          key,
          userId: uid,
          method: req.method,
          path: req.url.split("?")[0],
          statusCode: status,
          response: r.body as never
        }
      })
      .catch((err: unknown) => {
        // 并发竞争：另一相同请求已先写入，唯一约束保证只处理一次
        logger.debug({ err: String(err), key }, "幂等键并发竞争（忽略）");
      });
  }
  reply.code(status).send(r.body);
}

export type { FastifyInstance };
