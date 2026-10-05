import { useEditorStore } from "@/store/editorStore";

/**
 * 操作历史：服务端持久化（跨刷新、跨设备保留，最近 100 条；
 * 产品要求“撤销至少跨刷新保留五步”）。撤销本身也是新的历史条目，
 * 服务端在应用逆向补丁后重新全量校验 —— 他人编辑导致不可逆时返回冲突。
 */
const HistoryPanel = () => {
  const history = useEditorStore((s) => s.history);
  const undo = useEditorStore((s) => s.undo);

  return (
    <div className="w-64 shrink-0 rounded-2xl border border-slate-200 bg-white/70 p-3 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-800">历史（可跨刷新撤销）</h3>
        <button
          onClick={undo}
          className="text-[11px] px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition font-semibold"
        >
          ↩ 撤销
        </button>
      </div>
      <div className="space-y-1 overflow-auto flex-1">
        {history.map((h) => (
          <div
            key={h.id}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-2 ${
              h.undoneById ? "opacity-40 line-through" : "bg-slate-50"
            }`}
            title={new Date(h.createdAt).toLocaleString()}
          >
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: h.userColor }} />
            <span className="text-slate-700 truncate flex-1">{h.summary}</span>
            <span className="text-slate-400 tabular-nums">v{h.revision}</span>
          </div>
        ))}
        {history.length === 0 && <p className="text-[11px] text-slate-400">暂无操作记录</p>}
      </div>
    </div>
  );
};

export default HistoryPanel;
