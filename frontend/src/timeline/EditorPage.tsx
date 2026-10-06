import { useEffect, useMemo, useRef, useState } from "react";
import { timelineApi, mediaApi } from "@/api/timeline";
import { useEditorStore } from "@/store/editorStore";
import { timelineDuration } from "@timeline/core";
import { toast } from "react-hot-toast";
import MediaBin from "./MediaBin";
import UndoPanel from "./UndoPanel";
import Inspector from "./Inspector";
import RenderPanel from "./RenderPanel";
import Ruler from "./Ruler";
import TrackLanes from "./TrackLanes";
import DeleteDialog from "./DeleteDialog";
import ConflictDialog from "./ConflictDialog";
import { usePlaybackClock } from "@/hooks/usePlaybackClock";
import { tc, sec } from "./format";

const TIMELINE_ID = "seed-timeline-1";

const EditorPage = () => {
  const store = useEditorStore();
  const [playing, setPlaying] = useState(false);
  const [deleteClipId, setDeleteClipId] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [simTick, setSimTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  usePlaybackClock(playing);

  useEffect(() => {
    let cancelled = false;
    store.setLoading(true);
    Promise.all([timelineApi.get(TIMELINE_ID), mediaApi.list()])
      .then(([tl, media]) => {
        if (cancelled) return;
        store.setTimeline(tl.id, tl.doc, tl.revision, media);
        void store.refreshUndo();
      })
      .catch(() => !cancelled && toast.error("加载时间线失败"))
      .finally(() => !cancelled && store.setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doc = store.doc;
  const pxPerTick = store.zoom;
  const total = useMemo(() => (doc ? timelineDuration(doc) : 0), [doc]);
  const laneWidth = Math.max(1200, total * pxPerTick + 400);

  const addMarker = async () => {
    if (!doc) return;
    const id = `mk-${Date.now().toString(36)}`;
    const label = window.prompt("标记名称", `标记 ${doc.markers.length + 1}`);
    if (label === null) return;
    const ok = await store.dispatch(
      { type: "addMarker", marker: { id, at: store.playhead, label: label || "未命名" } },
      { label: "添加标记" }
    );
    if (ok) toast.success("标记已添加（与预览/导出同源）");
  };

  const simulateOther = async () => {
    const clip = doc?.clips[0];
    if (!clip) return;
    const start = simTick || Math.max(0, clip.start + 16016);
    try {
      const res = await timelineApi.simulateOtherEdit(TIMELINE_ID, clip.id, start);
      toast(`协作者已将「${clip.name}」移动到 ${tc(start, doc!.fps)}（rev ${res.revision}），请尝试继续拖动以体验基线冲突`, {
        icon: "👥",
        duration: 5000
      });
      setSimOpen(false);
      await store.forceReloadFromServer();
    } catch {
      toast.error("模拟协作者编辑失败");
    }
  };

  if (store.loading || !doc) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-10 w-72 rounded-xl bg-slate-200/70 animate-pulse" />
        <div className="h-[60vh] rounded-2xl bg-slate-200/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col bg-slate-50/60">
      {/* 工具栏 */}
      <div className="shrink-0 px-4 py-2.5 flex items-center gap-2 border-b border-slate-200 bg-white/80 backdrop-blur flex-wrap">
        <div className="flex items-center gap-2 mr-2">
          <span className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm">🎬</span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 leading-tight">多轨时间线编排</h2>
            <p className="text-[10px] text-slate-400 font-mono">
              rev {store.revision} · {doc.fps}fps · 240000 tick/s
            </p>
          </div>
        </div>

        <ToolBtn onClick={() => setPlaying((p) => !p)}>{playing ? "⏸ 暂停" : "▶ 播放"}</ToolBtn>
        <ToolBtn onClick={() => store.setPlayhead(0)}>⏮ 起点</ToolBtn>
        <ToolBtn onClick={addMarker}>🚩 添加标记</ToolBtn>
        <div className="h-5 w-px bg-slate-200 mx-1" />
        <ToolBtn onClick={() => setSimOpen(true)} title="模拟他人并发编辑">👥 模拟协作者</ToolBtn>
        <div className="flex-1" />

        {/* 缩放 */}
        <div className="flex items-center gap-1">
          <ToolBtn onClick={() => store.setZoom(store.zoom / 1.25)}>−</ToolBtn>
          <span className="text-[10px] text-slate-400 w-14 text-center font-mono">{pxPerTick.toFixed(3)}px/t</span>
          <ToolBtn onClick={() => store.setZoom(store.zoom * 1.25)}>+</ToolBtn>
        </div>
        <div className="h-5 w-px bg-slate-200 mx-1" />
        <SaveBadge status={store.saveStatus} pending={store.pendingCount} error={store.lastError} />
      </div>

      <div className="flex-1 flex min-h-0">
        <UndoPanel />
        <MediaBin />

        {/* 中央轨道编辑区 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="shrink-0 px-3 py-1.5 border-b border-slate-200 bg-white/70 flex items-center gap-4 text-[11px] text-slate-500 font-mono overflow-x-auto">
            <span>游标 {tc(store.playhead, doc.fps)} ({sec(store.playhead)}s)</span>
            <span>总长 {total} tick ({sec(total)}s)</span>
            <span>
              导出 {tc(doc.exportStart ?? 0, doc.fps)} → {tc(doc.exportEnd ?? total, doc.fps)}
            </span>
            <span className="text-slate-400">提示：拖动片段移动 · 拖边缘修剪 · 拖白点调关键点 · 双击片段选择删除策略</span>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-auto">
            <Ruler pxPerTick={pxPerTick} width={laneWidth} onSeek={store.setPlayhead} />
            <TrackLanes pxPerTick={pxPerTick} width={laneWidth} onRequestDelete={setDeleteClipId} />
          </div>
        </div>

        <Inspector />
        <RenderPanel timelineId={TIMELINE_ID} />
      </div>

      {deleteClipId && <DeleteDialog clipId={deleteClipId} onClose={() => setDeleteClipId(null)} />}
      <ConflictDialog />

      {simOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setSimOpen(false)}>
          <div className="w-80 rounded-2xl bg-white p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-semibold mb-3">模拟协作者并发编辑</h4>
            <p className="text-[11px] text-slate-500 mb-3">
              服务端将以另一位用户身份把首个片段移动到指定 tick，制造基线冲突（您本地正在进行的拖动不会被静默覆盖）。
            </p>
            <input
              type="number"
              step={8008}
              value={simTick}
              onChange={(e) => setSimTick(Number(e.target.value))}
              placeholder="目标 start tick（默认 +2 帧）"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono mb-3"
            />
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1.5 text-xs rounded-lg hover:bg-slate-100" onClick={() => setSimOpen(false)}>
                取消
              </button>
              <button
                className="px-4 py-1.5 text-xs rounded-lg bg-primary text-white font-medium hover:opacity-90"
                onClick={simulateOther}
              >
                执行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ToolBtn = ({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) => (
  <button
    onClick={onClick}
    title={title}
    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-primary/10 hover:text-primary active:scale-95 transition whitespace-nowrap"
  >
    {children}
  </button>
);

const SaveBadge = ({ status, pending, error }: { status: string; pending: number; error: string | null }) => {
  const map: Record<string, { text: string; cls: string }> = {
    idle: { text: "空闲", cls: "bg-slate-100 text-slate-500" },
    saving: { text: `保存中 ${pending}`, cls: "bg-amber-50 text-amber-600" },
    saved: { text: "✓ 已保存", cls: "bg-emerald-50 text-emerald-600" },
    error: { text: "保存失败 · 点击重试", cls: "bg-rose-50 text-rose-600" },
    conflict: { text: "版本冲突", cls: "bg-rose-50 text-rose-600" }
  };
  const m = map[status] ?? map.idle;
  return (
    <span
      className={"px-2.5 py-1 rounded-full text-[11px] font-medium " + m.cls}
      title={error ?? undefined}
      onClick={() => {
        if (status === "error") {
          void useEditorStore.getState().retryLastSave();
          toast("使用原幂等键重试，操作不会被重复应用", { icon: "🔁" });
        }
      }}
    >
      {m.text}
    </span>
  );
};

export default EditorPage;
