/**
 * 初始化演示数据：
 *  - 两个协作用户（用于演示并发拖动冲突）
 *  - 不同帧率素材：23.976 / 25 / 29.97 / 60fps 视频 + 48kHz 音频
 *  - 多轨时间线：2 视频轨 + 2 音频轨，含转场重叠、关键点、标记、字幕锚点、配乐
 */

import {
  frameToTick,
  RATE_23976,
  RATE_25,
  RATE_2997,
  RATE_60,
  RATE_AUDIO_48K,
  TICKS_PER_SECOND
} from "@timeline/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const sec = (n: number) => n * TICKS_PER_SECOND;

async function main() {
  const alice = await prisma.user.upsert({
    where: { id: "user_alice" },
    update: {},
    create: { id: "user_alice", name: "林编辑", color: "#165DFF" }
  });
  await prisma.user.upsert({
    where: { id: "user_bob" },
    update: {},
    create: { id: "user_bob", name: "陈协作", color: "#FF7D00" }
  });

  // 幂等：清理旧演示项目
  await prisma.project.deleteMany({ where: { id: "proj_demo" } });

  const project = await prisma.project.create({
    data: {
      id: "proj_demo",
      name: "云溪公园 · 形象片",
      ownerId: alice.id,
      currentRevision: 1,
      timebase: BigInt(TICKS_PER_SECOND),
      rateNum: 25,
      rateDen: 1,
      exportStart: 0,
      exportEnd: null
    }
  });

  // 素材（时长全部为源 tick 整数；帧->tick 经有理数换算）
  const assetsData = [
    { id: "ast_mist", kind: "video", name: "湖面薄雾(23.976fps)", rate: RATE_23976, frames: 240, w: 1920, h: 1080 },
    { id: "ast_forest", kind: "video", name: "森林阅读(25fps)", rate: RATE_25, frames: 300, w: 3840, h: 2160 },
    { id: "ast_light", kind: "video", name: "光影秀(29.97fps)", rate: RATE_2997, frames: 360, w: 1920, h: 1080 },
    { id: "ast_aerial", kind: "video", name: "航拍延时(60fps)", rate: RATE_60, frames: 600, w: 3840, h: 2160 },
    { id: "ast_bgm", kind: "audio", name: "主题配乐(48kHz)", rate: RATE_AUDIO_48K, frames: 48000 * 30 },
    { id: "ast_nature", kind: "audio", name: "自然环境声(48kHz)", rate: RATE_AUDIO_48K, frames: 48000 * 20 }
  ] as const;

  for (const a of assetsData) {
    await prisma.asset.create({
      data: {
        id: a.id,
        projectId: project.id,
        kind: a.kind,
        name: a.name,
        rateNum: a.rate.num,
        rateDen: a.rate.den,
        duration: BigInt(frameToTick(a.frames, a.rate)),
        width: "w" in a ? a.w : null,
        height: "h" in a ? a.h : null,
        status: "active"
      }
    });
  }

  const tracks = [
    { id: "tr_v1", kind: "video", name: "V1 主轨", position: 0 },
    { id: "tr_v2", kind: "video", name: "V2 叠加", position: 1 },
    { id: "tr_a1", kind: "audio", name: "A1 配乐", position: 2 },
    { id: "tr_a2", kind: "audio", name: "A2 环境声", position: 3 }
  ] as const;
  for (const t of tracks) {
    await prisma.track.create({
      data: { id: t.id, projectId: project.id, kind: t.kind, name: t.name, position: t.position, locked: false }
    });
  }

  // 主轨片段（注意不同帧率素材：tick 统一，源入点各异）
  const clipsData = [
    { id: "cl_mist", trackId: "tr_v1", assetId: "ast_mist", start: 0, duration: sec(6), inPoint: frameToTick(0, RATE_23976) },
    { id: "cl_forest", trackId: "tr_v1", assetId: "ast_forest", start: sec(5), duration: sec(6), inPoint: frameToTick(25, RATE_25) }, // 与薄雾重叠1s做转场
    { id: "cl_light", trackId: "tr_v1", assetId: "ast_light", start: sec(11), duration: sec(5), inPoint: 0 },
    { id: "cl_aerial", trackId: "tr_v2", assetId: "ast_aerial", start: sec(2), duration: sec(4), inPoint: frameToTick(120, RATE_60) }
  ] as const;
  for (const c of clipsData) {
    await prisma.clip.create({
      data: {
        id: c.id,
        projectId: project.id,
        trackId: c.trackId,
        assetId: c.assetId,
        start: BigInt(c.start),
        duration: BigInt(c.duration),
        inPoint: BigInt(c.inPoint),
        outPoint: BigInt(c.inPoint + c.duration),
        position: 0
      }
    });
  }

  // 转场：薄雾<->森林 重叠 1s
  await prisma.transition.create({
    data: {
      id: "tr_dissolve_1",
      projectId: project.id,
      trackId: "tr_v1",
      fromClipId: "cl_mist",
      toClipId: "cl_forest",
      overlap: BigInt(sec(1)),
      kind: "dissolve"
    }
  });

  // 关键点（透明度）
  await prisma.keyframe.createMany({
    data: [
      { id: "kf_a_1", projectId: project.id, clipId: "cl_aerial", offset: BigInt(0), property: "opacity", value: 0 },
      { id: "kf_a_2", projectId: project.id, clipId: "cl_aerial", offset: BigInt(sec(1)), property: "opacity", value: 1 },
      { id: "kf_a_3", projectId: project.id, clipId: "cl_aerial", offset: BigInt(sec(4)), property: "opacity", value: 1 }
    ]
  });

  // 标记
  await prisma.marker.createMany({
    data: [
      { id: "mk_sunrise", projectId: project.id, tick: BigInt(sec(1)), label: "薄雾最佳光线", clipId: "cl_mist", mode: "clip" },
      { id: "mk_show", projectId: project.id, tick: BigInt(sec(12)), label: "光影秀开场", clipId: null, mode: "absolute" }
    ]
  });

  // 字幕锚点
  await prisma.captionAnchor.createMany({
    data: [
      { id: "cap_1", projectId: project.id, clipId: "cl_mist", text: "清晨 · 云溪湖", mode: "clip", offset: BigInt(sec(2)), absoluteTick: BigInt(0) },
      { id: "cap_2", projectId: project.id, clipId: "cl_light", text: "夜幕 · 光影艺术", mode: "clip", offset: BigInt(sec(1)), absoluteTick: BigInt(0) },
      { id: "cap_3", projectId: project.id, clipId: null, text: "云溪公园 欢迎您", mode: "absolute", offset: BigInt(0), absoluteTick: BigInt(sec(15)) }
    ]
  });

  // 音频片段（位置全部为 tick 整数）
  await prisma.audioClip.createMany({
    data: [
      { id: "au_bgm", projectId: project.id, trackId: "tr_a1", assetId: "ast_bgm", start: BigInt(0), duration: BigInt(sec(16)), inPoint: BigInt(0), gain: 0.8 },
      { id: "au_nature", projectId: project.id, trackId: "tr_a2", assetId: "ast_nature", start: BigInt(0), duration: BigInt(sec(10)), inPoint: BigInt(0), gain: 0.6 }
    ]
  });

  console.log("种子数据完成: proj_demo (用户 user_alice / user_bob)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
