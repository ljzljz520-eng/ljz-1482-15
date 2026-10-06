import type { MediaAsset, TimelineDoc } from "@timeline/core";
import { assertValid } from "@timeline/core";
import { prisma } from "../db/prisma.js";

export async function listMediaAssets(): Promise<MediaAsset[]> {
  const rows = await prisma.media.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as MediaAsset["kind"],
    fps: r.fps,
    duration: r.duration,
    sampleRate: r.sampleRate ?? undefined,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    retired: r.retired
  }));
}

/**
 * 服务端权威校验：整数 tick、悬空引用、退役素材、入出点、转场、重叠、锚点、
 * 标记、导出范围。任何写库/渲染路径都必须经过这里。
 */
export async function assertDocValid(doc: TimelineDoc): Promise<void> {
  const assets = await listMediaAssets();
  assertValid(doc, assets);
}

/**
 * 退役素材（不物理删除，保证历史冻结快照仍可追溯）：
 * 退役后所有引用它的新编辑（拖动/添加/保存）都会被校验拒绝。
 */
export async function retireMedia(id: string) {
  return prisma.media.update({ where: { id }, data: { retired: true } });
}

export async function createMedia(data: {
  name: string;
  kind: "video" | "audio" | "image";
  fps: string;
  duration: number;
  sampleRate?: number;
  width?: number;
  height?: number;
}) {
  return prisma.media.create({
    data: {
      name: data.name,
      kind: data.kind,
      fps: data.fps,
      duration: data.duration,
      sampleRate: data.sampleRate ?? null,
      width: data.width ?? null,
      height: data.height ?? null
    }
  });
}
