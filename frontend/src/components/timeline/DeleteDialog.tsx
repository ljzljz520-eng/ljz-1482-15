import { useState } from "react";
import type { CaptionPolicy, DeleteMode } from "@timeline/shared";

interface Props {
  clipName: string;
  onCancel: () => void;
  onConfirm: (options: { mode: DeleteMode; captions: CaptionPolicy; markers: CaptionPolicy; music: "ripple" | "stay" }) => void;
}

const modes: { value: DeleteMode; title: string; desc: string; icon: string }[] = [
  { value: "ripple", title: "波纹删除", desc: "删除后右侧片段整体左移，时间线缩短", icon: "🌊" },
  { value: "keep_absolute", title: "保留绝对位置", desc: "只移除片段，其余内容位置不变（可能产生空隙）", icon: "📌" },
  { value: "lift", title: "提升（留空隙）", desc: "移除片段内容但保留时间空隙", icon: "✂️" }
];

const DeleteDialog = ({ clipName, onCancel, onConfirm }: Props) => {
  const [mode, setMode] = useState<DeleteMode>("ripple");
  const [captions, setCaptions] = useState<CaptionPolicy>("detach");
  const [markers, setMarkers] = useState<CaptionPolicy>("detach");
  const [music, setMusic] = useState<"ripple" | "stay">("stay");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="w-full max-w-xl rounded-3xl bg-white shadow-card border border-slate-100 p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-bold text-slate-900">删除片段「{clipName}」</h2>
          <p className="text-sm text-slate-500 mt-1">删除方式会影响子标题、字幕锚点、标记与配乐，请明确选择。</p>
        </div>

        <div className="space-y-2">
          {modes.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`w-full text-left p-4 rounded-2xl border transition flex items-start gap-3 ${
                mode === m.value
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-slate-200 hover:border-primary/40 hover:bg-slate-50"
              }`}
            >
              <span className="text-xl leading-none mt-0.5">{m.icon}</span>
              <span>
                <span className="block text-sm font-semibold text-slate-900">{m.title}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PolicySelect
            label="子标题 / 字幕锚点"
            value={captions}
            onChange={setCaptions}
            options={[
              { value: "detach", label: "脱钩为绝对位置（保留）" },
              { value: "delete", label: "随片段一起删除" }
            ]}
          />
          <PolicySelect
            label="片段上的标记"
            value={markers}
            onChange={setMarkers}
            options={[
              { value: "detach", label: "脱钩为绝对位置（保留）" },
              { value: "delete", label: "随片段一起删除" }
            ]}
          />
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-600 mb-1.5">配乐（音频轨）</p>
          <div className="grid grid-cols-2 gap-2">
            {(["stay", "ripple"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setMusic(v)}
                className={`px-3 py-2 rounded-xl border text-sm font-medium transition ${
                  music === v
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-slate-200 text-slate-600 hover:border-accent/40"
                } ${mode !== "ripple" ? "opacity-50 cursor-not-allowed" : ""}`}
                disabled={mode !== "ripple"}
              >
                {v === "ripple" ? "跟随波纹平移" : "保留绝对位置"}
              </button>
            ))}
          </div>
          {mode !== "ripple" && <p className="text-[11px] text-slate-400 mt-1">非波纹删除时配乐总是保留在绝对位置</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition">
            取消
          </button>
          <button
            onClick={() => onConfirm({ mode, captions, markers, music })}
            className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent hover:opacity-90 active:scale-95 transition shadow-card"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
};

const PolicySelect = ({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (v: CaptionPolicy) => void;
  options: { value: CaptionPolicy; label: string }[];
}) => (
  <div>
    <p className="text-xs font-semibold text-slate-600 mb-1.5">{label}</p>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CaptionPolicy)}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

export default DeleteDialog;
