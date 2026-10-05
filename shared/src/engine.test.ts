import { describe, it, expect } from "vitest";
import {
  TICKS_PER_SECOND,
  RATE_23976,
  RATE_25,
  RATE_2997,
  RATE_5994,
  frameToTick,
  tickToFrame,
  snapTickToFrame,
  type AssetDO,
  type TimelineDoc,
  type ClipDO,
  applyOperation,
  validateDoc,
  EngineError,
  timelineContentEnd,
  resolveMarkers,
  exportRange,
  previewTotalTicks,
  applyPatch,
  invertPatch,
  detectClipMoveConflict,
  RATE_AUDIO_48K,
  type AudioClipDO
} from "./index";

function makeAsset(over: Partial<AssetDO> = {}): AssetDO {
  return {
    id: over.id ?? "ast_1",
    kind: over.kind ?? "video",
    name: over.name ?? "测试素材",
    rate: over.rate ?? RATE_25,
    duration: over.duration ?? 10 * TICKS_PER_SECOND,
    status: over.status ?? "active",
    width: over.width,
    height: over.height
  };
}

function makeDoc(over: Partial<TimelineDoc> = {}): TimelineDoc {
  return {
    revision: over.revision ?? 1,
    timebase: TICKS_PER_SECOND,
    rate: over.rate ?? RATE_25,
    exportStart: over.exportStart ?? 0,
    exportEnd: over.exportEnd ?? null,
    tracks: over.tracks ?? [
      { id: "tr_v1", kind: "video", name: "V1", locked: false },
      { id: "tr_v2", kind: "video", name: "V2", locked: false },
      { id: "tr_a1", kind: "audio", name: "A1", locked: false }
    ],
    clips: over.clips ?? [],
    transitions: over.transitions ?? [],
    keyframes: over.keyframes ?? [],
    markers: over.markers ?? [],
    captions: over.captions ?? [],
    audioClips: over.audioClips ?? []
  };
}

function makeClip(over: Partial<ClipDO> = {}): ClipDO {
  const start = over.start ?? 0;
  const duration = over.duration ?? TICKS_PER_SECOND;
  const inPoint = over.inPoint ?? 0;
  const outPoint = over.outPoint ?? duration;
  return {
    id: over.id ?? "cl_1",
    trackId: over.trackId ?? "tr_v1",
    assetId: over.assetId ?? "ast_1",
    start,
    duration,
    inPoint,
    outPoint
  };
}

function assetMap(...assets: AssetDO[]) {
  return new Map(assets.map((a) => [a.id, a]));
}

const sec = (n: number) => n * TICKS_PER_SECOND;

describe("时间基：不同帧率素材的整数/有理数换算", () => {
  it("23.976fps 与 29.97fps 往返一致，不使用浮点秒累加", () => {
    for (const rate of [RATE_23976, RATE_25, RATE_2997, RATE_5994]) {
      for (const f of [0, 1, 2, 23, 24, 99, 1000]) {
        const t = frameToTick(f, rate);
        expect(Number.isInteger(t)).toBe(true);
        // tickToTick 的帧起点再换算应回到同一帧
        expect(tickToFrame(t, rate)).toBe(f);
      }
    }
  });

  it("两帧之间的 tick 吸附到帧格起点（确定性 floor）", () => {
    const rate = RATE_23976;
    const t0 = frameToTick(10, rate);
    const t1 = frameToTick(11, rate);
    const mid = t0 + Math.floor((t1 - t0) / 2);
    expect(snapTickToFrame(mid, rate)).toBe(t0);
    expect(snapTickToFrame(t1, rate)).toBe(t1);
  });

  it("NTSC 帧间隔正确（24000/1001 ≈ 41.708ms）", () => {
    const gap = frameToTick(2, RATE_23976) - frameToTick(1, RATE_23976);
    expect(gap).toBe(41708333); // ns，整数
  });

  it("48kHz 音频采样位置使用同一套 tick 整数运算", () => {
    // 1 个 48k 采样点
    expect(frameToTick(48000, RATE_AUDIO_48K)).toBe(sec(1));
    expect(tickToFrame(sec(1), RATE_AUDIO_48K)).toBe(48000);
  });
});

describe("删除语义：波纹 / 保留绝对位置 / 提升", () => {
  function threeClipsDoc(): { doc: TimelineDoc; assets: Map<string, AssetDO> } {
    const doc = makeDoc({
      clips: [
        makeClip({ id: "a", start: 0, duration: sec(2) }),
        makeClip({ id: "b", start: sec(2), duration: sec(3) }),
        makeClip({ id: "c", start: sec(5), duration: sec(1) })
      ],
      markers: [
        { id: "m_b", tick: sec(1), label: "B上的标记", clipId: "b", mode: "clip" },
        { id: "m_abs", tick: sec(6), label: "绝对标记", clipId: null, mode: "absolute" }
      ],
      captions: [
        { id: "cap_b", text: "B字幕", mode: "clip", clipId: "b", offset: sec(1), absoluteTick: 0 },
        { id: "cap_abs", text: "绝对字幕", mode: "absolute", clipId: null, offset: 0, absoluteTick: sec(7) }
      ],
      audioClips: [
        { id: "au", trackId: "tr_a1", assetId: "ast_music", start: sec(4), duration: sec(4), inPoint: 0, gain: 1 }
      ]
    });
    const assets = assetMap(makeAsset({ id: "ast_1", duration: sec(10) }), makeAsset({ id: "ast_music", kind: "audio", duration: sec(20), rate: RATE_AUDIO_48K }));
    return { doc, assets };
  }

  it("ripple 删除中间片段：右侧片段/绝对标记/绝对字幕按整数 tick 左移，配乐可选跟随", () => {
    const { doc, assets } = threeClipsDoc();
    const r = applyOperation(doc, assets, {
      type: "clip/delete",
      clipId: "b",
      options: { mode: "ripple", captions: "detach", markers: "detach", music: "ripple" }
    });
    const c = r.doc.clips.find((x) => x.id === "c")!;
    expect(c.start).toBe(sec(2)); // 5 - 3
    const mAbs = r.doc.markers.find((x) => x.id === "m_abs")!;
    expect(mAbs.tick).toBe(sec(3)); // 6 - 3，脱钩后仍为绝对
    const capDetached = r.doc.captions.find((x) => x.id === "cap_b")!;
    expect(capDetached.mode).toBe("absolute");
    expect(capDetached.absoluteTick).toBe(sec(3)); // b.start 2 + offset 1
    const capAbs = r.doc.captions.find((x) => x.id === "cap_abs")!;
    expect(capAbs.absoluteTick).toBe(sec(4)); // 7 - 3
    const au = r.doc.audioClips.find((x) => x.id === "au")!;
    expect(au.start).toBe(sec(1)); // 4 - 3 配乐跟随
    expect(timelineContentEnd(r.doc)).toBe(sec(5)); // 无缝后总长 2+1 与音频 5
  });

  it("ripple + music=stay：配乐保留绝对位置", () => {
    const { doc, assets } = threeClipsDoc();
    const r = applyOperation(doc, assets, {
      type: "clip/delete",
      clipId: "b",
      options: { mode: "ripple", captions: "delete", markers: "delete", music: "stay" }
    });
    expect(r.doc.captions.some((x) => x.id === "cap_b")).toBe(false);
    expect(r.doc.markers.some((x) => x.id === "m_b")).toBe(false);
    expect(r.doc.audioClips.find((x) => x.id === "au")!.start).toBe(sec(4));
  });

  it("keep_absolute / lift：除目标片段外一切不动", () => {
    const { doc, assets } = threeClipsDoc();
    const r = applyOperation(doc, assets, {
      type: "clip/delete",
      clipId: "b",
      options: { mode: "keep_absolute", captions: "detach", markers: "detach", music: "stay" }
    });
    expect(r.doc.clips.find((x) => x.id === "c")!.start).toBe(sec(5));
    expect(r.doc.audioClips.find((x) => x.id === "au")!.start).toBe(sec(4));
    expect(r.doc.markers.find((x) => x.id === "m_abs")!.tick).toBe(sec(6));
  });

  it("锚定字幕策略 delete 会删除跟随片段的子标题", () => {
    const { doc, assets } = threeClipsDoc();
    const r = applyOperation(doc, assets, {
      type: "clip/delete",
      clipId: "b",
      options: { mode: "ripple", captions: "delete", markers: "delete", music: "stay" }
    });
    expect(r.doc.captions.find((x) => x.id === "cap_b")).toBeUndefined();
  });
});

describe("转场重叠", () => {
  function transitionDoc(overlap: number, bStart?: number) {
    const doc = makeDoc({
      clips: [
        makeClip({ id: "a", start: 0, duration: sec(4) }),
        makeClip({ id: "b", start: bStart ?? sec(4) - overlap, duration: sec(4) })
      ],
      transitions: [
        { id: "tr", trackId: "tr_v1", fromClipId: "a", toClipId: "b", overlap, kind: "dissolve" }
      ]
    });
    return doc;
  }

  it("合法转场：片段重叠长度必须精确等于 overlap", () => {
    const doc = transitionDoc(sec(1));
    expect(() => validateDoc(doc, { assets: assetMap(makeAsset()) })).not.toThrow();
  });

  it("验收：转场长于相邻片段 -> 拒绝", () => {
    // a 只有 0.5s，转场要 1s
    const doc = makeDoc({
      clips: [
        makeClip({ id: "a", start: 0, duration: Math.floor(sec(0.5)) }),
        makeClip({ id: "b", start: 0, duration: sec(2) })
      ],
      transitions: [
        { id: "tr", trackId: "tr_v1", fromClipId: "a", toClipId: "b", overlap: sec(1), kind: "dissolve" }
      ]
    });
    expect(() => validateDoc(doc, { assets: assetMap(makeAsset()) })).toThrowError(/长于相邻片段/);
  });

  it("重叠长度与 overlap 不一致 -> 拒绝（不能靠浮点秒随意累加）", () => {
    const doc = transitionDoc(sec(1), sec(3)); // 实际重叠 1s，但 b 放在 3s -> 重叠 1s 正确
    validateDoc(doc, { assets: assetMap(makeAsset()) });
    const bad = transitionDoc(sec(1), sec(3) + 1); // 实际重叠 < overlap
    expect(() => validateDoc(bad, { assets: assetMap(makeAsset()) })).toThrowError(/非法重叠|必须等于/);
  });

  it("无转场覆盖的同轨重叠 -> 拒绝", () => {
    const doc = makeDoc({
      clips: [makeClip({ id: "a", start: 0, duration: sec(2) }), makeClip({ id: "b", start: sec(1), duration: sec(2) })]
    });
    expect(() => validateDoc(doc, { assets: assetMap(makeAsset()) })).toThrowError(/非法重叠/);
  });

  it("两侧都有转场时波纹删除：左右邻居以交叉淡化精确接合", () => {
    // a[0,5] b[4,9]（重叠1）c[8,12]（重叠1）；删除 b 后 a 与 c 应以 1s crossfade 接合
    const doc = makeDoc({
      clips: [
        makeClip({ id: "a", start: 0, duration: sec(5) }),
        makeClip({ id: "b", start: sec(4), duration: sec(5) }),
        makeClip({ id: "c", start: sec(8), duration: sec(4) })
      ],
      transitions: [
        { id: "tr_ab", trackId: "tr_v1", fromClipId: "a", toClipId: "b", overlap: sec(1), kind: "dissolve" },
        { id: "tr_bc", trackId: "tr_v1", fromClipId: "b", toClipId: "c", overlap: sec(1), kind: "dissolve" }
      ]
    });
    const r = applyOperation(doc, assetMap(makeAsset()), {
      type: "clip/delete",
      clipId: "b",
      options: { mode: "ripple", captions: "delete", markers: "delete", music: "stay" }
    });
    expect(r.doc.transitions).toHaveLength(1);
    const jt = r.doc.transitions[0];
    expect(jt.kind).toBe("crossfade");
    expect(jt.overlap).toBe(sec(1));
    const c = r.doc.clips.find((x) => x.id === "c")!;
    // a 末端=5；c 起点=5-1=4，c 末端=8
    expect(c.start).toBe(sec(4));
    expect(c.start + c.duration).toBe(sec(8));
    validateDoc(r.doc, { assets: assetMap(makeAsset()) });
  });

  it("波纹删除带转场片段时，先拆转场，右移距离 = 时长 - 重叠", () => {
    const doc = transitionDoc(sec(1)); // a[0,4], b[3,7], 重叠 1
    const r = applyOperation(doc, assetMap(makeAsset()), {
      type: "clip/delete",
      clipId: "a",
      options: { mode: "ripple", captions: "delete", markers: "delete", music: "stay" }
    });
    expect(r.doc.transitions).toHaveLength(0);
    expect(r.doc.clips[0].start).toBe(0); // b 起点 3 - (4-1)=0
    expect(timelineContentEnd(r.doc)).toBe(sec(4));
  });
});

describe("素材入出点（不同帧率素材）", () => {
  it("片段时长必须精确等于 outPoint-inPoint，禁止漂移缩放", () => {
    const doc = makeDoc({
      clips: [makeClip({ id: "a", duration: sec(1), inPoint: 0, outPoint: sec(1) + 1 })]
    });
    expect(() => validateDoc(doc, { assets: assetMap(makeAsset({ rate: RATE_23976 })) })).toThrowError(/时长必须等于/);
  });

  it("出点超出素材长度 -> 拒绝", () => {
    const doc = makeDoc({
      clips: [makeClip({ id: "a", duration: sec(2), inPoint: sec(9), outPoint: sec(11) })]
    });
    expect(() => validateDoc(doc, { assets: assetMap(makeAsset({ duration: sec(10) })) })).toThrowError(/超出素材长度/);
  });

  it("裁剪时关键点越界 -> 拒绝", () => {
    const doc = makeDoc({
      clips: [makeClip({ id: "a", duration: sec(4) })],
      keyframes: [{ id: "k", clipId: "a", offset: sec(3), property: "opacity", value: 1 }]
    });
    expect(() =>
      applyOperation(doc, assetMap(makeAsset()), {
        type: "clip/trim",
        clipId: "a",
        end: sec(2)
      })
    ).toThrowError(/关键点/);
  });
});

describe("验收：拖拽中素材被退役", () => {
  it("引用已退役素材的任何新编辑都返回 E_ASSET_RETIRED", () => {
    const doc = makeDoc({ clips: [makeClip({ id: "a", start: 0, duration: sec(2) })] });
    const assets = assetMap(makeAsset({ status: "retired" }));
    expect(() =>
      applyOperation(doc, assets, { type: "clip/move", clipId: "a", newStart: sec(5) })
    ).toThrowError(/已被退役|素材/);
  });

  it("添加片段引用退役素材也被拒绝；冻结版本不要求 active（渲染可继续）", () => {
    const doc = makeDoc();
    const assets = assetMap(makeAsset({ status: "retired" }));
    expect(() =>
      applyOperation(doc, assets, { type: "clip/add", clip: makeClip({ id: "x" }) })
    ).toThrowError(EngineError);
    const frozen = makeDoc({ clips: [makeClip({ id: "a" })] });
    expect(() => validateDoc(frozen, { assets, requireActiveAsset: false })).not.toThrow();
  });
});

describe("悬空引用", () => {
  it("片段引用不存在的素材/轨道 -> 拒绝", () => {
    const doc = makeDoc({ clips: [makeClip({ assetId: "ghost", trackId: "nope" })] });
    expect(() => validateDoc(doc, { assets: assetMap(makeAsset()) })).toThrowError(/悬空/);
  });
  it("关键点引用不存在的片段 -> 拒绝", () => {
    const doc = makeDoc({
      keyframes: [{ id: "k", clipId: "ghost", offset: 0, property: "x", value: 0 }]
    });
    expect(() => validateDoc(doc, { assets: assetMap(makeAsset()) })).toThrowError(/悬空/);
  });
});

describe("并发拖动：基线冲突，不能最后到达覆盖", () => {
  it("他人已移动同一片段 -> 检测冲突", () => {
    const base = makeDoc({ revision: 10, clips: [makeClip({ id: "a", start: 0, duration: sec(2) })] });
    const latest = makeDoc({ revision: 11, clips: [makeClip({ id: "a", start: sec(4), duration: sec(2) })] });
    const d = detectClipMoveConflict({ baseDoc: base, latestDoc: latest, clipId: "a" });
    expect(d.conflict).toBe(true);
    expect(d.reason).toContain("位置");
  });
  it("他人删除片段 -> 冲突", () => {
    const base = makeDoc({ clips: [makeClip({ id: "a" })] });
    const latest = makeDoc({ clips: [] });
    expect(detectClipMoveConflict({ baseDoc: base, latestDoc: latest, clipId: "a" }).conflict).toBe(true);
  });
  it("他人只改了别的片段 -> 无冲突", () => {
    const base = makeDoc({ clips: [makeClip({ id: "a" }), makeClip({ id: "b", start: sec(5) })] });
    const latest = makeDoc({ clips: [makeClip({ id: "a" }), makeClip({ id: "b", start: sec(6) })] });
    expect(detectClipMoveConflict({ baseDoc: base, latestDoc: latest, clipId: "a" }).conflict).toBe(false);
  });
});

describe("撤销：逆向补丁 + 他人编辑后重算可逆条件", () => {
  it("move 后应用逆向补丁精确恢复（整数 tick）", () => {
    const doc = makeDoc({ clips: [makeClip({ id: "a", start: 0, duration: sec(2) })] });
    const r = applyOperation(doc, assetMap(makeAsset()), { type: "clip/move", clipId: "a", newStart: sec(3) });
    const undone = applyPatch(r.doc, invertPatch(r.patch));
    expect(undone.clips[0].start).toBe(0);
  });

  it("波纹删除的逆向补丁恢复片段、转场、字幕、配乐全部位置", () => {
    const doc = makeDoc({
      clips: [
        makeClip({ id: "a", start: 0, duration: sec(2) }),
        makeClip({ id: "b", start: sec(1), duration: sec(3) }),
        makeClip({ id: "c", start: sec(4), duration: sec(2) })
      ],
      transitions: [{ id: "tr1", trackId: "tr_v1", fromClipId: "a", toClipId: "b", overlap: sec(1), kind: "x" }],
      keyframes: [{ id: "k", clipId: "b", offset: sec(1), property: "p", value: 1 }],
      captions: [{ id: "cap", text: "t", mode: "clip", clipId: "b", offset: sec(1), absoluteTick: 0 }],
      audioClips: [{ id: "au", trackId: "tr_a1", assetId: "ast_m", start: sec(3), duration: sec(3), inPoint: 0, gain: 1 }]
    });
    const assets = assetMap(makeAsset({ id: "ast_1" }), makeAsset({ id: "ast_m", kind: "audio", rate: RATE_AUDIO_48K, duration: sec(10) }));
    const r = applyOperation(doc, assets, {
      type: "clip/delete",
      clipId: "b",
      options: { mode: "ripple", captions: "detach", markers: "detach", music: "ripple" }
    });
    const restored = applyPatch(r.doc, invertPatch(r.patch));
    expect(restored.clips.map((c) => [c.id, c.start]).sort()).toEqual([
      ["a", 0],
      ["b", sec(1)],
      ["c", sec(4)]
    ]);
    expect(restored.transitions).toHaveLength(1);
    expect(restored.keyframes).toHaveLength(1);
    expect(restored.captions[0]).toMatchObject({ mode: "clip", clipId: "b", offset: sec(1) });
    expect(restored.audioClips[0].start).toBe(sec(3));
    validateDoc(restored, { assets });
  });

  it("他人编辑导致逆向补丁重放后结构非法 -> E_VALIDATION（重算可逆条件失败）", () => {
    // 撤销“移动 a 到 3s”时，最新文档上 3s 已被另一片段占据
    const latest = makeDoc({
      clips: [
        makeClip({ id: "a", start: sec(3), duration: sec(2) }),
        makeClip({ id: "other", start: sec(3), duration: sec(2), trackId: "tr_v1", assetId: "ast_1" })
      ]
    });
    const inverseMove: ReturnType<typeof invertPatch> = {
      ops: [{ type: "clip/update", clipId: "a", before: { start: sec(3) }, after: { start: 0 } }]
    };
    expect(() => {
      const candidate = applyPatch(latest, inverseMove);
      // a 回到 0 后与 other 不重叠；构造真正冲突：把 other 放在 0
      const conflicted: TimelineDoc = {
        ...latest,
        clips: [makeClip({ id: "a", start: sec(3), duration: sec(2) }), makeClip({ id: "other", start: 0, duration: sec(2) })]
      };
      validateDoc(applyPatch(conflicted, inverseMove), { assets: assetMap(makeAsset()) });
      void candidate;
    }).toThrowError(/非法重叠/);
  });
});

describe("同一时间模型：预览总长 / 标记 / 导出范围", () => {
  it("三者由同一 doc 的选择器计算", () => {
    const doc = makeDoc({
      clips: [makeClip({ id: "a", duration: sec(2) }), makeClip({ id: "b", start: sec(4), duration: sec(2) })],
      exportStart: sec(1),
      exportEnd: sec(5)
    });
    expect(timelineContentEnd(doc)).toBe(sec(6));
    const r = exportRange(doc);
    expect(r).toEqual({ start: sec(1), end: sec(5) });
    expect(previewTotalTicks(doc)).toBe(sec(5)); // 显式导出范围
  });
  it("exportEnd=null 时预览总长=内容末端，导出范围自动补齐", () => {
    const doc = makeDoc({
      clips: [makeClip({ id: "a", duration: sec(2) }), makeClip({ id: "b", start: sec(4), duration: sec(2) })]
    });
    expect(previewTotalTicks(doc)).toBe(sec(6));
    expect(exportRange(doc)).toEqual({ start: 0, end: sec(6) });
  });
  it("片段锚定标记随片段移动，标尺读到的是解析后的绝对位置", () => {
    let doc = makeDoc({
      clips: [makeClip({ id: "a", start: 0, duration: sec(4) })],
      markers: [{ id: "m", tick: sec(1), label: "x", clipId: "a", mode: "clip" }]
    });
    doc = applyOperation(doc, assetMap(makeAsset()), { type: "clip/move", clipId: "a", newStart: sec(10) }).doc;
    expect(resolveMarkers(doc)[0].tick).toBe(sec(11));
  });
});

describe("音频位置", () => {
  it("配乐不能使用浮点秒累加：音频重叠被拒绝、移动按 tick 校验", () => {
    const a1: AudioClipDO = { id: "a1", trackId: "tr_a1", assetId: "ast_m", start: 0, duration: sec(3), inPoint: 0, gain: 1 };
    const a2: AudioClipDO = { id: "a2", trackId: "tr_a1", assetId: "ast_m", start: sec(2), duration: sec(3), inPoint: 0, gain: 1 };
    const doc = makeDoc({ audioClips: [a1, a2] });
    const assets = assetMap(makeAsset({ id: "ast_m", kind: "audio", rate: RATE_AUDIO_48K, duration: sec(30) }));
    expect(() => validateDoc(doc, { assets })).toThrowError(/音频/);
  });
});
