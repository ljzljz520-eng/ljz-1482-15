/**
 * 明确时间基（explicit timebase）
 * ----------------------------------------------------------------------------
 * 系统内部所有时间位置统一使用整数 tick：
 *   1 秒 = TICKS_PER_SECOND = 1_000_000_000 个 tick（纳秒精度）
 *
 * 帧率（frame rate）一律表示为有理数 Rate = num / den（帧/秒），
 * 例如：
 *   23.976...（24000/1001） -> { num: 24000, den: 1001 }
 *   29.97... （30000/1001） -> { num: 30000, den: 1001 }
 *   25                      -> { num: 25,     den: 1 }
 *   59.94...                -> { num: 60000, den: 1001 }
 *   48000Hz 音频采样        -> { num: 48000,  den: 1 }
 *
 * 帧 <-> tick 的转换只允许经过本模块中的整数运算（BigInt 中间过程），
 * 严禁用浮点秒反复累加：
 *   frameToTick(f) = f * TICKS_PER_SECOND * den / num   （整除向下取整）
 *   tickToFrame(t) = t * num / (TICKS_PER_SECOND * den) （整除向下取整）
 *
 * 整除采用向 -∞ 取整（floorDiv），保证往返与比较在不同帧率下确定性一致。
 */

export const TICKS_PER_SECOND = 1_000_000_000 as const;

/** 有理数帧率：num/den 帧每秒 */
export interface Rate {
  num: number;
  den: number;
}

export const RATE_24: Rate = { num: 24, den: 1 };
export const RATE_23976: Rate = { num: 24000, den: 1001 };
export const RATE_25: Rate = { num: 25, den: 1 };
export const RATE_30: Rate = { num: 30, den: 1 };
export const RATE_2997: Rate = { num: 30000, den: 1001 };
export const RATE_50: Rate = { num: 50, den: 1 };
export const RATE_60: Rate = { num: 60, den: 1 };
export const RATE_5994: Rate = { num: 60000, den: 1001 };
/** 音频采样率作为“帧率”处理 */
export const RATE_AUDIO_48K: Rate = { num: 48000, den: 1 };

export function rateEquals(a: Rate, b: Rate): boolean {
  return a.num === b.num && a.den === b.den;
}

export function rateToApproxFps(r: Rate): number {
  return r.num / r.den;
}

/** BigInt floor division（向负无穷取整） */
function floorDiv(x: bigint, y: bigint): bigint {
  let q = x / y;
  const r = x % y;
  if ((r !== 0n) && ((r < 0n) !== (y < 0n))) q -= 1n;
  return q;
}

/**
 * BigInt 向上取整。
 * frameToTick(f) 取“不早于精确帧边界的最小整数 tick”：
 * 这样保证 tickToFrame(frameToTick(f)) === f（floor 反算恒等），
 * 误差 < 1 tick（纳秒），且单调；任意 tick -> 帧号仍用 floor。
 */
function ceilDiv(x: bigint, y: bigint): bigint {
  const q = x / y;
  const r = x - q * y;
  return r > 0n ? q + 1n : q;
}

/** 帧号（源素材速率）-> 主时间线 tick */
export function frameToTick(frame: number, rate: Rate): number {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new RangeError(`frame 必须为非负整数，收到 ${frame}`);
  }
  const num = BigInt(rate.num);
  const den = BigInt(rate.den);
  const tps = BigInt(TICKS_PER_SECOND);
  // frame / (num/den) 秒 = frame * tps * den / num（num/den 是帧/秒）；先乘满再除，避免截断
  const ticks = ceilDiv(BigInt(frame) * tps * den, num);
  return Number(ticks);
}

/** 主时间线 tick -> 给定速率下的帧号（向下取整） */
export function tickToFrame(tick: number, rate: Rate): number {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`tick 必须为非负整数，收到 ${tick}`);
  }
  const num = BigInt(rate.num);
  const den = BigInt(rate.den);
  const tps = BigInt(TICKS_PER_SECOND);
  return Number(floorDiv(BigInt(tick) * num, tps * den));
}

/**
 * 在给定帧率下，将 tick 吸附到最近的帧格。
 * snap=true 时回到该帧起始 tick（同一帧内的 tick 归一化，避免半帧位置）。
 */
export function snapTickToFrame(tick: number, rate: Rate): number {
  const f = tickToFrame(tick, rate);
  return frameToTick(f, rate);
}

/**
 * tick -> 时间码字符串 HH:MM:SS:FF（drop-frame 以外的计数法，
 * 对 NTSC 分数帧率使用全帧计数，与 tick 精确对应）。
 */
export function formatTimecode(tick: number, rate: Rate): string {
  const totalFrames = tickToFrame(Math.max(0, tick), rate);
  const fps = rate.num / rate.den;
  const framesPerMinute = Math.round(fps * 60);
  const framesPerHour = framesPerMinute * 60;
  const h = Math.floor(totalFrames / framesPerHour);
  const m = Math.floor((totalFrames % framesPerHour) / framesPerMinute);
  const s = Math.floor((totalFrames % framesPerMinute) / Math.round(fps));
  const f = totalFrames % Math.round(fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/** tick -> 秒（仅用于展示，绝不参与运算累加） */
export function tickToDisplaySeconds(tick: number): number {
  return tick / TICKS_PER_SECOND;
}

/** 秒（浮点，仅展示）-> 形如 12.34s 的字符串 */
export function formatSecondsLabel(tick: number): string {
  return `${(tick / TICKS_PER_SECOND).toFixed(2)}s`;
}

/** 安全的整数 tick 相加（拒绝非整数/负数/越界，避免静默浮点污染） */
export function addTicks(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    throw new RangeError(`tick 运算只接受整数: ${a} + ${b}`);
  }
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new RangeError("tick 运算超出安全整数范围");
  return r;
}
