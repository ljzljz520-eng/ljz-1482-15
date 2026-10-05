import api from "./client";
import type { FreezeItem, HistoryItem, JobItem, MutateOk, ProjectDetail, UserInfo } from "./types";
import type { EditorOperation } from "@timeline/shared";

export async function fetchUsers(): Promise<UserInfo[]> {
  const { data } = await api.get<UserInfo[]>("/users");
  return data;
}

export async function fetchProjects() {
  const { data } = await api.get<{ id: string; name: string; owner: UserInfo; currentRevision: number }[]>("/projects");
  return data;
}

export async function fetchProject(id: string): Promise<ProjectDetail> {
  const { data } = await api.get<ProjectDetail>(`/projects/${id}`);
  return data;
}

export async function fetchHistory(id: string): Promise<HistoryItem[]> {
  const { data } = await api.get<HistoryItem[]>(`/projects/${id}/history`);
  return data;
}

export async function mutate(
  projectId: string,
  baseRevision: number,
  operation: EditorOperation,
  clientId: string,
  force = false
): Promise<MutateOk> {
  const { data } = await api.post<MutateOk>(
    `/projects/${projectId}/mutate`,
    { baseRevision, operation, clientId, force },
    { headers: force ? { "x-force": "1" } : undefined }
  );
  return data;
}

export async function undo(projectId: string, clientId: string, historyId?: string): Promise<MutateOk> {
  const { data } = await api.post<MutateOk>(`/projects/${projectId}/undo`, { historyId, clientId });
  return data;
}

export async function retireAsset(projectId: string, assetId: string) {
  await api.post(`/projects/${projectId}/assets/${assetId}/retire`);
}

export async function freezeAndRender(projectId: string, kind: "edl" | "preview", label?: string, enqueue = true) {
  const { data } = await api.post<{ frozen: unknown; jobId?: string }>(`/projects/${projectId}/freeze`, {
    kind,
    label,
    enqueue
  });
  return data;
}

export async function fetchJobs(projectId: string): Promise<JobItem[]> {
  const { data } = await api.get<JobItem[]>(`/projects/${projectId}/jobs`);
  return data;
}

export async function fetchFreezes(projectId: string): Promise<FreezeItem[]> {
  const { data } = await api.get<FreezeItem[]>(`/projects/${projectId}/freezes`);
  return data;
}

export async function createAsset(
  projectId: string,
  payload: { kind: "video" | "audio" | "image"; name: string; rate: { num: number; den: number }; duration: number; width?: number; height?: number }
) {
  const { data } = await api.post(`/projects/${projectId}/assets`, payload);
  return data;
}

export function genClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `cid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
