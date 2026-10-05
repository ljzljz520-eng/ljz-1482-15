/**
 * 规范化文档 <-> 关系表 装载/持久化。
 * 所有外键使用 Restrict，配合引擎校验，数据库物理拒绝悬空引用。
 */

import type { Prisma } from "@prisma/client";
import type { PrismaTransaction } from "../lib/types";
import type { AssetDO, TimelineDoc } from "@timeline/shared";

export async function loadAssets(tx: PrismaTransaction, projectId: string): Promise<AssetDO[]> {
  const rows = await tx.asset.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as AssetDO["kind"],
    name: r.name,
    rate: { num: r.rateNum, den: r.rateDen },
    duration: Number(r.duration),
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    status: r.status as AssetDO["status"]
  }));
}

export async function loadDoc(tx: PrismaTransaction, projectId: string): Promise<{ doc: TimelineDoc; assets: AssetDO[]; name: string; ownerId: string; revision: number }> {
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  const [tracks, clips, transitions, keyframes, markers, captions, audioClips, assets] = await Promise.all([
    tx.track.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
    tx.clip.findMany({ where: { projectId }, orderBy: { position: "asc" } }),
    tx.transition.findMany({ where: { projectId } }),
    tx.keyframe.findMany({ where: { projectId } }),
    tx.marker.findMany({ where: { projectId } }),
    tx.captionAnchor.findMany({ where: { projectId } }),
    tx.audioClip.findMany({ where: { projectId } }),
    loadAssets(tx, projectId)
  ]);

  const doc: TimelineDoc = {
    revision: project.currentRevision,
    timebase: Number(project.timebase),
    rate: { num: project.rateNum, den: project.rateDen },
    exportStart: Number(project.exportStart),
    exportEnd: project.exportEnd === null ? null : Number(project.exportEnd),
    tracks: tracks.map((t) => ({ id: t.id, kind: t.kind as "video" | "audio", name: t.name, locked: t.locked })),
    clips: clips.map((c) => ({
      id: c.id, trackId: c.trackId, assetId: c.assetId, start: Number(c.start), duration: Number(c.duration),
      inPoint: Number(c.inPoint), outPoint: Number(c.outPoint)
    })),
    transitions: transitions.map((t) => ({
      id: t.id, trackId: t.trackId, fromClipId: t.fromClipId, toClipId: t.toClipId, overlap: Number(t.overlap), kind: t.kind
    })),
    keyframes: keyframes.map((k) => ({ id: k.id, clipId: k.clipId, offset: Number(k.offset), property: k.property, value: k.value })),
    markers: markers.map((m) => ({ id: m.id, tick: Number(m.tick), label: m.label, clipId: m.clipId, mode: m.mode as "clip" | "absolute" })),
    captions: captions.map((c) => ({
      id: c.id, text: c.text, mode: c.mode as "clip" | "absolute", clipId: c.clipId,
      offset: Number(c.offset), absoluteTick: Number(c.absoluteTick)
    })),
    audioClips: audioClips.map((a) => ({
      id: a.id, trackId: a.trackId, assetId: a.assetId, start: Number(a.start), duration: Number(a.duration),
      inPoint: Number(a.inPoint), gain: a.gain
    }))
  };

  return { doc, assets, name: project.name, ownerId: project.ownerId, revision: project.currentRevision };
}

/**
 * 全量替换持久化（项目级事务，调用方持有项目咨询锁）。
 * 删除顺序尊重外键：先删引用方，再删被引用方；插入顺序相反。
 */
export async function persistDoc(tx: PrismaTransaction, projectId: string, doc: TimelineDoc): Promise<void> {
  await tx.keyframe.deleteMany({ where: { projectId } });
  await tx.transition.deleteMany({ where: { projectId } });
  await tx.marker.deleteMany({ where: { projectId } });
  await tx.captionAnchor.deleteMany({ where: { projectId } });
  await tx.audioClip.deleteMany({ where: { projectId } });
  await tx.clip.deleteMany({ where: { projectId } });
  await tx.track.deleteMany({ where: { projectId } });

  for (let i = 0; i < doc.tracks.length; i++) {
    const t = doc.tracks[i];
    await tx.track.create({
      data: { id: t.id, projectId, kind: t.kind, name: t.name, locked: t.locked, position: i }
    });
  }

  // 先确定每个轨道上的片段位置（保持装载/引擎顺序）
  const trackOrder = new Map(doc.tracks.map((t, i) => [t.id, i]));
  const perTrackCount = new Map<string, number>();

  for (const c of doc.clips) {
    const pos = perTrackCount.get(c.trackId) ?? 0;
    perTrackCount.set(c.trackId, pos + 1);
    await tx.clip.create({
      data: {
        id: c.id, projectId, trackId: c.trackId, assetId: c.assetId,
        start: BigInt(c.start), duration: BigInt(c.duration), inPoint: BigInt(c.inPoint), outPoint: BigInt(c.outPoint), position: trackOrder.has(c.trackId) ? pos : 0
      }
    });
  }

  for (const tr of doc.transitions) {
    await tx.transition.create({
      data: {
        id: tr.id, projectId, trackId: tr.trackId, fromClipId: tr.fromClipId, toClipId: tr.toClipId,
        overlap: Number(tr.overlap), kind: tr.kind
      }
    });
  }

  for (const k of doc.keyframes) {
    await tx.keyframe.create({
      data: { id: k.id, projectId, clipId: k.clipId, offset: Number(k.offset), property: k.property, value: k.value }
    });
  }

  for (const m of doc.markers) {
    await tx.marker.create({
      data: { id: m.id, projectId, clipId: m.clipId, tick: BigInt(m.tick), label: m.label, mode: m.mode }
    });
  }

  for (const c of doc.captions) {
    await tx.captionAnchor.create({
      data: { id: c.id, projectId, clipId: c.clipId, text: c.text, mode: c.mode, offset: Number(c.offset), absoluteTick: Number(c.absoluteTick) }
    });
  }

  for (const a of doc.audioClips) {
    await tx.audioClip.create({
      data: { id: a.id, projectId, trackId: a.trackId, assetId: a.assetId, start: BigInt(a.start), duration: BigInt(a.duration), inPoint: BigInt(a.inPoint), gain: a.gain }
    });
  }

  await tx.project.update({
    where: { id: projectId },
    data: {
      timebase: BigInt(doc.timebase),
      rateNum: doc.rate.num,
      rateDen: doc.rate.den,
      exportStart: BigInt(doc.exportStart),
      exportEnd: doc.exportEnd === null ? null : BigInt(doc.exportEnd)
    }
  });
}

/** 项目级事务咨询锁（哈希 projectId 到 int8），串行化同一项目的变更 */
export async function lockProject(tx: PrismaTransaction, projectId: string): Promise<bigint> {
  const hash = hashStringToBigInt(projectId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hash})`;
  return hash;
}

function hashStringToBigInt(s: string): bigint {
  let h = 1469598103934665603n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 1099511628211n) & 0xffffffffffffffffn;
  }
  // 转为有符号 int8 范围
  if (h > 0x7fffffffffffffffn) h -= 0x10000000000000000n;
  return h;
}

export type { Prisma };
