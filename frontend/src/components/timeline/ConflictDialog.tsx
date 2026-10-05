import { useEditorStore } from "@/store/editorStore";
import { useState } from "react";

/**
 * 基线冲突对话框：并发拖动同一片段时，服务端拒绝“最后到达覆盖”。
 * 用户必须显式选择：放弃改动 / 在最新基线上重放 / 强制覆盖。
 */
const ConflictDialog = () => {
  const conflict = useEditorStore((s) => s.pendingConflict);
  const useServer = useEditorStore((s) => s.resolveConflictUseServer);
  const retry = useEditorStore((s) => s.resolveConflictRetry);
  const force = useEditorStore((s) => s.resolveConflictForce);
  const [busy, setBusy] = useState(false);

  if (!conflict) return null;

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-card border border-red-100 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <span className="h-10 w-10 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center text-xl shrink-0">⚠️</span>
          <div>
            <h2 className="text-lg font-bold text-slate-900">检测到并发编辑冲突</h2>
            <p className="text-sm text-slate-500 mt-1">
              你的操作基于版本 <b className="text-slate-700">v{conflict.baseRevision}</b>，但时间线已被他人更新到{" "}
              <b className="text-slate-700">v{conflict.serverRevision}</b>。
            </p>
            <p className="text-sm text-red-600 mt-2 font-medium">原因：{conflict.reason}</p>
          </div>
        </div>

        <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">
          系统不会用后到的操作静默覆盖他人的编辑。请选择如何处理你的本次改动。
        </div>

        <div className="space-y-2">
          <button
            disabled={busy}
            onClick={() => wrap(retry)}
            className="w-full text-left p-3.5 rounded-2xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-primary">在最新基线上重放</p>
            <p className="text-xs text-slate-500 mt-0.5">先采纳他人修改，再尝试把我的操作应用到新版本（推荐）</p>
          </button>
          <button
            disabled={busy}
            onClick={() => wrap(useServer)}
            className="w-full text-left p-3.5 rounded-2xl border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-slate-700">放弃我的改动，采用最新版本</p>
            <p className="text-xs text-slate-500 mt-0.5">丢弃本次拖动，刷新为协作者的版本</p>
          </button>
          <button
            disabled={busy}
            onClick={() => wrap(force)}
            className="w-full text-left p-3.5 rounded-2xl border border-red-200 hover:bg-red-50 transition disabled:opacity-50"
          >
            <p className="text-sm font-semibold text-red-600">强制覆盖（以我的版本为准）</p>
            <p className="text-xs text-slate-500 mt-0.5">可能抹掉他人的编辑结果，请谨慎使用</p>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConflictDialog;
