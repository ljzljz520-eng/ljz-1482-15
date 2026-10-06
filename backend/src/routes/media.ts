import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Rational, ticksPerFrame, isExactFrameRate } from "@timeline/core";
import { listMediaAssets, retireMedia, createMedia } from "../services/mediaService.js";
import { logger } from "../logger.js";

const createSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["video", "audio", "image"]),
  fps: z.string().regex(/^\d+\/\d+$|^\d+$/, "帧率必须是有理数 num/den（如 30000/1001）"),
  /** 源帧数（视频）或采样数（音频），由服务端精确换算为整数 tick，禁止传浮点秒 */
  sourceFrames: z.number().int().nonnegative().optional(),
  samples: z.number().int().nonnegative().optional(),
  sampleRate: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

export async function mediaRoutes(app: FastifyInstance) {
  app.get("/media", { onRequest: [app.authenticate] }, async () => {
    return { items: await listMediaAssets() };
  });

  app.post("/media", { onRequest: [app.authenticate] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "素材入参校验失败", issues: parsed.error.flatten() });
    }
    const b = parsed.data;
    const fps = Rational.from(b.fps);
    if (!isExactFrameRate(fps)) {
      return reply
        .code(400)
        .send({ message: `帧率 ${b.fps} 无法在整数 tick 时间基上精确表达，请改用可整除帧率` });
    }
    let duration: number;
    if (b.kind === "audio") {
      if (!b.samples || !b.sampleRate) {
        return reply.code(400).send({ message: "音频素材需要 samples 与 sampleRate" });
      }
      // 采样 -> tick 精确整数换算（48k 每采样 5 tick）
      if (240000 % b.sampleRate !== 0) {
        return reply.code(400).send({ message: `采样率 ${b.sampleRate} 无法精确映射到 tick` });
      }
      duration = (b.samples * 240000) / b.sampleRate;
    } else {
      if (b.sourceFrames == null) {
        return reply.code(400).send({ message: "视频/图片素材需要 sourceFrames" });
      }
      duration = b.sourceFrames * ticksPerFrame(fps);
    }
    const item = await createMedia({
      name: b.name,
      kind: b.kind,
      fps: b.fps,
      duration,
      sampleRate: b.sampleRate,
      width: b.width,
      height: b.height
    });
    logger.info({ mediaId: item.id, duration }, "素材已创建（时长由整数 tick 精确换算）");
    return reply.code(201).send({ item });
  });

  /**
   * 退役素材：模拟“拖拽过程中素材被他人退役”的验收场景。
   * 退役后任何引用它的编辑/渲染都会被服务端校验拒绝。
   */
  app.post("/media/:id/retire", { onRequest: [app.authenticate] }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    try {
      const item = await retireMedia(id);
      logger.warn({ mediaId: id, by: (req as unknown as { authUser: { username: string } }).authUser.username }, "素材已退役");
      return { item };
    } catch {
      return reply.code(404).send({ message: "素材不存在" });
    }
  });
}
