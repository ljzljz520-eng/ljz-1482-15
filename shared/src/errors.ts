/** 引擎/协议错误码：前端据此做差异化处理（冲突、素材退役、转场非法等） */
export type EngineErrorCode =
  | "E_VALIDATION"
  | "E_NOT_FOUND"
  | "E_REVISION_CONFLICT"
  | "E_ASSET_RETIRED"
  | "E_DANGLING_REF"
  | "E_TRACK_LOCKED"
  | "E_OVERLAP"
  | "E_TRANSITION_INVALID"
  | "E_SOURCE_RANGE"
  | "E_KEYFRAME_RANGE"
  | "E_UNDO_CONFLICT"
  | "E_BAD_TIMEBASE";

export class EngineError extends Error {
  code: EngineErrorCode;
  details?: unknown;
  constructor(code: EngineErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.details = details;
  }
}

/** 校验冲突明细中的单条问题 */
export interface ValidationIssue {
  path: string;
  message: string;
}
