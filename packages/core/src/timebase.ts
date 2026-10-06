import { Rational } from "./rational.js";

/**
 * ============================================================================
 * 统一时间基（Time Base）
 * ============================================================================
 * 时间线内部所有位置、长度、入出点、转场重叠、音频偏移、标记、导出范围
 * 一律使用 **整数 tick**。TICKS_PER_SECOND = 240_000，它是
 * 23.976/24/25/29.97/30/48/50/59.94/60 等常见帧率每帧 tick 数的整数倍，
 * 也是 48k 音频采样间隔 tick 数（5）的整数倍：
 *
 *   23.976 -> 10010 tick/帧   29.97 -> 8008   59.94 -> 4004
 *   24     -> 10000           30    -> 8000   60    -> 4000
 *   25     -> 9600            50    -> 4800
 *
 * 因此帧 <-> tick 与音频采样 <-> tick 的互换可以做到“精确整数”，
 * 禁止使用浮点秒做累加（浮点只出现在最终显示环节）。
 * ============================================================================
 */
export const TICKS_PER_SECOND = 240_000;

/** 常见帧率的有理数表达（num/den 帧/秒），杜绝 29.97 之类的二进制浮点近似 */
export const FRAME_RATES: Record<string, Rational> = {
  "23.976": Rational.of(24000, 1001),
  "24": Rational.of(24, 1),
  "25": Rational.of(25, 1),
  "29.97": Rational.of(30000, 1001),
  "30": Rational.of(30, 1),
  "48": Rational.of(48, 1),
  "50": Rational.of(50, 1),
  "59.94": Rational.of(60000, 1001),
  "60": Rational.of(60, 1)
};

export type Tick = number;

/** 每帧持续多少 tick（精确整数；非整除帧率由时间基保证整除） */
export function ticksPerFrame(fps: Rational): number {
  const r = Rational.of(BigInt(TICKS_PER_SECOND), 1).div(fps);
  if (!Number.isInteger(r.toNumber())) {
    throw new Error(`timebase: fps ${fps} does not map to integer ticks/frame`);
  }
  return Number(r.floor());
}

/** 帧索引 -> 该帧起点的 tick（frame 可为任意整数） */
export function frameToTick(frame: number, fps: Rational): Tick {
  const tpf = ticksPerFrame(fps);
  return frame * tpf;
}

/** tick -> 所属帧索引（floor，永不使用 Math.round(seconds*fps)） */
export function tickToFrame(tick: Tick, fps: Rational): number {
  const tpf = ticksPerFrame(fps);
  return Math.floor(tick / tpf);
}

/** 把任意 tick 吸附到该帧率的帧网格上 */
export function snapToFrame(tick: Tick, fps: Rational): Tick {
  const tpf = ticksPerFrame(fps);
  return Math.round(tick / tpf) * tpf;
}

/** 音频采样索引 -> tick（例如 48kHz：每采样恰好 5 tick） */
export function sampleToTick(sample: number, sampleRate: number): Tick {
  const ticksPerSample = TICKS_PER_SECOND / sampleRate;
  if (!Number.isInteger(ticksPerSample)) {
    throw new Error(`timebase: sample rate ${sampleRate} does not map to integer ticks/sample`);
  }
  return sample * ticksPerSample;
}

/** tick -> 音频采样索引（floor） */
export function tickToSample(tick: Tick, sampleRate: number): number {
  return Math.floor((tick * sampleRate) / TICKS_PER_SECOND);
}

/** 任意来源帧率（num/den）校验：能否在整数 tick 上精确表达 */
export function isExactFrameRate(fps: Rational): boolean {
  const r = Rational.of(BigInt(TICKS_PER_SECOND), 1).div(fps);
  return Number.isInteger(r.toNumber());
}

/** tick -> 浮点秒，仅用于最终显示 */
export function ticksToSeconds(tick: Tick): number {
  return tick / TICKS_PER_SECOND;
}

/** 显示用：秒保留 3 位小数 */
export function formatSeconds(tick: Tick): string {
  return ticksToSeconds(tick).toFixed(3);
}

/**
 * tick -> SMPTE 时间码。
 * 29.97 / 59.94 使用丢帧（drop-frame）时间码，其余为非丢帧。
 * 全程整数运算，避免累计漂移。
 */
export function formatTimecode(tick: Tick, fps: Rational): string {
  // 名义帧率：23.976->24, 29.97->30, 59.94->60；其余帧率回到自身取整
  const nominal = Number(fps.mul(Rational.of(1001, 1000)).round());
  const drop = fps.toString() === "30000/1001" || fps.toString() === "60000/1001";
  const tpf = ticksPerFrame(fps);
  let totalFrames = Math.floor(tick / tpf);
  const framesPerMinute = nominal * 60;
  let framesPer10Min: number;
  let dropFrames: number;
  if (drop) {
    dropFrames = Math.round(nominal * 0.066666); // 2 (29.97) / 4 (59.94)
    framesPer10Min = framesPerMinute * 10 - dropFrames * 9;
    const d = Math.floor(totalFrames / framesPer10Min);
    const r = totalFrames - d * framesPer10Min;
    totalFrames += d * dropFrames * 9 + dropFrames * Math.floor(r / (framesPerMinute - dropFrames));
  }
  const f = totalFrames % nominal;
  const s = Math.floor(totalFrames / nominal) % 60;
  const m = Math.floor(totalFrames / (nominal * 60)) % 60;
  const h = Math.floor(totalFrames / (nominal * 3600));
  const pad = (v: number) => String(v).padStart(2, "0");
  const sep = drop ? ";" : ":";
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(f)}`;
}
