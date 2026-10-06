import { useEffect, useMemo, useState } from "react";
import { timelineApi } from "@/api/timeline";
import type { DeletePolicy, DeleteEffect } from "@timeline/core";
import { useEditorStore } from "@/store/editorStore";
import { toast } from "react-hot-toast";

interface Props {
  clipId: string;
  onClose: () => void;
}

const policyLabels: Record<DeleteEffect["kind"], string> = {
  remove: "删除",
  shift: "位移",
  detach: "解除锚点",
  "marker-shift": "标记移动",
  "marker-remove": "标记删除",
  "transition-drop": "转场解除",
  "export-adjust": "导出范围调整"
};

/**
 * 删除确认对话框：让用户显式选择
 *  1) 波纹删除（闭合）还是保留绝对位置（lift）
 *  2) 锚定字幕/配音如何处理（删除/留位/跟随）
 *  3) 配乐跟随还是保持绝对位置
 * 影响预览由后端依据当前文档+策略实时计算。
 */
const DeleteDialog = ({ clipId, onClose }: Props) => {
  const doc = useEditorStore((s) => s.doc);
  const revision = useEditorStore((s) => s.revision);
  const dispatchDelete = useEditorStore((s) => s.dispatchDelete);
  const [mode, setMode] = useState<DeletePolicy["mode"]>("ripple");
  const [subtitles, setSubtitles] = useState<DeletePolicy["subtitles"]>("follow");
  const [music, setMusic] = useState<DeletePolicy["music"]>("follow");
  const [effects, setEffects] = useState<DeleteEffect[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const clipName = useMemo(() => doc?.clips.find((c) => c.id === clipId)?.name ?? clipId, [doc, clipId]);

  useEffect(() => {
    let cancelled = false;
    const policy: DeletePolicy = { mode, subtitles, music };
    setLoading(true);
    timelineApi
      .previewDelete(useEditorStore.getState().timelineId!, clipId, policy)
      .then((r) => {
        if (!cancelled) setEffects(r.effects);
      })
      .catch(() => {
        if (!cancelled) setEffects([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clipId, mode, subtitles, music, revision]);

  const confirm = async () => {
    setSubmitting(true);
    const ok = await dispatchDelete(clipId, { mode, subtitles, music });
    setSubmitting(false);
    if (ok) {
      toast.success(mode === "ripple" ? "已波纹删除" : "已删除（保留绝对位置）");
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-card border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-primary/5 to-accent/5">
          <h3 className="text-lg font-semibold text-slate-900">删除片段「{clipName}」</h3>
          <p className="text-sm text-slate-500 mt-1">请明确选择删除对时间线、字幕锚点与配乐的影响</p>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
          <section>
            <p className="text-sm font-semibold text-slate-800 mb-2">时间线闭合方式</p>
            <div className="grid grid-cols-2 gap-3">
              <Choice
                active={mode === "ripple"}
                onClick={() => setMode("ripple")}
                title="波纹删除"
                desc="后续内容左移闭合，总长缩短"
              />
              <Choice
                active={mode === "lift"}
                onClick={() => setMode("lift")}
                title="保留绝对位置"
                desc="留下空洞，其它片段位置不变"
              />
            </div>
          </section>

          <section>
            <p className="text-sm font-semibold text-slate-800 mb-2">锚定到该片段的字幕 / 配音</p>
            <div className="grid grid-cols-3 gap-2">
              <Choice small active={subtitles === "follow"} onClick={() => setSubtitles("follow")} title="跟随" desc="随波纹移动并解除锚点" />
              <Choice small active={subtitles === "detach"} onClick={() => setSubtitles("detach")} title="保留位置" desc="解除锚点留在原时间" />
              <Choice small active={subtitles === "delete"} onClick={() => setSubtitles("delete")} title="一并删除" desc="移除关联字幕/配音" />
            </div>
          </section>

          <section>
            <p className="text-sm font-semibold text-slate-800 mb-2">背景音乐</p>
            <div className="grid grid-cols-2 gap-3">
              <Choice active={music === "follow"} onClick={() => setMusic("follow")} title="跟随波纹" desc="音乐随时间线左移" />
              <Choice active={music === "hold"} onClick={() => setMusic("hold")} title="保持绝对位置" desc="音乐不随删除移动" />
            </div>
          </section>

          <section className="rounded-xl bg-slate-50 border border-slate-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-700">影响预览（服务端实时计算）</p>
              {loading && <span className="text-xs text-slate-400">计算中…</span>}
            </div>
            {effects.length === 0 && !loading ? (
              <p className="text-xs text-slate-400">没有连带影响</p>
            ) : (
              <ul className="space-y-1.5">
                {effects.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span
                      className={
                        "mt-0.5 shrink-0 px-1.5 py-0.5 rounded-md font-medium " +
                        (e.kind === "remove" || e.kind === "marker-remove"
                          ? "bg-rose-50 text-rose-600"
                          : e.kind === "transition-drop"
                            ? "bg-amber-50 text-amber-600"
                            : "bg-blue-50 text-blue-600")
                      }
                    >
                      {policyLabels[e.kind]}
                    </span>
                    <div>
                      <span className="font-medium text-slate-700">{e.label}</span>
                      <span className="text-slate-500"> — {e.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
          >
            取消
          </button>
          <button
            disabled={submitting}
            onClick={confirm}
            className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-primary to-accent shadow-card hover:opacity-90 active:scale-95 transition disabled:opacity-50"
          >
            {submitting ? "提交中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
};

const Choice = ({
  active,
  onClick,
  title,
  desc,
  small
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  small?: boolean;
}) => (
  <button
    onClick={onClick}
    className={
      "text-left rounded-xl border p-3 transition active:scale-[0.98] " +
      (active
        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
        : "border-slate-200 bg-white hover:border-primary/40")
    }
  >
    <p className={small ? "text-xs font-semibold text-slate-800" : "text-sm font-semibold text-slate-800"}>{title}</p>
    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{desc}</p>
  </button>
);

export default DeleteDialog;
