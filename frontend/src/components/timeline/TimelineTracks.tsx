import { useCallback, useMemo, useRef, useState } from "react";
import {
  TICKS_PER_SECOND,
  snapTickToFrame,
  type ClipDO,
  type EditorOperation,
  type TimelineDoc
} from "@timeline/shared";
import { useEditorStore } from "@/store/editorStore";
import ClipBlock from "./ClipBlock";
import AudioBlock from "./AudioBlock";
import Ruler from "./Ruler";
import { HEADER_HEIGHT, RULER_HEIGHT, TRACK_HEIGHT, type DragState } from "./types";

interface Props {
  doc: TimelineDoc;
  pxPerTick: number;
  layout: {
    totalTicks: number;
    markers: { id: string; label: string; tick: number; attached: boolean }[];
  } | null;
  selectedClipId: string | null;
  setSelectedClipId: (id: string | null) => void;
  onRequestDelete: (clip: ClipDO) => void;
}

const TimelineTracks = ({ doc, pxPerTick, layout, selectedClipId, setSelectedClipId, onRequestDelete }: Props) => {
  const assets = useEditorStore((s) => s.assets);
  const stageLocal = useEditorStore((s) => s.stageLocal);
  const commit = useEditorStore((s) => s.commit);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playhead = useEditorStore((s) => s.playhead);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [, forceRender] = useState(0);

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const totalTicks = layout?.totalTicks ?? 1;
  const canvasWidth = Math.max(900, totalTicks * pxPerTick + 120);

  const clientToTick = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left + el.scrollLeft;
      const raw = x / pxPerTick;
      return Math.max(0, Math.round(raw));
    },
    [pxPerTick]
  );

  const snap = useCallback((tick: number) => snapTickToFrame(tick, doc.rate), [doc.rate]);

  const beginDrag = (state: Omit<DragState, "moved">) => {
    dragRef.current = { ...state, moved: false };
    forceRender((n) => n + 1);
  };

  const onClipPointerDown = (clip: ClipDO) => (e: React.PointerEvent, edge: "body" | "left" | "right") => {
    if (assetById.get(clip.assetId)?.status === "retired") return; // 拖拽中素材已被退役 -> 锁定
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelectedClipId(clip.id);
    beginDrag({
      kind: edge === "body" ? "clip" : edge === "left" ? "trim-left" : "trim-right",
      id: clip.id,
      trackId: clip.trackId,
      startClientX: e.clientX,
      origStart: clip.start,
      origEnd: clip.start + clip.duration
    });
  };

  const onKeyframePointerDown = (clipId: string) => (e: React.PointerEvent, keyframeId: string) => {
    e.preventDefault();
    const kf = doc.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    beginDrag({
      kind: "keyframe",
      id: keyframeId,
      clipId,
      startClientX: e.clientX,
      origStart: kf.offset,
      origOffset: kf.offset
    });
  };

  const onAudioPointerDown = (audioId: string) => (e: React.PointerEvent, edge: "body" | "right") => {
    e.preventDefault();
    const a = doc.audioClips.find((x) => x.id === audioId)!;
    beginDrag({
      kind: "audio",
      id: audioId,
      startClientX: e.clientX,
      origStart: a.start,
      origEnd: a.start + a.duration
    });
  };

  const onRulerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    beginDrag({ kind: "playhead", id: "playhead", startClientX: e.clientX, origStart: 0, origPlayhead: playhead });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    const deltaTick = Math.round((e.clientX - d.startClientX) / pxPerTick);

    if (d.kind === "playhead") {
      setPlayhead(snap(clientToTick(e.clientX)));
      return;
    }

    if (d.kind === "clip") {
      const newStart = snap(Math.max(0, d.origStart + deltaTick));
      stageLocal((cur) => ({
        ...cur,
        clips: cur.clips.map((c) => (c.id === d.id ? { ...c, start: newStart } : c))
      }));
    } else if (d.kind === "trim-left") {
      const newStart = snap(clampTick(d.origStart + deltaTick, 0, d.origEnd! - 1));
      stageLocal((cur) => ({
        ...cur,
        clips: cur.clips.map((c) =>
          c.id === d.id
            ? {
                ...c,
                start: newStart,
                duration: d.origEnd! - newStart,
                inPoint: snapTickToFrame(c.inPoint + (newStart - d.origStart), assetById.get(c.assetId)?.rate ?? cur.rate),
                outPoint: snapTickToFrame(c.inPoint + (d.origEnd! - newStart), assetById.get(c.assetId)?.rate ?? cur.rate)
              }
            : c
        )
      }));
    } else if (d.kind === "trim-right") {
      const newEnd = snap(Math.max(d.origStart + 1, d.origEnd! + deltaTick));
      stageLocal((cur) => ({
        ...cur,
        clips: cur.clips.map((c) =>
          c.id === d.id
            ? {
                ...c,
                duration: newEnd - c.start,
                outPoint: snapTickToFrame(c.inPoint + (newEnd - c.start), assetById.get(c.assetId)?.rate ?? cur.rate)
              }
            : c
        )
      }));
    } else if (d.kind === "keyframe") {
      const clip = doc.clips.find((c) => c.id === d.clipId)!;
      const newOffset = snap(clampTick(d.origOffset! + deltaTick, 0, clip.duration));
      stageLocal((cur) => ({
        ...cur,
        keyframes: cur.keyframes.map((k) => (k.id === d.id ? { ...k, offset: newOffset } : k))
      }));
    } else if (d.kind === "audio") {
      const audio = doc.audioClips.find((a) => a.id === d.id)!;
      if (e.shiftKey && d.origEnd !== undefined) {
        // shift 拖动右缘裁剪
        const newEnd = Math.max(audio.start + 1, d.origEnd + deltaTick);
        stageLocal((cur) => ({
          ...cur,
          audioClips: cur.audioClips.map((a) => (a.id === d.id ? { ...a, duration: newEnd - a.start } : a))
        }));
      } else {
        const newStart = Math.max(0, d.origStart + deltaTick);
        stageLocal((cur) => ({
          ...cur,
          audioClips: cur.audioClips.map((a) => (a.id === d.id ? { ...a, start: newStart } : a))
        }));
      }
    }
  };

  const onPointerUp = async () => {
    const d = dragRef.current;
    dragRef.current = null;
    forceRender((n) => n + 1);
    if (!d || !d.moved) return;

    let op: EditorOperation | null = null;
    if (d.kind === "clip") {
      const clip = doc.clips.find((c) => c.id === d.id);
      if (clip) {
        const current = useEditorStore.getState().doc!.clips.find((c) => c.id === d.id)!;
        if (current.start !== clip.start) op = { type: "clip/move", clipId: d.id, newStart: current.start };
      }
    } else if (d.kind === "trim-left" || d.kind === "trim-right") {
      const base = doc.clips.find((c) => c.id === d.id)!;
      const current = useEditorStore.getState().doc!.clips.find((c) => c.id === d.id)!;
      op = {
        type: "clip/trim",
        clipId: d.id,
        start: current.start,
        end: current.start + current.duration,
        inPoint: current.inPoint,
        outPoint: current.outPoint
      };
      void base;
    } else if (d.kind === "keyframe") {
      const current = useEditorStore.getState().doc!.keyframes.find((k) => k.id === d.id);
      const baseOffset = d.origOffset!;
      if (current && current.offset !== baseOffset) op = { type: "keyframe/move", keyframeId: d.id, newOffset: current.offset };
    } else if (d.kind === "audio") {
      const baseAudio = doc.audioClips.find((a) => a.id === d.id)!;
      const current = useEditorStore.getState().doc!.audioClips.find((a) => a.id === d.id)!;
      if (current.start !== baseAudio.start) op = { type: "audio/move", audioId: d.id, newStart: current.start };
      else if (current.duration !== baseAudio.duration) op = { type: "audio/trim", audioId: d.id, end: current.start + current.duration };
    }
    if (op) {
      const ok = await commit(op);
      if (!ok) {
        // 冲突或失败：本地乐观态将由冲突处理/loadProject 收敛
      }
    }
  };

  const videoTracks = doc.tracks.filter((t) => t.kind === "video");
  const audioTracks = doc.tracks.filter((t) => t.kind === "audio");
  const transitionsOnTrack = (trackId: string) => doc.transitions.filter((t) => t.trackId === trackId);

  return (
    <div className="flex-1 flex flex-col min-h-0 rounded-2xl border border-slate-200 bg-white/60 overflow-hidden">
      <Ruler
        pxPerTick={pxPerTick}
        totalTicks={totalTicks}
        rate={doc.rate}
        markers={layout?.markers ?? []}
        playhead={playhead}
      />
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="relative" style={{ width: canvasWidth, height: HEADER_HEIGHT + (videoTracks.length + audioTracks.length) * TRACK_HEIGHT }}>
          <div onPointerDown={onRulerPointerDown} className="absolute left-0 right-0 top-0 z-30 cursor-ew-resize" style={{ height: RULER_HEIGHT }} />
          {[...videoTracks, ...audioTracks].map((track, idx) => {
            const top = HEADER_HEIGHT + idx * TRACK_HEIGHT;
            const isVideo = track.kind === "video";
            return (
              <div key={track.id} className="absolute left-0 right-0 border-b border-slate-100" style={{ top, height: TRACK_HEIGHT }}>
                <div className={`absolute inset-1.5 rounded-xl ${isVideo ? "bg-indigo-50/60" : "bg-amber-50/60"}`} />
                {isVideo
                  ? doc.clips
                      .filter((c) => c.trackId === track.id)
                      .map((clip) => (
                        <FragmentClip
                          key={clip.id}
                          clip={clip}
                          pxPerTick={pxPerTick}
                          asset={assetById.get(clip.assetId)}
                          selected={clip.id === selectedClipId}
                          keyframes={doc.keyframes.filter((k) => k.clipId === clip.id)}
                          onPointerDown={onClipPointerDown(clip)}
                          onKeyframePointerDown={onKeyframePointerDown(clip.id)}
                        />
                      ))
                  : doc.audioClips
                      .filter((a) => a.trackId === track.id)
                      .map((audio) => (
                        <AudioBlock
                          key={audio.id}
                          audio={audio}
                          pxPerTick={pxPerTick}
                          name={assetById.get(audio.assetId)?.name ?? audio.id}
                          selected={false}
                          onPointerDown={onAudioPointerDown(audio.id)}
                        />
                      ))}
                {isVideo &&
                  transitionsOnTrack(track.id).map((tr) => {
                    const from = doc.clips.find((c) => c.id === tr.fromClipId);
                    const to = doc.clips.find((c) => c.id === tr.toClipId);
                    if (!from || !to) return null;
                    const center = Math.max(from.start, to.start) * pxPerTick;
                    return (
                      <div
                        key={tr.id}
                        className="absolute top-1 bottom-1 w-6 -ml-3 flex items-center justify-center pointer-events-none"
                        style={{ left: center }}
                        title={`转场 ${tr.kind} · 重叠 ${(tr.overlap / TICKS_PER_SECOND).toFixed(2)}s`}
                      >
                        <div className="w-5 h-5 rounded-full bg-white shadow border border-slate-300 text-[10px] flex items-center justify-center">⇄</div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
          {/* 播放头竖线 */}
          <div className="absolute top-0 bottom-0 w-px bg-rose-500/80 z-10 pointer-events-none" style={{ left: playhead * pxPerTick }} />
        </div>
      </div>
    </div>
  );
};

function FragmentClip(props: {
  clip: ClipDO;
  pxPerTick: number;
  asset: ReturnType<Map<string, { status: string }>["get"]>;
  selected: boolean;
  keyframes: { id: string; offset: number; property: string; value: number }[];
  onPointerDown: (e: React.PointerEvent, edge: "body" | "left" | "right") => void;
  onKeyframePointerDown: (e: React.PointerEvent, keyframeId: string) => void;
}) {
  const assets = useEditorStore((s) => s.assets);
  const fullAsset = assets.find((a) => a.id === props.clip.assetId);
  return (
    <ClipBlock
      clip={props.clip}
      pxPerTick={props.pxPerTick}
      asset={fullAsset}
      selected={props.selected}
      retired={fullAsset?.status === "retired"}
      keyframes={props.keyframes}
      onPointerDown={props.onPointerDown}
      onKeyframePointerDown={props.onKeyframePointerDown}
    />
  );
}

function clampTick(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export default TimelineTracks;
