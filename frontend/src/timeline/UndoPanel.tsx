import { useEditorStore } from "@/store/editorStore";

/**
 * 撤销记录面板：记录持久化在服务端（跨刷新保留最近 50 步）。
 * stale 的记录表示其后出现了新编辑，撤销时会先要求重算/确认可逆条件。
 */
const UndoPanel = () => {
  const items = useEditorStore((s) => s.undoItems);
  const undo = useEditorStore((s) => s.undo);

  return (
    <div className="w-56 shrink-0 border-r border-slate-200 bg-white/70 backdrop-blur flex flex-col">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">历史记录</h3>
        <p className="text-[11px] text-slate-400 mt-0.5">服务端持久化 · 跨刷新保留（≥5 步）</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {items.length === 0 && <p className="text-xs text-slate-400 px-2 py-3">暂无历史操作</p>}
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => void undo(it)}
            className={
              "w-full text-left px-2.5 py-2 rounded-lg text-xs transition group " +
              (it.reversible
                ? "hover:bg-primary/10 text-slate-700"
                : "bg-slate-50 text-slate-400 hover:bg-amber-50")
            }
            title={it.stale ? "该操作之后存在新编辑，撤销需重算可逆条件" : "撤销此步（栈顶）"}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">↶ {it.label}</span>
              <span className="text-[10px] font-mono opacity-60">#{it.seq}</span>
            </div>
            {it.stale && <span className="text-[10px] text-amber-600">含他人编辑 · 点击重算</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

export default UndoPanel;
