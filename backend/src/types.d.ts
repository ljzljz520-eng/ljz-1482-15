import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser } from "./plugins/auth.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authUser: AuthUser;
  }
}
