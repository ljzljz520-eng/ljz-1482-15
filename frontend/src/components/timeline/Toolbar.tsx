import { useEditorStore } from "@/store/editorStore";
import { genId, type AssetDO } from "@timeline/shared";
import toast from "react-hot-toast";

interface Props {
  assets: AssetDO[];
  pxPerSec: number;
  setPxPerSec: (n: number) => void;
}

const Toolbar = ({ assets, pxPerSec, setPxPerSec }: Props) => {
  const { doc, commit, playhead } = useEditorStore();

  const addMarker = async () => {
    await commit({
      type: "marker/add",
      marker: { id: genId("mk"), tick: playhead, label: `标记 ${(playhead / 1e9).toFixed(1)}s`, clipId: null, mode: "absolute" }
    });
  };

  const addCaption = async () => {
    await commit({
      type: "caption/add",
      caption: { id: genId("cap"), text: "新字幕", mode: "absolute", clipId: null, offset: 0, absoluteTick: playhead }
    });
  };

  const autoTransition = async () => {
    if (!doc) return;
    // 为同轨上最近的两个片段创建 0.5s 重叠转场（会按 tick 校验重叠精确一致）
    for (const track of doc.tracks.filter((t) => t.kind === "video")) {
      const clips = doc.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
      for (let i = 0; i < clips.length - 1; i++) {
        const a = clips[i];
        const b = clips[i + 1];
        const gap = a.start + a.duration - b.start;
        const exists = doc.transitions.some(
          (t) =>
            (t.fromClipId === a.id && t.toClipId === b.id) || (t.fromClipId === b.id && t.toClipId === a.id)
        );
        if (exists) continue;
        const overlap = Math.min(500_000_000, a.duration - 1, b.duration - 1);
        if (gap < overlap) {
          // 需要先移动 b 使其重叠 overlap（一次性做 move + transition 两个提交）
          const res = await commit({ type: "clip/move", clipId: b.id, newStart: a.start + a.duration - overlap });
          if (!res) return;
          const latest = useEditorStore.getState().doc!;
          await commit({
            type: "transition/add",
            transition: {
              id: genId("tr"),
              trackId: track.id,
              fromClipId: a.id,
              toClipId: b.id,
              overlap,
              kind: "dissolve"
            }
          });
          void latest;
          toast.success(`已创建 ${(overlap / 1e9).toFixed(1)}s 转场`);
          return;
        }
      }
    }
    toast.error("没有可添加转场的相邻片段（需要可重叠的两个片段）");
  };

  return (
    <div className="flex items-center gap-1.5">
      <ToolBtn onClick={addMarker}>🏁 标记</ToolBtn>
      <ToolBtn onClick={addCaption}>💬 字幕</ToolBtn>
      <ToolBtn onClick={autoTransition}>⇄ 转场</ToolBtn>
      <div className="w-px h-6 bg-slate-200 mx-1" />
      <button
        onClick={() => setPxPerSec(Math.max(24, pxPerSec - 20))}
        className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-primary transition text-sm"
        title="缩小"
      >
        −
      </button>
      <span className="text-[11px] text-slate-400 w-12 text-center tabular-nums">{pxPerSec}px/s</span>
      <button
        onClick={() => setPxPerSec(Math.min(240, pxPerSec + 20))}
        className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-primary transition text-sm"
        title="放大"
      >
        +
      </button>
    </div>
  );
};

const ToolBtn = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="px-2.5 h-8 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:border-primary hover:text-primary active:scale-95 transition"
  >
    {children}
  </button>
);

export default Toolbar;
