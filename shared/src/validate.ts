/**
 * 全量文档校验
 * ----------------------------------------------------------------------------
 * 任何高层操作编译、微补丁应用、撤销重放、冻结渲染之前都必须通过该校验。
 * 这是“数据库拒绝悬空引用 / 拒绝非法时间结构”的最后一道应用级防线
 * （数据库层另有外键约束兜底）。
 */

import type { AssetDO, TimelineDoc, ValidationIssue } from "./index";
import { EngineError, TICKS_PER_SECOND } from "./index";

export interface ValidateOptions {
  assets: Map<string, AssetDO>;
  /** 是否要求引用素材处于 active（对实时文档为 true；冻结版本允许退役素材） */
  requireActiveAsset?: boolean;
}

function assertNonNegInt(v: unknown, path: string, issues: ValidationIssue[]) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    issues.push({ path, message: "必须为非负整数 tick" });
  }
}

export function validateDoc(doc: TimelineDoc, opts: ValidateOptions): void {
  const issues: ValidationIssue[] = [];
  const { assets, requireActiveAsset = true } = opts;

  if (!Number.isInteger(doc.timebase) || doc.timebase !== TICKS_PER_SECOND) {
    issues.push({ path: "timebase", message: `时间基必须为 ${TICKS_PER_SECOND} tick/秒` });
  }
  if (!doc.rate || doc.rate.num <= 0 || doc.rate.den <= 0) {
    issues.push({ path: "rate", message: "主帧率必须为正有理数" });
  }

  const trackIds = new Set<string>();
  for (const t of doc.tracks) {
    if (trackIds.has(t.id)) issues.push({ path: `tracks.${t.id}`, message: "轨道 id 重复" });
    trackIds.add(t.id);
  }

  const clipsById = new Map(doc.clips.map((c) => [c.id, c]));
  const clipIds = new Set<string>();
  for (const c of doc.clips) {
    if (clipIds.has(c.id)) issues.push({ path: `clips.${c.id}`, message: "片段 id 重复" });
    clipIds.add(c.id);
    if (!trackIds.has(c.trackId)) {
      issues.push({ path: `clips.${c.id}.trackId`, message: "悬空引用：轨道不存在" });
    } else if (doc.tracks.find((t) => t.id === c.trackId)?.kind !== "video") {
      issues.push({ path: `clips.${c.id}.trackId`, message: "视频片段必须位于视频轨" });
    }
    const asset = assets.get(c.assetId);
    if (!asset) {
      issues.push({ path: `clips.${c.id}.assetId`, message: "悬空引用：素材不存在" });
    } else if (asset.kind === "audio") {
      issues.push({ path: `clips.${c.id}.assetId`, message: "音频素材必须放在音频轨" });
    }
    // 注意：已退役素材允许被存量文档引用（冻结版本、待清理片段）；
    // 是否允许“编辑引用退役素材的片段”由引擎按操作粒度拒绝（E_ASSET_RETIRED）。
    void requireActiveAsset;
    assertNonNegInt(c.start, `clips.${c.id}.start`, issues);
    if (!Number.isInteger(c.duration) || c.duration <= 0) {
      issues.push({ path: `clips.${c.id}.duration`, message: "时长必须为正整数 tick" });
    }
    assertNonNegInt(c.inPoint, `clips.${c.id}.inPoint`, issues);
    assertNonNegInt(c.outPoint, `clips.${c.id}.outPoint`, issues);
    if (Number.isInteger(c.inPoint) && Number.isInteger(c.outPoint) && c.outPoint <= c.inPoint) {
      issues.push({ path: `clips.${c.id}.outPoint`, message: "出点必须晚于入点" });
    }
    if (asset && Number.isInteger(c.outPoint) && c.outPoint > asset.duration) {
      issues.push({ path: `clips.${c.id}.outPoint`, message: `超出素材长度（素材 ${asset.duration} tick）` });
    }
    // 时间线时长必须与源入出点区间精确一致（tick 是统一的绝对时间单位，不做浮点缩放）
    if (
      Number.isInteger(c.duration) &&
      Number.isInteger(c.inPoint) &&
      Number.isInteger(c.outPoint) &&
      c.duration !== c.outPoint - c.inPoint
    ) {
      issues.push({ path: `clips.${c.id}.duration`, message: "片段时长必须等于出点-入点（禁止漂移缩放）" });
    }
  }

  // 同轨重叠：仅允许被转场精确覆盖的重叠
  const byTrack = new Map<string, typeof doc.clips>();
  for (const c of doc.clips) {
    const arr = byTrack.get(c.trackId) ?? [];
    arr.push(c);
    byTrack.set(c.trackId, arr);
  }
  const transitionKeys = new Set<string>();
  for (const tr of doc.transitions) {
    transitionKeys.add(pairKey(tr.fromClipId, tr.toClipId));
  }
  for (const [trackId, arr] of byTrack) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        const lo = Math.max(a.start, b.start);
        const hi = Math.min(a.start + a.duration, b.start + b.duration);
        const inter = hi - lo;
        if (inter > 0) {
          const key =
            transitionKeys.has(pairKey(a.id, b.id)) || transitionKeys.has(pairKey(b.id, a.id))
              ? matchedOverlap(doc, a, b)
              : 0;
          if (key !== inter) {
            issues.push({
              path: `tracks.${trackId}`,
              message: `片段 ${a.id} 与 ${b.id} 非法重叠 ${inter} tick（只能由转场精确覆盖）`
            });
          }
        }
      }
    }
  }

  // 转场：相邻、同轨、精确重叠、转场不得长于任一侧片段
  const trSeen = new Set<string>();
  for (const tr of doc.transitions) {
    const a = clipsById.get(tr.fromClipId);
    const b = clipsById.get(tr.toClipId);
    if (!a || !b) {
      issues.push({ path: `transitions.${tr.id}`, message: "悬空引用：转场片段不存在" });
      continue;
    }
    if (a.trackId !== b.trackId) {
      issues.push({ path: `transitions.${tr.id}`, message: "转场必须连接同一轨道上的片段" });
    }
    const pair = pairKey(a.id, b.id);
    if (trSeen.has(pair)) issues.push({ path: `transitions.${tr.id}`, message: "一对片段只能有一个转场" });
    trSeen.add(pair);
    if (!Number.isInteger(tr.overlap) || tr.overlap <= 0) {
      issues.push({ path: `transitions.${tr.id}.overlap`, message: "转场重叠必须为正整数 tick" });
    } else {
      const inter = Math.min(a.start + a.duration, b.start + b.duration) - Math.max(a.start, b.start);
      if (inter !== tr.overlap) {
        issues.push({ path: `transitions.${tr.id}.overlap`, message: "转场重叠必须等于两片段实际重叠长度" });
      }
      if (tr.overlap > a.duration || tr.overlap > b.duration) {
        issues.push({
          path: `transitions.${tr.id}.overlap`,
          message: `转场（${tr.overlap}）长于相邻片段（${a.duration}/${b.duration}）`
        });
      }
    }
  }

  // 关键点
  const kfIds = new Set<string>();
  for (const k of doc.keyframes) {
    if (kfIds.has(k.id)) issues.push({ path: `keyframes.${k.id}`, message: "关键点 id 重复" });
    kfIds.add(k.id);
    const clip = clipsById.get(k.clipId);
    if (!clip) {
      issues.push({ path: `keyframes.${k.id}.clipId`, message: "悬空引用：片段不存在" });
    } else if (!Number.isInteger(k.offset) || k.offset < 0 || k.offset > clip.duration) {
      issues.push({ path: `keyframes.${k.id}.offset`, message: `关键点必须落在片段时长 [0,${clip.duration}] 内` });
    }
  }

  // 标记
  for (const m of doc.markers) {
    if (m.mode === "clip") {
      const clip = m.clipId ? clipsById.get(m.clipId) : undefined;
      if (!clip) issues.push({ path: `markers.${m.id}.clipId`, message: "片段锚定标记必须引用存在的片段" });
      else if (!Number.isInteger(m.tick) || m.tick < 0 || m.tick > clip.duration) {
        issues.push({ path: `markers.${m.id}.tick`, message: "标记必须落在片段范围内" });
      }
    } else if (!Number.isInteger(m.tick) || m.tick < 0) {
      issues.push({ path: `markers.${m.id}`, message: "绝对标记位置必须为非负整数 tick" });
    }
  }

  // 子标题/字幕锚点
  for (const cap of doc.captions) {
    if (cap.mode === "clip") {
      const clip = cap.clipId ? clipsById.get(cap.clipId) : undefined;
      if (!clip) issues.push({ path: `captions.${cap.id}.clipId`, message: "悬空引用：锚定片段不存在" });
      else if (!Number.isInteger(cap.offset) || cap.offset < 0 || cap.offset > clip.duration) {
        issues.push({ path: `captions.${cap.id}.offset`, message: "字幕偏移必须落在片段范围内" });
      }
    } else if (!Number.isInteger(cap.absoluteTick) || cap.absoluteTick < 0) {
      issues.push({ path: `captions.${cap.id}.absoluteTick`, message: "绝对字幕位置必须为非负整数 tick" });
    }
  }

  // 音频片段
  const audioIds = new Set<string>();
  const audioByTrack = new Map<string, typeof doc.audioClips>();
  for (const a of doc.audioClips) {
    if (audioIds.has(a.id)) issues.push({ path: `audioClips.${a.id}`, message: "音频片段 id 重复" });
    audioIds.add(a.id);
    const track = doc.tracks.find((t) => t.id === a.trackId);
    if (!track) issues.push({ path: `audioClips.${a.id}.trackId`, message: "悬空引用：轨道不存在" });
    else if (track.kind !== "audio") issues.push({ path: `audioClips.${a.id}.trackId`, message: "音频片段必须位于音频轨" });
    const asset = assets.get(a.assetId);
    if (!asset) {
      issues.push({ path: `audioClips.${a.id}.assetId`, message: "悬空引用：素材不存在" });
    } else {
      if (asset.kind !== "audio") issues.push({ path: `audioClips.${a.id}.assetId`, message: "视频素材不能放在音频轨" });
      if (Number.isInteger(a.inPoint) && (a.inPoint < 0 || a.inPoint + a.duration > asset.duration)) {
        issues.push({ path: `audioClips.${a.id}`, message: "音频使用区间超出素材长度" });
      }
    }
    assertNonNegInt(a.start, `audioClips.${a.id}.start`, issues);
    if (!Number.isInteger(a.duration) || a.duration <= 0) {
      issues.push({ path: `audioClips.${a.id}.duration`, message: "音频时长必须为正整数 tick" });
    }
    const arr = audioByTrack.get(a.trackId) ?? [];
    arr.push(a);
    audioByTrack.set(a.trackId, arr);
  }
  for (const [trackId, arr] of audioByTrack) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];
        if (Math.max(a.start, b.start) < Math.min(a.start + a.duration, b.start + b.duration)) {
          issues.push({ path: `tracks.${trackId}`, message: `音频片段 ${a.id} 与 ${b.id} 在同一轨重叠` });
        }
      }
    }
  }

  // 导出范围
  assertNonNegInt(doc.exportStart, "exportStart", issues);
  if (doc.exportEnd !== null) {
    if (!Number.isInteger(doc.exportEnd) || doc.exportEnd <= doc.exportStart) {
      issues.push({ path: "exportEnd", message: "导出终点必须晚于起点" });
    }
  }

  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new EngineError("E_VALIDATION", `时间线文档校验失败：${issues.length} 个问题 -> ${detail}`, issues);
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function matchedOverlap(doc: TimelineDoc, a: { id: string }, b: { id: string }): number {
  const tr = doc.transitions.find(
    (t) =>
      (t.fromClipId === a.id && t.toClipId === b.id) || (t.fromClipId === b.id && t.toClipId === a.id)
  );
  return tr?.overlap ?? 0;
}
