import type { TrackDO } from "@timeline/shared";
import { TRACK_HEIGHT } from "./types";

interface Props {
  tracks: TrackDO[];
}

const TrackHeader = ({ tracks }: Props) => (
  <div className="w-36 shrink-0">
    <div style={{ height: 34 }} className="border-b border-slate-200 flex items-end pb-1 px-2">
      <span className="text-[10px] text-slate-400">轨道</span>
    </div>
    {tracks.map((t) => (
      <div
        key={t.id}
        style={{ height: TRACK_HEIGHT }}
        className="border-b border-slate-100 px-2 flex flex-col justify-center"
      >
        <div className={`text-xs font-semibold flex items-center gap-1 ${t.kind === "video" ? "text-indigo-600" : "text-amber-600"}`}>
          <span>{t.kind === "video" ? "🎬" : "🎵"}</span>
          <span className="truncate">{t.name}</span>
          {t.locked && <span className="text-[9px]">🔒</span>}
        </div>
      </div>
    ))}
  </div>
);

export default TrackHeader;
