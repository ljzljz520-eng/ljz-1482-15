import type { FastifyInstance } from "fastify";
import { renderService } from "../services/renderService.js";

export async function renderRoutes(app: FastifyInstance) {
  /** 创建渲染任务：冻结当前时间线版本（快照 + 同源导出范围） */
  app.post("/timelines/:id/render", { onRequest: [app.authenticate] }, async (req, reply) => {
    const userId = (req as unknown as { authUser: { id: string } }).authUser.id;
    try {
      const result = await renderService.create((req.params as { id: string }).id, userId);
      return reply.code(202).send(result);
    } catch (err) {
      return reply.code(400).send({
        message: "渲染任务创建失败：时间线未通过校验（可能存在悬空引用或退役素材）",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.get("/renders", { onRequest: [app.authenticate] }, async (req) => {
    const timelineId = (req.query as { timelineId?: string }).timelineId;
    return { items: await renderService.list(timelineId) };
  });

  app.get("/renders/:id", { onRequest: [app.authenticate] }, async (req, reply) => {
    try {
      return await renderService.get((req.params as { id: string }).id);
    } catch {
      return reply.code(404).send({ message: "渲染任务不存在" });
    }
  });

  /** 冻结版本导出清单：预览总长、标记、导出范围来自同一 tick 时间模型 */
  app.get("/renders/:id/manifest", { onRequest: [app.authenticate] }, async (req, reply) => {
    try {
      return await renderService.manifest((req.params as { id: string }).id);
    } catch {
      return reply.code(404).send({ message: "渲染任务不存在" });
    }
  });

  /** 推进模拟编码（真实环境替换为编码 worker 回调） */
  app.post("/renders/:id/advance", { onRequest: [app.authenticate] }, async (req, reply) => {
    try {
      return await renderService.advance((req.params as { id: string }).id);
    } catch {
      return reply.code(404).send({ message: "渲染任务不存在" });
    }
  });
}
