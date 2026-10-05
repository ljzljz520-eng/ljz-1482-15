import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "@/api/timeline";
import type { FreezeItem, JobItem } from "@/api/types";
import { TICKS_PER_SECOND, formatTimecode } from "@timeline/shared";
import toast from "react-hot-toast";

const PROJECT_ID = "proj_demo";

const STATUS_META: Record<JobItem["status"], { label: string; cls: string }> = {
  queued: { label: "排队中", cls: "bg-slate-100 text-slate-600" },
  running: { label: "渲染中（冻结版本）", cls: "bg-blue-100 text-blue-700" },
  succeeded: { label: "成功", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "失败", cls: "bg-red-100 text-red-700" }
};

const RendersPage = () => {
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [freezes, setFreezes] = useState<FreezeItem[]>([]);
  const [activeJob, setActiveJob] = useState<JobItem | null>(null);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [j, f] = await Promise.all([api.fetchJobs(PROJECT_ID), api.fetchFreezes(PROJECT_ID)]);
    setJobs(j);
    setFreezes(f);
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 2000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [refresh]);

  const createRender = async (kind: "edl" | "preview") => {
    setBusy(true);
    try {
      await api.freezeAndRender(PROJECT_ID, kind, undefined, true);
      toast.success("已冻结当前时间线并提交渲染任务");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link to="/" className="text-xs text-primary hover:underline">← 返回编辑器</Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">冻结版本与渲染队列</h1>
          <p className="text-sm text-slate-500 mt-1">
            渲染任务读取提交时刻冻结的时间线快照；提交后继续编辑不会影响进行中的任务。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => createRender("edl")}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent hover:opacity-90 active:scale-95 disabled:opacity-50 transition shadow-card"
          >
            ❄️ 冻结并导出 EDL
          </button>
          <button
            disabled={busy}
            onClick={() => createRender("preview")}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-primary text-primary hover:bg-primary/10 active:scale-95 disabled:opacity-50 transition"
          >
            🖼️ 冻结并生成海报
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
          <h2 className="text-sm font-bold text-slate-800 mb-3">渲染任务</h2>
          <div className="space-y-2">
            {jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => setActiveJob(j)}
                className="w-full text-left px-3.5 py-3 rounded-xl border border-slate-100 bg-slate-50/60 hover:border-primary/40 transition flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {j.kind === "edl" ? "EDL 导出" : "时间线海报"} · v{j.revision}
                  </p>
                  <p className="text-[11px] text-slate-400">{new Date(j.createdAt).toLocaleString()}</p>
                  {j.error && <p className="text-[11px] text-red-500 mt-0.5">{j.error}</p>}
                </div>
                <span className={`text-[11px] px-2 py-1 rounded-full font-medium shrink-0 ${STATUS_META[j.status].cls}`}>
                  {STATUS_META[j.status].label}
                </span>
              </button>
            ))}
            {jobs.length === 0 && <p className="text-xs text-slate-400">尚无渲染任务</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
          <h2 className="text-sm font-bold text-slate-800 mb-3">已冻结版本</h2>
          <div className="space-y-2">
            {freezes.map((f) => (
              <div key={f.id} className="px-3.5 py-2.5 rounded-xl bg-slate-50/60 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{f.label}</p>
                  <p className="text-[11px] text-slate-400">{new Date(f.createdAt).toLocaleString()}</p>
                </div>
                <code className="text-[10px] text-slate-400">{f.id.slice(-8)}</code>
              </div>
            ))}
            {freezes.length === 0 && <p className="text-xs text-slate-400">尚未冻结过时间线</p>}
          </div>
        </div>
      </section>

      {activeJob && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-800">
              任务结果 · v{activeJob.revision}（{activeJob.status}）
            </h2>
            <button onClick={() => setActiveJob(null)} className="text-slate-400 hover:text-slate-600 text-sm">关闭 ✕</button>
          </div>
          {activeJob.kind === "preview" && activeJob.result ? (
            <div className="overflow-auto rounded-xl border border-slate-100" dangerouslySetInnerHTML={{ __html: activeJob.result }} />
          ) : (
            <pre className="text-[11px] leading-relaxed bg-slate-900 text-slate-100 rounded-xl p-4 overflow-auto max-h-[420px] whitespace-pre-wrap">
              {activeJob.result ?? "（结果尚未生成）"}
            </pre>
          )}
          <p className="text-[11px] text-slate-400 mt-2">
            导出范围与时间码来自冻结文档的同一时间模型（时间基 {TICKS_PER_SECOND.toLocaleString()} tick/秒）。
            示例：{formatTimecode(5 * TICKS_PER_SECOND, { num: 25, den: 1 })}
          </p>
        </section>
      )}
    </div>
  );
};

export default RendersPage;
