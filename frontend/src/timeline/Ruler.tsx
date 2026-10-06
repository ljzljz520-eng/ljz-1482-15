import { memo, useMemo } from "react";
import { Rational, ticksPerFrame } from "@timeline/core";
import { tc } from "./format";
import { useEditorStore } from "@/store/editorStore";

/**
 * 时间标尺：按文档帧率（有理数）的整数帧网格绘制刻度。
 * 所有刻度位置 = 帧索引 × ticksPerFrame，绝不使用浮点秒乘像素。
 */
const Ruler = memo(({ pxPerTick, width, onSeek }: { pxPerTick: number; width: number; onSeek: (tick: number) => void }) => {
  const doc = useEditorStore((s) => s.doc);
  const playhead = useEditorStore((s) => s.playhead);
  const markers = useEditorStore((s) => s.doc?.markers ?? []);
  const dispatch = useEditorStore((s) => s.dispatch);

  const tpf = useMemo(() => (doc ? ticksPerFrame(Rational.from(doc.fps)) : 8008), [doc]);
  if (!doc) return null;

  // 根据缩放选择每秒/每半秒/每 10 帧的刻度密度
  const pxPerFrame = tpf * pxPerTick;
  const frameStep = pxPerFrame < 8 ? (pxPerFrame * 10 < 8 ? 30 : 10) : 1;
  const totalTick = width / pxPerTick;
  const ticks: number[] = [];
  for (let f = 0; f * tpf <= totalTick; f += frameStep) ticks.push(f * tpf);

  const seek = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tick = Math.round((e.clientX - rect.left) / pxPerTick);
    onSeek(Math.max(0, tick));
  };

  return (
    <div className="relative h-9 bg-white/90 border-b border-slate-200 cursor-pointer" style={{ width }} onClick={seek}>
      {ticks.map((t) => {
        const major = t % 240000 === 0;
        return (
          <div key={t} className="absolute top-0 bottom-0" style={{ left: t * pxPerTick }}>
            <div className={"w-px " + (major ? "h-5 bg-slate-400" : "h-2.5 bg-slate-300")} />
            {major && (
              <span className="absolute top-5 left-1 text-[10px] text-slate-500 font-mono whitespace-nowrap">
                {tc(t, doc.fps)}
              </span>
            )}
          </div>
        );
      })}
      {/* 标记在标尺上的小旗，可拖动 */}
      {markers.map((m) => (
        <MarkerFlag key={m.id} id={m.id} at={m.at} label={m.label} pxPerTick={pxPerTick} tpf={tpf} dispatch={dispatch} />
      ))}
      {/* 播放游标 */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-none" style={{ left: playhead * pxPerTick }}>
        <div className="absolute -top-0 -left-[5px] w-3 h-3 bg-rose-500 rotate-45 rounded-sm" />
      </div>
    </div>
  );
});

Ruler.displayName = "Ruler";

const MarkerFlag = ({
  id,
  at,
  label,
  pxPerTick,
  tpf,
  dispatch
}: {
  id: string;
  at: number;
  label: string;
  pxPerTick: number;
  tpf: number;
  dispatch: ReturnType<typeof useEditorStore.getState>["dispatch"];
}) => {
  let liveAt = at;
  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => {
      const next = Math.max(0, Math.round((at + (ev.clientX - x0) / pxPerTick) / tpf) * tpf);
      liveAt = next;
      (document.getElementById(`marker-flag-${id}`) as HTMLElement | null)?.style.setProperty("left", `${next * pxPerTick}px`);
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (liveAt !== at) await dispatch({ type: "moveMarker", markerId: id, at: liveAt }, { label: "移动标记" });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      id={`marker-flag-${id}`}
      onPointerDown={startDrag}
      title={`标记 ${label}（可拖动）`}
      className="absolute top-0 z-40 cursor-ew-resize"
      style={{ left: at * pxPerTick }}
    >
      <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[9px] border-l-transparent border-r-transparent border-t-amber-500" />
      <div className="w-0.5 h-6 bg-amber-500/70 mx-auto" />
    </div>
  );
};

export default Ruler;
