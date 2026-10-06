/**
 * 操作（Op）模型：一切编辑都是可序列化、可重放、可逆的纯函数操作。
 * applyOp 不做 IO，可同时运行在浏览器（乐观更新）、服务端（鉴权落库）、
 * 渲染冻结版本（快照重放）三处。
 */
import type { Clip, Marker, TimelineDoc } from "./model.js";
import { getClip, getMarker, timelineDuration } from "./model.js";

export type Op =
  | { type: "addClip"; clip: Clip }
  | { type: "removeClip"; clip: Clip }
  | { type: "moveClip"; clipId: string; start: number; trackId?: string }
  | {
      type: "trimClip";
      clipId: string;
      edge: "head" | "tail";
      start: number;
      duration: number;
      sourceIn: number;
    }
  | { type: "dragKeyPoint"; clipId: string; keyPointId: string; at: number }
  | { type: "addMarker"; marker: Marker }
  | { type: "moveMarker"; markerId: string; at: number }
  | { type: "removeMarker"; marker: Marker }
  | { type: "setExportRange"; start: number; end: number }
  | { type: "setTransition"; clipId: string; transition: Clip["transitionIn"] }
  | { type: "setAnchor"; clipId: string; anchorClipId: string | null; anchorOffset?: number }
  | { type: "compound"; ops: Op[]; label?: string };

export class OpError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "INVALID"
      | "OVERLAP"
      | "REBASE_UNSUPPORTED"
      | "NOT_REVERSIBLE",
    message: string
  ) {
    super(message);
    this.name = "OpError";
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function updateClips(doc: TimelineDoc, fn: (clips: Clip[]) => Clip[]): TimelineDoc {
  return { ...doc, clips: fn(doc.clips.map(clone)) };
}

/**
 * 应用操作，返回新文档与该操作的“逆操作”。
 * 结构层校验（存在性/范围/同轨重叠）；素材级校验由服务层用素材库完成。
 */
interface ApplyCtx { structuralOnly?: boolean }

export function applyOp(
  doc: TimelineDoc,
  op: Op,
  ctx: ApplyCtx = {}
): { doc: TimelineDoc; inverse: Op } {
  switch (op.type) {
    case "addClip": {
      if (getClip(doc, op.clip.id)) throw new OpError("INVALID", `片段 ${op.clip.id} 已存在`);
      if (!doc.tracks.some((t) => t.id === op.clip.trackId)) {
        throw new OpError("INVALID", `轨道 ${op.clip.trackId} 不存在`);
      }
      assertNoOverlap(doc, op.clip);
      const next = updateClips(doc, (cs) => [...cs, clone(op.clip)]);
      return { doc: next, inverse: { type: "removeClip", clip: clone(op.clip) } };
    }
    case "removeClip": {
      if (!getClip(doc, op.clip.id)) throw new OpError("NOT_FOUND", `片段 ${op.clip.id} 不存在`);
      const next = updateClips(doc, (cs) => cs.filter((c) => c.id !== op.clip.id));
      return { doc: next, inverse: { type: "addClip", clip: clone(op.clip) } };
    }
    case "moveClip": {
      const c = getClip(doc, op.clipId);
      if (!c) throw new OpError("NOT_FOUND", `片段 ${op.clipId} 不存在，可能已被他人删除`);
      const before = clone(c);
      const trackId = op.trackId ?? c.trackId;
      if (!doc.tracks.some((t) => t.id === trackId)) throw new OpError("INVALID", "目标轨道不存在");
      if (op.start < 0) throw new OpError("INVALID", "片段起点不能为负");
      const tentative: Clip = { ...clone(c), start: op.start, trackId };
      assertNoOverlap(doc, tentative, c.id);
      const next = updateClips(doc, (cs) =>
        cs.map((x) => (x.id === c.id ? { ...x, start: op.start, trackId } : x))
      );
      return {
        doc: next,
        inverse: { type: "moveClip", clipId: c.id, start: before.start, trackId: before.trackId }
      };
    }
    case "trimClip": {
      const c = getClip(doc, op.clipId);
      if (!c) throw new OpError("NOT_FOUND", `片段 ${op.clipId} 不存在`);
      if (op.duration <= 0 || op.sourceIn < 0 || op.start < 0) {
        throw new OpError("INVALID", "修剪参数非法：时长必须为正且入点非负");
      }
      const before = clone(c);
      const tentative: Clip = { ...clone(c), start: op.start, duration: op.duration, sourceIn: op.sourceIn };
      assertNoOverlap(doc, tentative, c.id);
      // 转场不能比修剪后的片段更长
      if (tentative.transitionIn && tentative.transitionIn.overlap > op.duration) {
        tentative.transitionIn = null;
      }
      const next = updateClips(doc, (cs) =>
        cs.map((x) =>
          x.id === c.id
            ? {
                ...x,
                start: op.start,
                duration: op.duration,
                sourceIn: op.sourceIn,
                transitionIn: tentative.transitionIn
              }
            : x
        )
      );
      return {
        doc: next,
        inverse: {
          type: "trimClip",
          clipId: c.id,
          edge: op.edge,
          start: before.start,
          duration: before.duration,
          sourceIn: before.sourceIn
        }
      };
    }
    case "dragKeyPoint": {
      const c = getClip(doc, op.clipId);
      if (!c) throw new OpError("NOT_FOUND", `片段 ${op.clipId} 不存在`);
      const kp = c.keyPoints.find((k) => k.id === op.keyPointId);
      if (!kp) throw new OpError("NOT_FOUND", `关键点 ${op.keyPointId} 不存在`);
      if (!Number.isInteger(op.at) || op.at < 0 || op.at > c.duration) {
        throw new OpError("INVALID", `关键点位置必须在 [0, ${c.duration}] tick 内`);
      }
      const beforeAt = kp.at;
      const next = updateClips(doc, (cs) =>
        cs.map((x) =>
          x.id === c.id
            ? { ...x, keyPoints: x.keyPoints.map((k) => (k.id === kp.id ? { ...k, at: op.at } : k)) }
            : x
        )
      );
      return { doc: next, inverse: { ...op, at: beforeAt } };
    }
    case "addMarker": {
      if (getMarker(doc, op.marker.id)) throw new OpError("INVALID", "标记已存在");
      if (op.marker.at < 0 || (!ctx.structuralOnly && op.marker.at > timelineDuration(doc))) {
        throw new OpError("INVALID", "标记超出时间线范围");
      }
      const next: TimelineDoc = { ...doc, markers: [...doc.markers, clone(op.marker)] };
      return { doc: next, inverse: { type: "removeMarker", marker: clone(op.marker) } };
    }
    case "moveMarker": {
      const m = getMarker(doc, op.markerId);
      if (!m) throw new OpError("NOT_FOUND", "标记不存在");
      if (op.at < 0 || (!ctx.structuralOnly && op.at > timelineDuration(doc))) {
        throw new OpError("INVALID", "标记超出时间线范围");
      }
      const beforeAt = m.at;
      const next: TimelineDoc = {
        ...doc,
        markers: doc.markers.map((x) => (x.id === m.id ? { ...x, at: op.at } : x))
      };
      return { doc: next, inverse: { ...op, at: beforeAt } };
    }
    case "removeMarker": {
      if (!getMarker(doc, op.marker.id)) throw new OpError("NOT_FOUND", "标记不存在");
      const next: TimelineDoc = { ...doc, markers: doc.markers.filter((x) => x.id !== op.marker.id) };
      return { doc: next, inverse: { type: "addMarker", marker: clone(op.marker) } };
    }
    case "setExportRange": {
      const total = timelineDuration(doc);
      // 复合操作逆序撤销过程中，导出范围可能先于片段恢复，此时只做结构性校验；
      // 完整范围校验在复合操作结束后由 validateDoc 统一完成。
      if (!ctx.structuralOnly && (op.start < 0 || op.end > total || op.start >= op.end)) {
        throw new OpError("INVALID", `导出范围 [${op.start}, ${op.end}) 无效（总长 ${total}）`);
      }
      if (op.start < 0 || op.start >= op.end) {
        throw new OpError("INVALID", `导出范围 [${op.start}, ${op.end}) 结构非法`);
      }
      const prev = {
        start: doc.exportStart ?? 0,
        end: doc.exportEnd ?? total
      };
      return {
        doc: { ...doc, exportStart: op.start, exportEnd: op.end },
        inverse: { type: "setExportRange", start: prev.start, end: prev.end }
      };
    }
    case "setTransition": {
      const c = getClip(doc, op.clipId);
      if (!c) throw new OpError("NOT_FOUND", `片段 ${op.clipId} 不存在`);
      const prev = clone(c.transitionIn ?? null);
      const next = updateClips(doc, (cs) =>
        cs.map((x) => (x.id === c.id ? { ...x, transitionIn: op.transition ?? null } : x))
      );
      return { doc: next, inverse: { type: "setTransition", clipId: c.id, transition: prev } };
    }
    case "setAnchor": {
      const c = getClip(doc, op.clipId);
      if (!c) throw new OpError("NOT_FOUND", `片段 ${op.clipId} 不存在`);
      const prevAnchor = c.anchorClipId ?? null;
      const prevOffset = c.anchorOffset ?? 0;
      const next = updateClips(doc, (cs) =>
        cs.map((x) =>
          x.id === c.id
            ? {
                ...x,
                anchorClipId: op.anchorClipId,
                anchorOffset: op.anchorOffset ?? x.anchorOffset ?? 0
              }
            : x
        )
      );
      return {
        doc: next,
        inverse: {
          type: "setAnchor",
          clipId: c.id,
          anchorClipId: prevAnchor,
          anchorOffset: prevOffset
        }
      };
    }
    case "compound": {
      let cur = doc;
      const inverses: Op[] = [];
      for (const sub of op.ops) {
        const r = applyOp(cur, sub, { structuralOnly: true });
        cur = r.doc;
        inverses.push(r.inverse);
      }
      return {
        doc: cur,
        inverse: { type: "compound", ops: inverses.reverse(), label: `撤销:${op.label ?? ""}` }
      };
    }
  }
}

function clipIdId(id: string): string {
  return id;
}

/** 同轨非法重叠检查（转场 overlap 是被允许的显式重叠） */
/**
 * 同轨非法重叠检查。
 * 规则：同轨片段按起点排序后，每对相邻片段 (p, n) 必须满足
 *   n.start >= p.start + p.duration - allowedOverlap
 * 其中 allowedOverlap 仅当 n 携带入场转场、且转场另一端恰好是 p 时等于其 overlap。
 * 用“排序后的假想列表”判定，可同时覆盖 add/move/trim 三类操作。
 */
function assertNoOverlap(doc: TimelineDoc, target: Clip, ignoreId?: string): void {
  const sorted = doc.clips
    .filter((c) => c.id !== ignoreId && c.trackId === target.trackId)
    .concat(target)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i - 1];
    const n = sorted[i];
    const transitionOk =
      n.transitionIn != null &&
      n.transitionIn.overlap <= n.duration &&
      n.transitionIn.overlap <= p.duration &&
      n.start === p.start + p.duration - n.transitionIn.overlap;
    const allowedOverlap = transitionOk ? n.transitionIn!.overlap : 0;
    if (n.start < p.start + p.duration - allowedOverlap) {
      throw new OpError(
        "OVERLAP",
        `与同轨片段「${p.id === target.id ? n.name : p.name}」发生非法重叠，请先波纹删除或挪动位置`
      );
    }
  }
}

// ============================================================================
// 删除策略：波纹(ripple) vs 保留绝对位置(lift)，以及对字幕/锚点/配乐的影响
// ============================================================================

export interface DeletePolicy {
  /** ripple = 后续内容左移闭合；lift = 保留绝对位置留下空洞 */
  mode: "ripple" | "lift";
  /** 锚定到被删片段的字幕/配音：delete 删除 / detach 留在绝对时间 / follow 随波纹移动 */
  subtitles: "delete" | "detach" | "follow";
  /** 配乐：follow 随波纹移动 / hold 保持绝对位置 */
  music: "follow" | "hold";
}

export interface DeleteEffect {
  kind: "remove" | "shift" | "detach" | "marker-shift" | "marker-remove" | "transition-drop" | "export-adjust";
  label: string;
  detail: string;
}

export interface DeletePlan {
  op: Op;
  effects: DeleteEffect[];
}

/**
 * 生成删除操作（复合操作）。纯函数，前端“删除确认对话框”先用它预览影响，
 * 用户确认后原样发送给后端，后端重新计算并校验，不信任客户端。
 */
export function planDelete(doc: TimelineDoc, clipId: string, policy: DeletePolicy): DeletePlan {
  const target = getClip(doc, clipId);
  if (!target) throw new OpError("NOT_FOUND", `片段 ${clipId} 不存在或已被删除`);

  // 基本时间量（tick 整数，禁止浮点累加）
  const inOv = target.transitionIn?.overlap ?? 0;
  const gapStart = target.start;
  const gapEnd = target.start + target.duration;
  const dur = target.duration;
  const ops: Op[] = [];
  const effects: DeleteEffect[] = [];

  // 同轨直接后邻：无转场时身体起点恰好为 gapEnd；
  // 带入场转场时身体起点 = gapEnd - overlap（视觉上跨入 target）。
  const successor = doc.clips.find(
    (c) =>
      c.id !== target.id &&
      c.trackId === target.trackId &&
      c.start - (c.transitionIn?.overlap ?? 0) < gapEnd &&
      c.start + c.duration >= gapEnd &&
      c.start <= gapEnd
  );
  const prev = predecessor(doc, target);
  const succOv = successor?.transitionIn?.overlap ?? 0;
  const migrateTransition =
    policy.mode === "ripple" && successor != null && succOv > 0 && prev != null && succOv <= prev.duration;

  // 前邻非重叠内容结束处：被删片段入转场共享区 [prev.end-inOv, prev.end)
  // 在删除后仍由前邻内容占据，因此无转场后邻闭合到 prevExclusiveEnd。
  const prevExclusiveEnd = prev ? prev.start + prev.duration - inOv : gapStart;

  // 后邻（同轨）闭合后的新起点与位移量
  let succNewStart: number | null = null;
  let succShift = 0;
  if (successor && policy.mode === "ripple") {
    if (succOv === 0) {
      succNewStart = prevExclusiveEnd;
    } else if (migrateTransition && prev) {
      succNewStart = prev.start + prev.duration - succOv;
    } else {
      // 转场长于新相邻片段：解除转场后闭合到前邻非重叠内容结束处
      succNewStart = prevExclusiveEnd;
    }
    succShift = successor.start - succNewStart;
  }

  // 全局（其它轨道、配乐、标记、导出范围）波纹位移量：
  // 删除最后一个片段或后邻承接了全部时间时为 dur-inOv；同轨后邻闭合位移可能不同
  const globalDelta = policy.mode === "ripple" ? dur - inOv : 0;
  const shiftGlobal = (t: number): number => t - globalDelta;

  // —— 1) 删除目标片段 ——
  ops.push({ type: "removeClip", clip: clone(target) });
  effects.push({
    kind: "remove",
    label: target.name,
    detail: `删除片段（${policy.mode === "ripple" ? "波纹删除" : "保留绝对位置"}）`
  });

  if (successor) {
    if (policy.mode === "lift") {
      if (succOv > 0) {
        ops.push(dropTransitionOp(successor.id));
        effects.push({ kind: "transition-drop", label: successor.name, detail: "前邻被删除，转场解除（绝对位置保持不变）" });
      }
    } else if (succNewStart != null) {
      if (succOv > 0 && !migrateTransition) {
        ops.push(dropTransitionOp(successor.id));
        effects.push({ kind: "transition-drop", label: successor.name, detail: "转场长于新相邻片段，解除后随波纹闭合" });
      } else if (migrateTransition && prev) {
        effects.push({ kind: "shift", label: successor.name, detail: `随波纹闭合，转场迁移至「${prev.name}」` });
      }
      ops.push({ type: "moveClip", clipId: successor.id, start: succNewStart, trackId: successor.trackId });
      if (!migrateTransition) effects.push({ kind: "shift", label: successor.name, detail: `随波纹闭合左移 ${succShift} tick` });
    }
  }

  // —— 2) 其它片段：锚点 / 波纹位移（判定均基于删除前文档）——
  for (const c of doc.clips) {
    if (c.id === target.id || c.id === successor?.id) continue;
    const track = doc.tracks.find((t) => t.id === c.trackId);

    // 2a) 锚定到被删片段的字幕/配音 —— 用户策略
    if (c.anchorClipId === target.id) {
      if (policy.subtitles === "delete") {
        ops.push({ type: "removeClip", clip: clone(c) });
        effects.push({ kind: "remove", label: c.name, detail: "锚定到被删片段，按所选策略一并删除" });
      } else if (policy.subtitles === "detach" || policy.mode === "lift") {
        ops.push(reanchorOp(c.id, null));
        effects.push({ kind: "detach", label: c.name, detail: "解除锚点，保留在当前绝对时间位置" });
      } else {
        ops.push(reanchorOp(c.id, null));
        ops.push({ type: "moveClip", clipId: c.id, start: Math.max(0, shiftGlobal(c.start)), trackId: c.trackId });
        effects.push({ kind: "shift", label: c.name, detail: `随波纹左移 ${globalDelta} tick 并解除失效锚点` });
      }
      continue;
    }

    if (policy.mode !== "ripple") continue;

    // 2b) 锚定到其它视频片段：跟随锚片段的实际位移
    if (c.anchorClipId != null) {
      const anchor = doc.clips.find((x) => x.id === c.anchorClipId);
      if (anchor && anchor.start >= gapEnd) {
        const anchorShift = anchor.id === successor?.id ? succShift : globalDelta;
        const newStart = anchor.start - anchorShift + (c.anchorOffset ?? 0);
        ops.push({ type: "moveClip", clipId: c.id, start: Math.max(0, newStart), trackId: c.trackId });
        effects.push({ kind: "shift", label: c.name, detail: "跟随被锚定片段做波纹移动" });
      }
      continue;
    }

    // 2c) 配乐：hold 保持绝对位置
    if (track?.kind === "audio" && policy.music === "hold") continue;

    // 2d) 空洞之后整体左移 globalDelta；完全落在空洞内的字幕移除
    if (c.start >= gapEnd) {
      ops.push({ type: "moveClip", clipId: c.id, start: shiftGlobal(c.start), trackId: c.trackId });
      effects.push({ kind: "shift", label: c.name, detail: `波纹左移 ${globalDelta} tick` });
    } else if (c.start >= gapStart - inOv && c.start + c.duration <= gapEnd && track?.kind === "subtitle") {
      ops.push({ type: "removeClip", clip: clone(c) });
      effects.push({ kind: "remove", label: c.name, detail: "字幕完全位于被删区间，随波纹移除" });
    }
  }

  if (policy.mode === "ripple") {
    // —— 3) 标记：落入被删内容区间删除；其后左移 globalDelta；转场共享区内保留 ——
    for (const m of doc.markers) {
      if (m.at >= gapEnd) {
        ops.push({ type: "moveMarker", markerId: m.id, at: shiftGlobal(m.at) });
        effects.push({ kind: "marker-shift", label: m.label, detail: `标记随波纹左移 ${globalDelta} tick` });
      } else if (m.at >= gapStart && m.at < gapEnd) {
        ops.push({ type: "removeMarker", marker: clone(m) });
        effects.push({ kind: "marker-remove", label: m.label, detail: "标记落入被删片段，移除" });
      }
    }
    // —— 4) 导出范围同源调整 ——
    const total = timelineDuration(doc);
    const es = doc.exportStart ?? 0;
    const ee = doc.exportEnd ?? total;
    const ns = es >= gapEnd ? shiftGlobal(es) : es;
    const ne = ee > gapStart ? shiftGlobal(ee) : ee;
    if (ns !== es || ne !== ee) {
      ops.push({ type: "setExportRange", start: Math.max(0, ns), end: Math.max(ns + 1, ne) });
      effects.push({ kind: "export-adjust", label: "导出范围", detail: "随波纹重新计算（与预览总长、标记同一时间模型）" });
    }
  }

  return { op: { type: "compound", ops, label: `删除 ${target.name}` }, effects };
}

function predecessor(doc: TimelineDoc, c: Clip): Clip | undefined {
  const sorted = doc.clips
    .filter((x) => x.trackId === c.trackId)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const idx = sorted.findIndex((x) => x.id === c.id);
  return idx > 0 ? sorted[idx - 1] : undefined;
}

function dropTransitionOp(clipId: string): Op {
  return { type: "setTransition", clipId, transition: null };
}

function reanchorOp(clipId: string, anchorClipId: string | null): Op {
  return { type: "setAnchor", clipId, anchorClipId, anchorOffset: 0 };
}

// ============================================================================
// 重基线（rebase）：他人编辑后，重算本地未提交操作的可逆/适用条件
// 几何类操作做意图保持的变换；结构性操作不允许盲目重放，要求用户重新决策
// ============================================================================

export interface RebaseResult {
  ok: boolean;
  op?: Op;
  reason?: string;
}

export function rebaseOp(op: Op, baseDoc: TimelineDoc, currentDoc: TimelineDoc): RebaseResult {
  switch (op.type) {
    case "moveClip": {
      const base = getClip(baseDoc, op.clipId);
      const cur = getClip(currentDoc, op.clipId);
      if (!base || !cur) return { ok: false, reason: "片段已被他人删除，无法重放拖动" };
      // 意图保持：用户拖动的“位移量”叠加到服务端最新位置上，而不是覆盖成旧坐标
      const delta = op.start - base.start;
      const target = cur.start + delta;
      if (target < 0) return { ok: false, reason: "重算后起点为负，请重新拖动" };
      if (wouldOverlap(currentDoc, { ...cur, start: target, trackId: op.trackId ?? cur.trackId })) {
        return { ok: false, reason: "他人编辑后目标位置已被占用，请基于最新版本重新拖动" };
      }
      return { ok: true, op: { ...op, start: target, trackId: op.trackId ?? cur.trackId } };
    }
    case "trimClip": {
      const cur = getClip(currentDoc, op.clipId);
      const base = getClip(baseDoc, op.clipId);
      if (!base || !cur) return { ok: false, reason: "片段已被删除，修剪操作失效" };
      if (op.edge === "head") {
        const shiftDelta = cur.start - base.start;
        const start = Math.max(0, op.start + shiftDelta);
        const duration = op.duration;
        if (wouldOverlap(currentDoc, { ...cur, start, duration })) {
          return { ok: false, reason: "修剪后与他人新增片段冲突，请重试" };
        }
        return { ok: true, op: { ...op, start, duration } };
      }
      if (wouldOverlap(currentDoc, { ...cur, duration: op.duration })) {
        return { ok: false, reason: "修剪后与他人编辑冲突，请重试" };
      }
      return { ok: true, op };
    }
    case "dragKeyPoint": {
      const cur = getClip(currentDoc, op.clipId);
      if (!cur) return { ok: false, reason: "片段已被删除" };
      if (!cur.keyPoints.some((k) => k.id === op.keyPointId)) {
        return { ok: false, reason: "关键点已被删除" };
      }
      const at = Math.min(op.at, cur.duration);
      return { ok: true, op: { ...op, at } };
    }
    case "moveMarker": {
      const base = getMarker(baseDoc, op.markerId);
      const cur = getMarker(currentDoc, op.markerId);
      if (!base || !cur) return { ok: false, reason: "标记已被删除" };
      const delta = op.at - base.at;
      const at = Math.max(0, Math.min(cur.at + delta, timelineDuration(currentDoc)));
      return { ok: true, op: { ...op, at } };
    }
    case "addMarker": {
      if (op.marker.at > timelineDuration(currentDoc)) {
        return { ok: false, reason: "波纹编辑后时间线缩短，标记超出范围" };
      }
      return { ok: true, op };
    }
    case "addClip": {
      if (wouldOverlap(currentDoc, op.clip)) return { ok: false, reason: "落点已被他人占用" };
      return { ok: true, op };
    }
    case "removeClip":
    case "removeMarker":
    case "setExportRange":
    case "setTransition":
    case "setAnchor":
    case "compound":
    default:
      return { ok: false, reason: "结构性操作不能自动重基线，请基于最新版本重新操作" };
  }
}

function wouldOverlap(doc: TimelineDoc, target: Clip): boolean {
  try {
    assertNoOverlap(doc, target, target.id);
    return false;
  } catch {
    return true;
  }
}
