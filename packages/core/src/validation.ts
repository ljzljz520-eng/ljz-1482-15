import type { Clip, MediaAsset, TimelineDoc, Track } from "./model.js";
import { getTrack, timelineDuration } from "./model.js";

export interface Issue {
  code:
    | "NEGATIVE_TICK"
    | "UNKNOWN_TRACK"
    | "TRACK_KIND_MISMATCH"
    | "MEDIA_NOT_FOUND"
    | "MEDIA_RETIRED"
    | "SOURCE_RANGE"
    | "DURATION_MISMATCH"
    | "OVERLAP"
    | "TRANSITION_NO_PREV"
    | "TRANSITION_TOO_LONG"
    | "TRANSITION_WRONG_KIND"
    | "KEYPOINT_RANGE"
    | "ANCHOR_NOT_FOUND"
    | "ANCHOR_NOT_VIDEO"
    | "ANCHOR_OUT_OF_RANGE"
    | "MARKER_RANGE"
    | "EXPORT_RANGE";
  message: string;
  ref?: string;
}

export class ValidationError extends Error {
  constructor(readonly issues: Issue[]) {
    super(issues.map((i) => i.message).join("; "));
    this.name = "ValidationError";
  }
}

const assertTick = (v: number, field: string, issues: Issue[], ref?: string) => {
  if (!Number.isInteger(v) || v < 0) {
    issues.push({ code: "NEGATIVE_TICK", message: `${field} 必须是非负整数 tick`, ref });
  }
};

/**
 * 全量结构校验。保存/渲染/应用操作前后均调用；
 * 与数据库触发器一起构成两道防线（数据库拒绝悬空引用）。
 */
export function validateDoc(
  doc: TimelineDoc,
  media: Pick<MediaAsset, "id" | "duration" | "retired" | "kind">[]
): Issue[] {
  const issues: Issue[] = [];
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const trackById = new Map<string, Track>(doc.tracks.map((t) => [t.id, t]));
  const clipById = new Map<string, Clip>(doc.clips.map((c) => [c.id, c]));

  if (!Array.isArray(doc.clips) || !Array.isArray(doc.tracks)) {
    issues.push({ code: "OVERLAP", message: "文档结构不完整" });
    return issues;
  }

  for (const c of doc.clips) {
    assertTick(c.start, `片段 ${c.id}.start`, issues, c.id);
    assertTick(c.duration, `片段 ${c.id}.duration`, issues, c.id);
    assertTick(c.sourceIn, `片段 ${c.id}.sourceIn`, issues, c.id);
    if (c.duration <= 0) {
      issues.push({ code: "DURATION_MISMATCH", message: `片段 ${c.name} 时长必须为正`, ref: c.id });
    }

    const track = getTrack(doc, c.trackId);
    if (!track) {
      issues.push({ code: "UNKNOWN_TRACK", message: `片段 ${c.name} 引用了不存在的轨道 ${c.trackId}`, ref: c.id });
      continue;
    }

    // —— 悬空引用检查（数据库端还有触发器兜底）——
    if (c.mediaId !== null) {
      const asset = mediaById.get(c.mediaId);
      if (!asset) {
        issues.push({
          code: "MEDIA_NOT_FOUND",
          message: `片段 ${c.name} 引用的素材 ${c.mediaId} 不存在（悬空引用被拒绝）`,
          ref: c.id
        });
      } else {
        if (asset.retired) {
          issues.push({
            code: "MEDIA_RETIRED",
            message: `片段 ${c.name} 引用的素材 ${asset.id} 已被退役，无法参与编辑/渲染`,
            ref: c.id
          });
        }
        // 入出点必须落在素材范围内，且出点-入点 == 时间线时长
        const sourceOut = c.sourceIn + c.duration;
        if (c.sourceIn < 0 || sourceOut > asset.duration) {
          issues.push({
            code: "SOURCE_RANGE",
            message: `片段 ${c.name} 入出点 [${c.sourceIn}, ${sourceOut}) 超出素材范围 [0, ${asset.duration})`,
            ref: c.id
          });
        }
        if (track.kind === "video" && asset.kind === "audio") {
          issues.push({ code: "TRACK_KIND_MISMATCH", message: `音频素材不能放到视频轨`, ref: c.id });
        }
        if (track.kind === "audio" && asset.kind !== "audio") {
          issues.push({ code: "TRACK_KIND_MISMATCH", message: `${asset.kind} 素材不能放到音频轨`, ref: c.id });
        }
      }
    }

    if (track.kind === "subtitle") {
      if (c.mediaId !== null) {
        issues.push({ code: "TRACK_KIND_MISMATCH", message: "字幕片段不引用素材", ref: c.id });
      }
      if (!c.text) {
        issues.push({ code: "SOURCE_RANGE", message: `字幕片段 ${c.id} 缺少文本`, ref: c.id });
      }
    }

    // —— 关键点必须在片段时长范围内 ——
    for (const k of c.keyPoints) {
      if (!Number.isInteger(k.at) || k.at < 0 || k.at > c.duration) {
        issues.push({
          code: "KEYPOINT_RANGE",
          message: `片段 ${c.name} 的关键点 ${k.id} 位置 ${k.at} 超出 [0, ${c.duration}]`,
          ref: k.id
        });
      }
    }

    // —— 锚点：必须锚到存在的视频片段 ——
    if (c.anchorClipId != null) {
      const anchor = clipById.get(c.anchorClipId);
      if (!anchor) {
        issues.push({ code: "ANCHOR_NOT_FOUND", message: `片段 ${c.name} 的锚点片段不存在（悬空锚点）`, ref: c.id });
      } else {
        const anchorTrack = trackById.get(anchor.trackId);
        if (anchorTrack?.kind !== "video") {
          issues.push({ code: "ANCHOR_NOT_VIDEO", message: `片段 ${c.name} 只能锚定到视频片段`, ref: c.id });
        }
        const off = c.anchorOffset ?? 0;
        if (off < 0 || off > anchor.duration) {
          issues.push({
            code: "ANCHOR_OUT_OF_RANGE",
            message: `片段 ${c.name} 的锚点偏移 ${off} 超出锚片段范围`,
            ref: c.id
          });
        }
      }
    }

    // —— 转场：必须有前邻片段，重叠不能长于任何一侧 ——
    if (c.transitionIn) {
      const ov = c.transitionIn.overlap;
      if (track.kind !== "video") {
        issues.push({ code: "TRANSITION_WRONG_KIND", message: "转场只能出现在视频轨", ref: c.id });
      }
      if (!Number.isInteger(ov) || ov <= 0) {
        issues.push({ code: "TRANSITION_TOO_LONG", message: "转场重叠必须为正整数 tick", ref: c.id });
      } else {
        const sorted = doc.clips
          .filter((x) => x.trackId === c.trackId)
          .sort((a, b) => a.start - b.start);
        const idx = sorted.findIndex((x) => x.id === c.id);
        const prev = idx > 0 ? sorted[idx - 1] : undefined;
        if (!prev) {
          issues.push({ code: "TRANSITION_NO_PREV", message: `片段 ${c.name} 的转场缺少前邻片段`, ref: c.id });
        } else {
          if (ov > c.duration || ov > prev.duration) {
            issues.push({
              code: "TRANSITION_TOO_LONG",
              message: `转场长度 ${ov} 长于相邻片段（前 ${prev.duration} / 后 ${c.duration}）`,
              ref: c.id
            });
          }
          // 时间上必须真正邻接：c 的起点 = prev 非重叠段结束位置
          if (c.start !== prev.start + prev.duration - ov) {
            issues.push({
              code: "TRANSITION_NO_PREV",
              message: `片段 ${c.name} 的转场与前邻片段未正确邻接`,
              ref: c.id
            });
          }
        }
      }
    }
  }

  // —— 同轨重叠检测（转场区间不计为非法重叠）——
  for (const track of doc.tracks) {
    const sorted = doc.clips
      .filter((c) => c.trackId === track.id)
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const allowedOverlap =
        b.transitionIn && b.start === a.start + a.duration - b.transitionIn.overlap
          ? b.transitionIn.overlap
          : 0;
      // 正常 b.start - a.start >= a.duration；合法转场时恰好为 a.duration - overlap
      if (b.start - a.start < a.duration - allowedOverlap) {
        issues.push({
          code: "OVERLAP",
          message: `轨道 ${track.name} 上片段 ${a.name} 与 ${b.name} 非法重叠`,
          ref: b.id
        });
      }
    }
  }

  // —— 标记必须落在时间线范围内 ——
  const total = timelineDuration(doc);
  for (const m of doc.markers) {
    assertTick(m.at, `标记 ${m.label}.at`, issues, m.id);
    if (m.at > total) {
      issues.push({ code: "MARKER_RANGE", message: `标记 ${m.label} 位置 ${m.at} 超出时间线总长 ${total}`, ref: m.id });
    }
  }

  // —— 导出范围同源校验 ——
  if (doc.exportStart != null || doc.exportEnd != null) {
    const s = doc.exportStart ?? 0;
    const e = doc.exportEnd ?? total;
    if (s < 0 || e > total || s >= e) {
      issues.push({ code: "EXPORT_RANGE", message: `导出范围 [${s}, ${e}) 无效（总长 ${total}）` });
    }
  }

  return issues;
}

export function assertValid(doc: TimelineDoc, media: MediaAsset[]): void {
  const issues = validateDoc(doc, media);
  if (issues.length > 0) throw new ValidationError(issues);
}
