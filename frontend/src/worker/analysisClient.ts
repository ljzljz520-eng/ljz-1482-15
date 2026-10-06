import type { AnalysisRequest, AnalysisResponse } from "./analysis.worker";
import { logger } from "@/utils/logger";

/**
 * 主线程侧封装（防止工作线程“迟到结果回滚新编辑”）：
 * 每类分析维护最新请求 seq；结果到达时若已被更新的请求取代则标记 stale 并丢弃，
 * 调用方只会在结果仍为最新时收到非 stale 回调。
 */
let worker: Worker | null = null;
let globalSeq = 0;
const latestSeqByKind = new Map<AnalysisRequest["kind"], number>();
const handlers = new Map<number, (res: AnalysisResponse & { stale: boolean }) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<AnalysisResponse>) => {
      const res = ev.data;
      const latest = latestSeqByKind.get(res.kind) ?? 0;
      const cb = handlers.get(res.seq);
      if (!cb) return;
      handlers.delete(res.seq);
      const stale = res.seq < latest;
      if (stale) {
        logger.debug(`丢弃过期工作线程结果 kind=${res.kind} seq=${res.seq} latest=${latest}`);
        return;
      }
      cb({ ...res, stale: false });
    };
    worker.onerror = (e) => logger.error("分析工作线程错误", e);
  }
  return worker;
}

export function requestAnalysis(
  kind: AnalysisRequest["kind"],
  payload: unknown,
  onResult: (res: AnalysisResponse & { stale: boolean }) => void
): () => void {
  const w = getWorker();
  const mySeq = ++globalSeq;
  latestSeqByKind.set(kind, Math.max(latestSeqByKind.get(kind) ?? 0, mySeq));
  handlers.set(mySeq, onResult);
  const req: AnalysisRequest = { seq: mySeq, kind, payload };
  w.postMessage(req);
  return () => {
    handlers.delete(mySeq);
  };
}
