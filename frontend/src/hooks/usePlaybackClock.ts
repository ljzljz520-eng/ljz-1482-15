import { useEffect, useRef } from "react";
import { TICKS_PER_SECOND, timelineDuration } from "@timeline/core";
import { useEditorStore } from "@/store/editorStore";

/**
 * 播放时钟：真实挂钟毫秒 -> 整数 tick 的唯一换算处。
 * 不使用浮点秒累加；每帧都从锚点时刻重新取整，避免漂移。
 */
export function usePlaybackClock(playing: boolean) {
  const rafRef = useRef<number>(0);
  const anchorRef = useRef<{ wallMs: number; tick: number } | null>(null);

  useEffect(() => {
    if (!playing) {
      anchorRef.current = null;
      return;
    }
    const doc = useEditorStore.getState().doc;
    const startTick = useEditorStore.getState().playhead;
    anchorRef.current = { wallMs: performance.now(), tick: startTick };
    const total = doc ? timelineDuration(doc) : 0;

    const tickFn = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const elapsedMs = performance.now() - anchor.wallMs;
      const next = anchor.tick + Math.round((elapsedMs * TICKS_PER_SECOND) / 1000);
      if (next >= total) {
        useEditorStore.getState().setPlayhead(total);
        return; // 停止信号由调用方根据到尾处理
      }
      useEditorStore.getState().setPlayhead(next);
      rafRef.current = requestAnimationFrame(tickFn);
    };
    rafRef.current = requestAnimationFrame(tickFn);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);
}
