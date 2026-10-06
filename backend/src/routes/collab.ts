import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { timelineService } from "../services/timelineService.js";

const simulateSchema = z.object({
  clipId: z.string(),
  /** 协作者把片段移动到的绝对起点 tick */
  start: z.number().int().nonnegative()
});

/**
 * 模拟“他人编辑”：以服务端系统用户身份直接对时间线做一次合法移动，
 * 供验收“并发拖动同一片段检测基线冲突，不能以最后到达覆盖”。
 */
export async function collabRoutes(app: FastifyInstance) {
  app.post("/timelines/:id/simulate-other-edit", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = simulateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "模拟编辑入参非法", issues: parsed.error.flatten() });
    }
    const system = await app.prisma.user.findFirst({ where: { username: "admin" } });
    if (!system) return reply.code(500).send({ message: "系统演示用户缺失" });
    const timelineId = (req.params as { id: string }).id;
    const tl = await timelineService.get(timelineId);
    try {
      const result = await timelineService.apply({
        timelineId,
        userId: system.id,
        op: { type: "moveClip", clipId: parsed.data.clipId, start: parsed.data.start },
        baseRevision: tl.revision,
        label: "协作者移动（模拟）"
      });
      return reply.code(200).send({
        message: "模拟协作者编辑已提交，您当前拖动的基线已过期",
        by: "admin（模拟协作者）",
        revision: result.revision
      });
    } catch (err) {
      return reply.code(409).send({
        message: "模拟编辑也被拒绝（目标位置冲突或片段已不存在）",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  });
}
