/// <reference lib="webworker" />
/**
 * 耗时分析工作线程：生成缩略图条/波形包络/帧网格统计等。
 * 关键约定：每条结果都带请求序列号（seq），由主线程判断是否过期，
 * 迟到结果绝不能覆盖/回滚用户在等待期间做出的新编辑。
 */
export interface AnalysisRequest {
  seq: number;
  kind: "waveform" | "thumbstrip" | "grid";
  payload: unknown;
}

export interface AnalysisResponse {
  seq: number;
  kind: AnalysisRequest["kind"];
  data: number[];
  /** 计算所依据的文档指纹，主线程可比对当前编辑版本 */
  basis: string | null;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<AnalysisRequest>) => {
  const { seq, kind, payload } = ev.data;
  const basis = (payload as { basis?: string } | null)?.basis ?? null;
  const data = compute(kind, payload);
  const res: AnalysisResponse = { seq, kind, data, basis };
  ctx.postMessage(res);
};

function compute(kind: AnalysisRequest["kind"], payload: unknown): number[] {
  const p = payload as { bins?: number; cost?: number; docLength?: number };
  const bins = Math.max(1, p.bins ?? 64);
  switch (kind) {
    case "waveform":
      return pseudoEnvelope(bins, (p.cost ?? 0) + 1);
    case "thumbstrip":
      return Array.from({ length: bins }, (_, i) => deterministic(i * 7 + 3) * 100);
    case "grid":
      return Array.from({ length: bins }, (_, i) => i);
  }
}

/** 用确定性序列模拟可复现的包络，避免 Math.random 造成结果不稳定 */
function pseudoEnvelope(bins: number, seed: number): number[] {
  return Array.from({ length: bins }, (_, i) => {
    const v = Math.abs(Math.sin(i * 0.7 + seed) * 0.6 + deterministic(i + seed) * 0.4);
    return Math.round(v * 100) / 100;
  });
}

function deterministic(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
