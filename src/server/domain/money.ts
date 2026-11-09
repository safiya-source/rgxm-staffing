// Exact decimal arithmetic for money (no floating point). Amounts are integer cents; rates and
// quantities arrive as decimal strings (e.g. "0.7300" $/km, "123.45" km) and are multiplied as
// scaled BigInts, rounding only the final amount to the cent (half away from zero).

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** "12.345" → { units: BigInt(12345), scale: 3 }. Throws on anything that isn't a plain decimal. */
export function parseDecimal(value: string | number): { units: bigint; scale: number } {
  const s = typeof value === "number" ? String(value) : value.trim();
  const m = DECIMAL.exec(s);
  if (!m) throw new Error(`Not a decimal number: ${value}`);
  const frac = m[3] ?? "";
  const units = BigInt(`${m[2]}${frac}` || "0") * (m[1] ? -BigInt(1) : BigInt(1));
  return { units, scale: frac.length };
}

/** Divides a scaled integer by 10^shift, rounding half away from zero. */
function roundShift(n: bigint, shift: number): bigint {
  if (shift <= 0) return n * BigInt(10) ** BigInt(-shift);
  const d = BigInt(10) ** BigInt(shift);
  const q = n / d;
  const r = n % d;
  const half = d / BigInt(2);
  if (r >= half) return q + BigInt(1);
  if (r <= -half) return q - BigInt(1);
  return q;
}

/** Dollar decimal string → cents, rounded to the cent. "0.73" → 73, "12.345" → 1235. */
export function dollarsToCents(value: string | number): number {
  const { units, scale } = parseDecimal(value);
  return Number(roundShift(units, scale - 2));
}

/** quantity × dollar rate, in cents, rounded once at the end. mileageCents("123.45", "0.73") → 9012. */
export function multiplyToCents(quantity: string | number, dollarRate: string | number): number {
  const q = parseDecimal(quantity);
  const r = parseDecimal(dollarRate);
  return Number(roundShift(q.units * r.units, q.scale + r.scale - 2));
}

/** Tax in cents on an amount at a rate in parts per million, half away from zero (works for credits). */
export function taxOnCents(amountCents: number, ratePpm: number): number {
  if (!Number.isInteger(amountCents) || !Number.isInteger(ratePpm) || ratePpm < 0) throw new Error("Invalid tax input");
  return Number(roundShift(BigInt(amountCents) * BigInt(ratePpm), 6));
}

/** "13%" / "9.975%" from parts per million. */
export function formatRatePpm(ppm: number): string {
  const whole = Math.floor(ppm / 10000);
  const frac = String(ppm % 10000).padStart(4, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}%`;
}

/** Percentage text ("13", "9.975") → parts per million. */
export function percentToPpm(value: string): number {
  const { units, scale } = parseDecimal(value);
  const ppm = roundShift(units * BigInt(10000), scale);
  if (ppm < BigInt(0) || ppm > BigInt(500000)) throw new Error("Rate must be between 0% and 50%");
  return Number(ppm);
}

/** A km figure with at most 2 decimals, > 0 and ≤ 5000 (one trip). */
export function normalizeKm(value: string): string {
  const s = value.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s) || Number(s) <= 0 || Number(s) > 5000) throw new Error("Enter kilometres as a number up to 5000, with at most 2 decimals.");
  return s;
}
