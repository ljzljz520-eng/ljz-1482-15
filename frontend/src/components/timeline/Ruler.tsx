import { useMemo } from "react";
import { TICKS_PER_SECOND, formatTimecode, type Rate } from "@timeline/shared";
import { RULER_HEIGHT } from "./types";

interface Props {
  pxPerTick: number;
  totalTicks: number;
  rate: Rate;
  markers: { id: string; label: string; tick: number; attached: boolean }[];
  playhead: number;
}

const Ruler = ({ pxPerTick, totalTicks, rate, markers, playhead }: Props) => {
  const ticks = useMemo(() => {
    // 整数秒刻度（秒来自明确时间基，绝不使用浮点累加）
    const seconds = Math.ceil(totalTicks / TICKS_PER_SECOND);
    return Array.from({ length: seconds + 1 }, (_, i) => i * TICKS_PER_SECOND);
  }, [totalTicks]);

  return (
    <div className="relative border-b border-slate-200 bg-white/70" style={{ height: RULER_HEIGHT }}>
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: t * pxPerTick }}>
          <div className="w-px h-2.5 bg-slate-300" />
          <span className="text-[10px] text-slate-400 mt-0.5 -translate-x-1/2 whitespace-nowrap">
            {formatTimecode(t, rate)}
          </span>
        </div>
      ))}
      {markers.map((m) => (
        <div
          key={m.id}
          className="absolute top-0 h-full flex items-start"
          style={{ left: m.tick * pxPerTick }}
          title={`${m.label} @${formatTimecode(m.tick, rate)}`}
        >
          <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-red-500 ml-[-5px]" />
          <span className="absolute top-1.5 ml-1 text-[9px] font-medium text-red-500 whitespace-nowrap">{m.label}</span>
        </div>
      ))}
      <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-20 pointer-events-none" style={{ left: playhead * pxPerTick }} />
    </div>
  );
};

export default Ruler;
