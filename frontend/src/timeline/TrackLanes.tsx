import { memo, useMemo } from "react";
import { timelineDuration, type TimelineDoc } from "@timeline/core";
import { useEditorStore } from "@/store/editorStore";
import ClipBlock from "./ClipBlock";

interface Props {
  pxPerTick: number;
  width: number;
  onRequestDelete: (clipId: string) => void;
}

const TRACK_HEIGHT = 64;
const kindStyle: Record<string, string> = {
  video: "bg-gradient-to-b from-sky-50 to-white",
  audio: "bg-gradient-to-b from-emerald-50 to-white",
  subtitle: "bg-gradient-to-b from-violet-50 to-white"
};

/**
 * 多轨编排区：视频/音频/字幕轨道纵向排布，同轨片段水平按整数 tick 定位。
 * 预览总长、标记、导出范围共用同一个 TimelineDoc（唯一时间模型）。
 */
const TrackLanes = memo(({ pxPerTick, width, onRequestDelete }: Props) => {
  const doc = useEditorStore((s) => s.doc);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const total = useMemo(() => (doc ? timelineDuration(doc) : 0), [doc]);
  if (!doc) return null;

  const seekFromLane = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.lane !== "1") return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPlayhead(Math.max(0, Math.round((e.clientX - rect.left) / pxPerTick)));
  };

  return (
    <div className="relative" style={{ width }} onClick={seekFromLane}>
      {doc.tracks.map((track) => (
        <div key={track.id} className="flex border-b border-slate-100" style={{ height: TRACK_HEIGHT }}>
          <div className="w-28 shrink-0 px-3 py-2 bg-slate-50/80 border-r border-slate-200 flex flex-col justify-center">
            <span className="text-xs font-semibold text-slate-700">{track.name}</span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">{track.kind}</span>
          </div>
          <div className={"relative flex-1 " + (kindStyle[track.kind] ?? "bg-white")} data-lane="1">
            {/* 帧网格背景线 */}
            <GridLines pxPerTick={pxPerTick} width={width} />
            {doc.clips
              .filter((c) => c.trackId === track.id)
              .map((c) => (
                <ClipBlock
                  key={c.id}
                  clip={c}
                  doc={doc as TimelineDoc}
                  pxPerTick={pxPerTick}
                  onRequestDelete={onRequestDelete}
                />
              ))}
          </div>
        </div>
      ))}

      {/* 导出范围高亮（与预览总长、标记同源） */}
      <ExportOverlay doc={doc} pxPerTick={pxPerTick} laneWidth={width} trackCount={doc.tracks.length} />

      {/* 时间线结束边界 */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-slate-400/60 pointer-events-none"
        style={{ left: 112 + total * pxPerTick }}
        title={`时间线总长 ${total} tick`}
      />
    </div>
  );
});

TrackLanes.displayName = "TrackLanes";

const GridLines = memo(({ pxPerTick, width }: { pxPerTick: number; width: number }) => {
  const second = 240000 * pxPerTick;
  const lines = Math.ceil(width / second);
  return (
    <>
      {Array.from({ length: lines + 1 }, (_, i) => (
        <div key={i} className="absolute top-0 bottom-0 w-px bg-slate-200/60" style={{ left: i * second }} />
      ))}
    </>
  );
});
GridLines.displayName = "GridLines";

const ExportOverlay = ({
  doc,
  pxPerTick,
  laneWidth,
  trackCount
}: {
  doc: TimelineDoc;
  pxPerTick: number;
  laneWidth: number;
  trackCount: number;
}) => {
  const total = timelineDuration(doc);
  const start = doc.exportStart ?? 0;
  const end = doc.exportEnd ?? total;
  const height = trackCount * TRACK_HEIGHT;
  return (
    <div className="absolute pointer-events-none" style={{ left: 112, top: 0, height, width: laneWidth - 112 }}>
      <div className="absolute top-0 bottom-0 bg-primary/5 border-x border-primary/30" style={{ left: start * pxPerTick, width: (end - start) * pxPerTick }} />
      <div className="absolute top-0 bottom-0 bg-slate-900/5" style={{ left: 0, width: start * pxPerTick }} />
      <div className="absolute top-0 bottom-0 bg-slate-900/5" style={{ left: end * pxPerTick, right: 0 }} />
      <div className="absolute -top-0 text-[10px] text-primary font-mono bg-primary/10 rounded px-1" style={{ left: start * pxPerTick + 4 }}>
        导出
      </div>
    </div>
  );
};

export default TrackLanes;
