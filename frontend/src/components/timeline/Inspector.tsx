import { useEditorStore } from "@/store/editorStore";
import { TICKS_PER_SECOND, formatTimecode } from "@timeline/shared";
import { genId } from "@timeline/shared";

interface Props {
  selectedClipId: string | null;
  onDelete: () => void;
}

const Inspector = ({ selectedClipId, onDelete }: Props) => {
  const doc = useEditorStore((s) => s.doc);
  const assets = useEditorStore((s) => s.assets);
  const commit = useEditorStore((s) => s.commit);

  const clip = selectedClipId ? doc?.clips.find((c) => c.id === selectedClipId) : null;
  const asset = clip ? assets.find((a) => a.id === clip.assetId) : null;
  const keyframes = clip ? doc?.keyframes.filter((k) => k.clipId === clip.id) ?? [] : [];

  return (
    <aside className="w-72 shrink-0 rounded-2xl border border-slate-200 bg-white/70 p-4 space-y-4 overflow-auto">
      <h3 className="text-sm font-bold text-slate-800">检查器</h3>
      {!clip || !doc ? (
        <p className="text-xs text-slate-400 leading-relaxed">
          点选片段可查看精确的整数 tick 属性；拖动片段或菱形关键点进行编排。删除片段时可选择波纹 / 保留绝对位置 / 提升，
          并指定子标题、字幕锚点与配乐的处理方式。
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Field label="素材" value={asset?.name ?? clip.assetId} />
            <Field label="素材状态" value={asset?.status === "retired" ? "已退役（锁定编辑）" : "可用"} danger={asset?.status === "retired"} />
            <Field label="素材帧率" value={`${asset!.rate.num}/${asset!.rate.den} fps`} />
            <Field label="时间线起点" value={`${clip.start} tick · ${formatTimecode(clip.start, doc.rate)}`} mono />
            <Field label="时长" value={`${clip.duration} tick · ${(clip.duration / TICKS_PER_SECOND).toFixed(3)}s`} mono />
            <Field label="源入点 / 出点" value={`${clip.inPoint} / ${clip.outPoint} tick`} mono />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-600">关键点（{keyframes.length}）</p>
              <button
                disabled={asset?.status === "retired"}
                onClick={() =>
                  commit({
                    type: "keyframe/add",
                    keyframe: {
                      id: genId("kf"),
                      clipId: clip.id,
                      offset: Math.floor(clip.duration / 2),
                      property: "opacity",
                      value: 1
                    }
                  })
                }
                className="text-[11px] px-2 py-1 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-40 transition"
              >
                + 关键点
              </button>
            </div>
            <div className="space-y-1">
              {keyframes.map((k) => (
                <div key={k.id} className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded-lg bg-slate-50">
                  <span className="text-slate-600">
                    {k.property}={k.value}
                  </span>
                  <span className="tabular-nums text-slate-400">{(k.offset / TICKS_PER_SECOND).toFixed(2)}s</span>
                  <button
                    onClick={() => commit({ type: "keyframe/delete", keyframeId: k.id })}
                    className="text-red-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {keyframes.length === 0 && <p className="text-[11px] text-slate-400">暂无关键点，可在片段中部拖动菱形调整位置</p>}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <button
              onClick={onDelete}
              className="w-full px-3 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-rose-500 hover:opacity-90 active:scale-95 transition"
            >
              删除片段…
            </button>
          </div>
        </>
      )}
    </aside>
  );
};

const Field = ({ label, value, mono, danger }: { label: string; value: string; mono?: boolean; danger?: boolean }) => (
  <div className="flex items-center justify-between gap-2 text-xs">
    <span className="text-slate-400 shrink-0">{label}</span>
    <span className={`${mono ? "tabular-nums" : ""} ${danger ? "text-red-600 font-semibold" : "text-slate-700 font-medium"} truncate text-right`}>
      {value}
    </span>
  </div>
);

export default Inspector;
