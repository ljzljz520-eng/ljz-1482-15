/**
 * 布局预览工作线程：把时间线文档投影为 UI 渲染所需的布局结果。
 * 消息携带 generation（单调代次）：主线程只接受代次最新的结果，
 * 迟到的旧结果会被丢弃 —— “工作线程迟到结果不能回滚新编辑”。
 *
 * 所有计算复用 @timeline/shared 的同一组选择器，
 * 预览总长/标记/导出范围与后端渲染任务读同一个时间模型。
 */

import {
  exportRange,
  previewTotalTicks,
  resolveCaptions,
  resolveMarkers,
  timelineContentEnd,
  type TimelineDoc
} from "@timeline/shared";

export interface LayoutResult {
  generation: number;
  revision: number;
  totalTicks: number;
  contentEnd: number;
  exportRange: { start: number; end: number };
  markers: { id: string; label: string; tick: number; attached: boolean }[];
  captions: { id: string; text: string; tick: number }[];
  clipCount: number;
  audioCount: number;
  transitionCount: number;
}

export interface LayoutRequest {
  generation: number;
  doc: TimelineDoc;
}

self.onmessage = (ev: MessageEvent<LayoutRequest>) => {
  const { generation, doc } = ev.data;
  // 模拟较重的计算（真实场景包括吸附线、缩略图排布等）
  const start = performance.now();
  while (performance.now() - start < 30) {
    // 占用约 30ms 主线程外时间，使“迟到结果”在快速编辑时可观察
  }
  const result: LayoutResult = {
    generation,
    revision: doc.revision,
    totalTicks: previewTotalTicks(doc),
    contentEnd: timelineContentEnd(doc),
    exportRange: exportRange(doc),
    markers: resolveMarkers(doc),
    captions: resolveCaptions(doc),
    clipCount: doc.clips.length,
    audioCount: doc.audioClips.length,
    transitionCount: doc.transitions.length
  };
  (self as unknown as Worker).postMessage(result);
};
