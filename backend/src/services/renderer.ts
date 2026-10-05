/**
 * 渲染器（确定性、纯计算，基于冻结快照）：
 *  - edl：生成文本 EDL（CMX3600 风格），时间用 tick/帧号整数表达；
 *  - preview：生成 SVG 时间线海报。
 * 真正的视频编码由下游编码器消费 EDL；这里不引入浮点秒累加。
 */

import {
  exportRange,
  formatTimecode,
  resolveCaptions,
  resolveMarkers,
  tickToFrame,
  timelineContentEnd,
  type AssetDO,
  type FrozenTimeline
} from "@timeline/shared";

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);
}

export function renderEdl(frozen: FrozenTimeline): string {
  const { doc, assets } = frozen;
  const rate = doc.rate;
  const range = exportRange(doc);
  const assetById = new Map<string, AssetDO>(assets.map((a) => [a.id, a]));
  const lines: string[] = [
    `TITLE: ${esc(frozen.label)}`,
    `FCM: NON-DROP FRAME`,
    `# REVISION ${frozen.revision} FROZEN ${frozen.id}`,
    `# EXPORT RANGE tick ${range.start}..${range.end} rate ${rate.num}/${rate.den}`
  ];
  let event = 1;
  const clips = doc.clips.slice().sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId));
  for (const clip of clips) {
    if (clip.start + clip.duration <= range.start || clip.start >= range.end) continue;
    const asset = assetById.get(clip.assetId);
    const srcRate = asset?.rate ?? rate;
    const recIn = formatTimecode(Math.max(0, clip.start - range.start), rate);
    const recOut = formatTimecode(Math.max(0, clip.start + clip.duration - range.start), rate);
    // 素材入出点帧号直接由源速率整数换算，绝不使用浮点秒
    const srcIn = frameTc(clip.inPoint, srcRate);
    const srcOut = frameTc(clip.outPoint, srcRate);
    lines.push(
      `${String(event).padStart(3, "0")}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`
    );
    lines.push(`* FROM CLIP NAME: ${esc(asset?.name ?? clip.assetId)} (src ${srcRate.num}/${srcRate.den})`);
    event += 1;
  }
  for (const cap of resolveCaptions(doc)) {
    if (cap.tick < range.start || cap.tick >= range.end) continue;
    lines.push(`# CAPTION @tick${cap.tick} ${formatTimecode(cap.tick - range.start, rate)} ${esc(cap.text)}`);
  }
  for (const m of resolveMarkers(doc)) {
    lines.push(`# MARKER @tick${m.tick} ${esc(m.label)}`);
  }
  lines.push(`# CONTENT END tick ${timelineContentEnd(doc)}`);
  return lines.join("\n");
}

function frameTc(tick: number, rate: { num: number; den: number }): string {
  // EDL 使用时间码：tick -> 帧号（整数）-> 时间码，不经过浮点秒
  return formatTimecodeFromFrame(tickToFrame(tick, rate), rate);
}

function formatTimecodeFromFrame(totalFrames: number, rate: { num: number; den: number }): string {
  const fps = rate.num / rate.den;
  const fpm = Math.round(fps * 60);
  const fph = fpm * 60;
  const pf = Math.round(fps);
  const h = Math.floor(totalFrames / fph);
  const m = Math.floor((totalFrames % fph) / fpm);
  const sec = Math.floor((totalFrames % fpm) / pf);
  const f = totalFrames % pf;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}:${pad(f)}`;
}

export function renderSvgPoster(frozen: FrozenTimeline): string {
  const { doc, assets } = frozen;
  const width = 960;
  const trackHeight = 46;
  const header = 70;
  const videoTracks = doc.tracks.filter((t) => t.kind === "video");
  const audioTracks = doc.tracks.filter((t) => t.kind === "audio");
  const height = header + (videoTracks.length + audioTracks.length) * (trackHeight + 12) + 80;
  const end = Math.max(exportRange(doc).end, 1);
  const x = (tick: number) => 24 + (tick / end) * (width - 48);
  const colors = ["#165DFF", "#3b82f6", "#0ea5e9", "#6366f1"];
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#f8fafc"/>`,
    `<text x="24" y="32" font-family="Inter,Arial" font-size="20" font-weight="700" fill="#0f172a">${esc(frozen.label)}</text>`,
    `<text x="24" y="54" font-family="Inter,Arial" font-size="12" fill="#64748b">冻结版本 revision=${frozen.revision} · 帧率 ${doc.rate.num}/${doc.rate.den}fps · 总时长 ${(end / 1e9).toFixed(2)}s</text>`
  ];

  let ty = header;
  for (const t of [...videoTracks, ...audioTracks]) {
    parts.push(`<rect x="24" y="${ty}" width="${width - 48}" height="${trackHeight}" rx="10" fill="#eef2ff"/>`);
    const items = t.kind === "video" ? doc.clips.filter((c) => c.trackId === t.id) : doc.audioClips.filter((c) => c.trackId === t.id);
    items.forEach((c, i) => {
      const cx = x(c.start);
      const cw = Math.max(3, x(c.start + c.duration) - cx);
      const fill = t.kind === "video" ? colors[i % colors.length] : "#FF7D00";
      parts.push(`<rect x="${cx.toFixed(1)}" y="${ty + 6}" width="${cw.toFixed(1)}" height="${trackHeight - 12}" rx="7" fill="${fill}" opacity="0.85"/>`);
      const name = esc(assetById.get(c.assetId)?.name ?? c.id);
      parts.push(`<text x="${(cx + 8).toFixed(1)}" y="${ty + 27}" font-family="Inter,Arial" font-size="11" fill="#ffffff">${name}</text>`);
    });
    parts.push(`<text x="${width - 20}" y="${ty + 18}" text-anchor="end" font-family="Inter,Arial" font-size="10" fill="#94a3b8">${esc(t.name)}</text>`);
    ty += trackHeight + 12;
  }

  for (const m of resolveMarkers(doc)) {
    const mx = x(m.tick);
    parts.push(`<line x1="${mx}" y1="${header - 6}" x2="${mx}" y2="${height - 60}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${(mx + 3).toFixed(1)}" y="${header + 8}" font-family="Inter,Arial" font-size="10" fill="#ef4444">${esc(m.label)}</text>`);
  }
  const r = exportRange(doc);
  parts.push(`<text x="24" y="${height - 24}" font-family="Inter,Arial" font-size="12" fill="#475569">导出范围（同源时间模型）：tick ${r.start} → ${r.end}</text>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}
