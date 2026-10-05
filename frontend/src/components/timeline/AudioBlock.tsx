import { memo } from "react";
import type { AudioClipDO } from "@timeline/shared";
import { TICKS_PER_SECOND } from "@timeline/shared";

interface Props {
  audio: AudioClipDO;
  pxPerTick: number;
  name: string;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, edge: "body" | "right") => void;
}

const AudioBlock = memo(function AudioBlock({ audio, pxPerTick, name, selected, onPointerDown }: Props) {
  const left = audio.start * pxPerTick;
  const width = Math.max(6, audio.duration * pxPerTick);
  return (
    <div
      className={`absolute top-1.5 bottom-1.5 rounded-xl cursor-grab active:cursor-grabbing select-none bg-gradient-to-r from-amber-500 to-orange-500 ${
        selected ? "ring-2 ring-slate-900/70 z-10" : "hover:shadow-card"
      }`}
      style={{ left, width }}
      onPointerDown={(e) => onPointerDown(e, "body")}
      title={`${name} · ${(audio.duration / TICKS_PER_SECOND).toFixed(2)}s · 增益 ${audio.gain}`}
    >
      <div className="px-2.5 pt-1.5 text-white pointer-events-none">
        <p className="text-[11px] font-semibold truncate">🎵 {name}</p>
        <p className="text-[9px] opacity-80">{(audio.duration / TICKS_PER_SECOND).toFixed(2)}s</p>
      </div>
      <div
        onPointerDown={(e) => onPointerDown(e, "right")}
        className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-white/30 rounded-r-xl"
      />
    </div>
  );
});

export default AudioBlock;
