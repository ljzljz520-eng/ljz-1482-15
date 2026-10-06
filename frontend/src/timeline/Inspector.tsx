import { timelineDuration, type TimelineDoc } from "@timeline/core";
import { useEditorStore } from "@/store/editorStore";
import { tc, sec } from "./format";

/**
 * 检查器：展示选中片段的精确时间参数（整数 tick + 时间码）。
 * 预览总长、导出范围、标记位置全部读取同一 doc。
 */
const Inspector = () => {
  const doc = useEditorStore((s) => s.doc);
  const clipId = useEditorStore((s) => s.selectedClipId);
  const playhead = useEditorStore((s) => s.playhead);
  if (!doc) return null;
  const clip = doc.clips.find((c) => c.id === clipId);
  const total = timelineDuration(doc);
  const exportStart = doc.exportStart ?? 0;
  const exportEnd = doc.exportEnd ?? total;

  return (
    <div className="w-64 shrink-0 border-l border-slate-200 bg-white/70 backdrop-blur p-4 space-y-4 overflow-y-auto">
      <section>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">统一时间模型</h4>
        <dl className="space-y-1.5 text-xs">
          <Row k="文档帧率" v={`${doc.fps} fps`} mono />
          <Row k="游标" v={`${tc(playhead, doc.fps)} · ${sec(playhead)}s`} mono />
          <Row k="预览总长" v={`${total} tick · ${sec(total)}s`} mono />
          <Row k="标记数" v={String(doc.markers.length)} />
          <Row k="导出范围" v={`${tc(exportStart, doc.fps)} → ${tc(exportEnd, doc.fps)}`} mono />
          <Row k="导出时长" v={`${exportEnd - exportStart} tick`} mono />
        </dl>
      </section>

      <section>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">选中片段</h4>
        {!clip ? (
          <p className="text-xs text-slate-400">点击轨道上的片段查看精确参数</p>
        ) : (
          <dl className="space-y-1.5 text-xs">
            <Row k="名称" v={clip.name} />
            <Row k="start" v={`${clip.start} tick`} mono />
            <Row k="duration" v={`${clip.duration} tick`} mono />
            <Row k="sourceIn" v={`${clip.sourceIn} tick`} mono />
            <Row k="sourceOut" v={`${clip.sourceIn + clip.duration} tick`} mono />
            <Row k="时间码" v={`${tc(clip.start, doc.fps)} → ${tc(clip.start + clip.duration, doc.fps)}`} mono />
            {clip.transitionIn && (
              <Row k="入场转场" v={`${clip.transitionIn.type} ${clip.transitionIn.overlap} tick`} mono />
            )}
            {clip.anchorClipId && <Row k="锚定片段" v={clip.anchorClipId} mono />}
            {clip.keyPoints.length > 0 && <Row k="关键点" v={clip.keyPoints.map((k) => `${k.at}`).join(", ")} mono />}
          </dl>
        )}
      </section>

      <MarkersList doc={doc} />
    </div>
  );
};

const MarkersList = ({ doc }: { doc: TimelineDoc }) => {
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const selectMarker = useEditorStore((s) => s.selectMarker);
  const selectedMarker = useEditorStore((s) => s.selectedMarkerId);
  return (
    <section>
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">标记</h4>
      <ul className="space-y-1">
        {doc.markers.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => {
                setPlayhead(m.at);
                selectMarker(m.id);
              }}
              className={
                "w-full text-left px-2 py-1.5 rounded-lg text-xs flex justify-between items-center transition " +
                (selectedMarker === m.id ? "bg-amber-100 text-amber-800" : "hover:bg-slate-100 text-slate-600")
              }
            >
              <span className="truncate">{m.label}</span>
              <span className="font-mono text-[10px] opacity-70">{tc(m.at, doc.fps)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const Row = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div className="flex justify-between gap-2">
    <dt className="text-slate-400">{k}</dt>
    <dd className={"text-slate-700 text-right truncate " + (mono ? "font-mono text-[11px]" : "")}>{v}</dd>
  </div>
);

export default Inspector;
