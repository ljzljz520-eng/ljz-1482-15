/**
 * 同源时间模型选择器
 * ----------------------------------------------------------------------------
 * 预览总长、标尺标记位置、导出范围必须来自这一组纯函数，
 * 渲染工作线程 / UI / 导出任务读取同一 doc 与同一函数，杜绝多处各算各的。
 */

import type { CaptionAnchorDO, MarkerDO, TimelineDoc } from "./model";
import { captionResolvedTick } from "./engine";
import { TICKS_PER_SECOND } from "./time";

export interface LaidOutClip {
  id: string;
  trackId: string;
  start: number;
  end: number;
  duration: number;
}

/** 单轨上的片段布局（含转场重叠信息） */
export function layoutClips(doc: TimelineDoc): LaidOutClip[] {
  return doc.clips.map((c) => ({
    id: c.id,
    trackId: c.trackId,
    start: c.start,
    end: c.start + c.duration,
    duration: c.duration
  }));
}

/** 时间线内容总长 = 所有视频/音频片段末端的最大值（整数 tick） */
export function timelineContentEnd(doc: TimelineDoc): number {
  let end = 0;
  for (const c of doc.clips) end = Math.max(end, c.start + c.duration);
  for (const a of doc.audioClips) end = Math.max(end, a.start + a.duration);
  return end;
}

/**
 * 预览总长（秒，仅用于 UI 数字展示）
 */
export function previewTotalSeconds(doc: TimelineDoc): number {
  return previewTotalTicks(doc) / TICKS_PER_SECOND;
}

/** 预览总长（tick）：导出范围优先，否则按内容 */
export function previewTotalTicks(doc: TimelineDoc): number {
  if (doc.exportEnd !== null) return doc.exportEnd;
  return timelineContentEnd(doc);
}

export interface ResolvedMarker {
  id: string;
  label: string;
  /** 主时间线绝对 tick */
  tick: number;
  attached: boolean;
}

/** 解析后标记位置（片段锚定的标记解析为绝对 tick）—— 标尺唯一数据源 */
export function resolveMarkers(doc: TimelineDoc): ResolvedMarker[] {
  const out: ResolvedMarker[] = [];
  for (const m of doc.markers) {
    if (m.mode === "absolute" || !m.clipId) {
      out.push({ id: m.id, label: m.label, tick: m.tick, attached: false });
    } else {
      const clip = doc.clips.find((c) => c.id === m.clipId);
      if (clip) out.push({ id: m.id, label: m.label, tick: clip.start + m.tick, attached: true });
    }
  }
  return out.sort((a, b) => a.tick - b.tick);
}

export interface ResolvedCaption {
  id: string;
  text: string;
  tick: number;
}

export function resolveCaptions(doc: TimelineDoc): ResolvedCaption[] {
  const out: ResolvedCaption[] = [];
  for (const cap of doc.captions) {
    out.push({ id: cap.id, text: cap.text, tick: captionResolvedTick(doc, cap) });
  }
  return out.sort((a, b) => a.tick - b.tick);
}

/** 导出范围（主时间线绝对 tick，半开区间）；end=null 时自动等于内容末端 */
export function exportRange(doc: TimelineDoc): { start: number; end: number } {
  return {
    start: doc.exportStart,
    end: doc.exportEnd ?? timelineContentEnd(doc)
  };
}

/** 判断 tick 是否落在导出范围内 */
export function isInsideExport(doc: TimelineDoc, tick: number): boolean {
  const r = exportRange(doc);
  return tick >= r.start && tick < r.end;
}

/**
 * 冲突检测：客户端拖动基于 baseRevision 的文档发起 move 时，
 * 判断服务端最新文档中该片段是否已被他人改过（位置/轨道/时长）。
 * 绝不允许“最后到达者覆盖”。
 */
export function detectClipMoveConflict(args: {
  baseDoc: TimelineDoc;
  latestDoc: TimelineDoc;
  clipId: string;
}): { conflict: boolean; reason?: string } {
  const base = args.baseDoc.clips.find((c) => c.id === args.clipId);
  const latest = args.latestDoc.clips.find((c) => c.id === args.clipId);
  if (!base) return { conflict: true, reason: "基线中找不到该片段" };
  if (!latest) return { conflict: true, reason: "该片段已被他人删除" };
  if (latest.start !== base.start) return { conflict: true, reason: "片段位置已被他人移动" };
  if (latest.trackId !== base.trackId) return { conflict: true, reason: "片段已被他人移动到其他轨道" };
  if (latest.duration !== base.duration) return { conflict: true, reason: "片段已被他人裁剪" };
  if (latest.inPoint !== base.inPoint || latest.outPoint !== base.outPoint) {
    return { conflict: true, reason: "片段入出点已被他人修改" };
  }
  return { conflict: false };
}

/**
 * 三方重放（rebase）：把基于 baseDoc 编译出的补丁，尝试在 latestDoc 上重放。
 * - 目标集合实体仍存在且微操作的 before 与 latest 匹配 -> 干净重放
 * - 否则报 E_REVISION_CONFLICT，携带冲突明细，由用户选择处理方式
 */
export function rebaseResult(args: {
  baseDoc: TimelineDoc;
  latestDoc: TimelineDoc;
  clipId: string;
  newStart: number;
  newTrackId?: string;
}):
  | { ok: true; newStart: number; newTrackId: string }
  | { ok: false; reason: string } {
  const d = detectClipMoveConflict(args);
  if (!d.conflict) {
    return { ok: true, newStart: args.newStart, newTrackId: args.newTrackId ?? args.baseDoc.clips.find((c) => c.id === args.clipId)!.trackId };
  }
  return { ok: false, reason: d.reason ?? "基线冲突" };
}

export { TICKS_PER_SECOND };
export type { MarkerDO, CaptionAnchorDO };
