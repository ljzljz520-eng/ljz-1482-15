export interface DragState {
  kind: "clip" | "trim-left" | "trim-right" | "keyframe" | "audio" | "playhead" | "marker";
  id: string;
  trackId?: string;
  startClientX: number;
  origStart: number;
  origEnd?: number;
  origOffset?: number;
  origPlayhead?: number;
  clipId?: string;
  moved: boolean;
}

export const TRACK_HEIGHT = 56;
export const HEADER_HEIGHT = 44;
export const RULER_HEIGHT = 34;
export const MIN_PX_PER_SEC = 24;
