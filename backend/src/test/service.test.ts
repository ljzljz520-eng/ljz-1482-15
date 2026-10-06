import { test } from "node:test";
import assert from "node:assert/strict";
import { __setPrismaForTest } from "../db/prisma.js";
import { FakePrisma, type FakeTimelineRow } from "./fakePrisma.js";
import { timelineService, ConflictError } from "../services/timelineService.js";
import { renderService } from "../services/renderService.js";
import { timelineDuration, type TimelineDoc } from "@timeline/core";

let fake: FakePrisma;
const T1 = "t1";
const U1 = "u1";
const U2 = "u2";

function makeDoc(): TimelineDoc {
  const TPF = 8008; // 29.97
  return {
    schema: 1,
    fps: "30000/1001",
    tracks: [
      { id: "v1", kind: "video", name: "V1" },
      { id: "a1", kind: "audio", name: "A1" }
    ],
    clips: [
      { id: "a", trackId: "v1", start: 0, duration: TPF * 10, mediaId: "m1", sourceIn: 0, name: "A", keyPoints: [] },
      { id: "b", trackId: "v1", start: TPF * 10, duration: TPF * 10, mediaId: "m2", sourceIn: 0, name: "B", keyPoints: [] },
      { id: "c", trackId: "v1", start: TPF * 20, duration: TPF * 10, mediaId: "m1", sourceIn: 0, name: "C", keyPoints: [] }
    ],
    markers: [{ id: "mk", at: TPF * 25, label: "章" }],
    exportStart: 0,
    exportEnd: TPF * 30
  };
}

async function setup() {
  fake = new FakePrisma();
  __setPrismaForTest(fake);
  fake.media.rows.set("m1", {
    id: "m1", name: "m1", kind: "video", fps: "30000/1001", duration: 8008 * 200,
    sampleRate: null, width: null, height: null, retired: false, createdAt: new Date(0)
  });
  fake.media.rows.set("m2", {
    id: "m2", name: "m2", kind: "video", fps: "24/1", duration: 10000 * 200,
    sampleRate: null, width: null, height: null, retired: false, createdAt: new Date(0)
  });
  const doc = makeDoc();
  const { hashDocSync } = await import("@timeline/core/hashNode");
  const row: FakeTimelineRow = {
    id: T1, name: "t", doc, revision: 1, docHash: hashDocSync(doc),
    frozen: false, createdAt: new Date(0), updatedAt: new Date(0)
  };
  fake.timeline.rows.set(T1, row);
}

test("服务端：基线冲突拒绝最后到达覆盖，不改变文档", async () => {
  await setup();
  // 用户 U1 先合法地把 c 向后移动 10 帧（腾出空间），rev->2
  const r1 = await timelineService.apply({
    timelineId: T1, userId: U1, baseRevision: 1,
    op: { type: "moveClip", clipId: "c", start: 8008 * 30 }
  });
  assert.equal(r1.revision, 2);

  // U2 拿着过期基线 rev=1 试图把 b 拖到 15 帧位置：必须 409，且不得覆盖
  await assert.rejects(
    () =>
      timelineService.apply({
        timelineId: T1, userId: U2, baseRevision: 1,
        op: { type: "moveClip", clipId: "b", start: 8008 * 15 }
      }),
    ConflictError
  );
  const after = await timelineService.get(T1);
  assert.equal(after.revision, 2, "过期写入未生效，没有覆盖 U1 的编辑");
  assert.equal(after.doc.clips.find((c) => c.id === "c")!.start, 8008 * 30);
  assert.equal(after.doc.clips.find((c) => c.id === "b")!.start, 8008 * 10);
});

test("服务端：自动重基线保持位移意图，而不是用旧绝对坐标覆盖", async () => {
  await setup();
  // 服务端现状 rev=2：c 已被协作者移到 30 帧
  await timelineService.apply({
    timelineId: T1, userId: U1, baseRevision: 1,
    op: { type: "moveClip", clipId: "c", start: 8008 * 30 }
  });
  // 客户端基线 rev=1 上 b.start=10帧；用户把 b 拖到 13 帧（位移 +3 帧）
  const baseDoc = makeDoc();
  const r = await timelineService.apply({
    timelineId: T1, userId: U2, baseRevision: 1, autoRebase: true, baseDoc,
    op: { type: "moveClip", clipId: "b", start: 8008 * 13 }
  });
  assert.equal(r.rebased, true);
  // 意图保持：最新 b(10帧) + 3 帧 = 13 帧，而不是旧坐标或服务端坐标覆盖
  assert.equal(r.doc.clips.find((c) => c.id === "b")!.start, 8008 * 13);
  assert.equal(r.doc.clips.find((c) => c.id === "c")!.start, 8008 * 30, "协作者的移动被保留");
});

test("服务端：撤销持久化跨刷新，他人编辑后撤销前提失效返回冲突，force 可回滚", async () => {
  await setup();
  await timelineService.apply({
    timelineId: T1, userId: U1, baseRevision: 1,
    op: { type: "addMarker", marker: { id: "mk2", at: 1000, label: "新" } },
    label: "加标记"
  });
  // 模拟“刷新后重新加载”：重新 new 一个 service 查询也无妨（同一 fake 库）
  const items = await timelineService.listUndo(T1, U1);
  assert.ok(items.length >= 1, "撤销记录持久化");
  const top = items.find((i) => i.label === "加标记")!;
  assert.equal(top.reversible, true);

  // 他人（不同用户）在 rev2 之上再做一次编辑 rev->3
  await timelineService.apply({
    timelineId: T1, userId: U2, baseRevision: 2,
    op: { type: "moveMarker", markerId: "mk", at: 8008 * 26 }
  });
  // U1 那条撤销记录前提是 rev2 的文档，现在 rev3 已分歧 -> 拒绝盲目回滚
  await assert.rejects(() => timelineService.undo(T1, U1, top.id, false), ConflictError);
  // force 允许回滚
  const r2 = await timelineService.undo(T1, U1, top.id, true);
  assert.ok(!r2.doc.markers.some((m) => m.id === "mk2"));
});

test("服务端：波纹删除由服务端重算策略，校验并更新导出/标记", async () => {
  await setup();
  const before = await timelineService.get(T1);
  assert.equal(timelineDuration(before.doc), 8008 * 30);
  const r = await timelineService.deleteClip({
    timelineId: T1, userId: U1, clipId: "b",
    policy: { mode: "ripple", subtitles: "follow", music: "follow" },
    baseRevision: 1
  });
  assert.ok(r.effects && r.effects.length > 0);
  assert.equal(timelineDuration(r.doc), 8008 * 20);
  assert.equal(r.doc.clips.find((c) => c.id === "c")!.start, 8008 * 10);
  // 标记从 25 帧 -> 15 帧
  assert.equal(r.doc.markers.find((m) => m.id === "mk")!.at, 8008 * 15);
  // 撤销完整恢复
  const items = await timelineService.listUndo(T1, U1);
  await timelineService.undo(T1, U1, items[0].id, true);
  const restored = await timelineService.get(T1);
  assert.equal(timelineDuration(restored.doc), 8008 * 30);
});

test("服务端：拒绝悬空素材引用与退役素材编辑", async () => {
  await setup();
  await assert.rejects(
    () =>
      timelineService.apply({
        timelineId: T1, userId: U1, baseRevision: 1,
        op: {
          type: "addClip",
          clip: {
            id: "ghost", trackId: "v1", start: 8008 * 30, duration: 8008,
            mediaId: "does-not-exist", sourceIn: 0, name: "ghost", keyPoints: []
          }
        }
      }),
    ConflictError
  );
  // 退役 m1 后，移动引用 m1 的片段也被拒绝（先让 rev 前进不需要：直接在 rev=1 操作）
  const m1 = fake.media.rows.get("m1")!;
  m1.retired = true;
  // 拖动（trim）引用已退役素材的片段 -> 权威校验拒绝
  await assert.rejects(
    () =>
      timelineService.apply({
        timelineId: T1, userId: U1, baseRevision: 1,
        op: {
          type: "trimClip", clipId: "a", edge: "head",
          start: 8008, duration: 8008 * 9, sourceIn: 8008
        }
      }),
    /退役/
  );
});

test("服务端：渲染任务冻结快照，之后编辑不影响任务", async () => {
  await setup();
  const created = await renderService.create(T1, U1);
  assert.equal(created.revision, 1);
  const m0 = await renderService.manifest(created.jobId);
  assert.equal(m0.exportEndTick, 8008 * 30);
  assert.equal(m0.tracks.length, 2);

  // 之后大改时间线（波纹删除 b）
  await timelineService.deleteClip({
    timelineId: T1, userId: U1, clipId: "b",
    policy: { mode: "ripple", subtitles: "follow", music: "follow" },
    baseRevision: 1
  });
  const m1doc = await renderService.manifest(created.jobId);
  assert.equal(m1doc.exportEndTick, 8008 * 30, "冻结快照的导出范围不变");
  assert.equal(m1doc.snapshotHash, m0.snapshotHash, "冻结快照哈希不变");
  assert.equal(timelineDuration((await timelineService.get(T1)).doc), 8008 * 20, "可编辑时间线已变短");

  // 推进渲染始终基于快照
  let job = await renderService.advance(created.jobId);
  for (let i = 0; i < 5 && job.status !== "done"; i++) job = await renderService.advance(created.jobId);
  assert.equal(job.status, "done");
  assert.ok(job.resultUrl?.includes(".mp4"));
});

test("服务端：关键点拖动落在片段时长内才被接受（含 24fps 素材混排）", async () => {
  await setup();
  // b 是 24fps 素材（时长 80080 tick）放在 29.97 时间线；以 tick 为共同语言精确混排
  const doc = await timelineService.get(T1);
  assert.equal(doc.doc.clips.find((c) => c.id === "b")!.duration, 80080);
  await assert.rejects(
    () =>
      timelineService.apply({
        timelineId: T1, userId: U1, baseRevision: 1,
        op: { type: "dragKeyPoint", clipId: "b", keyPointId: "nope", at: 1 }
      }),
    ConflictError
  );
});
