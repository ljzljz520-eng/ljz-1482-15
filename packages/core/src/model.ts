/**
 * 时间线文档模型（前后端共享的唯一事实源）。
 * 所有时间字段单位均为整数 tick（见 timebase.ts），禁止使用浮点秒存储。
 */
import type { Tick } from "./timebase.js";

export type TrackKind = "video" | "audio" | "subtitle";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** 同轨片段不得重叠（转场区间除外，转场是两片段在时间上的显式重叠契约） */
  locked?: boolean;
}

export type MediaKind = "video" | "audio" | "image";

/** 素材库条目（片段通过 mediaId 引用，退役后不允许新引用） */
export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  /** 素材主帧率（有理数，如 30000/1001）；纯音频可为 30/1 */
  fps: string;
  /** 素材总时长（tick，整数；由其自身帧率精确换算得到） */
  duration: Tick;
  sampleRate?: number;
  width?: number;
  height?: number;
  retired: boolean;
}

/**
 * 转场：挂在“后一个片段”上，向前与前一片段重叠 overlap 个 tick。
 * overlap 必须 > 0 且不超过相邻两片段中较短者的时长。
 */
export interface Transition {
  type: string;
  overlap: Tick;
}

/** 关键点（关键帧）：锚定在片段时间线上的相对 tick，可拖动 */
export interface KeyPoint {
  id: string;
  /** 相对片段起点的 tick 偏移，范围 [0, duration] */
  at: Tick;
  value: number;
  label?: string;
}

export interface Clip {
  id: string;
  trackId: string;
  /** 时间线起点（绝对 tick） */
  start: Tick;
  /** 时间线时长（tick） */
  duration: Tick;
  /** 引用素材 id；字幕片段为 null（文本即数据） */
  mediaId: string | null;
  /** 素材入点（tick，相对素材源） */
  sourceIn: Tick;
  /** 素材出点（tick，相对素材源），sourceOut - sourceIn 必须等于 duration */
  name: string;
  color?: string;
  /** 字幕文本（仅 subtitle 轨） */
  text?: string;
  /** 与前一片段的转场（仅 video 轨） */
  transitionIn?: Transition | null;
  /** 片段内关键点（如音量/透明度） */
  keyPoints: KeyPoint[];
  /** 字幕/配音对视频锚点：指向某视频片段 id，锚点随其移动 */
  anchorClipId?: string | null;
  /** 锚点相对被锚定片段起点的偏移（tick） */
  anchorOffset?: Tick;
}

/** 全局标记（章节点），与预览游标、导出范围共用同一时间模型 */
export interface Marker {
  id: string;
  at: Tick;
  label: string;
}

export interface TimelineDoc {
  /** 文档 schema 版本 */
  schema: 1;
  /** 显示/换算所用帧率（有理数字符串，如 "30000/1001"） */
  fps: string;
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  /** 导出范围（tick），与标记、总长同源 */
  exportStart?: Tick;
  exportEnd?: Tick;
}

/** 时间线总长 = 所有片段结束位置的最大值（含转场重叠） */
export function timelineDuration(doc: TimelineDoc): Tick {
  let end = 0;
  for (const c of doc.clips) end = Math.max(end, c.start + c.duration);
  return end;
}

export function getTrack(doc: TimelineDoc, trackId: string): Track | undefined {
  return doc.tracks.find((t) => t.id === trackId);
}

export function getClip(doc: TimelineDoc, clipId: string): Clip | undefined {
  return doc.clips.find((c) => c.id === clipId);
}

export function getMarker(doc: TimelineDoc, markerId: string): Marker | undefined {
  return doc.markers.find((m) => m.id === markerId);
}

/** 同一轨道上按起点排序的片段 */
export function clipsOnTrack(doc: TimelineDoc, trackId: string): Clip[] {
  return doc.clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** 片段在时间线上的区间（考虑入场转场：视觉起点更早 overlap） */
export function clipVisualStart(c: Clip): Tick {
  return c.start - (c.transitionIn?.overlap ?? 0);
}

export function exportRange(doc: TimelineDoc): { start: Tick; end: Tick } {
  const total = timelineDuration(doc);
  return {
    start: Math.max(0, doc.exportStart ?? 0),
    end: Math.min(total, doc.exportEnd ?? total)
  };
}
