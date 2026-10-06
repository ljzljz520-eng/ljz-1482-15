import axios from "axios";
import api, { idempotencyKey } from "./client";
import type {
  ApplyResult,
  ConflictInfo,
  DeletePolicy,
  MediaAsset,
  Op,
  RenderJob,
  TimelineDetail,
  TimelineSummary,
  TimelineDoc,
  UndoItem
} from "./types";
import type { DeleteEffect } from "@timeline/core";

export class ApiConflict extends Error {
  constructor(readonly conflict: ConflictInfo) {
    super(conflict.reason);
    this.name = "ApiConflict";
  }
}

function asConflict(err: unknown): ApiConflict | null {
  if (axios.isAxiosError(err) && err.response?.status === 409) {
    return new ApiConflict(err.response.data.conflict ?? {
      currentRevision: 0,
      currentHash: "",
      reason: err.response.data.message ?? "冲突"
    });
  }
  return null;
}

export const authApi = {
  async login(username: string, password: string) {
    const { data } = await api.post("/auth/login", { username, password });
    return data as { token: string; user: { id: string; username: string; role: string; displayName: string } };
  },
  async me() {
    const { data } = await api.get("/auth/me");
    return data.user as { id: string; username: string; role: string; displayName: string };
  }
};

export const mediaApi = {
  async list(): Promise<MediaAsset[]> {
    const { data } = await api.get("/media");
    return data.items;
  },
  async retire(id: string) {
    const { data } = await api.post(`/media/${id}/retire`);
    return data.item as MediaAsset;
  }
};

export const timelineApi = {
  async list(): Promise<TimelineSummary[]> {
    const { data } = await api.get("/timelines");
    return data.items;
  },
  async get(id: string): Promise<TimelineDetail> {
    const { data } = await api.get(`/timelines/${id}`);
    return data;
  },
  /**
   * 提交操作。幂等键保证“保存响应丢失”时重试不会重复应用；
   * autoRebase + baseDoc 支持几何操作在他人编辑后由服务端重基线。
   */
  async apply(
    id: string,
    op: Op,
    baseRevision: number,
    opts: { label?: string; autoRebase?: boolean; baseDoc?: TimelineDoc; key?: string } = {}
  ): Promise<ApplyResult> {
    try {
      const { data } = await api.post(
        `/timelines/${id}/ops`,
        {
          op,
          baseRevision,
          label: opts.label,
          autoRebase: opts.autoRebase ?? true,
          baseDoc: opts.baseDoc
        },
        { headers: { "Idempotency-Key": opts.key ?? idempotencyKey() } }
      );
      return data;
    } catch (err) {
      const c = asConflict(err);
      if (c) throw c;
      throw err;
    }
  },
  async remove(
    id: string,
    clipId: string,
    policy: DeletePolicy,
    baseRevision: number,
    key?: string
  ): Promise<ApplyResult> {
    try {
      const { data } = await api.post(
        `/timelines/${id}/delete`,
        { clipId, policy, baseRevision },
        { headers: { "Idempotency-Key": key ?? idempotencyKey() } }
      );
      return data;
    } catch (err) {
      const c = asConflict(err);
      if (c) throw c;
      throw err;
    }
  },
  async previewDelete(id: string, clipId: string, policy: DeletePolicy): Promise<{ effects: DeleteEffect[] }> {
    const { data } = await api.post(`/timelines/${id}/delete-preview`, { clipId, policy });
    return data;
  },
  async listUndo(id: string): Promise<UndoItem[]> {
    const { data } = await api.get(`/timelines/${id}/undo`);
    return data.items;
  },
  async undo(id: string, entryId: string, force = false) {
    try {
      const { data } = await api.post(`/timelines/${id}/undo/${entryId}`, { force });
      return data as ApplyResult;
    } catch (err) {
      const c = asConflict(err);
      if (c) throw c;
      throw err;
    }
  },
  async simulateOtherEdit(id: string, clipId: string, start: number) {
    const { data } = await api.post(`/timelines/${id}/simulate-other-edit`, { clipId, start });
    return data as { revision: number; message: string };
  }
};

export const renderApi = {
  async create(id: string) {
    const { data } = await api.post(`/timelines/${id}/render`, {});
    return data as { jobId: string; status: string; revision: number };
  },
  async list(timelineId?: string): Promise<RenderJob[]> {
    const { data } = await api.get("/renders", { params: { timelineId } });
    return data.items;
  },
  async get(jobId: string): Promise<RenderJob> {
    const { data } = await api.get(`/renders/${jobId}`);
    return data;
  },
  async manifest(jobId: string) {
    const { data } = await api.get(`/renders/${jobId}/manifest`);
    return data;
  },
  async advance(jobId: string): Promise<RenderJob> {
    const { data } = await api.post(`/renders/${jobId}/advance`);
    return data;
  }
};
