/**
 * 冻结时间线版本：渲染任务永远从冻结快照读取，
 * 编辑继续进行不会影响已排队/进行中的渲染。
 */

import { validateDoc, type FrozenTimeline } from "@timeline/shared";
import { prisma } from "../lib/prisma";
import { loadAssets, loadDoc, lockProject } from "./docRepository";
import { assetMap } from "../lib/types";
import { logger } from "../lib/logger";

export async function freezeCurrentTimeline(
  projectId: string,
  label?: string
): Promise<{ frozen: FrozenTimeline; frozenId: string }> {
  return prisma.$transaction(
    async (tx) => {
      await lockProject(tx, projectId);
      const loaded = await loadDoc(tx, projectId);
      const assets = await loadAssets(tx, projectId);
      validateDoc(loaded.doc, { assets: assetMap(assets), requireActiveAsset: false });

      const row = await tx.frozenTimeline.create({
        data: {
          projectId,
          revision: loaded.revision,
          label: label ?? `v${loaded.revision} 冻结版本`,
          doc: loaded.doc as unknown as object,
          assets: assets as unknown as object
        }
      });
      logger.info({ projectId, frozenId: row.id, revision: loaded.revision }, "时间线已冻结");
      const frozen: FrozenTimeline = {
        id: row.id,
        projectId,
        revision: row.revision,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        doc: loaded.doc,
        assets
      };
      return { frozen, frozenId: row.id };
    },
    { timeout: 15000 }
  );
}

export async function enqueueRender(frozenId: string, kind: "edl" | "preview"): Promise<{ jobId: string }> {
  const frozen = await prisma.frozenTimeline.findUniqueOrThrow({ where: { id: frozenId } });
  const job = await prisma.renderJob.create({
    data: { projectId: frozen.projectId, frozenId, revision: frozen.revision, status: "queued", kind }
  });
  return { jobId: job.id };
}

export async function listFreezes(projectId: string) {
  return prisma.frozenTimeline.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 50 });
}
