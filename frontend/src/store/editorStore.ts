/**
 * 编辑器全局状态
 * ----------------------------------------------------------------------------
 * 乐观编辑：拖拽过程中先更新本地 doc（未提交），松手后携带 baseRevision +
 * 幂等 clientId 提交；保存响应丢失时可以安全重试（服务端按 clientId 去重）。
 *
 * 冲突：服务端返回 409 时绝不静默覆盖，弹出冲突对话框让用户选择
 *   - 重新拉取基线（放弃自己的拖动）
 *   - 在最新基线上重放（若结构上仍可行）
 *   - 强制覆盖（用户明确确认）
 */

import { create } from "zustand";
import axios from "axios";
import type { AssetDO, EditorOperation, TimelineDoc } from "@timeline/shared";
import * as api from "../api/timeline";
import { genClientId } from "../api/timeline";
import type { HistoryItem, MutateOk } from "../api/types";
import { toast } from "react-hot-toast";

export type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";

export interface PendingConflict {
  operation: EditorOperation;
  clientId: string;
  baseRevision: number;
  serverRevision: number;
  reason: string;
  serverDoc: TimelineDoc;
}

interface EditorState {
  projectId: string | null;
  projectName: string;
  doc: TimelineDoc | null;
  assets: AssetDO[];
  revision: number;
  saveState: SaveState;
  pendingConflict: PendingConflict | null;
  history: HistoryItem[];
  localMutations: number;
  playhead: number;

  loadProject: (id: string) => Promise<void>;
  setPlayhead: (tick: number) => void;
  /** 拖拽过程中的本地临时更新（不产生网络请求） */
  stageLocal: (producer: (doc: TimelineDoc) => TimelineDoc) => void;
  /** 提交高层操作（带乐观更新与冲突处理） */
  commit: (op: EditorOperation, opts?: { force?: boolean; clientId?: string }) => Promise<MutateOk | null>;
  /** 冲突解决：使用服务端最新文档，放弃本地改动 */
  resolveConflictUseServer: () => Promise<void>;
  /** 冲突解决：强制覆盖 */
  resolveConflictForce: () => Promise<boolean>;
  /** 冲突解决：用最新基线重试（rebase 后结构可行时） */
  resolveConflictRetry: () => Promise<boolean>;
  clearConflict: () => void;
  undo: () => Promise<void>;
  refreshHistory: () => Promise<void>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: null,
  projectName: "",
  doc: null,
  assets: [],
  revision: 0,
  saveState: "idle",
  pendingConflict: null,
  history: [],
  localMutations: 0,
  playhead: 0,

  async loadProject(id) {
    const project = await api.fetchProject(id);
    set({
      projectId: id,
      projectName: project.name,
      doc: project.doc,
      assets: project.assets,
      revision: project.revision,
      saveState: "saved",
      pendingConflict: null,
      localMutations: 0
    });
    await get().refreshHistory();
  },

  setPlayhead(tick) {
    set({ playhead: Math.max(0, Math.floor(tick)) });
  },

  stageLocal(producer) {
    const { doc } = get();
    if (!doc) return;
    set({ doc: producer(doc), localMutations: get().localMutations + 1, saveState: "saving" });
  },

  async commit(op, opts) {
    const { projectId, revision, doc } = get();
    if (!projectId || !doc) return null;
    const clientId = opts?.clientId ?? genClientId();
    set({ saveState: "saving" });
    try {
      // 基线冲突时服务端返回 409 + 最新文档；
      // force 时仍以当前 store 中的最新 revision 为基线
      const res = await api.mutate(projectId, revision, op, clientId, opts?.force);
      set({
        doc: res.doc,
        revision: res.revision,
        saveState: "saved",
        pendingConflict: null,
        localMutations: 0
      });
      if (!res.idempotent) toast.success(`已保存 v${res.revision} · ${res.summary}`, { duration: 1800 });
      else toast("响应迟到但操作未重复（幂等）", { icon: "🔁" });
      await get().refreshHistory();
      return res;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const body = err.response.data as { error?: string; message: string; details?: { serverDoc?: TimelineDoc; serverRevision?: number; reason?: string } };
        const serverDoc = body.details?.serverDoc ?? null;
        if (body.error === "E_UNDO_CONFLICT" || !serverDoc) {
          set({ saveState: "conflict" });
          toast.error(body.message ?? "撤销已不再安全（他人编辑），请刷新基线");
          await get().loadProject(projectId);
          return null;
        }
        set({
          saveState: "conflict",
          pendingConflict: {
            operation: op,
            clientId,
            baseRevision: revision,
            serverRevision: body.details?.serverRevision ?? revision + 1,
            reason: body.details?.reason ?? "文档已被他人修改",
            serverDoc
          }
        });
        return null;
      }
      set({ saveState: "error" });
      throw err;
    }
  },

  async resolveConflictUseServer() {
    const c = get().pendingConflict;
    const projectId = get().projectId;
    if (!c || !projectId) return;
    set({ doc: c.serverDoc, revision: c.serverRevision, pendingConflict: null, saveState: "saved", localMutations: 0 });
    toast("已采用服务端最新版本，你的本次改动已放弃", { icon: "ℹ️" });
    await get().refreshHistory();
  },

  async resolveConflictForce() {
    const c = get().pendingConflict;
    if (!c) return false;
    set({ pendingConflict: null, revision: c.serverRevision });
    const res = await get().commit(c.operation, { force: true, clientId: c.clientId });
    if (res) toast.success(`已强制覆盖并保存为 v${res.revision}`);
    return !!res;
  },

  async resolveConflictRetry() {
    const c = get().pendingConflict;
    const projectId = get().projectId;
    if (!c || !projectId) return false;
    // rebase：以服务端最新文档为基线，原操作重新提交
    set({ doc: c.serverDoc, revision: c.serverRevision, pendingConflict: null });
    try {
      const res = await get().commit(c.operation, { clientId: genClientId() });
      if (res) toast.success(`已在最新基线上重放并保存 v${res.revision}`);
      return !!res;
    } catch {
      toast.error("在最新基线上重放失败，请重新编辑");
      await get().loadProject(projectId);
      return false;
    }
  },

  clearConflict() {
    set({ pendingConflict: null, saveState: "saved" });
  },

  async undo() {
    const projectId = get().projectId;
    if (!projectId) return;
    const clientId = genClientId();
    try {
      const res = await api.undo(projectId, clientId);
      set({ doc: res.doc, revision: res.revision, saveState: "saved" });
      toast.success(`已撤销 → v${res.revision}`);
      await get().refreshHistory();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        toast.error("撤销条件已因他人编辑失效，请先刷新最新版本");
        await get().loadProject(projectId);
      }
    }
  },

  async refreshHistory() {
    const projectId = get().projectId;
    if (!projectId) return;
    const history = await api.fetchHistory(projectId);
    set({ history });
  }
}));
