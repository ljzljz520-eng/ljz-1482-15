/**
 * Rational —— 精确有理数。
 *
 * 时间线内部一切“帧率”“采样率换算”都必须经过该类型：
 * 例如 29.97fps 被表达为 30000/1001，而不是 29.96999999999999。
 * 底层使用 bigint，永不产生浮点漂移；只有在最终显示（秒）时才允许舍入。
 */
export class Rational {
  constructor(
    readonly num: bigint,
    readonly den: bigint
  ) {
    if (den === 0n) throw new Error("Rational: denominator must not be zero");
    if (den < 0n) {
      this.num = -num;
      this.den = -den;
    } else {
      this.num = num;
      this.den = den;
    }
  }

  static from(n: number | string): Rational {
    const s = String(n);
    if (s.includes("/")) {
      const [a, b] = s.split("/");
      return new Rational(BigInt(a.trim()), BigInt(b.trim()));
    }
    if (!s.includes(".")) return new Rational(BigInt(s), 1n);
    const [int, frac] = s.split(".");
    const den = 10n ** BigInt(frac.length);
    const numer = BigInt(int) * den + BigInt(frac);
    return new Rational(numer, den).canonical();
  }

  static of(num: bigint | number, den: bigint | number = 1): Rational {
    return new Rational(BigInt(num), BigInt(den));
  }

  add(o: Rational): Rational {
    return new Rational(this.num * o.den + o.num * this.den, this.den * o.den).canonical();
  }

  sub(o: Rational): Rational {
    return new Rational(this.num * o.den - o.num * this.den, this.den * o.den).canonical();
  }

  mul(o: Rational): Rational {
    return new Rational(this.num * o.num, this.den * o.den).canonical();
  }

  div(o: Rational): Rational {
    if (o.num === 0n) throw new Error("Rational: division by zero");
    return new Rational(this.num * o.den, this.den * o.num).canonical();
  }

  neg(): Rational {
    return new Rational(-this.num, this.den);
  }

  /** floor 取整为 bigint（用于帧索引等离散量） */
  floor(): bigint {
    const q = this.num / this.den;
    return this.num < 0n && this.num % this.den !== 0n ? q - 1n : q;
  }

  round(): bigint {
    const half = new Rational(this.num >= 0n ? this.den : -this.den, this.den * 2n);
    return this.add(half).floor();
  }

  compare(o: Rational): -1 | 0 | 1 {
    const l = this.num * o.den;
    const r = o.num * this.den;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  gt(o: Rational): boolean {
    return this.compare(o) > 0;
  }
  gte(o: Rational): boolean {
    return this.compare(o) >= 0;
  }
  lt(o: Rational): boolean {
    return this.compare(o) < 0;
  }
  lte(o: Rational): boolean {
    return this.compare(o) <= 0;
  }

  /** 唯一允许“转浮点”的出口：仅用于最终 UI 显示（保留指定小数位） */
  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }

  toFixed(digits: number): string {
    return this.toNumber().toFixed(digits);
  }

  /** 约分 */
  canonical(): Rational {
    if (this.num === 0n) return new Rational(0n, 1n);
    const g = gcd(abs(this.num), this.den);
    return new Rational(this.num / g, this.den / g);
  }

  toString(): string {
    return `${this.num}/${this.den}`;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x || 1n;
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}
