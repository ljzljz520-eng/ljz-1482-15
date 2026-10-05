import { memo } from "react";
import type { AssetDO, ClipDO } from "@timeline/shared";
import { TICKS_PER_SECOND } from "@timeline/shared";

interface Props {
  clip: ClipDO;
  asset?: AssetDO;
  pxPerTick: number;
  selected: boolean;
  retired: boolean;
  onPointerDown: (e: React.PointerEvent, edge: "body" | "left" | "right") => void;
  onKeyframePointerDown: (e: React.PointerEvent, keyframeId: string) => void;
  keyframes: { id: string; offset: number; property: string; value: number }[];
}

const PALETTE = ["#165DFF", "#0ea5e9", "#6366f1", "#0d9488", "#7c3aed"];

const ClipBlock = memo(function ClipBlock({ clip, asset, pxPerTick, selected, retired, onPointerDown, keyframes, onKeyframePointerDown }: Props) {
  const left = clip.start * pxPerTick;
  const width = Math.max(6, clip.duration * pxPerTick);
  const color = PALETTE[Math.abs(hashCode(clip.assetId)) % PALETTE.length];
  const durationLabel = `${(clip.duration / TICKS_PER_SECOND).toFixed(2)}s`;

  return (
    <div
      className={`absolute top-1.5 bottom-1.5 rounded-xl cursor-grab active:cursor-grabbing select-none group transition-shadow ${
        selected ? "ring-2 ring-slate-900/70 shadow-card z-10" : "hover:shadow-card"
      } ${retired ? "opacity-60 grayscale" : ""}`}
      style={{ left, width, background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
      onPointerDown={(e) => onPointerDown(e, "body")}
      title={`${asset?.name ?? clip.assetId} · ${durationLabel}${retired ? "（素材已退役）" : ""}`}
    >
      <div className="px-2.5 pt-1.5 text-white pointer-events-none">
        <p className="text-[11px] font-semibold truncate">{asset?.name ?? clip.assetId}</p>
        <p className="text-[9px] opacity-80">
          {durationLabel}
          {asset ? ` · ${(asset.rate.num / asset.rate.den).toFixed(asset.rate.den === 1 ? 0 : 3)}fps` : ""}
        </p>
      </div>

      {/* 关键点轨道 */}
      <div className="absolute left-1.5 right-1.5 bottom-1 h-2.5 pointer-events-none">
        {keyframes.map((k) => (
          <div
            key={k.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onKeyframePointerDown(e, k.id);
            }}
            className="absolute top-0 h-2.5 w-2.5 rotate-45 bg-amber-300 border border-amber-500 pointer-events-auto cursor-ew-resize hover:scale-125 transition"
            style={{ left: Math.max(0, k.offset * pxPerTick - 5) }}
            title={`关键点 ${k.property}=${k.value}`}
          />
        ))}
      </div>

      {retired && (
        <span className="absolute right-1.5 top-1 text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded-md">退役</span>
      )}

      {/* 裁剪手柄 */}
      <div
        onPointerDown={(e) => onPointerDown(e, "left")}
        className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/0 hover:bg-white/30 rounded-l-xl"
      />
      <div
        onPointerDown={(e) => onPointerDown(e, "right")}
        className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/0 hover:bg-white/30 rounded-r-xl"
      />
    </div>
  );
});

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default ClipBlock;
