import type { DeleteEffect, DeletePolicy, Op, TimelineDoc } from "@timeline/core";
import type { MediaAsset } from "@timeline/core";

export interface TimelineSummary {
  id: string;
  name: string;
  revision: number;
  frozen: boolean;
  updatedAt: string;
}

export interface TimelineDetail extends TimelineSummary {
  docHash: string;
  doc: TimelineDoc;
}

export interface ApplyResult {
  doc: TimelineDoc;
  revision: number;
  docHash: string;
  rebased: boolean;
  effects: DeleteEffect[] | null;
}

export interface ConflictInfo {
  currentRevision: number;
  currentHash: string;
  reason: string;
  rebased?: Op | null;
  staleUndo?: { id: string; label: string }[];
}

export interface UndoItem {
  id: string;
  seq: number;
  label: string;
  baseRevision: number;
  createdAt: string;
  reversible: boolean;
  stale: boolean;
}

export interface RenderJob {
  id: string;
  timelineId: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  exportStart: number;
  exportEnd: number;
  fps: string;
  resultUrl: string | null;
  message: string | null;
  createdAt: string;
}

export type { MediaAsset, Op, DeletePolicy, TimelineDoc };
