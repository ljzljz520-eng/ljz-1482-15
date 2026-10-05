/**
 * 变更服务：所有写操作的唯一入口。
 *
 * 并发模型（乐观并发 + 项目级咨询锁）：
 *  1. pg_advisory_xact_lock 串行化同一项目的写事务；
 *  2. 客户端必须携带 baseRevision；服务端文档版本不匹配 -> E_REVISION_CONFLICT，
 *     返回服务端最新文档与冲突明细，绝不“最后到达者覆盖”；
 *  3. 客户端幂等键 (projectId, clientId) 唯一；保存响应丢失时安全重试，
 *     重试命中已存在记录，原样返回首次响应；
 *  4. 每次成功变更在 history 中持久化正向/逆向微补丁（跨刷新、跨设备可撤销，
 *     每项目保留最近 100 条，前端至少展示 5 步）。
 */

import {
  applyOperation,
  applyPatch,
  EngineError,
  invertPatch,
  validateDoc,
  type EditorOperation,
  type MicroPatch,
  type TimelineDoc
} from "@timeline/shared";
import { prisma } from "../lib/prisma";
import { loadAssets, loadDoc, lockProject, persistDoc } from "./docRepository";
import { assetMap } from "../lib/types";
import { logger } from "../lib/logger";

const HISTORY_LIMIT = 100;

export interface MutationRequest {
  projectId: string;
  userId: string;
  baseRevision: number;
  operation: EditorOperation;
  clientId?: string;
  /** 冲突时强制覆盖（用户在冲突对话框中明确选择“以我的版本覆盖”） */
  force?: boolean;
}

export interface MutationResponse {
  revision: number;
  doc: TimelineDoc;
  summary: string;
  idempotent?: boolean;
}

export async function mutate(req: MutationRequest): Promise<MutationResponse> {
  // 幂等快速路径（无需拿项目锁）
  if (req.clientId) {
    const existing = await prisma.clientMutation.findUnique({
      where: { projectId_clientId: { projectId: req.projectId, clientId: req.clientId } }
    });
    if (existing) {
      logger.info({ clientId: req.clientId, status: existing.status }, "幂等命中：返回首次响应");
      const response = existing.response as unknown as MutationResponse;
      return { ...response, idempotent: true };
    }
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockProject(tx, req.projectId);
        const loaded = await loadDoc(tx, req.projectId);
        const assets = await loadAssets(tx, req.projectId);

        // 乐观并发：基线检查
        if (!req.force && loaded.revision !== req.baseRevision) {
          const conflict = describeConflict(loaded.doc, req.operation, req.baseRevision, loaded.revision);
          throw new EngineError("E_REVISION_CONFLICT", `版本冲突：你的基线 v${req.baseRevision}，服务端已到 v${loaded.revision}（${conflict}）`, {
            serverDoc: loaded.doc,
            serverRevision: loaded.revision,
            reason: conflict
          });
        }

        // 编译高层操作（内含校验；素材退役/悬空/转场非法在此被拒）
        const compiled = applyOperation(loaded.doc, assetMap(assets), req.operation);
        const nextDoc: TimelineDoc = { ...compiled.doc, revision: loaded.revision + 1 };

        // 双保险：补丁结果整体校验一次（冻结/撤销同样路径）
        validateDoc(nextDoc, { assets: assetMap(assets), requireActiveAsset: true });

        await persistDoc(tx, req.projectId, nextDoc);
        await tx.project.update({
          where: { id: req.projectId },
          data: { currentRevision: { increment: 1 } }
        });

        const history = await tx.historyEntry.create({
          data: {
            projectId: req.projectId,
            userId: req.userId,
            revision: loaded.revision + 1,
            summary: compiled.summary,
            patch: compiled.patch as unknown as object,
            inverse: invertPatch(compiled.patch) as unknown as object
          }
        });

        // 裁剪历史（保留最近 HISTORY_LIMIT 条）
        const count = await tx.historyEntry.count({ where: { projectId: req.projectId } });
        if (count > HISTORY_LIMIT) {
          const stale = await tx.historyEntry.findMany({
            where: { projectId: req.projectId },
            orderBy: { revision: "asc" },
            take: count - HISTORY_LIMIT,
            select: { id: true }
          });
          await tx.historyEntry.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
        }

        const response: MutationResponse = { revision: loaded.revision + 1, doc: nextDoc, summary: compiled.summary };

        if (req.clientId) {
          await tx.clientMutation.create({
            data: {
              projectId: req.projectId,
              userId: req.userId,
              clientId: req.clientId,
              status: "applied",
              newRevision: response.revision,
              response: response as unknown as object
            }
          });
        }
        logger.info({ projectId: req.projectId, rev: response.revision, op: compiled.summary }, "变更已提交");
        void history;
        return response;
      },
      { isolationLevel: "ReadCommitted", timeout: 15000 }
    );
  } catch (err) {
    if (req.clientId && err instanceof EngineError && err.code !== "E_REVISION_CONFLICT") {
      await recordRejected(req, err).catch(() => undefined);
    }
    throw err;
  }
}

async function recordRejected(req: MutationRequest, err: EngineError) {
  await prisma.clientMutation
    .create({
      data: {
        projectId: req.projectId,
        userId: req.userId,
        clientId: req.clientId as string,
        status: "rejected",
        response: { error: err.code, message: err.message, details: (err.details ?? null) as object }
      }
    })
    .catch(() => undefined);
}

function describeConflict(serverDoc: TimelineDoc, op: EditorOperation, base: number, latest: number): string {
  void base;
  void latest;
  const clipId =
    op.type === "clip/move" || op.type === "clip/trim" || op.type === "clip/delete"
      ? op.clipId
      : op.type.startsWith("keyframe/")
        ? op.type === "keyframe/add"
          ? op.keyframe.clipId
          : serverDoc.keyframes.find((k) => k.id === (op as { keyframeId?: string }).keyframeId)?.clipId
        : undefined;
  if (clipId) {
    const c = serverDoc.clips.find((x) => x.id === clipId);
    if (!c) return "目标片段已被他人删除";
    return `他人编辑影响了片段 ${clipId}`;
  }
  return "文档已被他人修改";
}

// ---------------------------------------------------------------------------
// 撤销 / 重做
// ---------------------------------------------------------------------------

export interface UndoRequest {
  projectId: string;
  userId: string;
  /** 要撤销的历史条目（前端取最近一条未撤销的本用户操作；不传则撤销最新一条） */
  historyId?: string;
  clientId?: string;
}

export async function undo(req: UndoRequest): Promise<MutationResponse> {
  if (req.clientId) {
    const existing = await prisma.clientMutation.findUnique({
      where: { projectId_clientId: { projectId: req.projectId, clientId: req.clientId } }
    });
    if (existing) return { ...(existing.response as unknown as MutationResponse), idempotent: true };
  }

  return prisma.$transaction(
    async (tx) => {
      await lockProject(tx, req.projectId);
      const loaded = await loadDoc(tx, req.projectId);
      const assets = await loadAssets(tx, req.projectId);

      const entry = req.historyId
        ? await tx.historyEntry.findFirst({ where: { id: req.historyId, projectId: req.projectId } })
        : await tx.historyEntry.findFirst({ where: { projectId: req.projectId }, orderBy: { revision: "desc" } });
      if (!entry) throw new EngineError("E_NOT_FOUND", "没有可撤销的历史");

      // 应用持久化的逆向微补丁
      const inverse = entry.inverse as unknown as MicroPatch;
      const candidate = applyPatch(loaded.doc, inverse);

      // 他人编辑后重新计算可逆条件：重放结果必须仍然是合法文档
      try {
        validateDoc({ ...candidate, revision: loaded.revision }, { assets: assetMap(assets), requireActiveAsset: true });
      } catch (e) {
        if (e instanceof EngineError) {
          throw new EngineError(
            "E_UNDO_CONFLICT",
            `撤销 v${entry.revision} 已不再安全：${e.message}。他人编辑改变了可逆条件，请先刷新基线。`,
            { historyId: entry.id, serverRevision: loaded.revision, issues: e.details }
          );
        }
        throw e;
      }

      const nextDoc: TimelineDoc = { ...candidate, revision: loaded.revision + 1 };
      await persistDoc(tx, req.projectId, nextDoc);
      await tx.project.update({ where: { id: req.projectId }, data: { currentRevision: { increment: 1 } } });

      // 撤销本身也是一个可重做的历史条目：正向=旧 inverse，逆向=旧 patch
      const undoEntry = await tx.historyEntry.create({
        data: {
          projectId: req.projectId,
          userId: req.userId,
          revision: loaded.revision + 1,
          summary: `撤销：${entry.summary}`,
          patch: inverse as unknown as object,
          inverse: entry.patch as unknown as object
        }
      });
      await tx.historyEntry.update({ where: { id: entry.id }, data: { undoneById: undoEntry.id } });

      const response: MutationResponse = { revision: loaded.revision + 1, doc: nextDoc, summary: undoEntry.summary };
      if (req.clientId) {
        await tx.clientMutation.create({
          data: {
            projectId: req.projectId,
            userId: req.userId,
            clientId: req.clientId as string,
            status: "applied",
            newRevision: response.revision,
            response: response as unknown as object
          }
        });
      }
      return response;
    },
    { timeout: 15000 }
  );
}

/** 冲突拒绝时也落幂等记录（非事务，best-effort） */
export async function recordConflictIdempotency(
  projectId: string,
  userId: string,
  clientId: string,
  response: unknown
): Promise<void> {
  await prisma.clientMutation
    .create({
      data: {
        projectId,
        userId,
        clientId,
        status: "conflict",
        response: response as object
      }
    })
    .catch((e) => {
      // 唯一键竞争：另一请求已记录，忽略
      logger.debug({ err: (e as Error).message }, "冲突幂等记录竞争，忽略");
    });
}
