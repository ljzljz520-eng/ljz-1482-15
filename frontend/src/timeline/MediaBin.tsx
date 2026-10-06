import { MediaAsset, Rational, formatSeconds, ticksPerFrame } from "@timeline/core";
import { mediaApi } from "@/api/timeline";
import { useEditorStore } from "@/store/editorStore";
import { toast } from "react-hot-toast";

const kindLabel: Record<string, string> = { video: "视频", audio: "音频", image: "图片" };

/**
 * 素材库：展示不同帧率素材（精确 tick 时长）；
 * 管理员可“退役”素材，用于验收“拖拽中素材被退役”：
 * 正在拖动该素材片段时退役，提交会被服务端拒绝并提示。
 */
const MediaBin = () => {
  const media = useEditorStore((s) => s.media);
  const setMedia = useEditorStore((s) => s.setMedia);
  const role = localStorage.getItem("tl_role");

  const retire = async (m: MediaAsset) => {
    try {
      await mediaApi.retire(m.id);
      const next = media.map((x) => (x.id === m.id ? { ...x, retired: true } : x));
      setMedia(next);
      toast(`素材「${m.name}」已退役，引用它的编辑将被拒绝`, { icon: "⚠️" });
    } catch {
      toast.error("退役失败");
    }
  };

  return (
    <div className="w-60 shrink-0 border-r border-slate-200 bg-white/70 backdrop-blur flex flex-col">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">素材库</h3>
        <p className="text-[11px] text-slate-400 mt-0.5">时长为整数 tick（不同帧率精确换算）</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {media.map((m) => {
          const tpf = ticksPerFrame(Rational.from(m.fps));
          return (
            <div
              key={m.id}
              className={
                "rounded-xl border p-3 transition " +
                (m.retired ? "border-rose-200 bg-rose-50/60 opacity-70" : "border-slate-200 bg-white hover:border-primary/40 hover:shadow-card")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800 leading-snug">{m.name}</p>
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500">
                  {kindLabel[m.kind]}
                </span>
              </div>
              <div className="mt-1.5 text-[10px] text-slate-500 space-y-0.5 font-mono">
                <p>帧率 {m.fps} fps</p>
                <p>{tpf} tick/帧 · {m.duration} tick</p>
                <p>{formatSeconds(m.duration)}s{m.sampleRate ? ` · ${m.sampleRate}Hz` : ""}</p>
              </div>
              {m.retired ? (
                <span className="mt-2 inline-block text-[10px] font-semibold text-rose-600">已退役 · 拒绝引用</span>
              ) : role === "admin" ? (
                <button
                  onClick={() => retire(m)}
                  className="mt-2 text-[10px] text-rose-500 hover:text-rose-700 font-medium"
                >
                  退役此素材（模拟）
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MediaBin;
