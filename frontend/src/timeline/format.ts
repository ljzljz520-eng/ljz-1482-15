import { Rational, formatTimecode, ticksToSeconds, TICKS_PER_SECOND, type Tick } from "@timeline/core";

/** 所有展示时间都来自整数 tick，禁止用浮点秒累加 */
export function fpsOf(docFps: string): Rational {
  return Rational.from(docFps);
}

export function tc(tick: Tick, docFps: string): string {
  return formatTimecode(Math.max(0, Math.round(tick)), fpsOf(docFps));
}

export function sec(tick: Tick): string {
  return ticksToSeconds(tick).toFixed(3);
}

export { TICKS_PER_SECOND };
