import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "入参校验失败", issues: parsed.error.flatten() });
    }
    const user = await prisma.user.findUnique({ where: { username: parsed.data.username } });
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      logger.warn({ username: parsed.data.username }, "登录失败：用户名或密码错误");
      return reply.code(401).send({ message: "用户名或密码错误" });
    }
    const token = app.jwt.sign(
      { id: user.id, username: user.username, role: user.role, displayName: user.displayName },
      { expiresIn: "12h" }
    );
    logger.info({ username: user.username }, "用户登录成功");
    return {
      token,
      user: { id: user.id, username: user.username, role: user.role, displayName: user.displayName }
    };
  });

  app.get("/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    return { user: (req as unknown as { authUser: unknown }).authUser };
  });
}
