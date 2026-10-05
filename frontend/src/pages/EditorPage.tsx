import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useEditorStore } from "@/store/editorStore";
import { useLayoutWorker } from "@/hooks/useLayoutWorker";
import TimelineTracks from "@/components/timeline/TimelineTracks";
import TrackHeader from "@/components/timeline/TrackHeader";
import PreviewStats from "@/components/timeline/PreviewStats";
import Inspector from "@/components/timeline/Inspector";
import HistoryPanel from "@/components/timeline/HistoryPanel";
import DeleteDialog from "@/components/timeline/DeleteDialog";
import ConflictDialog from "@/components/timeline/ConflictDialog";
import Toolbar from "@/components/timeline/Toolbar";
import type { ClipDO, DeleteClipOptions } from "@timeline/shared";

const PROJECT_ID = "proj_demo";

const EditorPage = () => {
  const { doc, assets, loadProject, projectName, revision, saveState, commit } = useEditorStore();
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClipDO | null>(null);
  const [pxPerSec, setPxPerSec] = useState(60);
  const { layout, generationsDropped } = useLayoutWorker(doc);

  useEffect(() => {
    loadProject(PROJECT_ID);
  }, [loadProject]);

  const pxPerTick = pxPerSec / 1_000_000_000;
  const selectedClip = selectedClipId ? doc?.clips.find((c) => c.id === selectedClipId) ?? null : null;

  const orderedTracks = useMemo(() => {
    if (!doc) return [];
    const videos = doc.tracks.filter((t) => t.kind === "video");
    const audios = doc.tracks.filter((t) => t.kind === "audio");
    return [...videos, ...audios];
  }, [doc]);

  if (!doc) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-4">
        <div className="h-10 w-64 rounded-xl bg-slate-200/70 animate-pulse" />
        <div className="h-24 rounded-2xl bg-slate-200/70 animate-pulse" />
        <div className="h-[420px] rounded-2xl bg-slate-200/70 animate-pulse" />
      </div>
    );
  }

  const handleDeleteConfirm = async (options: DeleteClipOptions) => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    setSelectedClipId(null);
    await commit({ type: "clip/delete", clipId: id, options });
  };

  const saveBadge = {
    idle: { text: "待机", cls: "bg-slate-100 text-slate-500" },
    saving: { text: "● 保存中…", cls: "bg-amber-100 text-amber-700" },
    saved: { text: "✓ 已保存", cls: "bg-emerald-100 text-emerald-700" },
    conflict: { text: "⚠ 版本冲突", cls: "bg-red-100 text-red-700" },
    error: { text: "✕ 保存失败", cls: "bg-red-100 text-red-700" }
  }[saveState];

  return (
    <div className="h-screen flex flex-col p-3 gap-3 max-w-[1600px] mx-auto w-full">
      {/* 顶栏 */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/" className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary to-accent shadow-card flex items-center justify-center text-white font-bold">
            云溪
          </Link>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">{projectName}</h1>
            <p className="text-[11px] text-slate-400">多轨时间线编排 · 整数 tick 时间基 · 有理数帧率</p>
          </div>
          <span className={`ml-2 text-[11px] px-2.5 py-1 rounded-full font-medium ${saveBadge.cls}`}>v{revision} · {saveBadge.text}</span>
        </div>
        <div className="flex items-center gap-2">
          <UserSwitcher />
          <Toolbar assets={assets} pxPerSec={pxPerSec} setPxPerSec={setPxPerSec} />
          <Link
            to="/assets"
            className="px-3.5 py-2 rounded-xl text-sm font-medium border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary transition"
          >
            素材库
          </Link>
          <Link
            to="/renders"
            className="px-3.5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent hover:opacity-90 active:scale-95 transition shadow-card"
          >
            冻结并导出
          </Link>
        </div>
      </header>

      <PreviewStats layout={layout} rate={doc.rate} generationsDropped={generationsDropped} revision={revision} />

      {/* 三栏：历史 / 时间线 / 检查器 */}
      <div className="flex-1 flex gap-3 min-h-0">
        <HistoryPanel />
        <main className="flex-1 flex min-w-0">
          <TrackHeader tracks={orderedTracks} />
          <TimelineTracks
            doc={doc}
            pxPerTick={pxPerTick}
            layout={layout}
            selectedClipId={selectedClipId}
            setSelectedClipId={setSelectedClipId}
            onRequestDelete={(c) => setDeleteTarget(c)}
          />
        </main>
        <Inspector selectedClipId={selectedClipId} onDelete={() => selectedClip && setDeleteTarget(selectedClip)} />
      </div>

      {deleteTarget && <DeleteDialog clipName={assets.find((a) => a.id === deleteTarget.assetId)?.name ?? deleteTarget.id} onCancel={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirm} />}
      <ConflictDialog />
    </div>
  );
};

const UserSwitcher = () => {
  const [users, setUsers] = useState<{ id: string; name: string; color: string }[]>([]);
  const [userId, setUserId] = useState(localStorage.getItem("tl_user_id") ?? "user_alice");

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data: { id: string; name: string; color: string }[]) => {
        setUsers(data);
        if (!localStorage.getItem("tl_user_id") && data[0]) {
          localStorage.setItem("tl_user_id", data[0].id);
          setUserId(data[0].id);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <select
      value={userId}
      onChange={(e) => {
        localStorage.setItem("tl_user_id", e.target.value);
        setUserId(e.target.value);
      }}
      className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:border-primary outline-none"
      title="切换协作者身份（用于演示并发拖动冲突）"
    >
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
};

export default EditorPage;
