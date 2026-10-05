import { TICKS_PER_SECOND, formatTimecode, type Rate } from "@timeline/shared";
import type { LayoutResult } from "@/workers/layout.worker";

interface Props {
  layout: LayoutResult | null;
  rate: Rate;
  generationsDropped: number;
  revision: number;
}

/**
 * 预览指标：总长 / 内容末端 / 导出范围 / 标记数 —— 全部来自 worker 计算的
 * 同一份时间模型（与标尺、EDL 导出同源）。同时显示被丢弃的迟到结果代次数。
 */
const PreviewStats = ({ layout, rate, generationsDropped, revision }: Props) => {
  if (!layout) return <div className="h-20 rounded-2xl bg-white/60 border border-slate-200 animate-pulse" />;
  const items = [
    { label: "预览总长", value: formatTimecode(layout.totalTicks, rate), sub: `${(layout.totalTicks / TICKS_PER_SECOND).toFixed(2)}s` },
    { label: "内容末端", value: formatTimecode(layout.contentEnd, rate), sub: `${(layout.contentEnd / TICKS_PER_SECOND).toFixed(2)}s` },
    {
      label: "导出范围",
      value: `${formatTimecode(layout.exportRange.start, rate)} → ${formatTimecode(layout.exportRange.end, rate)}`,
      sub: `长度 ${((layout.exportRange.end - layout.exportRange.start) / TICKS_PER_SECOND).toFixed(2)}s`
    },
    { label: "标记 / 字幕", value: `${layout.markers.length} / ${layout.captions.length}`, sub: `片段 ${layout.clipCount} · 转场 ${layout.transitionCount}` }
  ];
  return (
    <div className="rounded-2xl bg-white/70 border border-slate-200 p-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map((it) => (
          <div key={it.label} className="px-3 py-2 rounded-xl bg-slate-50/80">
            <p className="text-[10px] text-slate-400 font-medium">{it.label}</p>
            <p className="text-sm font-bold text-slate-800 tabular-nums leading-tight">{it.value}</p>
            <p className="text-[10px] text-slate-400 tabular-nums">{it.sub}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
        <span>当前文档 revision v{revision}（主帧率 {rate.num}/{rate.den} fps）</span>
        <span title="工作线程迟到结果已被代次令牌丢弃，不会回滚新编辑">
          {generationsDropped > 0 ? `🗑️ 已丢弃 ${generationsDropped} 个迟到预览结果` : "预览结果均为最新代次"}
        </span>
      </div>
    </div>
  );
};

export default PreviewStats;
