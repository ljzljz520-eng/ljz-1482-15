/**
 * 编辑引擎：把高层 EditorOperation 编译为规范化 MicroPatch。
 *
 * 关键语义：
 *  - ripple（波纹删除）：右侧内容按整数 tick 整体左移；转场先拆除，
 *    右移距离 = 片段时长 - 与右侧片段的转场重叠；绝对字幕/标记/配乐可选跟随。
 *  - keep_absolute（保留绝对位置）：只删片段，其余一切不动；产生结构冲突时拒绝。
 *  - lift（提升）：与 keep_absolute 同结构（留出空隙），语义单独记录。
 *  - 跟随片段的子标题/字幕锚点：删除（delete）或就地脱钩为绝对锚点（detach）。
 *  - 配乐：波纹时可选整体跟随平移（ripple）或保留绝对位置（stay）。
 * 所有结构在编译后统一走 validateDoc，非法操作不会产生补丁。
 */

import type {
  AssetDO,
  AudioClipDO,
  CaptionAnchorDO,
  ClipDO,
  EditorOperation,
  KeyframeDO,
  MarkerDO,
  MicroPatch,
  TimelineDoc,
  TrackDO,
  TransitionDO
} from "./model";
import { EngineError } from "./errors";
import { validateDoc } from "./validate";
import { applyPatch } from "./patch";

class Mutator {
  ops: MicroPatch["ops"] = [];

  addClip(clip: ClipDO) {
    this.ops.push({ type: "clip/add", clip });
  }
  removeClip(clip: ClipDO) {
    this.ops.push({ type: "clip/remove", clipId: clip.id, clip });
  }
  updateClip(clip: ClipDO, after: Partial<ClipDO>) {
    const before: Partial<ClipDO> = {};
    (Object.keys(after) as (keyof ClipDO)[]).forEach((k) => {
      (before as Record<string, unknown>)[k] = clip[k];
    });
    this.ops.push({ type: "clip/update", clipId: clip.id, before, after });
  }
  addTransition(t: TransitionDO) {
    this.ops.push({ type: "transition/add", transition: t });
  }
  removeTransition(t: TransitionDO) {
    this.ops.push({ type: "transition/remove", transitionId: t.id, transition: t });
  }
  addKeyframe(k: KeyframeDO) {
    this.ops.push({ type: "keyframe/add", keyframe: k });
  }
  removeKeyframe(k: KeyframeDO) {
    this.ops.push({ type: "keyframe/remove", keyframeId: k.id, keyframe: k });
  }
  updateKeyframe(k: KeyframeDO, after: Partial<KeyframeDO>) {
    const before: Partial<KeyframeDO> = {};
    (Object.keys(after) as (keyof KeyframeDO)[]).forEach((key) => {
      (before as Record<string, unknown>)[key] = k[key];
    });
    this.ops.push({ type: "keyframe/update", keyframeId: k.id, before, after });
  }
  addMarker(m: MarkerDO) {
    this.ops.push({ type: "marker/add", marker: m });
  }
  removeMarker(m: MarkerDO) {
    this.ops.push({ type: "marker/remove", markerId: m.id, marker: m });
  }
  updateMarker(m: MarkerDO, after: Partial<MarkerDO>) {
    const before: Partial<MarkerDO> = {};
    (Object.keys(after) as (keyof MarkerDO)[]).forEach((key) => {
      (before as Record<string, unknown>)[key] = m[key];
    });
    this.ops.push({ type: "marker/update", markerId: m.id, before, after });
  }
  addCaption(c: CaptionAnchorDO) {
    this.ops.push({ type: "caption/add", caption: c });
  }
  removeCaption(c: CaptionAnchorDO) {
    this.ops.push({ type: "caption/remove", captionId: c.id, caption: c });
  }
  updateCaption(c: CaptionAnchorDO, after: Partial<CaptionAnchorDO>) {
    const before: Partial<CaptionAnchorDO> = {};
    (Object.keys(after) as (keyof CaptionAnchorDO)[]).forEach((key) => {
      (before as Record<string, unknown>)[key] = c[key];
    });
    this.ops.push({ type: "caption/update", captionId: c.id, before, after });
  }
  addAudio(a: AudioClipDO) {
    this.ops.push({ type: "audio/add", audio: a });
  }
  removeAudio(a: AudioClipDO) {
    this.ops.push({ type: "audio/remove", audioId: a.id, audio: a });
  }
  updateAudio(a: AudioClipDO, after: Partial<AudioClipDO>) {
    const before: Partial<AudioClipDO> = {};
    (Object.keys(after) as (keyof AudioClipDO)[]).forEach((key) => {
      (before as Record<string, unknown>)[key] = a[key];
    });
    this.ops.push({ type: "audio/update", audioId: a.id, before, after });
  }
  addTrack(t: TrackDO) {
    this.ops.push({ type: "track/add", track: t });
  }
  removeTrack(t: TrackDO) {
    this.ops.push({ type: "track/remove", trackId: t.id, track: t });
  }
  updateDoc(after: Partial<TimelineDoc>, before: Partial<TimelineDoc>) {
    this.ops.push({ type: "doc/update", before, after });
  }

  get patch(): MicroPatch {
    return { ops: this.ops };
  }
}

function getClip(doc: TimelineDoc, id: string): ClipDO {
  const c = doc.clips.find((x) => x.id === id);
  if (!c) throw new EngineError("E_NOT_FOUND", `片段 ${id} 不存在`);
  return c;
}
function getAudio(doc: TimelineDoc, id: string): AudioClipDO {
  const a = doc.audioClips.find((x) => x.id === id);
  if (!a) throw new EngineError("E_NOT_FOUND", `音频片段 ${id} 不存在`);
  return a;
}
function getTrack(doc: TimelineDoc, id: string): TrackDO {
  const t = doc.tracks.find((x) => x.id === id);
  if (!t) throw new EngineError("E_NOT_FOUND", `轨道 ${id} 不存在`);
  return t;
}
function assertTrackUnlocked(doc: TimelineDoc, trackId: string) {
  const t = getTrack(doc, trackId);
  if (t.locked) throw new EngineError("E_TRACK_LOCKED", `轨道 ${t.name} 已锁定`);
}
function assertAsset(assets: Map<string, AssetDO>, id: string): AssetDO {
  const a = assets.get(id);
  if (!a) throw new EngineError("E_DANGLING_REF", `素材 ${id} 不存在`);
  if (a.status === "retired") throw new EngineError("E_ASSET_RETIRED", `素材 ${a.name} 已被退役，不能再参与编辑`, { assetId: id });
  return a;
}
function assertClipAssetUsable(doc: TimelineDoc, assets: Map<string, AssetDO>, clipId: string): ClipDO {
  const clip = doc.clips.find((x) => x.id === clipId);
  if (!clip) throw new EngineError("E_NOT_FOUND", `片段 ${clipId} 不存在`);
  const asset = assets.get(clip.assetId);
  if (!asset) throw new EngineError("E_DANGLING_REF", `素材 ${clip.assetId} 不存在`);
  if (asset.status === "retired") {
    throw new EngineError("E_ASSET_RETIRED", `素材 ${asset.name} 已被退役，引用它的片段「${clip.id}」已锁定，不能再编辑`, {
      assetId: asset.id,
      clipId
    });
  }
  return clip;
}

export function captionResolvedTick(doc: TimelineDoc, cap: CaptionAnchorDO): number {
  if (cap.mode === "absolute") return cap.absoluteTick;
  const clip = cap.clipId ? doc.clips.find((c) => c.id === cap.clipId) : undefined;
  if (!clip) throw new EngineError("E_DANGLING_REF", `字幕 ${cap.id} 锚定的片段不存在`);
  return clip.start + cap.offset;
}
function markerResolvedTick(doc: TimelineDoc, m: MarkerDO): number {
  if (m.mode === "absolute" || !m.clipId) return m.tick;
  const clip = doc.clips.find((c) => c.id === m.clipId);
  if (!clip) throw new EngineError("E_DANGLING_REF", `标记 ${m.id} 锚定的片段不存在`);
  return clip.start + m.tick;
}

export interface CompileResult {
  doc: TimelineDoc;
  patch: MicroPatch;
  summary: string;
}

/**
 * 在文档快照上编译并校验一个高层操作。
 * 不修改 revision（由持久化层在事务内推进）。
 */
export function applyOperation(
  doc: TimelineDoc,
  assets: Map<string, AssetDO>,
  op: EditorOperation
): CompileResult {
  const m = new Mutator();
  let summary: string = op.type;

  switch (op.type) {
    case "clip/add": {
      const clip = op.clip;
      assertTrackUnlocked(doc, clip.trackId);
      assertAsset(assets, clip.assetId);
      if (doc.clips.some((c) => c.id === clip.id)) throw new EngineError("E_VALIDATION", `片段 id ${clip.id} 已存在`);
      m.addClip(clip);
      summary = `添加片段 ${clip.id}`;
      break;
    }
    case "clip/move": {
      const clip = assertClipAssetUsable(doc, assets, op.clipId);
      assertTrackUnlocked(doc, clip.trackId);
      const targetTrack = op.newTrackId ?? clip.trackId;
      assertTrackUnlocked(doc, targetTrack);
      const after: Partial<ClipDO> = { start: op.newStart };
      if (op.newTrackId && op.newTrackId !== clip.trackId) {
        if (doc.transitions.some((t) => t.fromClipId === clip.id || t.toClipId === clip.id)) {
          throw new EngineError("E_TRANSITION_INVALID", "跨轨移动前必须先删除该片段参与的转场");
        }
        after.trackId = targetTrack;
      }
      // 同轨移动但该片段参与转场：与对侧片段的精确重叠必须保持，
      // 否则转场几何被破坏（拖走需先删转场，或整组联动移动）。
      const delta = op.newStart - clip.start;
      const linked = doc.transitions.filter((t) => t.fromClipId === clip.id || t.toClipId === clip.id);
      if (!op.newTrackId && delta !== 0) {
        for (const t of linked) {
          const otherId = t.fromClipId === clip.id ? t.toClipId : t.fromClipId;
          const other = doc.clips.find((c) => c.id === otherId)!;
          // 预演移动后的实际重叠
          const aStart = Math.min(op.newStart, other.start);
          const aEnd = Math.max(op.newStart + clip.duration, other.start + other.duration);
          const curStart = Math.min(clip.start, other.start);
          const curEnd = Math.max(clip.start + clip.duration, other.start + other.duration);
          const movedProj = { start: op.newStart, end: op.newStart + clip.duration };
          const otherProj = { start: other.start, end: other.start + other.duration };
          const newOverlap = Math.min(movedProj.end, otherProj.end) - Math.max(movedProj.start, otherProj.start);
          const oldOverlap =
            Math.min(clip.start + clip.duration, other.start + other.duration) -
            Math.max(clip.start, other.start);
          void aStart; void aEnd; void curStart; void curEnd;
          // 只有“整体平移”（两片段一起走，重叠不变）才合法；单独拖动一个端点破坏转场 -> 拒绝
          if (newOverlap !== oldOverlap || newOverlap !== t.overlap) {
            throw new EngineError(
              "E_TRANSITION_INVALID",
              `片段 ${clip.id} 与 ${otherId} 之间存在 ${t.overlap} tick 转场，单独移动会破坏重叠，请先删除转场或整组移动`
            );
          }
        }
      }
      m.updateClip(clip, after);
      summary = `移动片段 ${clip.id}`;
      break;
    }
    case "clip/trim": {
      const clip = assertClipAssetUsable(doc, assets, op.clipId);
      assertTrackUnlocked(doc, clip.trackId);
      const oldEnd = clip.start + clip.duration;
      const newStart = op.start ?? clip.start;
      const newEnd = op.end ?? oldEnd;
      // 拖动边缘时，素材入出点由整数 tick 差值联动推导（不做浮点缩放）：
      // 左缘移动 delta => inPoint 同步移动；右缘移动 delta => outPoint 同步移动。
      const newIn = op.inPoint ?? clip.inPoint + (newStart - clip.start);
      const newOut = op.outPoint ?? clip.outPoint + (newEnd - oldEnd);
      if (newEnd <= newStart) throw new EngineError("E_VALIDATION", "裁剪后时长必须为正");
      if (newIn < 0) throw new EngineError("E_SOURCE_RANGE", "入点不能早于素材起点");
      if (newOut - newIn !== newEnd - newStart) {
        throw new EngineError("E_VALIDATION", "裁剪后时长必须等于入出点之差（整数 tick）");
      }
      const asset = assets.get(clip.assetId);
      if (asset && newOut > asset.duration) throw new EngineError("E_SOURCE_RANGE", "出点超出素材长度");
      const newDuration = newEnd - newStart;
      for (const k of doc.keyframes.filter((k) => k.clipId === clip.id)) {
        if (k.offset > newDuration) {
          throw new EngineError("E_KEYFRAME_RANGE", `关键点 ${k.id} 落在裁剪后的片段范围之外，请先移动或删除`);
        }
      }
      for (const cap of doc.captions.filter((c) => c.clipId === clip.id)) {
        if (cap.offset > newDuration) {
          throw new EngineError("E_KEYFRAME_RANGE", `字幕 ${cap.id} 锚点落在裁剪范围之外`);
        }
      }
      m.updateClip(clip, { start: newStart, duration: newDuration, inPoint: newIn, outPoint: newOut });
      summary = `裁剪片段 ${clip.id}`;
      break;
    }
    case "clip/delete": {
      summary = compileDelete(doc, assets, m, op.clipId, op.options.mode, op.options.captions, op.options.markers ?? op.options.captions, op.options.music);
      break;
    }
    case "transition/add": {
      const t = op.transition;
      const a = assertClipAssetUsable(doc, assets, t.fromClipId);
      const b = assertClipAssetUsable(doc, assets, t.toClipId);
      assertTrackUnlocked(doc, a.trackId);
      if (a.trackId !== b.trackId) throw new EngineError("E_TRANSITION_INVALID", "转场必须在同一轨道上");
      m.addTransition(t);
      summary = `添加转场 ${a.id}→${b.id}`;
      break;
    }
    case "transition/delete": {
      const t = doc.transitions.find((x) => x.id === op.transitionId);
      if (!t) throw new EngineError("E_NOT_FOUND", `转场 ${op.transitionId} 不存在`);
      m.removeTransition(t);
      summary = "删除转场";
      break;
    }
    case "keyframe/add": {
      const k = op.keyframe;
      const clip = assertClipAssetUsable(doc, assets, k.clipId);
      if (k.offset < 0 || k.offset > clip.duration) throw new EngineError("E_KEYFRAME_RANGE", "关键点超出片段范围");
      m.addKeyframe(k);
      summary = "添加关键点";
      break;
    }
    case "keyframe/move": {
      const k = doc.keyframes.find((x) => x.id === op.keyframeId);
      if (!k) throw new EngineError("E_NOT_FOUND", `关键点 ${op.keyframeId} 不存在`);
      const clip = assertClipAssetUsable(doc, assets, k.clipId);
      if (op.newOffset < 0 || op.newOffset > clip.duration) throw new EngineError("E_KEYFRAME_RANGE", "关键点超出片段范围");
      m.updateKeyframe(k, { offset: op.newOffset });
      summary = "拖动关键点";
      break;
    }
    case "keyframe/delete": {
      const k = doc.keyframes.find((x) => x.id === op.keyframeId);
      if (!k) throw new EngineError("E_NOT_FOUND", `关键点 ${op.keyframeId} 不存在`);
      m.removeKeyframe(k);
      summary = "删除关键点";
      break;
    }
    case "marker/add": {
      m.addMarker(op.marker);
      summary = `添加标记 ${op.marker.label}`;
      break;
    }
    case "marker/move": {
      const mk = doc.markers.find((x) => x.id === op.markerId);
      if (!mk) throw new EngineError("E_NOT_FOUND", `标记 ${op.markerId} 不存在`);
      const after: Partial<MarkerDO> = {};
      const newMode = op.mode ?? mk.mode;
      if (newMode === "absolute") {
        after.mode = "absolute";
        after.clipId = null;
        after.tick = op.newTick;
      } else {
        const clip = mk.clipId ? doc.clips.find((c) => c.id === mk.clipId) : undefined;
        if (!clip) throw new EngineError("E_DANGLING_REF", "片段模式标记缺少锚定片段");
        after.tick = op.newTick;
      }
      m.updateMarker(mk, after);
      summary = "拖动标记";
      break;
    }
    case "marker/delete": {
      const mk = doc.markers.find((x) => x.id === op.markerId);
      if (!mk) throw new EngineError("E_NOT_FOUND", `标记 ${op.markerId} 不存在`);
      m.removeMarker(mk);
      summary = "删除标记";
      break;
    }
    case "caption/add": {
      m.addCaption(op.caption);
      summary = "添加字幕";
      break;
    }
    case "caption/move": {
      const cap = doc.captions.find((x) => x.id === op.captionId);
      if (!cap) throw new EngineError("E_NOT_FOUND", `字幕 ${op.captionId} 不存在`);
      const after: Partial<CaptionAnchorDO> = {};
      if (typeof op.absoluteTick === "number") after.absoluteTick = op.absoluteTick;
      if (typeof op.offset === "number") after.offset = op.offset;
      m.updateCaption(cap, after);
      summary = "拖动字幕";
      break;
    }
    case "caption/delete": {
      const cap = doc.captions.find((x) => x.id === op.captionId);
      if (!cap) throw new EngineError("E_NOT_FOUND", `字幕 ${op.captionId} 不存在`);
      m.removeCaption(cap);
      summary = "删除字幕";
      break;
    }
    case "audio/add": {
      const a = op.audio;
      assertTrackUnlocked(doc, a.trackId);
      assertAsset(assets, a.assetId);
      m.addAudio(a);
      summary = `添加配乐 ${a.id}`;
      break;
    }
    case "audio/move": {
      const a = getAudio(doc, op.audioId);
      assertTrackUnlocked(doc, a.trackId);
      const asset = assets.get(a.assetId);
      if (!asset) throw new EngineError("E_DANGLING_REF", `素材 ${a.assetId} 不存在`);
      if (asset.status === "retired") throw new EngineError("E_ASSET_RETIRED", `素材 ${asset.name} 已退役，配乐片段已锁定`, { assetId: asset.id });
      m.updateAudio(a, { start: op.newStart });
      summary = "拖动配乐";
      break;
    }
    case "audio/trim": {
      const a = getAudio(doc, op.audioId);
      const newEnd = op.end ?? a.start + a.duration;
      if (newEnd <= a.start) throw new EngineError("E_VALIDATION", "音频裁剪后时长必须为正");
      m.updateAudio(a, { duration: newEnd - a.start });
      summary = "裁剪配乐";
      break;
    }
    case "audio/delete": {
      const a = getAudio(doc, op.audioId);
      m.removeAudio(a);
      summary = "删除配乐";
      break;
    }
    case "track/add": {
      m.addTrack(op.track);
      summary = `添加${op.track.kind === "video" ? "视频" : "音频"}轨`;
      break;
    }
    case "track/delete": {
      const t = getTrack(doc, op.trackId);
      if (doc.clips.some((c) => c.trackId === t.id) || doc.audioClips.some((a) => a.trackId === t.id)) {
        throw new EngineError("E_VALIDATION", "轨道非空，请先清空片段后再删除");
      }
      m.removeTrack(t);
      summary = "删除轨道";
      break;
    }
    case "export/set": {
      if (!Number.isInteger(op.start) || op.start < 0) throw new EngineError("E_VALIDATION", "导出起点非法");
      if (op.end !== null && (!Number.isInteger(op.end) || op.end <= op.start)) {
        throw new EngineError("E_VALIDATION", "导出终点非法");
      }
      m.updateDoc({ exportStart: op.start, exportEnd: op.end }, { exportStart: doc.exportStart, exportEnd: doc.exportEnd });
      summary = "设置导出范围";
      break;
    }
    default: {
      const exhaustive: never = op;
      throw new EngineError("E_VALIDATION", `未知操作: ${JSON.stringify(exhaustive).slice(0, 60)}`);
    }
  }

  const next = applyPatchLocal(doc, m.patch);
  validateDoc(next, { assets, requireActiveAsset: true });
  return { doc: next, patch: m.patch, summary };
}

function applyPatchLocal(doc: TimelineDoc, patch: MicroPatch): TimelineDoc {
  return applyPatch(doc, patch);
}

/** 编译片段删除，返回 summary */
function compileDelete(
  doc: TimelineDoc,
  assets: Map<string, AssetDO>,
  m: Mutator,
  clipId: string,
  mode: "ripple" | "keep_absolute" | "lift",
  captionPolicy: "detach" | "delete",
  markerPolicy: "detach" | "delete",
  music: "ripple" | "stay"
): string {
  const clip = getClip(doc, clipId);
  assertTrackUnlocked(doc, clip.trackId);
  // 即使素材已退役也允许删除片段（解除引用），但素材不存在仍属悬空异常
  if (!assets.has(clip.assetId)) throw new EngineError("E_DANGLING_REF", `素材 ${clip.assetId} 不存在`);

  // 1) 识别左/右邻居及与它们的转场重叠
  const attachedTransitions = doc.transitions.filter((t) => t.fromClipId === clip.id || t.toClipId === clip.id);
  const clipStart = clip.start;
  const clipEnd = clip.start + clip.duration;
  let leftNeighbor: ClipDO | null = null;
  let rightNeighbor: ClipDO | null = null;
  let leftOverlap = 0;
  let rightOverlap = 0;
  for (const t of attachedTransitions) {
    const otherId = t.fromClipId === clip.id ? t.toClipId : t.fromClipId;
    const other = doc.clips.find((c) => c.id === otherId)!;
    if (other.start < clipStart && other.start + other.duration > clipStart && other.start + other.duration <= clipEnd) {
      // 左邻：在 clip 起点之前开始，末端伸入 clip 头部（且不越过 clip 末端）
      leftNeighbor = other;
      leftOverlap = t.overlap;
    } else if (other.start >= clipStart && other.start < clipEnd) {
      // 右邻：起点落在 clip 区间内
      rightNeighbor = other;
      rightOverlap = t.overlap;
    } else if (other.start < clipStart && other.start + other.duration > clipEnd) {
      // 罕见：邻居完全包含 clip —— 无法安全波纹，直接拒绝
      throw new EngineError("E_TRANSITION_INVALID", "相邻片段完全包含被删片段，无法波纹删除");
    }
  }
  // 没有转场时，仍按几何找紧邻的右邻（决定哪些片段随波纹移动）
  if (!rightNeighbor) {
    const candidate = doc.clips
      .filter((c) => c.id !== clip.id && c.trackId === clip.trackId && c.start >= clipEnd)
      .sort((a, b) => a.start - b.start)[0];
    if (candidate) rightNeighbor = candidate;
  }
  for (const t of attachedTransitions) m.removeTransition(t);

  // 2) 关键点随片段删除
  for (const k of doc.keyframes.filter((x) => x.clipId === clip.id)) m.removeKeyframe(k);

  // 3) 锚定在该片段上的字幕 / 标记：删除或脱钩为绝对
  for (const cap of doc.captions.filter((c) => c.clipId === clip.id)) {
    if (captionPolicy === "delete") {
      m.removeCaption(cap);
    } else {
      const absoluteTick = clip.start + cap.offset;
      m.updateCaption(cap, { mode: "absolute", clipId: null, absoluteTick });
    }
  }
  for (const mk of doc.markers.filter((x) => x.clipId === clip.id)) {
    if (markerPolicy === "delete") {
      m.removeMarker(mk);
    } else {
      const absoluteTick = clip.start + mk.tick;
      m.updateMarker(mk, { mode: "absolute", clipId: null, tick: absoluteTick });
    }
  }

  // 4) 波纹移动：同轨净缩短量 = 片段时长 - 右侧转场重叠
  //    （左侧转场只决定“左邻末端”，右侧片段最终落到左邻末端之后的接合点）
  if (mode === "ripple") {
    const shift = clip.duration - rightOverlap;
    if (shift < 0) throw new EngineError("E_TRANSITION_INVALID", "右侧转场重叠超过片段时长，无法波纹删除");
    const threshold = clipEnd - rightOverlap; // 右邻片段的实际起点
    if (shift > 0) {
      for (const other of doc.clips) {
        if (other.id === clip.id || other.trackId !== clip.trackId) continue;
        if (other.start >= threshold) m.updateClip(other, { start: other.start - shift });
      }
      for (const cap of doc.captions) {
        if (cap.clipId === clip.id) continue;
        const tick = captionResolvedTick(doc, cap);
        if (cap.mode === "absolute" && tick >= threshold) {
          m.updateCaption(cap, { absoluteTick: cap.absoluteTick - shift });
        }
      }
      for (const mk of doc.markers) {
        if (mk.clipId === clip.id) continue;
        const tick = markerResolvedTick(doc, mk);
        if (mk.mode === "absolute" && tick >= threshold) {
          m.updateMarker(mk, { tick: mk.tick - shift });
        }
      }
      if (music === "ripple") {
        for (const a of doc.audioClips) {
          if (a.start + a.duration > threshold) m.updateAudio(a, { start: Math.max(0, a.start - shift) });
        }
      }
    }

    // 左右两侧原本都有转场：移除中间片段后，用交叉淡化把左邻与（移动后的）右邻接合，
    // 重叠取两侧较小值，保证“转场精确覆盖重叠且不超过任一侧片段”。
    if (leftNeighbor && rightNeighbor && (rightOverlap > 0 || leftOverlap > 0)) {
      const joinOverlap = Math.min(
        leftOverlap || rightOverlap,
        rightOverlap || leftOverlap,
        leftNeighbor.duration,
        rightNeighbor.duration
      );
      const leftEnd = leftNeighbor.start + leftNeighbor.duration;
      // 右邻接合起点 = 左邻末端 - 接合重叠（整数 tick）
      const joinStart = leftEnd - joinOverlap;
      m.updateClip(rightNeighbor, { start: joinStart });
      if (joinOverlap > 0) {
        m.addTransition({
          id: `tr_join_${clip.id}`.slice(0, 40),
          trackId: clip.trackId,
          fromClipId: leftNeighbor.id,
          toClipId: rightNeighbor.id,
          overlap: joinOverlap,
          kind: "crossfade"
        });
      }
    }
  }

  // 5) 删除片段本体
  m.removeClip(clip);

  const modeLabel = mode === "ripple" ? "波纹删除" : mode === "lift" ? "提升（留空隙）" : "保留绝对位置删除";
  return `${modeLabel}片段 ${clip.id}`;
}
