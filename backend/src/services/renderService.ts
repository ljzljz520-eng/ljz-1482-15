import { exportRange, timelineDuration, type TimelineDoc } from "@timeline/core";
import { hashDocSync } from "@timeline/core/hashNode";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { withTimelineLock } from "./locks.js";
import { assertDocValid } from "./mediaService.js";

export interface RenderManifest {
  version: 1;
  jobId: string;
  fps: string;
  ticksPerSecond: 240000;
  exportStartTick: number;
  exportEndTick: number;
  totalTick: number;
  tracks: {
    id: string;
    kind: string;
    clips: {
      id: string;
      startTick: number;
      durationTick: number;
      sourceInTick: number;
      transitionIn?: { type: string; overlapTick: number } | null;
      keyPoints: { id: string; atTick: number; value: number }[];
      text?: string;
      mediaId?: string | null;
    }[];
  }[];
  markers: { id: string; atTick: number; label: string }[];
  snapshotHash: string;
  createdAt: string;
}

class RenderService {
  /**
   * 创建渲染任务：冻结创建时刻的文档快照与导出范围。
   * 之后无论时间线如何被编辑、素材是否退役，渲染都基于该不可变版本。
   */
  async create(timelineId: string, userId: string) {
    return withTimelineLock(timelineId, async () => {
      const row = await prisma.timeline.findUniqueOrThrow({ where: { id: timelineId } });
      const doc = row.doc as unknown as TimelineDoc;
      await assertDocValid(doc); // 冻结前再校验一次：拒绝悬空引用等
      const range = exportRange(doc);
      const job = await prisma.renderJob.create({
        data: {
          timelineId,
          userId,
          snapshot: doc as never,
          exportStart: range.start,
          exportEnd: range.end,
          fps: doc.fps,
          status: "queued",
          progress: 0
        }
      });
      logger.info({ jobId: job.id, timelineId, revision: row.revision }, "渲染任务已创建（时间线快照已冻结）");
      return { jobId: job.id, status: job.status, revision: row.revision };
    });
  }

  /** 基于冻结快照生成导出清单（预览总长/标记/导出范围来自同一时间模型） */
  async manifest(jobId: string): Promise<RenderManifest> {
    const job = await prisma.renderJob.findUniqueOrThrow({ where: { id: jobId } });
    const doc = job.snapshot as unknown as TimelineDoc;
    return {
      version: 1,
      jobId,
      fps: job.fps,
      ticksPerSecond: 240000,
      exportStartTick: job.exportStart,
      exportEndTick: job.exportEnd,
      totalTick: timelineDuration(doc),
      snapshotHash: hashDocSync(doc),
      createdAt: job.createdAt.toISOString(),
      tracks: doc.tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        clips: doc.clips
          .filter((c) => c.trackId === t.id)
          .map((c) => ({
            id: c.id,
            startTick: c.start,
            durationTick: c.duration,
            sourceInTick: c.sourceIn,
            transitionIn: c.transitionIn ? { type: c.transitionIn.type, overlapTick: c.transitionIn.overlap } : null,
            keyPoints: c.keyPoints.map((k) => ({ id: k.id, atTick: k.at, value: k.value })),
            text: c.text,
            mediaId: c.mediaId
          }))
      })),
      markers: doc.markers.map((m) => ({ id: m.id, atTick: m.at, label: m.label }))
    };
  }

  async list(timelineId?: string) {
    return prisma.renderJob.findMany({
      where: timelineId ? { timelineId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50
    });
  }

  async get(jobId: string) {
    return prisma.renderJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  /**
   * 模拟渲染推进（真实环境会把冻结快照投递给编码 worker）。
   * 关键点：即使源时间线已被编辑，这里推进与产物始终读取 snapshot。
   */
  async advance(jobId: string) {
    const job = await prisma.renderJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status === "done" || job.status === "failed") return job;
    const nextProgress = Math.min(100, job.progress + 25);
    const running = await prisma.renderJob.update({
      where: { id: jobId },
      data: {
        status: nextProgress >= 100 ? "done" : "running",
        progress: nextProgress,
        startedAt: job.startedAt ?? new Date(),
        finishedAt: nextProgress >= 100 ? new Date() : null,
        resultUrl: nextProgress >= 100 ? `/mock-renders/${jobId}.mp4` : null,
        message:
          nextProgress >= 100
            ? "渲染完成：基于冻结时间线快照，整数 tick 时间模型"
            : `编码中 ${nextProgress}%（冻结版本，不受后续编辑影响）`
      }
    });
    return running;
  }
}

export const renderService = new RenderService();
