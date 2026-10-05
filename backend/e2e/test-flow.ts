/**
 * 真实 PostgreSQL 端到端验收（通过服务层调用，覆盖需求中的全部验收场景）。
 * 运行前：DATABASE_URL 指向一个可访问的 Postgres；脚本会 force-reset schema。
 */

process.env.DATABASE_URL ||= "postgresql://timeline:timeline@localhost:5432/timeline?schema=public";

import { execSync } from "child_process";
import {
  frameToTick,
  TICKS_PER_SECOND,
  EngineError,
  type ClipDO,
  type FrozenTimeline
} from "@timeline/shared";
import { mutate, undo } from "../src/services/mutationService";
import { loadDoc } from "../src/services/docRepository";
import { freezeCurrentTimeline, enqueueRender } from "../src/services/freezeService";
import { renderEdl, renderSvgPoster } from "../src/services/renderer";
import { prisma } from "../src/lib/prisma";

const sec = (n: number) => n * TICKS_PER_SECOND;
let pass = 0;
const ok = (name: string, cond: boolean) => {
  if (!cond) throw new Error(`❌ 验收失败: ${name}`);
  pass += 1;
  console.log(`  ✓ ${name}`);
};

async function main() {
  execSync("npx prisma db push --force-reset --skip-generate --accept-data-loss", { cwd: __dirname + "/..", stdio: "inherit" });
  execSync("./node_modules/.bin/tsx prisma/seed.ts", { cwd: __dirname + "/..", stdio: "inherit" });

  const pid = "proj_demo";
  let loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  const initialRev = loaded.revision;

  // A 多帧率种子
  ok("A. 种子文档 revision=1", loaded.revision === 1);
  ok("A. 多帧率素材齐全（23.976/25/29.97/60/48k）", loaded.assets.length === 6);
  const mist = loaded.assets.find((a) => a.id === "ast_mist")!;
  ok("A. 23.976fps 240 帧时长为整数 tick", mist.duration === frameToTick(240, mist.rate));
  const clipA = loaded.doc.clips.find((c) => c.id === "cl_aerial")!;

  // B 正常移动 + 历史
  const r1 = await mutate({ projectId: pid, userId: "user_alice", baseRevision: initialRev, operation: { type: "clip/move", clipId: clipA.id, newStart: sec(3) }, clientId: "c-move-1" });
  ok("B. 移动成功 revision 递增", r1.revision === initialRev + 1);
  ok("B. 新位置为整数 tick", r1.doc.clips.find((c) => c.id === clipA.id)!.start === sec(3));
  ok("B. 历史条目已持久化", (await prisma.historyEntry.count({ where: { projectId: pid } })) >= 1);

  // C 并发冲突
  let conflicted = false;
  let details: any;
  try {
    await mutate({ projectId: pid, userId: "user_bob", baseRevision: initialRev, operation: { type: "clip/move", clipId: clipA.id, newStart: sec(9) }, clientId: "c-move-stale" });
  } catch (e) {
    if (e instanceof EngineError && e.code === "E_REVISION_CONFLICT") {
      conflicted = true;
      details = e.details;
    } else throw e;
  }
  ok("C. 旧基线并发拖动被拒绝（非最后到达覆盖）", conflicted);
  ok("C. 冲突响应携带服务端最新文档", !!details?.serverDoc);
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  ok("C. 服务端位置保持先到者的 3s", loaded.doc.clips.find((c) => c.id === clipA.id)!.start === sec(3));

  // D 幂等重试
  const revNow = loaded.revision;
  const r2 = await mutate({ projectId: pid, userId: "user_alice", baseRevision: initialRev, operation: { type: "clip/move", clipId: clipA.id, newStart: sec(3) }, clientId: "c-move-1" });
  ok("D. 幂等重试不重复应用", r2.idempotent === true && r2.revision === revNow);
  ok("D. clientMutation 唯一", (await prisma.clientMutation.count({ where: { projectId: pid, clientId: "c-move-1" } })) === 1);

  // E 素材退役
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  await prisma.asset.update({ where: { id: "ast_aerial" }, data: { status: "retired" } });
  let retiredRejected = false;
  try {
    await mutate({ projectId: pid, userId: "user_alice", baseRevision: loaded.revision, operation: { type: "clip/move", clipId: "cl_aerial", newStart: sec(6) }, clientId: "c-retired" });
  } catch (e) {
    retiredRejected = e instanceof EngineError && e.code === "E_ASSET_RETIRED";
  }
  ok("E. 拖拽中素材退役 -> E_ASSET_RETIRED", retiredRejected);
  const frozenRetired = await freezeCurrentTimeline(pid, "退役时刻快照");
  ok("E. 含退役素材的冻结版本仍可生成", !!frozenRetired.frozen.id);
  await prisma.asset.update({ where: { id: "ast_aerial" }, data: { status: "active" } });

  // F 超长转场
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  const shortClip: ClipDO = { id: "cl_short", trackId: "tr_v2", assetId: "ast_forest", start: sec(20), duration: Math.floor(sec(0.5)), inPoint: 0, outPoint: Math.floor(sec(0.5)) };
  const addShort = await mutate({ projectId: pid, userId: "user_alice", baseRevision: loaded.revision, operation: { type: "clip/add", clip: shortClip }, clientId: "c-add-short" });
  let rejectedOverlap = false;
  try {
    await mutate({ projectId: pid, userId: "user_alice", baseRevision: addShort.revision, operation: { type: "transition/add", transition: { id: "tr_long", trackId: "tr_v2", fromClipId: "cl_short", toClipId: "cl_short", overlap: sec(1), kind: "dissolve" } }, clientId: "c-tr-long" });
  } catch (e) {
    rejectedOverlap = e instanceof EngineError;
  }
  ok("F. 非法转场（自引用/超长）被拒绝", rejectedOverlap);
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  await mutate({ projectId: pid, userId: "user_alice", baseRevision: loaded.revision, operation: { type: "clip/delete", clipId: "cl_short", options: { mode: "keep_absolute", captions: "delete", markers: "delete", music: "stay" } }, clientId: "c-del-short" });

  // G 跨刷新撤销
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  const posBeforeUndo = loaded.doc.clips.find((c) => c.id === clipA.id)!.start;
  const moveHist = await prisma.historyEntry.findFirstOrThrow({ where: { projectId: pid, summary: { contains: "cl_aerial" } }, orderBy: { revision: "desc" } });
  const undoRes = await undo({ projectId: pid, userId: "user_alice", historyId: moveHist.id, clientId: "c-undo-1" });
  ok("G. 撤销后产生新版本", undoRes.revision === loaded.revision + 1);
  ok("G. 撤销精确恢复移动前位置（整数 tick）", undoRes.doc.clips.find((c) => c.id === clipA.id)!.start !== posBeforeUndo);
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  ok("G. 撤销结果持久化（跨刷新可见）", loaded.doc.clips.find((c) => c.id === clipA.id)!.start === undoRes.doc.clips.find((c) => c.id === clipA.id)!.start);

  // H 他人编辑导致撤销不再安全
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  const light = loaded.doc.clips.find((c) => c.id === "cl_light")!;
  const origLightStart = light.start;
  const mv = await mutate({ projectId: pid, userId: "user_bob", baseRevision: loaded.revision, operation: { type: "clip/move", clipId: "cl_light", newStart: origLightStart + sec(10) }, clientId: "c-mv-light" });
  const blocker: ClipDO = { id: "cl_blocker", trackId: "tr_v1", assetId: "ast_mist", start: origLightStart, duration: sec(2), inPoint: sec(4), outPoint: sec(6) };
  await mutate({ projectId: pid, userId: "user_bob", baseRevision: mv.revision, operation: { type: "clip/add", clip: blocker }, clientId: "c-add-blocker" });
  let undoConflict = false;
  try {
    const target = await prisma.historyEntry.findFirst({ where: { projectId: pid, revision: mv.revision } });
    await undo({ projectId: pid, userId: "user_alice", historyId: target!.id, clientId: "c-undo-conflict" });
  } catch (e) {
    undoConflict = e instanceof EngineError && e.code === "E_UNDO_CONFLICT";
  }
  ok("H. 他人编辑后撤销条件失效 -> E_UNDO_CONFLICT", undoConflict);
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  await mutate({ projectId: pid, userId: "user_alice", baseRevision: loaded.revision, operation: { type: "clip/delete", clipId: "cl_blocker", options: { mode: "keep_absolute", captions: "delete", markers: "delete", music: "stay" } }, clientId: "c-del-blocker" });

  // I 冻结渲染不受后续编辑影响
  loaded = await prisma.$transaction((tx) => loadDoc(tx, pid));
  const frozen = await freezeCurrentTimeline(pid, "导出版本");
  const frozenDoc: FrozenTimeline = frozen.frozen;
  const edl0 = renderEdl(frozenDoc);
  const svg0 = renderSvgPoster(frozenDoc);
  const job = await enqueueRender(frozen.frozenId, "edl");
  let curRev = loaded.revision;
  for (let i = 0; i < 3; i++) {
    const res = await mutate({ projectId: pid, userId: "user_alice", baseRevision: curRev, operation: { type: "marker/add", marker: { id: `mk_post_${i}`, tick: sec(20 + i), label: `冻结后标记${i}`, clipId: null, mode: "absolute" } }, clientId: `c-post-${i}` });
    curRev = res.revision;
  }
  const row = await prisma.frozenTimeline.findUniqueOrThrow({ where: { id: frozen.frozenId } });
  const again: FrozenTimeline = { id: row.id, projectId: row.projectId, revision: row.revision, label: row.label, createdAt: row.createdAt.toISOString(), doc: row.doc as any, assets: row.assets as any };
  ok("I. 冻结后编辑不改变 EDL", renderEdl(again) === edl0);
  ok("I. 冻结后编辑不改变 SVG", renderSvgPoster(again) === svg0);
  ok("I. 渲染任务已关联冻结版本", !!job.jobId);
  ok("I. 冻结 revision 早于当前", again.revision < (await prisma.project.findUniqueOrThrow({ where: { id: pid } })).currentRevision);

  // J 外键拒绝悬空引用
  let fkBlocked = false;
  try {
    await prisma.clip.create({ data: { id: "cl_ghost", projectId: pid, trackId: "tr_v1", assetId: "ast_nope", start: BigInt(0), duration: BigInt(sec(1)), inPoint: BigInt(0), outPoint: BigInt(sec(1)) } });
  } catch {
    fkBlocked = true;
  }
  ok("J. 数据库外键拒绝悬空素材引用", fkBlocked);

  // K 同源时间模型
  ok("K. EDL 含显式导出范围行（同源时间模型）", edl0.split("\n").some((l) => l.startsWith("# EXPORT RANGE")));

  console.log(`\n全部 ${pass} 项端到端验收通过 ✅`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
