import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "@/api/timeline";
import type { AssetDO } from "@timeline/shared";
import { TICKS_PER_SECOND } from "@timeline/shared";
import toast from "react-hot-toast";

const PROJECT_ID = "proj_demo";

const AssetsPage = () => {
  const [project, setProject] = useState<Awaited<ReturnType<typeof api.fetchProject>> | null>(null);

  const refresh = async () => setProject(await api.fetchProject(PROJECT_ID));
  useEffect(() => {
    refresh();
  }, []);

  const retire = async (asset: AssetDO) => {
    await api.retireAsset(PROJECT_ID, asset.id);
    toast.success(`素材「${asset.name}」已退役：引用它的片段将被锁定，不能再拖动/编辑；已冻结渲染仍可完成`);
    await refresh();
  };

  if (!project) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-3">
        <div className="h-8 w-56 rounded-xl bg-slate-200/70 animate-pulse" />
        <div className="h-40 rounded-2xl bg-slate-200/70 animate-pulse" />
      </div>
    );
  }

  // 统计每个素材被哪些片段引用
  const usage = new Map<string, { clips: number; audio: number }>();
  for (const c of project.doc.clips) usage.set(c.assetId, { clips: (usage.get(c.assetId)?.clips ?? 0) + 1, audio: usage.get(c.assetId)?.audio ?? 0 });
  for (const a of project.doc.audioClips) usage.set(a.assetId, { clips: usage.get(a.assetId)?.clips ?? 0, audio: (usage.get(a.assetId)?.audio ?? 0) + 1 });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <header>
        <Link to="/" className="text-xs text-primary hover:underline">← 返回编辑器</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">素材库</h1>
        <p className="text-sm text-slate-500 mt-1">
          素材时长以源帧率的整数帧换算为 tick 存储。退役素材不会删除（外键 Restrict），但引用它的片段立即锁定编辑。
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {project.assets.map((a) => {
          const u = usage.get(a.id) ?? { clips: 0, audio: 0 };
          const fps = a.rate.num / a.rate.den;
          return (
            <div
              key={a.id}
              className={`rounded-2xl border p-4 transition ${
                a.status === "retired" ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-white/80 hover:shadow-card"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-2xl">{a.kind === "audio" ? "🎵" : a.kind === "image" ? "🖼️" : "🎬"}</span>
                  <h3 className="text-sm font-bold text-slate-800 mt-1">{a.name}</h3>
                </div>
                {a.status === "retired" && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-semibold">已退役</span>
                )}
              </div>
              <dl className="mt-3 space-y-1 text-[11px] text-slate-500">
                <div className="flex justify-between"><dt>帧率/采样率</dt><dd className="tabular-nums">{a.rate.num}/{a.rate.den} ({fps % 1 === 0 ? fps : fps.toFixed(3)})</dd></div>
                <div className="flex justify-between"><dt>时长</dt><dd className="tabular-nums">{(a.duration / TICKS_PER_SECOND).toFixed(3)}s</dd></div>
                <div className="flex justify-between"><dt>时长(tick)</dt><dd className="tabular-nums">{a.duration}</dd></div>
                {a.width && <div className="flex justify-between"><dt>分辨率</dt><dd>{a.width}×{a.height}</dd></div>}
                <div className="flex justify-between"><dt>时间线引用</dt><dd>视频 {u.clips} · 音频 {u.audio}</dd></div>
              </dl>
              {a.status === "active" ? (
                <button
                  onClick={() => retire(a)}
                  className="mt-3 w-full px-3 py-2 rounded-xl text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition"
                >
                  退役素材（验收：拖拽中被退役）
                </button>
              ) : (
                <p className="mt-3 text-[11px] text-red-500 leading-relaxed">
                  该素材被时间线引用，不能物理删除；引用片段已锁定，新编辑会被后端拒绝（E_ASSET_RETIRED）。
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AssetsPage;
