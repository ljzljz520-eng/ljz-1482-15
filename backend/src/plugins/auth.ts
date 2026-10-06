import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { logger } from "../logger.js";

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "editor";
  displayName: string;
}

declare module "@fastify/jwt" {
  interface JWT {
    payload: AuthUser;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser;
  }
}

export const authPlugin = fp(async (app) => {
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? "dev-secret" });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify<AuthUser>();
      req.authUser = {
        id: payload.id,
        username: payload.username,
        role: payload.role,
        displayName: payload.displayName
      };
    } catch {
      reply.code(401).send({ message: "未登录或登录已过期，请重新登录" });
    }
  });
});

// fp 默认导出兼容
export default authPlugin;

// 避免 logger 被树摇且保留统一日志入口
void logger;
