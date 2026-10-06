import { useEditorStore } from "@/store/editorStore";
import { tc } from "./format";

/**
 * 基线冲突对话框：并发拖动同一片段、他人编辑导致重基线失败、
 * 撤销前提被新编辑改变等情况统一在此呈现。绝不以“最后到达”静默覆盖。
 */
const ConflictDialog = () => {
  const conflict = useEditorStore((s) => s.conflict);
  const clear = useEditorStore((s) => s.clearConflict);
  const doc = useEditorStore((s) => s.doc);
  if (!conflict.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-card border border-amber-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-amber-50">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">!</span>
            <h3 className="text-lg font-semibold text-slate-900">版本冲突</h3>
          </div>
        </div>
        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-slate-700 leading-relaxed">{conflict.reason}</p>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-500 space-y-1">
            <p>
              服务端最新版本号：<span className="font-mono text-slate-800">rev {conflict.currentRevision}</span>
            </p>
            <p>您的编辑基于更旧的基线，系统已拒绝以“最后到达覆盖”的方式写入。</p>
            {doc && <p className="text-slate-400">当前时间线帧率 {doc.fps}，所有位置以整数 tick 计</p>}
            {doc && <p className="text-slate-400">游标时间 {tc(useEditorStore.getState().playhead, doc.fps)}</p>}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          {conflict.retry && (
            <button
              onClick={() => {
                const fn = conflict.retry;
                clear();
                fn?.();
              }}
              className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-100 transition"
            >
              强制重试
            </button>
          )}
          <button
            onClick={() => {
              const fn = conflict.forceReload;
              clear();
              fn?.();
            }}
            className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary to-accent shadow hover:opacity-90 active:scale-95 transition"
          >
            拉取最新版本并重做
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConflictDialog;
