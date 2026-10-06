import {
  applyOp,
  planDelete,
  rebaseOp,
  type DeleteEffect,
  type DeletePolicy,
  type Op,
  type TimelineDoc
} from "@timeline/core";
import { hashDocSync } from "@timeline/core/hashNode";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { logger } from "../logger.js";
import { withTimelineLock } from "./locks.js";
import { assertDocValid } from "./mediaService.js";

/** 撤销栈跨刷新保留：服务端持久化，保留最近 UNDO_LIMIT 步（远超验收要求的 5 步） */
export const UNDO_LIMIT = 50;

export interface ConflictPayload {
  currentRevision: number;
  currentHash: string;
  reason: string;
  rebased?: Op | null;
  staleUndo?: { id: string; label: string }[];
}

export class ConflictError extends Error {
  constructor(readonly payload: ConflictPayload) {
    super(payload.reason);
    this.name = "ConflictError";
  }
}

export interface ApplyParams {
  timelineId: string;
  userId: string;
  op: Op;
  baseRevision: number;
  label?: string;
  autoRebase?: boolean;
  /** 自动重基线所需的客户端基线文档 */
  baseDoc?: TimelineDoc;
}

class TimelineService {
  async get(id: string) {
    const row = await prisma.timeline.findUniqueOrThrow({ where: { id } });
    return {
      id: row.id,
      name: row.name,
      revision: row.revision,
      docHash: row.docHash,
      frozen: row.frozen,
      doc: row.doc as unknown as TimelineDoc,
      updatedAt: row.updatedAt
    };
  }

  /** 应用已授权操作（乐观并发 + 可选自动重基线），详见 ApplyParams */
  async apply(params: ApplyParams) {
    return withTimelineLock(params.timelineId, async () => {
      const row = await prisma.timeline.findUniqueOrThrow({ where: { id: params.timelineId } });
      this.assertNotFrozen(row);
      const currentDoc = row.doc as unknown as TimelineDoc;

      if (params.baseRevision !== row.revision) {
        if (params.autoRebase && params.baseDoc) {
          const rb = rebaseOp(params.op, params.baseDoc, currentDoc);
          if (!rb.ok || !rb.op) {
            throw new ConflictError({
              currentRevision: row.revision,
              currentHash: row.docHash,
              reason: rb.reason ?? "他人编辑后该操作不再适用，已拒绝覆盖"
            });
          }
          logger.info(
            { userId: params.userId, timelineId: params.timelineId },
            "检测到基线冲突，已按最新版本重基线后提交"
          );
          return this.commit({
            timelineId: params.timelineId,
            userId: params.userId,
            op: rb.op,
            baseDoc: currentDoc,
            baseRevision: row.revision,
            label: params.label,
            rebased: true
          });
        }
        throw new ConflictError({
          currentRevision: row.revision,
          currentHash: row.docHash,
          reason: `基线冲突：您的版本 ${params.baseRevision} 已过期，当前为 ${row.revision}（有他人编辑先到达，未覆盖您的操作）`
        });
      }

      return this.commit({
        timelineId: params.timelineId,
        userId: params.userId,
        op: params.op,
        baseDoc: currentDoc,
        baseRevision: row.revision,
        label: params.label,
        rebased: false
      });
    });
  }

  /**
   * 删除片段：服务端依据当前文档 + 用户选择的策略重新计算复合操作，
   * 不信任客户端提交的 op，防止绕过“波纹/绝对位置、字幕、配乐”策略。
   */
  async deleteClip(params: {
    timelineId: string;
    userId: string;
    clipId: string;
    policy: DeletePolicy;
    baseRevision: number;
  }) {
    return withTimelineLock(params.timelineId, async () => {
      const row = await prisma.timeline.findUniqueOrThrow({ where: { id: params.timelineId } });
      this.assertNotFrozen(row);
      if (params.baseRevision !== row.revision) {
        throw new ConflictError({
          currentRevision: row.revision,
          currentHash: row.docHash,
          reason: `基线冲突：版本 ${params.baseRevision} 已过期，当前为 ${row.revision}，请刷新删除策略后重试`
        });
      }
      const currentDoc = row.doc as unknown as TimelineDoc;
      const planned = planDelete(currentDoc, params.clipId, params.policy);
      return this.commit({
        timelineId: params.timelineId,
        userId: params.userId,
        op: planned.op,
        baseDoc: currentDoc,
        baseRevision: row.revision,
        label: (planned.op as { label?: string }).label,
        rebased: false,
        effects: planned.effects
      });
    });
  }

  /** 删除影响预览（不落库），供删除确认对话框呈现 */
  async previewDelete(timelineId: string, clipId: string, policy: DeletePolicy) {
    const row = await prisma.timeline.findUniqueOrThrow({ where: { id: timelineId } });
    const doc = row.doc as unknown as TimelineDoc;
    const planned = planDelete(doc, clipId, policy);
    return { effects: planned.effects, revision: row.revision };
  }

  /** 列出持久化撤销记录，并实时重算每条是否仍可逆 */
  async listUndo(timelineId: string, userId: string) {
    const entries = await prisma.undoEntry.findMany({
      where: { timelineId, userId },
      orderBy: { seq: "desc" },
      take: UNDO_LIMIT
    });
    const tl = await this.get(timelineId);
    // 仅栈顶（最新一条）允许直接撤销；其余条目前提已被后续编辑改变，
    // 必须先撤销其上的操作——这就是“遇到他人编辑需要重算可逆条件”。
    const topSeq = entries[0]?.seq;
    return entries.map((e) => ({
      id: e.id,
      seq: e.seq,
      label: e.label,
      baseRevision: e.baseRevision,
      createdAt: e.createdAt,
      reversible: e.seq === topSeq && e.baseHash === tl.docHash,
      stale: e.baseHash !== tl.docHash
    }));
  }

  /**
   * 撤销栈顶操作。前提哈希不匹配（他人编辑）时返回 409，
   * 用户可在前端选择强制回滚（force）或放弃；默认绝不覆盖新编辑。
   */
  async undo(timelineId: string, userId: string, entryId: string, force = false) {
    return withTimelineLock(timelineId, async () => {
      const entry = await prisma.undoEntry.findFirstOrThrow({
        where: { id: entryId, timelineId, userId }
      });
      const row = await prisma.timeline.findUniqueOrThrow({ where: { id: timelineId } });
      this.assertNotFrozen(row);

      const staleUndo = await this.staleEntries(timelineId, userId);
      if (entry.baseHash !== row.docHash && !force) {
        throw new ConflictError({
          currentRevision: row.revision,
          currentHash: row.docHash,
          reason: "该操作之后存在新编辑（可能来自协作者），直接撤销会回滚这些编辑；已重算可逆条件，请选择强制回滚或放弃",
          staleUndo
        });
      }

      const currentDoc = row.doc as unknown as TimelineDoc;
      const inverse = entry.inverse as unknown as Op;
      const applied = applyOp(currentDoc, inverse);
      await assertDocValid(applied.doc);

      const newRevision = row.revision + 1;
      const newHash = hashDocSync(applied.doc);
      await prisma.$transaction([
        prisma.timeline.update({
          where: { id: timelineId },
          data: { doc: applied.doc as never, revision: newRevision, docHash: newHash }
        }),
        prisma.undoEntry.delete({ where: { id: entry.id } }),
        this.pruneOld(timelineId, userId)
      ]);
      logger.info({ timelineId, userId, entryId, forced: force }, "撤销已执行");
      return { doc: applied.doc, revision: newRevision, docHash: newHash };
    });
  }

  private async staleEntries(timelineId: string, userId: string) {
    const tl = await this.get(timelineId);
    const rows = await prisma.undoEntry.findMany({
      where: { timelineId, userId },
      orderBy: { seq: "desc" },
      take: UNDO_LIMIT
    });
    return rows.filter((r) => r.baseHash !== tl.docHash).map((r) => ({ id: r.id, label: r.label }));
  }

  private async nextSeq(timelineId: string, userId: string): Promise<number> {
    const last = await prisma.undoEntry.findFirst({
      where: { timelineId, userId },
      orderBy: { seq: "desc" },
      select: { seq: true }
    });
    return (last?.seq ?? -1) + 1;
  }

  /** 删除超出 UNDO_LIMIT 的最旧记录（保留最近 50 步，跨刷新持久） */
  private pruneOld(timelineId: string, userId: string): Prisma.PrismaPromise<number> {
    return prisma.$executeRaw`
      DELETE FROM "UndoEntry"
      WHERE "timelineId" = ${timelineId}
        AND "userId" = ${userId}
        AND "id" IN (
          SELECT "id" FROM "UndoEntry"
          WHERE "timelineId" = ${timelineId} AND "userId" = ${userId}
          ORDER BY seq DESC
          OFFSET ${UNDO_LIMIT}
        )` as Prisma.PrismaPromise<number>;
  }

  private assertNotFrozen(row: { frozen: boolean }) {
    if (row.frozen) {
      throw new ConflictError({
        currentRevision: 0,
        currentHash: "",
        reason: "该时间线版本已冻结（渲染归档），不可编辑"
      });
    }
  }

  /** 统一提交：应用 -> 全量校验 -> revision+1 -> 记撤销，单事务完成 */
  private async commit(args: {
    timelineId: string;
    userId: string;
    op: Op;
    baseDoc: TimelineDoc;
    baseRevision: number;
    label?: string;
    rebased: boolean;
    effects?: DeleteEffect[];
  }) {
    let applied: ReturnType<typeof applyOp>;
    try {
      applied = applyOp(args.baseDoc, args.op);
    } catch (err) {
      throw new ConflictError({
        currentRevision: args.baseRevision,
        currentHash: hashDocSync(args.baseDoc),
        reason: err instanceof Error ? err.message : "操作无法应用到当前版本"
      });
    }
    try {
      await assertDocValid(applied.doc);
    } catch (err) {
      throw new ConflictError({
        currentRevision: args.baseRevision,
        currentHash: hashDocSync(args.baseDoc),
        reason: err instanceof Error ? err.message : "文档未通过权威校验"
      });
    }

    const newRevision = args.baseRevision + 1;
    const newHash = hashDocSync(applied.doc);
    const seq = await this.nextSeq(args.timelineId, args.userId);

    await prisma.$transaction([
      prisma.timeline.update({
        where: { id: args.timelineId },
        data: { doc: applied.doc as never, revision: newRevision, docHash: newHash }
      }),
      prisma.undoEntry.create({
        data: {
          timelineId: args.timelineId,
          userId: args.userId,
          seq,
          label: args.label ?? args.op.type,
          inverse: applied.inverse as never,
          baseHash: newHash,
          baseRevision: newRevision
        }
      }),
      this.pruneOld(args.timelineId, args.userId)
    ]);

    logger.info(
      {
        timelineId: args.timelineId,
        userId: args.userId,
        op: args.op.type,
        revision: newRevision,
        rebased: args.rebased
      },
      "编辑已提交并写入撤销栈"
    );
    return {
      doc: applied.doc,
      revision: newRevision,
      docHash: newHash,
      rebased: args.rebased,
      effects: args.effects ?? null
    };
  }
}

export const timelineService = new TimelineService();
