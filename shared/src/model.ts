/**
 * 时间线文档模型（规范化存储 + 冻结快照共用同一形状）
 * ----------------------------------------------------------------------------
 * 所有时间字段都是“主时间线 tick 整数”或“素材本地 tick 整数”。
 * 素材入点/出点（inPoint/outPoint）存在素材自己的源速率空间内。
 */

import type { Rate } from "./time";

export type TrackKind = "video" | "audio";
export type AssetKind = "video" | "audio" | "image";
export type AssetStatus = "active" | "retired";
export type CaptionAttachMode = "clip" | "absolute";

export interface AssetDO {
  id: string;
  kind: AssetKind;
  name: string;
  /** 源帧率/采样率，有理数 */
  rate: Rate;
  /** 素材总时长（源 tick） */
  duration: number;
  width?: number;
  height?: number;
  status: AssetStatus;
}

export interface KeyframeDO {
  id: string;
  clipId: string;
  /** 相对片段起点的 tick 偏移 */
  offset: number;
  property: string;
  value: number;
}

export interface ClipDO {
  id: string;
  trackId: string;
  assetId: string;
  /** 主时间线起点 tick */
  start: number;
  /** 时间线占用时长 tick */
  duration: number;
  /** 素材入点（源 tick，源速率空间） */
  inPoint: number;
  /** 素材出点（源 tick，不含）；outPoint - inPoint 经速率换算后与 duration 相容 */
  outPoint: number;
}

export interface TransitionDO {
  id: string;
  trackId: string;
  fromClipId: string;
  toClipId: string;
  /**
   * 重叠时长 tick：两个片段在时间线上必须按此时长重叠；
   * 转场中点位于 toClip.start + overlap/2 与 fromClip.end - overlap/2 对齐处。
   */
  overlap: number;
  kind: string;
}

export interface MarkerDO {
  id: string;
  /** tick；mode=clip 时为片段相对偏移，mode=absolute 时为主时间线绝对位置 */
  tick: number;
  label: string;
  clipId: string | null;
  mode: CaptionAttachMode;
}

export interface CaptionAnchorDO {
  id: string;
  text: string;
  mode: CaptionAttachMode;
  /** clip 模式：锚定片段 + 相对偏移；absolute 模式：主时间线绝对 tick */
  clipId: string | null;
  offset: number;
  absoluteTick: number;
}

export interface AudioClipDO {
  id: string;
  trackId: string;
  assetId: string;
  start: number;
  duration: number;
  inPoint: number;
  gain: number;
}

export interface TrackDO {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
}

export interface TimelineDoc {
  /** 文档逻辑版本（乐观并发基线） */
  revision: number;
  timebase: number;
  /** 主时间线显示帧率（有理数），用于标尺/吸附/时间码显示 */
  rate: Rate;
  /** 导出范围（主时间线绝对 tick，半开区间 [start,end)）；null 表示自动按内容 */
  exportStart: number;
  exportEnd: number | null;
  tracks: TrackDO[];
  clips: ClipDO[];
  transitions: TransitionDO[];
  keyframes: KeyframeDO[];
  markers: MarkerDO[];
  captions: CaptionAnchorDO[];
  audioClips: AudioClipDO[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  ownerId: string;
  currentRevision: number;
}

export interface FrozenTimeline {
  id: string;
  projectId: string;
  revision: number;
  label: string;
  createdAt: string;
  doc: TimelineDoc;
  assets: AssetDO[];
}

export interface RenderJobDO {
  id: string;
  projectId: string;
  frozenId: string;
  revision: number;
  status: "queued" | "running" | "succeeded" | "failed";
  kind: "edl" | "preview";
  result: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntryDO {
  id: string;
  projectId: string;
  userId: string;
  /** 应用后文档版本 */
  revision: number;
  summary: string;
  /** 前向微补丁（本次操作） */
  patch: MicroPatch;
  /** 逆向微补丁（服务端算出并持久化，撤销时使用） */
  inverse: MicroPatch;
  /** undo/redo 链：undoId 指向本次操作撤销后的那个历史条目 */
  undoneById: string | null;
  createdAt: string;
}

/** 规范化的微操作补丁：op 是对单个集合实体的增删改 */
export type MicroOp =
  | { type: "clip/add"; clip: ClipDO }
  | { type: "clip/remove"; clipId: string; clip: ClipDO }
  | { type: "clip/update"; clipId: string; before: Partial<ClipDO>; after: Partial<ClipDO> }
  | { type: "transition/add"; transition: TransitionDO }
  | { type: "transition/remove"; transitionId: string; transition: TransitionDO }
  | { type: "keyframe/add"; keyframe: KeyframeDO }
  | { type: "keyframe/remove"; keyframeId: string; keyframe: KeyframeDO }
  | { type: "keyframe/update"; keyframeId: string; before: Partial<KeyframeDO>; after: Partial<KeyframeDO> }
  | { type: "marker/add"; marker: MarkerDO }
  | { type: "marker/remove"; markerId: string; marker: MarkerDO }
  | { type: "marker/update"; markerId: string; before: Partial<MarkerDO>; after: Partial<MarkerDO> }
  | { type: "caption/add"; caption: CaptionAnchorDO }
  | { type: "caption/remove"; captionId: string; caption: CaptionAnchorDO }
  | { type: "caption/update"; captionId: string; before: Partial<CaptionAnchorDO>; after: Partial<CaptionAnchorDO> }
  | { type: "audio/add"; audio: AudioClipDO }
  | { type: "audio/remove"; audioId: string; audio: AudioClipDO }
  | { type: "audio/update"; audioId: string; before: Partial<AudioClipDO>; after: Partial<AudioClipDO> }
  | { type: "track/add"; track: TrackDO }
  | { type: "track/remove"; trackId: string; track: TrackDO }
  | { type: "doc/update"; before: Partial<Pick<TimelineDoc, "exportStart" | "exportEnd" | "rate">>; after: Partial<Pick<TimelineDoc, "exportStart" | "exportEnd" | "rate">> };

export type MicroPatch = { ops: MicroOp[] };

// ---------------------------------------------------------------------------
// 高层编辑操作（前端发起、后端校验并编译为微补丁）
// ---------------------------------------------------------------------------

export type DeleteMode = "ripple" | "keep_absolute" | "lift";
export type CaptionPolicy = "detach" | "delete";

export interface DeleteClipOptions {
  mode: DeleteMode;
  /** 跟随片段的子标题/字幕锚点如何处理 */
  captions: CaptionPolicy;
  /** 绑定在片段上的标记如何处理（默认同 captions 语义） */
  markers?: CaptionPolicy;
  /**
   * 配乐（音频轨片段）处理：
   *  ripple -> 与视频轨一同整体平移（保持配乐同步）
   *  stay   -> 保留绝对位置（默认）
   */
  music: "ripple" | "stay";
}

export type EditorOperation =
  | { type: "clip/add"; clip: ClipDO }
  | { type: "clip/move"; clipId: string; newStart: number; newTrackId?: string }
  | { type: "clip/trim"; clipId: string; start?: number; end?: number; inPoint?: number; outPoint?: number }
  | { type: "clip/delete"; clipId: string; options: DeleteClipOptions }
  | { type: "transition/add"; transition: TransitionDO }
  | { type: "transition/delete"; transitionId: string }
  | { type: "keyframe/add"; keyframe: KeyframeDO }
  | { type: "keyframe/move"; keyframeId: string; newOffset: number }
  | { type: "keyframe/delete"; keyframeId: string }
  | { type: "marker/add"; marker: MarkerDO }
  | { type: "marker/move"; markerId: string; newTick: number; mode?: CaptionAttachMode }
  | { type: "marker/delete"; markerId: string }
  | { type: "caption/add"; caption: CaptionAnchorDO }
  | { type: "caption/move"; captionId: string; absoluteTick?: number; offset?: number }
  | { type: "caption/delete"; captionId: string }
  | { type: "audio/add"; audio: AudioClipDO }
  | { type: "audio/move"; audioId: string; newStart: number }
  | { type: "audio/trim"; audioId: string; end?: number }
  | { type: "audio/delete"; audioId: string }
  | { type: "track/add"; track: TrackDO }
  | { type: "track/delete"; trackId: string }
  | { type: "export/set"; start: number; end: number | null };
