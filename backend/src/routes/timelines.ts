import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { timelineService, ConflictError } from "../services/timelineService.js";
import { idempotent } from "../plugins/idempotency.js";
import { logger } from "../logger.js";

const policySchema = z.object({
  mode: z.enum(["ripple", "lift"]),
  subtitles: z.enum(["delete", "detach", "follow"]),
  music: z.enum(["follow", "hold"])
});

const opSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("addClip"),
      clip: z.record(z.unknown())
    }),
    z.object({
      type: z.literal("removeClip"),
      clip: z.record(z.unknown())
    }),
    z.object({
      type: z.literal("moveClip"),
      clipId: z.string(),
      start: z.number().int().nonnegative(),
      trackId: z.string().optional()
    }),
    z.object({
      type: z.literal("trimClip"),
      clipId: z.string(),
      edge: z.enum(["head", "tail"]),
      start: z.number().int().nonnegative(),
      duration: z.number().int().positive(),
      sourceIn: z.number().int().nonnegative()
    }),
    z.object({
      type: z.literal("dragKeyPoint"),
      clipId: z.string(),
      keyPointId: z.string(),
      at: z.number().int().nonnegative()
    }),
    z.object({ type: z.literal("addMarker"), marker: z.record(z.unknown()) }),
    z.object({ type: z.literal("moveMarker"), markerId: z.string(), at: z.number().int().nonnegative() }),
    z.object({ type: z.literal("removeMarker"), marker: z.record(z.unknown()) }),
    z.object({
      type: z.literal("setExportRange"),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive()
    }),
    z.object({
      type: z.literal("setTransition"),
      clipId: z.string(),
      transition: z.union([z.null(), z.object({ type: z.string(), overlap: z.number().int().positive() })])
    }),
    z.object({
      type: z.literal("setAnchor"),
      clipId: z.string(),
      anchorClipId: z.union([z.string(), z.null()]),
      anchorOffset: z.number().int().nonnegative().optional()
    }),
    z.object({ type: z.literal("compound"), ops: z.array(opSchema), label: z.string().optional() })
  ])
);

const applySchema = z.object({
  op: opSchema,
  baseRevision: z.number().int().positive(),
  label: z.string().optional(),
  autoRebase: z.boolean().optional(),
  baseDoc: z.record(z.unknown()).optional()
});

const deleteSchema = z.object({
  clipId: z.string(),
  baseRevision: z.number().int().positive(),
  policy: policySchema
});

const previewSchema = z.object({
  clipId: z.string(),
  policy: policySchema
});

export async function timelineRoutes(app: FastifyInstance) {
  app.get("/timelines", { onRequest: [app.authenticate] }, async () => {
    const rows = await app.prisma.timeline.findMany({ orderBy: { createdAt: "asc" } });
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        revision: r.revision,
        frozen: r.frozen,
        updatedAt: r.updatedAt
      }))
    };
  });

  app.get("/timelines/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    try {
      return await timelineService.get((req.params as { id: string }).id);
    } catch {
      return reply.code(404).send({ message: "时间线不存在" });
    }
  });

  /** 应用操作（拖动片段/关键点/标记/修剪/添加等），带乐观基线与幂等保存 */
  app.post("/timelines/:id/ops", { onRequest: [app.authenticate] }, async (req, reply) => {
    const timelineId = (req.params as { id: string }).id;
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "操作入参校验失败", issues: parsed.error.flatten() });
    }
    const userId = (req as unknown as { authUser: { id: string } }).authUser.id;
    return idempotent(app, req, reply, async () => {
      try {
        const result = await timelineService.apply({
          timelineId,
          userId,
          op: parsed.data.op as never,
          baseRevision: parsed.data.baseRevision,
          label: parsed.data.label,
          autoRebase: parsed.data.autoRebase,
          baseDoc: parsed.data.baseDoc as never
        });
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ConflictError) {
          logger.warn({ timelineId, reason: err.payload.reason }, "操作冲突被拒绝");
          return { status: 409, body: { message: err.payload.reason, conflict: err.payload } };
        }
        throw err;
      }
    });
  });

  /** 删除片段（带用户选择的波纹/绝对位置与字幕/配乐策略） */
  app.post("/timelines/:id/delete", { onRequest: [app.authenticate] }, async (req, reply) => {
    const timelineId = (req.params as { id: string }).id;
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "删除入参校验失败", issues: parsed.error.flatten() });
    }
    const userId = (req as unknown as { authUser: { id: string } }).authUser.id;
    return idempotent(app, req, reply, async () => {
      try {
        const result = await timelineService.deleteClip({
          timelineId,
          userId,
          clipId: parsed.data.clipId,
          policy: parsed.data.policy,
          baseRevision: parsed.data.baseRevision
        });
        return { status: 200, body: result };
      } catch (err) {
        if (err instanceof ConflictError) {
          return { status: 409, body: { message: err.payload.reason, conflict: err.payload } };
        }
        if (err instanceof Error && err.message.includes("不存在")) {
          return { status: 404, body: { message: err.message } };
        }
        throw err;
      }
    });
  });

  /** 删除影响预览（供确认对话框） */
  app.post("/timelines/:id/delete-preview", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "预览入参校验失败", issues: parsed.error.flatten() });
    }
    try {
      return await timelineService.previewDelete(
        (req.params as { id: string }).id,
        parsed.data.clipId,
        parsed.data.policy
      );
    } catch (err) {
      return reply.code(404).send({ message: err instanceof Error ? err.message : "预览失败" });
    }
  });

  /** 撤销栈（跨刷新持久化） */
  app.get("/timelines/:id/undo", { onRequest: [app.authenticate] }, async (req) => {
    const userId = (req as unknown as { authUser: { id: string } }).authUser.id;
    return {
      items: await timelineService.listUndo((req.params as { id: string }).id, userId)
    };
  });

  app.post("/timelines/:id/undo/:entryId", { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req as unknown as { authUser: { id: string } }).authUser.id;
    const force = (req.body as { force?: boolean } | undefined)?.force === true;
    try {
      return await timelineService.undo(
        (req.params as { id: string; entryId: string }).id,
        userId,
        (req.params as { entryId: string }).entryId,
        force
      );
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.code(409).send({ message: err.payload.reason, conflict: err.payload });
      }
      return reply.code(404).send({ message: "撤销记录不存在" });
    }
  });
}
