import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/routes/auth.js";
import { hashDocSync } from "@timeline/core/hashNode";
import { logger } from "../src/logger.js";

const prisma = new PrismaClient();

/** 不同帧率素材（验收“不同帧率素材”）：23.976 / 29.97 / 25 / 30，整数 tick 精确表达 */
export function buildSeedTimeline() {
  // 29.97fps（30000/1001）：每帧 8008 tick
  // 24fps：10000；25fps：9600；23.976fps：10010
  const media = [
    {
      key: "lake-2997",
      name: "湖面晨雾（29.97fps）",
      kind: "video",
      fps: "30000/1001",
      duration: 8008 * 120, // 120 帧
      width: 1920,
      height: 1080
    },
    {
      key: "forest-24",
      name: "森林书屋（24fps）",
      kind: "video",
      fps: "24/1",
      duration: 10000 * 96,
      width: 1920,
      height: 1080
    },
    {
      key: "lightshow-25",
      name: "光影秀全景（25fps）",
      kind: "video",
      fps: "25/1",
      duration: 9600 * 100,
      width: 3840,
      height: 2160
    },
    {
      key: "interview-23976",
      name: "人物访谈（23.976fps）",
      kind: "video",
      fps: "24000/1001",
      duration: 10010 * 72,
      width: 1920,
      height: 1080
    },
    {
      key: "bgm-nature",
      name: "自然环境声（48kHz）",
      kind: "audio",
      fps: "30/1",
      duration: 240000 * 20,
      sampleRate: 48000
    },
    {
      key: "voiceover",
      name: "旁白配音（48kHz）",
      kind: "audio",
      fps: "30/1",
      duration: 240000 * 8,
      sampleRate: 48000
    }
  ];

  // 时间线以 29.97fps 网格显示
  const TPF = 8008;
  const clips = [
    {
      id: "clip-lake",
      trackId: "v1",
      start: 0,
      duration: TPF * 30,
      mediaKey: "lake-2997",
      sourceIn: 0,
      name: "湖面晨雾",
      color: "#38bdf8",
      keyPoints: [
        { id: "kp-lake-1", at: TPF * 5, value: 0.9, label: "提亮" },
        { id: "kp-lake-2", at: TPF * 20, value: 1, label: "正常" }
      ],
      anchorClipId: null
    },
    {
      id: "clip-forest",
      trackId: "v1",
      start: TPF * 30 - TPF * 3,
      duration: TPF * 24,
      mediaKey: "forest-24",
      sourceIn: TPF * 4,
      name: "森林书屋",
      color: "#34d399",
      transitionIn: { type: "dissolve", overlap: TPF * 3 },
      keyPoints: [{ id: "kp-forest-1", at: TPF * 10, value: 0.8, label: "淡入" }],
      anchorClipId: null
    },
    {
      id: "clip-light",
      trackId: "v1",
      // 紧接森林书屋：forest.start(27f)+24f = 51f
      start: TPF * 51,
      duration: TPF * 30,
      mediaKey: "lightshow-25",
      sourceIn: 0,
      name: "光影秀",
      color: "#fbbf24",
      keyPoints: [],
      anchorClipId: null
    },
    // 字幕轨（锚定到视频片段）
    {
      id: "sub-1",
      trackId: "s1",
      start: TPF * 2,
      duration: TPF * 12,
      mediaKey: null,
      sourceIn: 0,
      name: "字幕：晨雾",
      text: "清晨五点，湖面升起薄雾",
      keyPoints: [],
      anchorClipId: "clip-lake",
      anchorOffset: TPF * 2
    },
    {
      id: "sub-2",
      trackId: "s1",
      start: TPF * 32,
      duration: TPF * 10,
      mediaKey: null,
      sourceIn: 0,
      name: "字幕：书屋",
      text: "森林书屋的日光最为柔和",
      keyPoints: [],
      anchorClipId: "clip-forest",
      anchorOffset: TPF * 5
    },
    // 音频轨：配乐 + 锚定到光影秀的配音
    {
      id: "music-main",
      trackId: "a1",
      start: 0,
      duration: 240000 * 18,
      mediaKey: "bgm-nature",
      sourceIn: 0,
      name: "背景音乐",
      keyPoints: [
        { id: "kp-mu-1", at: 240000 * 2, value: 0.4, label: "压低" },
        { id: "kp-mu-2", at: 240000 * 10, value: 0.7, label: "恢复" }
      ],
      anchorClipId: null
    },
    {
      id: "vo-1",
      trackId: "a2",
      start: 0,
      duration: 240000 * 6,
      mediaKey: "voiceover",
      sourceIn: 0,
      name: "旁白：光影秀",
      keyPoints: [],
      anchorClipId: "clip-light",
      anchorOffset: TPF * 2
    }
  ];

  const markers = [
    { id: "mk-1", at: TPF * 8, label: "晨雾最佳镜头" },
    { id: "mk-2", at: TPF * 42, label: "转场到书屋" },
    { id: "mk-3", at: TPF * 72, label: "光影秀高潮" }
  ];

  const mediaIdByKey: Record<string, string> = {};
  for (const m of media) mediaIdByKey[m.key] = `seed-${m.key}`;

  const docClips = clips.map((c) => ({
    id: c.id,
    trackId: c.trackId,
    start: c.start,
    duration: c.duration,
    mediaId: c.mediaKey ? mediaIdByKey[c.mediaKey] : null,
    sourceIn: c.sourceIn,
    name: c.name,
    color: c.color,
    text: (c as { text?: string }).text,
    transitionIn: c.transitionIn ?? null,
    keyPoints: c.keyPoints,
    anchorClipId: c.anchorClipId,
    anchorOffset: c.anchorOffset ?? 0
  }));
  const lightStart = docClips.find((c) => c.id === "clip-light")!.start;
  const vo = docClips.find((c) => c.id === "vo-1")!;
  vo.start = lightStart + TPF * 2;

  const doc = {
    schema: 1 as const,
    fps: "30000/1001",
    tracks: [
      { id: "v1", kind: "video" as const, name: "视频轨 V1" },
      { id: "a1", kind: "audio" as const, name: "背景音乐 A1" },
      { id: "a2", kind: "audio" as const, name: "配音 A2" },
      { id: "s1", kind: "subtitle" as const, name: "字幕 S1" }
    ],
    clips: docClips,
    markers,
    exportStart: 0,
    exportEnd: lightStart + TPF * 30
  };
  return { media, clips, markers, TPF, doc };
}

async function main() {
  const { media, doc } = buildSeedTimeline();

  // —— 用户 ——
  const adminPass = hashPassword("123456");
  const editorPass = hashPassword("123456");
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: { username: "admin", displayName: "项目管理员", role: "admin", passwordHash: adminPass }
  });
  await prisma.user.upsert({
    where: { username: "editor" },
    update: {},
    create: { username: "editor", displayName: "协作剪辑师", role: "editor", passwordHash: editorPass }
  });

  // —— 素材（幂等 upsert）——
  for (const m of media) {
    const { key, ...data } = m;
    await prisma.media.upsert({
      where: { id: `seed-${key}` },
      update: data,
      create: { id: `seed-${key}`, ...data }
    });
  }

  // —— 时间线（时间全部为整数 tick，已通过核心校验器）——
  await prisma.timeline.upsert({
    where: { id: "seed-timeline-1" },
    update: { doc: doc as never, docHash: hashDocSync(doc), name: "云溪公园 · 一日光影（多轨示例）" },
    create: {
      id: "seed-timeline-1",
      name: "云溪公园 · 一日光影（多轨示例）",
      doc: doc as never,
      revision: 1,
      docHash: hashDocSync(doc)
    }
  });

  void admin;
  logger.info("[seed] 完成：2 个用户、6 个多帧率素材、1 条多轨时间线");
}

const isMain = (() => {
  try {
    const entry = process.argv[1]?.replace(/\.js$/, ".ts");
    return entry?.endsWith("prisma/seed.ts") || entry?.endsWith("prisma/seed.js") || process.env.SEED_RUN === "1";
  } catch {
    return false;
  }
})();

if (isMain) {
  main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    logger.error({ err: e }, "[seed] 失败");
    await prisma.$disconnect();
    process.exit(1);
  });
}
