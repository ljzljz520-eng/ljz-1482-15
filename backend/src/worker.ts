/**
 * 渲染工作线程（独立容器进程，轮询 queued 任务）。
 * 任务从冻结快照渲染；即使主时间线继续被编辑，本任务输出不受影响。
 * 采用 claim-and-skip：同一 frozenId 已有终态任务时跳过，重复入队安全。
 */

import { prisma } from "./lib/prisma";
import { logger } from "./lib/logger";
import type { FrozenTimeline } from "@timeline/shared";
import { renderEdl, renderSvgPoster } from "./services/renderer";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1500);

async function tick(): Promise<boolean> {
  const job = await prisma.renderJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" }
  });
  if (!job) return false;

  // 原子认领：仅当仍是 queued 时才能置为 running，防止多 worker 重复执行
  const claimed = await prisma.renderJob.updateMany({
    where: { id: job.id, status: "queued" },
    data: { status: "running" }
  });
  if (claimed.count === 0) return true;

  logger.info({ jobId: job.id, kind: job.kind, revision: job.revision }, "渲染任务开始（冻结版本）");
  try {
    // 模拟编码耗时，凸显“冻结版本不被编辑影响”
    await new Promise((r) => setTimeout(r, 1200));
    const frozenRow = await prisma.frozenTimeline.findUniqueOrThrow({ where: { id: job.frozenId } });
    const frozen = {
      id: frozenRow.id,
      projectId: frozenRow.projectId,
      revision: frozenRow.revision,
      label: frozenRow.label,
      createdAt: frozenRow.createdAt.toISOString(),
      doc: frozenRow.doc,
      assets: frozenRow.assets
    } as unknown as FrozenTimeline;

    const result = job.kind === "edl" ? renderEdl(frozen) : renderSvgPoster(frozen);
    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "succeeded", result, error: null }
    });
    logger.info({ jobId: job.id }, "渲染任务成功");
  } catch (err) {
    logger.error({ jobId: job.id, err }, "渲染任务失败");
    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "failed", error: (err as Error).message }
    });
  }
  return true;
}

async function main() {
  logger.info({ pollMs: POLL_MS }, "渲染工作线程启动");
  for (;;) {
    try {
      const did = await tick();
      await new Promise((r) => setTimeout(r, did ? 50 : POLL_MS));
    } catch (err) {
      logger.error({ err }, "工作线程循环异常");
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.fatal({ err }, "工作线程致命错误");
    process.exit(1);
  });
}
