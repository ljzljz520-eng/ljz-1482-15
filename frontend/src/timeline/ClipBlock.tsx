import { memo, useMemo } from "react";
import Waveform from "./Waveform";
import { Rational, snapToFrame, ticksPerFrame, type Clip, type TimelineDoc } from "@timeline/core";
import { useEditorStore } from "@/store/editorStore";
import { usePointerDrag } from "./usePointerDrag";
import { tc } from "./format";
import { toast } from "react-hot-toast";

interface Props {
  clip: Clip;
  doc: TimelineDoc;
  pxPerTick: number;
  onRequestDelete: (clipId: string) => void;
}

/**
 * 片段块：
 *  - 中部拖动 = moveClip（按文档帧率网格吸附）
 *  - 左右边缘 = trimClip（头部修剪同时移动 start 与 sourceIn）
 *  - 关键点小圆点可拖动 = dragKeyPoint（钳制在片段时长内）
 * 所有提交都经过 store.dispatch，由服务端做基线与权威校验。
 */
const ClipBlock = memo(({ clip, doc, pxPerTick, onRequestDelete }: Props) => {
  const dispatch = useEditorStore((s) => s.dispatch);
  const selectClip = useEditorStore((s) => s.selectClip);
  const selected = useEditorStore((s) => s.selectedClipId === clip.id);
  const playhead = useEditorStore((s) => s.playhead);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const media = useEditorStore((s) => s.media);
  const asset = media.find((m) => m.id === clip.mediaId);

  const fps = useMemo(() => Rational.from(doc.fps), [doc.fps]);
  const tpf = useMemo(() => ticksPerFrame(fps), [fps]);

  const width = clip.duration * pxPerTick;
  const left = clip.start * pxPerTick;
  const retired = asset?.retired ?? false;

  const dragBody = usePointerDrag({
    onStart: () => selectClip(clip.id),
    onMove: ({ dxPx }) => {
      const rawDelta = Math.round(dxPx / pxPerTick);
      const snapped = snapToFrame(rawDelta, fps);
      const next = Math.max(0, clip.start + snapped);
      useEditorStore.setState({
        doc: {
          ...useEditorStore.getState().doc!,
          clips: useEditorStore.getState().doc!.clips.map((c) =>
            c.id === clip.id ? { ...c, start: next } : c
          )
        }
      });
    },
    onEnd: async ({ moved }) => {
      if (!moved) return;
      const finalStart = useEditorStore.getState().doc!.clips.find((c) => c.id === clip.id)!.start;
      const ok = await dispatch(
        { type: "moveClip", clipId: clip.id, start: finalStart },
        { label: `移动 ${clip.name}` }
      );
      if (!ok) {
        const st = useEditorStore.getState();
        if (st.saveStatus === "error") toast.error("拖动保存失败，已保留本地状态，请检查网络后重试");
      }
    }
  });

  const trimEdge = (edge: "head" | "tail") =>
    usePointerDrag({
      onMove: ({ dxPx }) => {
        const deltaTicks = snapToFrame(Math.round(dxPx / pxPerTick), fps);
        const cur = useEditorStore.getState().doc!.clips.find((c) => c.id === clip.id)!;
        let start = cur.start;
        let duration = cur.duration;
        let sourceIn = cur.sourceIn;
        if (edge === "head") {
          const maxDelta = Math.min(deltaTicks, duration - tpf, asset ? asset.duration - sourceIn - duration : deltaTicks);
          const d = Math.max(-start, Math.max(-sourceIn, maxDelta));
          start = cur.start + d;
          duration = cur.duration - d;
          sourceIn = cur.sourceIn + d;
        } else {
          const maxExtend = asset ? asset.duration - cur.sourceIn - cur.duration : Infinity;
          duration = Math.max(tpf, Math.min(cur.duration + deltaTicks, cur.duration + maxExtend));
        }
        useEditorStore.setState({
          doc: {
            ...useEditorStore.getState().doc!,
            clips: useEditorStore.getState().doc!.clips.map((c) =>
              c.id === clip.id ? { ...c, start, duration, sourceIn } : c
            )
          }
        });
      },
      onEnd: async ({ moved }) => {
        if (!moved) return;
        const cur = useEditorStore.getState().doc!.clips.find((c) => c.id === clip.id)!;
        await dispatch(
          {
            type: "trimClip",
            clipId: clip.id,
            edge,
            start: cur.start,
            duration: cur.duration,
            sourceIn: cur.sourceIn
          },
          { label: `修剪 ${clip.name}` }
        );
      }
    });

  const dragHead = trimEdge("head");
  const dragTail = trimEdge("tail");

  const trackKind = doc.tracks.find((t) => t.id === clip.trackId)?.kind;
  const isVideo = trackKind === "video";

  return (
    <div
      className={
        "absolute top-1 bottom-1 rounded-lg select-none cursor-grab active:cursor-grabbing group transition-shadow " +
        (selected ? "ring-2 ring-primary shadow-card z-20" : "ring-1 ring-black/5 z-10 hover:ring-primary/40")
      }
      style={{
        left,
        width: Math.max(width, 6),
        background: retired
          ? "repeating-linear-gradient(45deg,#fecaca,#fecaca 6px,#fca5a5 6px,#fca5a5 12px)"
          : clip.color
            ? `linear-gradient(135deg, ${clip.color}, ${clip.color}cc)`
            : "linear-gradient(135deg,#93c5fd,#60a5fa)"
      }}
      {...dragBody}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onRequestDelete(clip.id);
      }}
      title={`${clip.name} · ${tc(clip.start, doc.fps)} ~ ${tc(clip.start + clip.duration, doc.fps)}（双击删除）`}
    >
      {/* 入场转场重叠指示 */}
      {clip.transitionIn && (
        <div
          className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-white/70 to-transparent rounded-l-lg pointer-events-none"
          style={{ width: clip.transitionIn.overlap * pxPerTick }}
          title={`转场 ${clip.transitionIn.type} · ${clip.transitionIn.overlap} tick 重叠`}
        />
      )}

      <div className="px-2 pt-1 text-[11px] font-semibold text-white/95 truncate drop-shadow-sm pointer-events-none">
        {clip.name}
        {retired && <span className="ml-1 text-rose-900">[已退役]</span>}
        {asset && <span className="ml-1 opacity-80">{asset.fps === doc.fps ? "" : `${asset.fps}`}</span>}
      </div>
      {clip.text && (
        <div className="px-2 text-[10px] text-white/90 truncate pointer-events-none">{clip.text}</div>
      )}

      {/* 关键点（拖动中只做本地整数 tick 更新，松手时提交一次 dragKeyPoint） */}
      {clip.keyPoints.map((kp) => (
        <KeyPointDot
          key={kp.id}
          at={kp.at}
          pxPerTick={pxPerTick}
          clipDuration={clip.duration}
          label={kp.label}
          onLive={(nextAt) => {
            useEditorStore.setState({
              doc: {
                ...useEditorStore.getState().doc!,
                clips: useEditorStore.getState().doc!.clips.map((c) =>
                  c.id === clip.id
                    ? { ...c, keyPoints: c.keyPoints.map((k) => (k.id === kp.id ? { ...k, at: nextAt } : k)) }
                    : c
                )
              }
            });
          }}
          onCommit={async (nextAt) => {
            await dispatch(
              { type: "dragKeyPoint", clipId: clip.id, keyPointId: kp.id, at: nextAt },
              { label: "拖动关键点" }
            );
          }}
        />
      ))}

      {/* 修剪手柄 */}
      {isVideo && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40 rounded-l-lg"
            {...dragHead}
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40 rounded-r-lg"
            {...dragTail}
          />
        </>
      )}

      {selected && Math.abs(playhead - (clip.start + clip.duration / 2)) < tpf && (
        <div className="absolute -top-5 text-[10px] text-primary font-mono whitespace-nowrap">
          {tc(clip.start, doc.fps)}
        </div>
      )}

      {trackKind === "audio" && (
        <Waveform
          width={Math.max(width, 6)}
          basis={`${clip.id}:${clip.start}:${clip.duration}:${clip.sourceIn}`}
          active={selected}
        />
      )}
    </div>
  );
});

ClipBlock.displayName = "ClipBlock";

const KeyPointDot = ({
  at,
  pxPerTick,
  clipDuration,
  label,
  onLive,
  onCommit
}: {
  at: number;
  pxPerTick: number;
  clipDuration: number;
  label?: string;
  onLive: (nextAt: number) => void;
  onCommit: (nextAt: number) => void;
}) => {
  const drag = usePointerDrag({
    onMove: ({ dxPx }) => {
      const next = Math.max(0, Math.min(clipDuration, at + Math.round(dxPx / pxPerTick)));
      onLive(next);
    },
    onEnd: ({ moved, dxPx }) => {
      if (!moved) return;
      const next = Math.max(0, Math.min(clipDuration, at + Math.round(dxPx / pxPerTick)));
      void onCommit(next);
    }
  });
  return (
    <div
      {...drag}
      title={`关键点 ${label ?? ""} @ ${at} tick`}
      className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white border-2 border-slate-800 cursor-ew-resize hover:scale-125 transition z-30"
      style={{ left: at * pxPerTick - 6 }}
    />
  );
};

export default ClipBlock;
