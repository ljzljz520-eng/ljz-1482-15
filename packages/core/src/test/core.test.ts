import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Rational,
  TICKS_PER_SECOND,
  ticksPerFrame,
  frameToTick,
  tickToFrame,
  sampleToTick,
  tickToSample,
  snapToFrame,
  formatTimecode,
  timelineDuration,
  validateDoc,
  applyOp,
  OpError,
  planDelete,
  rebaseOp,
  type TimelineDoc,
  type Clip,
  type MediaAsset
} from "../index.js";

const fps2997 = Rational.of(30000, 1001);
const fps24 = Rational.of(24, 1);

test("有理数：29.97fps 的帧长是精确整数 tick，绝不浮点近似", () => {
  assert.equal(ticksPerFrame(fps2997), 8008);
  assert.equal(ticksPerFrame(fps24), 10000);
  for (let f = 0; f < 100000; f++) {
    const t = frameToTick(f, fps2997);
    assert.equal(tickToFrame(t, fps2997), f);
  }
});

test("时间基：常见帧率全部整除 240000 tick/秒", () => {
  for (const r of Object.values({
    a: Rational.of(24000, 1001),
    b: Rational.of(24, 1),
    c: Rational.of(25, 1),
    d: Rational.of(30000, 1001),
    e: Rational.of(30, 1),
    f: Rational.of(50, 1),
    g: Rational.of(60000, 1001),
    h: Rational.of(60, 1)
  })) {
    const tpf = ticksPerFrame(r);
    assert.ok(Number.isInteger(tpf));
    const t = frameToTick(333, r);
    assert.equal(frameToTick(tickToFrame(t, r), r), t);
  }
});

test("音频：48kHz 每采样恰好 5 tick，来回转换不丢精度", () => {
  assert.equal(TICKS_PER_SECOND / 48000, 5);
  assert.equal(sampleToTick(48000, 48000), TICKS_PER_SECOND);
  assert.equal(tickToSample(TICKS_PER_SECOND, 48000), 48000);
});

test("吸附：任意 tick 吸附到 29.97 帧网格", () => {
  assert.equal(snapToFrame(8009, fps2997), 8008);
  assert.equal(snapToFrame(12013, fps2997), 8008 * 2);
});

test("丢帧时间码：1 小时 29.97 丢帧计算", () => {
  const oneHour = TICKS_PER_SECOND * 3600;
  assert.equal(formatTimecode(0, fps2997), "00:00:00;00");
  // 1 分钟处丢 2 帧
  assert.equal(formatTimecode(frameToTick(1798, fps2997), fps2997), "00:01:00;00");
  assert.match(formatTimecode(oneHour, fps2997), /^01:00:00;00$/);
});

function makeDoc(): TimelineDoc {
  return {
    schema: 1,
    fps: "30000/1001",
    tracks: [
      { id: "v1", kind: "video", name: "V1" },
      { id: "a1", kind: "audio", name: "A1" },
      { id: "s1", kind: "subtitle", name: "S1" }
    ],
    clips: [],
    markers: []
  };
}

const media: MediaAsset[] = [
  { id: "m1", name: "a", kind: "video", fps: "30000/1001", duration: 2_400_000, retired: false },
  { id: "m2", name: "b", kind: "video", fps: "30000/1001", duration: 2_400_000, retired: false },
  { id: "m3", name: "music", kind: "audio", fps: "30/1", duration: 6_000_000, sampleRate: 48000, retired: false }
];

const clip = (id: string, trackId: string, start: number, duration: number, mediaId: string | null, extra: Partial<Clip> = {}): Clip => ({
  id,
  trackId,
  start,
  duration,
  mediaId,
  sourceIn: 0,
  name: id,
  keyPoints: [],
  transitionIn: null,
  anchorClipId: null,
  ...extra
});

test("校验：拒绝悬空素材引用与退役素材", () => {
  const doc = makeDoc();
  doc.clips.push(clip("c1", "v1", 0, 100, "missing"));
  assert.ok(validateDoc(doc, media).some((i) => i.code === "MEDIA_NOT_FOUND"));

  const doc2 = makeDoc();
  doc2.clips.push(clip("c1", "v1", 0, 100, "m1"));
  assert.equal(validateDoc(doc2, media).length, 0);

  const retired = media.map((m) => (m.id === "m1" ? { ...m, retired: true } : m));
  assert.ok(validateDoc(doc2, retired).some((i) => i.code === "MEDIA_RETIRED"));
});

test("校验：入出点越界与时长关系", () => {
  const doc = makeDoc();
  doc.clips.push(clip("c1", "v1", 0, 100, "m1", { sourceIn: 2_399_990 }));
  assert.ok(validateDoc(doc, media).some((i) => i.code === "SOURCE_RANGE"));
});

test("校验：转场长于相邻片段必须报错", () => {
  const docBad = makeDoc();
  docBad.clips.push(clip("a", "v1", 0, 24, "m1"));
  docBad.clips.push(clip("b", "v1", 0, 100, "m2", { transitionIn: { type: "dissolve", overlap: 40 } }));
  assert.ok(validateDoc(docBad, media).some((i) => i.code === "TRANSITION_TOO_LONG"), "overlap 40 长于前片 24，必须拒绝");
  // overlap=40，a.duration=80,b.duration=100 -> 合法
  const doc2 = makeDoc();
  doc2.clips.push(clip("a", "v1", 0, 240, "m1"));
  doc2.clips.push(clip("b", "v1", 200, 240, "m2", { transitionIn: { type: "dissolve", overlap: 40 } }));
  assert.equal(validateDoc(doc2, media).length, 0);
});

test("拖动：同轨重叠抛出而非静默覆盖", () => {
  const doc = makeDoc();
  doc.clips.push(clip("a", "v1", 0, 200, "m1"));
  doc.clips.push(clip("b", "v1", 200, 200, "m2"));
  assert.throws(() => applyOp(doc, { type: "moveClip", clipId: "b", start: 100 }), OpError);
});

test("关键点：拖动约束在片段时长内，且操作可逆", () => {
  const doc = makeDoc();
  doc.clips.push(clip("a", "v1", 0, 200, "m1", { keyPoints: [{ id: "k1", at: 50, value: 1 }] }));
  assert.throws(() => applyOp(doc, { type: "dragKeyPoint", clipId: "a", keyPointId: "k1", at: 300 }), OpError);
  const r = applyOp(doc, { type: "dragKeyPoint", clipId: "a", keyPointId: "k1", at: 120 });
  assert.equal(r.doc.clips[0].keyPoints[0].at, 120);
  const back = applyOp(r.doc, r.inverse);
  assert.equal(back.doc.clips[0].keyPoints[0].at, 50);
});

test("删除策略：lift 保留绝对位置与配乐；转场解除", () => {
  const doc = makeDoc();
  doc.clips.push(clip("a", "v1", 0, 240, "m1"));
  doc.clips.push(clip("b", "v1", 200, 240, "m2", { transitionIn: { type: "dissolve", overlap: 40 } }));
  doc.clips.push(clip("c", "v1", 440, 240, "m1"));
  doc.clips.push(clip("mu", "a1", 0, 920, "m3"));
  const plan = planDelete(doc, "b", { mode: "lift", subtitles: "detach", music: "hold" });
  const r = applyOp(doc, plan.op);
  const after = r.doc;
  const c2 = after.clips.find((x) => x.id === "c")!;
  assert.equal(c2.start, 440, "lift 后后续片段绝对位置不变");
  const mu = after.clips.find((x) => x.id === "mu")!;
  assert.equal(mu.start, 0);
  assert.equal(validateDoc(after, media).length, 0);
});

test("删除策略：ripple 闭合、标记/导出同源位移（标准连续片段）", () => {
  const doc = makeDoc();
  doc.clips.push(clip("a", "v1", 0, 240, "m1"));
  doc.clips.push(clip("b", "v1", 240, 240, "m2"));
  doc.clips.push(clip("c", "v1", 480, 240, "m1"));
  doc.markers.push({ id: "mk", at: 600, label: "章节" });
  doc.exportStart = 0;
  doc.exportEnd = 720;
  const plan = planDelete(doc, "b", { mode: "ripple", subtitles: "follow", music: "follow" });
  const r = applyOp(doc, plan.op);
  const after = r.doc;
  assert.equal(after.clips.find((x) => x.id === "c")!.start, 240);
  assert.equal(timelineDuration(after), 480, "波纹缩短 dur=240");
  assert.equal(after.markers[0].at, 360);
  assert.equal(after.exportEnd, 480);
  assert.equal(validateDoc(after, media).length, 0);
  const back = applyOp(after, r.inverse);
  assert.equal(timelineDuration(back.doc), 720);
  assert.equal(back.doc.markers[0].at, 600);
});

test("删除策略：被删片段携带入转场时重叠区保留，闭合不产生非法重叠", () => {
  const doc = makeDoc();
  doc.clips.push(clip("a", "v1", 0, 240, "m1"));
  doc.clips.push(clip("b", "v1", 200, 240, "m2", { transitionIn: { type: "dissolve", overlap: 40 } }));
  doc.clips.push(clip("c", "v1", 440, 240, "m1"));
  const plan = planDelete(doc, "b", { mode: "ripple", subtitles: "follow", music: "follow" });
  const r = applyOp(doc, plan.op);
  const c2 = r.doc.clips.find((x) => x.id === "c")!;
  // 时间 200~240 仍由 a 的内容占据（b 入转场共享区），c 闭合到 a 结束处 240
  assert.equal(c2.start, 240);
  assert.equal(c2.transitionIn, null);
  assert.equal(validateDoc(r.doc, media).length, 0);
  // 撤销恢复
  const back = applyOp(r.doc, r.inverse);
  assert.equal(timelineDuration(back.doc), 680);
});

test("删除策略：后邻携带转场时迁移到新前邻", () => {
  const doc = makeDoc();
  doc.clips.push(clip("a", "v1", 0, 240, "m1"));
  doc.clips.push(clip("b", "v1", 240, 200, "m2"));
  // c 用 40 tick 转场跨入 b
  doc.clips.push(clip("c", "v1", 400, 240, "m1", { transitionIn: { type: "dissolve", overlap: 40 } }));
  const plan = planDelete(doc, "b", { mode: "ripple", subtitles: "follow", music: "follow" });
  const r = applyOp(doc, plan.op);
  const c2 = r.doc.clips.find((x) => x.id === "c")!;
  assert.equal(c2.transitionIn?.overlap, 40, "转场迁移保留");
  assert.equal(c2.start, 200, "迁移后 start = a.end(240) - overlap(40)");
  assert.equal(validateDoc(r.doc, media).length, 0);
});

test("删除策略：转场长于新相邻片段时自动解除", () => {
  const doc = makeDoc();
  doc.clips.push(clip("a", "v1", 0, 24, "m1")); // 很短的新前邻
  doc.clips.push(clip("b", "v1", 24, 240, "m2"));
  doc.clips.push(clip("c", "v1", 264, 240, "m1", { transitionIn: { type: "dissolve", overlap: 64 } }));
  const plan = planDelete(doc, "b", { mode: "ripple", subtitles: "follow", music: "follow" });
  const r = applyOp(doc, plan.op);
  const c2 = r.doc.clips.find((x) => x.id === "c")!;
  assert.equal(c2.transitionIn, null, "64 > 新前邻时长 24，转场必须解除");
  assert.equal(c2.start, 24, "解除后闭合到前邻结束处");
  assert.equal(validateDoc(r.doc, media).length, 0);
});

test("并发：rebase 保持拖动意图（位移叠加）而非最后到达覆盖", () => {
  const base = makeDoc();
  base.clips.push(clip("a", "v1", 0, 100, "m1"));
  base.clips.push(clip("b", "v1", 100, 100, "m2"));
  // 服务端现状：他人把 b 移到了 300
  const current = makeDoc();
  current.clips.push(clip("a", "v1", 0, 100, "m1"));
  current.clips.push(clip("b", "v1", 300, 100, "m2"));
  // 本地基于旧基线把 b 从 100 拖到 500（位移 +400）
  const local = { type: "moveClip" as const, clipId: "b", start: 500 };
  const rb = rebaseOp(local, base, current);
  assert.equal(rb.ok, true);
  assert.equal(rb.op && (rb.op as { start: number }).start, 700);
  // 若他人在目标落点放入了片段：拒绝而不是覆盖
  const blocked = makeDoc();
  blocked.clips.push(clip("a", "v1", 0, 100, "m1"));
  blocked.clips.push(clip("b", "v1", 300, 100, "m2"));
  blocked.clips.push(clip("x", "v1", 600, 200, "m1")); // 重算后 b 目标 700 与 x[600,800) 冲突
  const rb2 = rebaseOp(local, base, blocked);
  assert.equal(rb2.ok, false);
  assert.match(rb2.reason ?? "", /占用|冲突/);
});

test("并发：片段被他人删除后拖动返回 NOT_FOUND", () => {
  const base = makeDoc();
  base.clips.push(clip("a", "v1", 0, 100, "m1"));
  const current = makeDoc();
  const rb = rebaseOp({ type: "moveClip", clipId: "a", start: 50 }, base, current);
  assert.equal(rb.ok, false);
  assert.match(rb.reason ?? "", /删除/);
});
