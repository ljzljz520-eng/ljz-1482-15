import { create } from "zustand";
import {
  applyOp,
  type Clip,
  type DeletePolicy,
  type Marker,
  type Op,
  type TimelineDoc
} from "@timeline/core";
import { timelineApi, ApiConflict } from "@/api/timeline";
import type { MediaAsset, UndoItem } from "@/api/types";
import { logger } from "@/utils/logger";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

interface ConflictState {
  open: boolean;
  reason: string;
  currentRevision: number;
  /** 冲突后可供用户选择的重试动作 */
  retry?: () => void;
  forceReload?: () => void;
}

interface EditorState {
  timelineId: string | null;
  doc: TimelineDoc | null;
  /** 服务端已确认的文档与 revision（基线） */
  serverDoc: TimelineDoc | null;
  revision: number;
  media: MediaAsset[];
  loading: boolean;
  saveStatus: SaveStatus;
  pendingCount: number;
  conflict: ConflictState;
  undoItems: UndoItem[];
  selectedClipId: string | null;
  selectedMarkerId: string | null;
  playhead: number;
  zoom: number; // px per tick
  /** 最后一次错误（保存响应丢失等） */
  lastError: string | null;
  lastSubmission: (() => Promise<boolean>) | null;
  retryLastSave: () => Promise<void>;

  setTimeline: (id: string, doc: TimelineDoc, revision: number, media: MediaAsset[]) => void;
  setMedia: (media: MediaAsset[]) => void;
  setLoading: (v: boolean) => void;
  selectClip: (id: string | null) => void;
  selectMarker: (id: string | null) => void;
  setPlayhead: (tick: number) => void;
  setZoom: (z: number) => void;
  replaceFromServer: (doc: TimelineDoc, revision: number) => void;
  refreshUndo: () => Promise<void>;

  /**
   * 派发一个编辑：
   * 1) 本地乐观应用（applyOp 纯函数，失败立即回滚不发请求）
   * 2) 以乐观前的 revision 作为基线上报
   * 3) 服务端冲突时弹出冲突对话框，由用户决定重基线重试或放弃
   */
  dispatch: (op: Op, opts?: { label?: string; noBump?: boolean }) => Promise<boolean>;
  /** 删除（用户策略选择后） */
  dispatchDelete: (clipId: string, policy: DeletePolicy) => Promise<boolean>;
  /** 服务端返回新版本后的统一收敛 */
  settle: (next: { doc: TimelineDoc; revision: number }) => void;
  undo: (entry: UndoItem, force?: boolean) => Promise<void>;
  clearConflict: () => void;
  forceReloadFromServer: () => Promise<void>;
  reset: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  timelineId: null,
  doc: null,
  serverDoc: null,
  revision: 0,
  media: [],
  loading: false,
  saveStatus: "idle",
  pendingCount: 0,
  conflict: { open: false, reason: "", currentRevision: 0 },
  undoItems: [],
  selectedClipId: null,
  selectedMarkerId: null,
  playhead: 0,
  zoom: 0.08,
  lastError: null,
  lastSubmission: null,

  setTimeline: (id, doc, revision, media) =>
    set({
      timelineId: id,
      doc,
      serverDoc: JSON.parse(JSON.stringify(doc)),
      revision,
      media,
      playhead: 0,
      selectedClipId: null,
      saveStatus: "saved"
    }),

  setMedia: (media) => set({ media }),
  setLoading: (loading) => set({ loading }),
  selectClip: (selectedClipId) => set({ selectedClipId }),
  selectMarker: (selectedMarkerId) => set({ selectedMarkerId }),
  setPlayhead: (playhead) => set({ playhead }),
  setZoom: (zoom) => set({ zoom: Math.min(0.5, Math.max(0.01, zoom)) }),

  replaceFromServer: (doc, revision) =>
    set({
      doc: JSON.parse(JSON.stringify(doc)),
      serverDoc: JSON.parse(JSON.stringify(doc)),
      revision,
      saveStatus: "saved"
    }),

  refreshUndo: async () => {
    const id = get().timelineId;
    if (!id) return;
    try {
      const items = await timelineApi.listUndo(id);
      set({ undoItems: items });
    } catch (err) {
      logger.warn("刷新撤销栈失败", err);
    }
  },

  dispatch: async (op, opts) => {
    const state = get();
    if (!state.timelineId || !state.doc) return false;

    // 引用退役素材的操作在本地即被识别（“拖拽中素材被退役”）
    const retiredGuard = guardRetired(op, state.media);
    if (retiredGuard) {
      set({ conflict: { open: true, reason: retiredGuard, currentRevision: state.revision } });
      return false;
    }

    let optimistic: TimelineDoc;
    try {
      optimistic = applyOp(state.doc, op).doc;
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "本地校验失败" });
      return false;
    }

    const baseDoc = JSON.parse(JSON.stringify(state.doc));
    const baseRevision = state.revision;
    // 幂等键在“首次请求 + 响应丢失重试”间保持不变，保证操作最多应用一次
    const idemKey = `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    set({
      doc: optimistic,
      pendingCount: state.pendingCount + 1,
      saveStatus: "saving",
      lastError: null
    });

    const submit = async (autoRebase: boolean): Promise<boolean> => {
      try {
        const res = await timelineApi.apply(state.timelineId!, op, baseRevision, {
          label: opts?.label,
          autoRebase,
          baseDoc: autoRebase ? baseDoc : undefined,
          key: idemKey
        });
        get().settle({ doc: res.doc, revision: res.revision });
        if (res.rebased) {
          set({ saveStatus: "saved" });
        }
        void get().refreshUndo();
        return true;
      } catch (err) {
        if (err instanceof ApiConflict) {
          set({
            pendingCount: Math.max(0, get().pendingCount - 1),
            saveStatus: "conflict",
            conflict: {
              open: true,
              reason: err.conflict.reason,
              currentRevision: err.conflict.currentRevision,
              retry: () => {
                get().clearConflict();
                // 放弃本地乐观版本，拉取最新后让用户基于新版本重新操作
                void get().forceReloadFromServer();
              },
              forceReload: () => {
                get().clearConflict();
                void get().forceReloadFromServer();
              }
            }
          });
          // 回滚乐观更新
          set({ doc: baseDoc, revision: baseRevision });
          return false;
        }
        // 保存响应丢失/网络错误：保留乐观状态并允许重试
        set({
          pendingCount: Math.max(0, get().pendingCount - 1),
          saveStatus: "error",
          lastError: err instanceof Error ? err.message : "保存失败（可能是响应丢失，可重试）"
        });
        return false;
      }
    };

    const run = () => submit(true);
    set({ lastSubmission: run });
    return run();
  },

  retryLastSave: async () => {
    const fn = get().lastSubmission;
    if (!fn) return;
    set({ saveStatus: "saving", lastError: null });
    await fn();
  },

  dispatchDelete: async (clipId, policy) => {
    const state = get();
    if (!state.timelineId || !state.doc) return false;
    const baseDoc = JSON.parse(JSON.stringify(state.doc));
    const baseRevision = state.revision;
    set({ pendingCount: state.pendingCount + 1, saveStatus: "saving" });
    try {
      const res = await timelineApi.remove(state.timelineId, clipId, policy, baseRevision);
      get().settle({ doc: res.doc, revision: res.revision });
      void get().refreshUndo();
      return true;
    } catch (err) {
      set({ doc: baseDoc, revision: baseRevision, pendingCount: Math.max(0, get().pendingCount - 1) });
      if (err instanceof ApiConflict) {
        set({
          saveStatus: "conflict",
          conflict: {
            open: true,
            reason: err.conflict.reason,
            currentRevision: err.conflict.currentRevision,
            forceReload: () => {
              get().clearConflict();
              void get().forceReloadFromServer();
            }
          }
        });
      } else {
        set({ saveStatus: "error", lastError: "删除请求失败（可能是响应丢失，可重试）" });
      }
      return false;
    }
  },

  settle: ({ doc, revision }) =>
    set((s) => ({
      doc: JSON.parse(JSON.stringify(doc)),
      serverDoc: JSON.parse(JSON.stringify(doc)),
      revision,
      pendingCount: Math.max(0, s.pendingCount - 1),
      saveStatus: s.pendingCount - 1 <= 0 ? "saved" : "saving"
    })),

  undo: async (entry, force = false) => {
    const id = get().timelineId;
    if (!id) return;
    const baseDoc = get().doc ? JSON.parse(JSON.stringify(get().doc)) : null;
    try {
      const res = await timelineApi.undo(id, entry.id, force);
      get().settle({ doc: res.doc, revision: res.revision });
      void get().refreshUndo();
    } catch (err) {
      if (err instanceof ApiConflict) {
        set({
          conflict: {
            open: true,
            reason: err.conflict.reason,
            currentRevision: err.conflict.currentRevision,
            retry: () => {
              get().clearConflict();
              void get().undo(entry, true);
            },
            forceReload: () => {
              get().clearConflict();
              void get().forceReloadFromServer();
            }
          }
        });
      } else if (baseDoc) {
        set({ doc: baseDoc, lastError: "撤销失败，请重试" });
      }
    }
  },

  clearConflict: () =>
    set({ conflict: { open: false, reason: "", currentRevision: 0 } }),

  forceReloadFromServer: async () => {
    const id = get().timelineId;
    if (!id) return;
    set({ loading: true });
    const detail = await timelineApi.get(id);
    get().replaceFromServer(detail.doc, detail.revision);
    set({ loading: false });
    void get().refreshUndo();
  },

  reset: () =>
    set({
      timelineId: null,
      doc: null,
      serverDoc: null,
      revision: 0,
      undoItems: [],
      selectedClipId: null,
      playhead: 0,
      saveStatus: "idle",
      pendingCount: 0,
      lastError: null
    })
}));

/** 若操作引用了已退役素材，给出拒绝理由 */
function guardRetired(op: Op, media: MediaAsset[]): string | null {
  const ids = collectMediaIds(op);
  for (const id of ids) {
    const m = media.find((x) => x.id === id);
    if (m?.retired) return `素材「${m.name}」已被退役，无法继续该编辑（请先替换素材）`;
  }
  return null;
}

function collectMediaIds(op: Op): string[] {
  if (op.type === "addClip" && op.clip.mediaId) return [op.clip.mediaId];
  if (op.type === "compound") return op.ops.flatMap(collectMediaIds);
  return [];
}

export function clipById(doc: TimelineDoc | null, id: string | null): Clip | null {
  if (!doc || !id) return null;
  return doc.clips.find((c) => c.id === id) ?? null;
}

export function markerById(doc: TimelineDoc | null, id: string | null): Marker | null {
  if (!doc || !id) return null;
  return doc.markers.find((m) => m.id === id) ?? null;
}
