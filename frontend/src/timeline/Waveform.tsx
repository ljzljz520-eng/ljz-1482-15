import { useEffect, useRef, useState } from "react";
import { requestAnalysis } from "@/worker/analysisClient";

/**
 * 音频波形包络：由 Web Worker 计算。
 * basis 随片段时间参数变化；若计算期间用户又做了编辑（basis 变化），
 * 迟到的旧结果会被识别并丢弃，绝不会回滚新编辑。
 */
const Waveform = ({
  width,
  basis,
  active
}: {
  width: number;
  basis: string;
  active: boolean;
}) => {
  const [bins, setBins] = useState<number[]>([]);
  const basisRef = useRef(basis);
  basisRef.current = basis;

  useEffect(() => {
    let cancelled = false;
    const cancel = requestAnalysis(
      "waveform",
      { bins: Math.max(12, Math.round(width / 6)), cost: basis.length, basis },
      (res) => {
        // 双重保险：seq 已由 client 判定，这里再核对 basis
        if (cancelled || res.basis !== basisRef.current) return;
        setBins(res.data);
      }
    );
    return () => {
      cancelled = true;
      cancel();
    };
  }, [width, basis]);

  return (
    <div className="absolute inset-x-1 bottom-1 h-4 flex items-end gap-[1px] pointer-events-none" aria-hidden>
      {bins.map((v, i) => (
        <div
          key={i}
          className={"flex-1 rounded-sm " + (active ? "bg-emerald-200/90" : "bg-white/60")}
          style={{ height: `${Math.max(12, v * 100)}%` }}
        />
      ))}
    </div>
  );
};

export default Waveform;
