import { useCallback, useRef } from "react";

interface DragState {
  startX: number;
  startY: number;
  moved: boolean;
}

/**
 * 统一指针拖拽 Hook：返回 onPointerDown 处理器。
 * 拖拽期间以 tick 为单位换算（整数），onMove 的 tickDelta 已量化为整数，
 * 由调用方负责吸附帧率网格，杜绝浮点像素->秒的误差累积。
 */
export function usePointerDrag(opts: {
  onStart?: (e: React.PointerEvent) => void;
  onMove?: (info: { dxPx: number; dyPx: number; e: PointerEvent; state: DragState }) => void;
  onEnd?: (info: { dxPx: number; moved: boolean }) => void;
}) {
  const stateRef = useRef<DragState | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const state: DragState = { startX: e.clientX, startY: e.clientY, moved: false };
      stateRef.current = state;
      opts.onStart?.(e);

      const move = (ev: PointerEvent) => {
        if (!stateRef.current) return;
        const dxPx = ev.clientX - stateRef.current.startX;
        const dyPx = ev.clientY - stateRef.current.startY;
        if (Math.abs(dxPx) + Math.abs(dyPx) > 3) stateRef.current.moved = true;
        opts.onMove?.({ dxPx, dyPx, e: ev, state: stateRef.current });
      };
      const up = (ev: PointerEvent) => {
        const s = stateRef.current;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (s) opts.onEnd?.({ dxPx: ev.clientX - s.startX, moved: s.moved });
        stateRef.current = null;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [opts]
  );

  return { onPointerDown };
}
