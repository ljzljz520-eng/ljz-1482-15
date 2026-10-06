import { useEffect, useState } from "react";
import { renderApi } from "@/api/timeline";
import type { RenderJob } from "@/api/types";
import { useEditorStore } from "@/store/editorStore";
import { tc } from "./format";
import { toast } from "react-hot-toast";

/**
 * 渲染面板：创建任务时冻结时间线版本，之后的编辑不影响该任务。
 * 任务卡片显示冻结时的 revision 与基于同一 tick 模型的导出范围。
 */
const RenderPanel = ({ timelineId }: { timelineId: string }) => {
  const doc = useEditorStore((s) => s.doc);
  const revision = useEditorStore((s) => s.revision);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setJobs(await renderApi.list(timelineId));
  };
  useEffect(() => {
    void load();
  }, [timelineId]);

  const create = async () => {
    setCreating(true);
    try {
      await renderApi.create(timelineId);
      toast.success("渲染任务已创建：时间线版本已冻结");
      await load();
    } catch (e) {
      toast.error("创建失败：时间线校验未通过（可能有悬空引用）");
    } finally {
      setCreating(false);
    }
  };

  const advance = async (id: string) => {
    setBusyId(id);
    await renderApi.advance(id);
    await load();
    setBusyId(null);
  };

  if (!doc) return null;

  return (
    <div className="w-72 shrink-0 border-l border-slate-200 bg-white/70 backdrop-blur flex flex-col">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">导出 / 渲染</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">任务使用冻结的时间线快照</p>
        </div>
        <button
          onClick={create}
          disabled={creating}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-primary to-accent shadow hover:opacity-90 active:scale-95 transition disabled:opacity-50"
        >
          {creating ? "冻结中…" : "新建渲染"}
        </button>
      </div>
      <div className="px-4 py-2 border-b border-slate-100 text-[11px] text-slate-500 space-y-0.5 font-mono">
        <p>当前可编辑版本 rev {revision}</p>
        <p>
          导出 {tc(doc.exportStart ?? 0, doc.fps)} → {tc(doc.exportEnd ?? 1, doc.fps)}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {jobs.length === 0 && <p className="text-xs text-slate-400">尚无渲染任务</p>}
        {jobs.map((j) => (
          <div key={j.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span
                className={
                  "text-[10px] font-semibold px-1.5 py-0.5 rounded-md " +
                  (j.status === "done"
                    ? "bg-emerald-50 text-emerald-600"
                    : j.status === "failed"
                      ? "bg-rose-50 text-rose-600"
                      : "bg-blue-50 text-blue-600")
                }
              >
                {j.status.toUpperCase()}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">{j.id.slice(-6)}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={"h-full rounded-full " + (j.status === "done" ? "bg-emerald-400" : "bg-primary")}
                style={{ width: `${j.progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-slate-500">
              冻结范围 {j.exportStart}–{j.exportEnd} tick · {j.fps}fps
            </p>
            {j.message && <p className="mt-1 text-[10px] text-slate-400 leading-snug">{j.message}</p>}
            {j.status !== "done" && j.status !== "failed" && (
              <button
                onClick={() => void advance(j.id)}
                disabled={busyId === j.id}
                className="mt-2 w-full py-1 rounded-lg text-[11px] font-medium border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
              >
                {busyId === j.id ? "推进中…" : "推进编码（模拟）"}
              </button>
            )}
            {j.status === "done" && j.resultUrl && (
              <p className="mt-1.5 text-[10px] text-emerald-600 font-mono truncate">{j.resultUrl}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default RenderPanel;
