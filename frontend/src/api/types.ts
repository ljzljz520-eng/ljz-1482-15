import type { AssetDO, FrozenTimeline, HistoryEntryDO, TimelineDoc } from "@timeline/shared";

export interface ProjectDetail {
  id: string;
  name: string;
  ownerId: string;
  revision: number;
  doc: TimelineDoc;
  assets: AssetDO[];
}

export interface UserInfo {
  id: string;
  name: string;
  color: string;
}

export interface HistoryItem {
  id: string;
  revision: number;
  summary: string;
  userId: string;
  userName: string;
  userColor: string;
  undoneById: string | null;
  createdAt: string;
}

export interface JobItem {
  id: string;
  frozenId: string;
  revision: number;
  status: "queued" | "running" | "succeeded" | "failed";
  kind: "edl" | "preview";
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FreezeItem {
  id: string;
  revision: number;
  label: string;
  createdAt: string;
}

export type { TimelineDoc, AssetDO, FrozenTimeline, HistoryEntryDO };

export interface MutateOk {
  revision: number;
  doc: TimelineDoc;
  summary: string;
  idempotent?: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
