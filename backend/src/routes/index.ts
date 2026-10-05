import type { FastifyInstance } from "fastify";
import { EngineError, type EditorOperation } from "@timeline/shared";
import { prisma } from "../lib/prisma";
import { mutate, recordConflictIdempotency, undo } from "../services/mutationService";
import { loadAssets, loadDoc } from "../services/docRepository";
import { enqueueRender, freezeCurrentTimeline, listFreezes } from "../services/freezeService";
import { assetCreateSchema, mutateRequestSchema, renderCreateSchema, undoRequestSchema } from "../lib/schemas";
import { logger } from "../lib/logger";

/** 简化鉴权：演示项目使用 header x-user-id；缺省取项目 owner */
async function resolveUserId(projectId: string, headerUserId?: string): Promise<string> {
  if (headerUserId) {
    const user = await prisma.user.findUnique({ where: { id: headerUserId } });
    if (user) return user.id;
  }
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  return project.ownerId;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  app.get("/users", async () => prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }));

  app.get("/projects", async () => {
    const projects = await prisma.project.findMany({ orderBy: { createdAt: "asc" }, include: { owner: true } });
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      owner: { id: p.owner.id, name: p.owner.name, color: p.owner.color },
      currentRevision: p.currentRevision,
      updatedAt: p.updatedAt
    }));
  });

  app.get("/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    const data = await prisma.$transaction(async (tx) => loadDoc(tx, id), { timeout: 10000 });
    return {
      id,
      name: data.name,
      ownerId: data.ownerId,
      revision: data.revision,
      doc: data.doc,
      assets: data.assets
    };
  });

  app.get("/projects/:id/history", async (req) => {
    const { id } = req.params as { id: string };
    const entries = await prisma.historyEntry.findMany({
      where: { projectId: id },
      orderBy: { revision: "desc" },
      take: 10,
      include: { user: true }
    });
    return entries.map((e) => ({
      id: e.id,
      revision: e.revision,
      summary: e.summary,
      userId: e.userId,
      userName: e.user.name,
      userColor: e.user.color,
      undoneById: e.undoneById,
      createdAt: e.createdAt
    }));
  });

  app.post("/projects/:id/mutate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = mutateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "E_VALIDATION", message: "请求参数校验失败", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(id, req.headers["x-user-id"] as string | undefined);
    const operation = parsed.data.operation as EditorOperation;
    try {
      const res = await mutate({
        projectId: id,
        userId,
        baseRevision: parsed.data.baseRevision,
        operation,
        clientId: parsed.data.clientId,
        force: parsed.data.force
      });
      return res;
    } catch (err) {
      if (err instanceof EngineError) {
        const status = err.code === "E_REVISION_CONFLICT" ? 409 : err.code === "E_NOT_FOUND" ? 404 : 422;
        if (err.code === "E_REVISION_CONFLICT" && parsed.data.clientId) {
          await recordConflictIdempotency(id, userId, parsed.data.clientId, {
            error: err.code,
            message: err.message,
            details: err.details
          });
        }
        return reply.status(status).send({ error: err.code, message: err.message, details: err.details });
      }
      logger.error({ err }, "mutate 未预期错误");
      throw err;
    }
  });

  app.post("/projects/:id/undo", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = undoRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "E_VALIDATION", message: "请求参数校验失败", details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(id, req.headers["x-user-id"] as string | undefined);
    try {
      return await undo({ projectId: id, userId, historyId: parsed.data.historyId, clientId: parsed.data.clientId });
    } catch (err) {
      if (err instanceof EngineError) {
        const status = err.code === "E_UNDO_CONFLICT" ? 409 : err.code === "E_NOT_FOUND" ? 404 : 422;
        return reply.status(status).send({ error: err.code, message: err.message, details: err.details });
      }
      throw err;
    }
  });

  // 素材
  app.get("/projects/:id/assets", async (req) => {
    const { id } = req.params as { id: string };
    return prisma.asset.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" } });
  });

  app.post("/projects/:id/assets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = assetCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "E_VALIDATION", message: "素材参数校验失败", details: parsed.error.flatten() });
    }
    const asset = await prisma.asset.create({
      data: {
        projectId: id,
        kind: parsed.data.kind,
        name: parsed.data.name,
        rateNum: parsed.data.rate.num,
        rateDen: parsed.data.rate.den,
        duration: parsed.data.duration,
        width: parsed.data.width,
        height: parsed.data.height
      }
    });
    return asset;
  });

  app.post("/projects/:id/assets/:assetId/retire", async (req, reply) => {
    const { id, assetId } = req.params as { id: string; assetId: string };
    const asset = await prisma.asset.updateMany({
      where: { id: assetId, projectId: id },
      data: { status: "retired" }
    });
    if (asset.count === 0) return reply.status(404).send({ error: "E_NOT_FOUND", message: "素材不存在" });
    logger.info({ projectId: id, assetId }, "素材已退役（冻结版本仍可引用）");
    return { ok: true };
  });

  // 冻结 & 渲染
  app.post("/projects/:id/freeze", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = renderCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "E_VALIDATION", message: "参数校验失败", details: parsed.error.flatten() });
    }
    const { frozen } = await freezeCurrentTimeline(id, parsed.data.label);
    let jobId: string | undefined;
    if (parsed.data.enqueue) {
      const j = await enqueueRender(frozen.id, parsed.data.kind);
      jobId = j.jobId;
    }
    return { frozen, jobId };
  });

  app.get("/projects/:id/freezes", async (req) => {
    const { id } = req.params as { id: string };
    return listFreezes(id);
  });

  app.get("/projects/:id/jobs", async (req) => {
    const { id } = req.params as { id: string };
    const jobs = await prisma.renderJob.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      take: 30
    });
    return jobs.map((j) => ({
      id: j.id,
      frozenId: j.frozenId,
      revision: j.revision,
      status: j.status,
      kind: j.kind,
      result: j.result,
      error: j.error,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt
    }));
  });

  app.get("/jobs/:jobId", async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const j = await prisma.renderJob.findUnique({ where: { id: jobId } });
    if (!j) return reply.status(404).send({ error: "E_NOT_FOUND", message: "任务不存在" });
    return j;
  });
}
