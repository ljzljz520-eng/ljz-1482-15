/**
 * 微补丁：对规范化文档集合实体的增删改。
 * 每条 remove 微操作携带被删除实体（求逆需要），update 携带前后状态，
 * invertPatch 可纯函数式求逆 —— 服务端把正向与逆向补丁一起持久化，
 * 撤销即“应用逆向补丁 + 重新全量校验”，他人编辑后会重新校验可逆条件。
 */

import type { MicroOp, MicroPatch, TimelineDoc } from "./model";
import { EngineError } from "./errors";

export function invertPatch(patch: MicroPatch): MicroPatch {
  const ops: MicroOp[] = [];
  for (let i = patch.ops.length - 1; i >= 0; i--) {
    ops.push(invertOp(patch.ops[i]));
  }
  return { ops };
}

function invertOp(op: MicroOp): MicroOp {
  switch (op.type) {
    case "clip/add":
      return { type: "clip/remove", clipId: op.clip.id, clip: op.clip };
    case "clip/remove":
      return { type: "clip/add", clip: op.clip };
    case "clip/update":
      return { type: "clip/update", clipId: op.clipId, before: op.after, after: op.before };
    case "transition/add":
      return { type: "transition/remove", transitionId: op.transition.id, transition: op.transition };
    case "transition/remove":
      return { type: "transition/add", transition: op.transition };
    case "keyframe/add":
      return { type: "keyframe/remove", keyframeId: op.keyframe.id, keyframe: op.keyframe };
    case "keyframe/remove":
      return { type: "keyframe/add", keyframe: op.keyframe };
    case "keyframe/update":
      return { type: "keyframe/update", keyframeId: op.keyframeId, before: op.after, after: op.before };
    case "marker/add":
      return { type: "marker/remove", markerId: op.marker.id, marker: op.marker };
    case "marker/remove":
      return { type: "marker/add", marker: op.marker };
    case "marker/update":
      return { type: "marker/update", markerId: op.markerId, before: op.after, after: op.before };
    case "caption/add":
      return { type: "caption/remove", captionId: op.caption.id, caption: op.caption };
    case "caption/remove":
      return { type: "caption/add", caption: op.caption };
    case "caption/update":
      return { type: "caption/update", captionId: op.captionId, before: op.after, after: op.before };
    case "audio/add":
      return { type: "audio/remove", audioId: op.audio.id, audio: op.audio };
    case "audio/remove":
      return { type: "audio/add", audio: op.audio };
    case "audio/update":
      return { type: "audio/update", audioId: op.audioId, before: op.after, after: op.before };
    case "track/add":
      return { type: "track/remove", trackId: op.track.id, track: op.track };
    case "track/remove":
      return { type: "track/add", track: op.track };
    case "doc/update":
      return { type: "doc/update", before: op.after, after: op.before };
    default:
      throw new EngineError("E_VALIDATION", `未知微操作: ${JSON.stringify(op).slice(0, 80)}`);
  }
}

/** 应用微补丁，返回新文档 */
export function applyPatch(doc: TimelineDoc, patch: MicroPatch): TimelineDoc {
  const next: TimelineDoc = {
    ...doc,
    tracks: doc.tracks.slice(),
    clips: doc.clips.slice(),
    transitions: doc.transitions.slice(),
    keyframes: doc.keyframes.slice(),
    markers: doc.markers.slice(),
    captions: doc.captions.slice(),
    audioClips: doc.audioClips.slice()
  };

  for (const op of patch.ops) {
    switch (op.type) {
      case "clip/add":
        next.clips.push(op.clip);
        break;
      case "clip/remove":
        next.clips = next.clips.filter((c) => c.id !== op.clipId);
        break;
      case "clip/update":
        next.clips = next.clips.map((c) => (c.id === op.clipId ? { ...c, ...op.after } : c));
        break;
      case "transition/add":
        next.transitions.push(op.transition);
        break;
      case "transition/remove":
        next.transitions = next.transitions.filter((t) => t.id !== op.transitionId);
        break;
      case "keyframe/add":
        next.keyframes.push(op.keyframe);
        break;
      case "keyframe/remove":
        next.keyframes = next.keyframes.filter((k) => k.id !== op.keyframeId);
        break;
      case "keyframe/update":
        next.keyframes = next.keyframes.map((k) => (k.id === op.keyframeId ? { ...k, ...op.after } : k));
        break;
      case "marker/add":
        next.markers.push(op.marker);
        break;
      case "marker/remove":
        next.markers = next.markers.filter((m) => m.id !== op.markerId);
        break;
      case "marker/update":
        next.markers = next.markers.map((m) => (m.id === op.markerId ? { ...m, ...op.after } : m));
        break;
      case "caption/add":
        next.captions.push(op.caption);
        break;
      case "caption/remove":
        next.captions = next.captions.filter((c) => c.id !== op.captionId);
        break;
      case "caption/update":
        next.captions = next.captions.map((c) => (c.id === op.captionId ? { ...c, ...op.after } : c));
        break;
      case "audio/add":
        next.audioClips.push(op.audio);
        break;
      case "audio/remove":
        next.audioClips = next.audioClips.filter((a) => a.id !== op.audioId);
        break;
      case "audio/update":
        next.audioClips = next.audioClips.map((a) => (a.id === op.audioId ? { ...a, ...op.after } : a));
        break;
      case "track/add":
        next.tracks.push(op.track);
        break;
      case "track/remove":
        next.tracks = next.tracks.filter((t) => t.id !== op.trackId);
        break;
      case "doc/update":
        Object.assign(next, op.after);
        break;
      default:
        throw new EngineError("E_VALIDATION", `未知微操作: ${JSON.stringify(op).slice(0, 80)}`);
    }
  }
  return next;
}
