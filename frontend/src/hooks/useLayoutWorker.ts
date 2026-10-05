import { useEffect, useRef, useState } from "react";
import type { TimelineDoc } from "@timeline/shared";
import type { LayoutResult } from "../workers/layout.worker";

/**
 * 把 doc 投递给 worker 计算布局；generation 单调递增，
 * 只有最新一代的结果会被采纳，旧结果（迟到）直接丢弃。
 */
export function useLayoutWorker(doc: TimelineDoc | null): { layout: LayoutResult | null; generationsDropped: number } {
  const workerRef = useRef<Worker | null>(null);
  const generationRef = useRef(0);
  const acceptedRef = useRef(0);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [generationsDropped, setDropped] = useState(0);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/layout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<LayoutResult>) => {
      // 关键防线：代次令牌。若编辑已推进到更新代次，迟到结果不能覆盖新状态
      if (ev.data.generation !== generationRef.current) {
        setDropped((n) => n + 1);
        return;
      }
      acceptedRef.current = ev.data.generation;
      setLayout(ev.data);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (!doc || !workerRef.current) return;
    generationRef.current += 1;
    const req = { generation: generationRef.current, doc };
    workerRef.current.postMessage(req);
  }, [doc]);

  return { layout, generationsDropped };
}
