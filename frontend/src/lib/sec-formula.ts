/** DC power specific-consumption (SEC) formulas from PAPCO electrolyzer design notes.
 *
 * Actual        = measured cell voltage x K
 * Design (load) = [V0 + slope x (current kA / ratedKa)] x K   (expected voltage at this load, then to SEC)
 * Standardized  = standardized_voltage (Un, already computed elsewhere) x K
 *
 * K is the plant's Faraday-based constant that turns a cell voltage into kWh per
 * ton NaOH 100%. The nameplate design target (RATED_SEC) is a fixed reference
 * value from the design document, independent of the live load.
 */

export const SEC_K = 4.277; // kWh / (V . ton NaOH 100%)
export const DESIGN_V0 = 2.39; // V, base voltage at zero load
export const DESIGN_SLOPE = 0.126; // V per unit load (currentKa / ratedKa)
export const DESIGN_RATED_KA = 14.85; // kA, reference/rated current used by the load curve
export const RATED_SEC_KWH_PER_TON = 2146; // kWh/ton NaOH 100%, nameplate design target (fixed)

export type SecTone = "ok" | "warning" | "danger";

export interface SecMatch {
  actualSec: number;
  designSec: number;
  designVoltage: number;
  diffPct: number; // |actual - design| / design, in %
  matchPct: number; // 100 - diffPct, clamped at 0
  tone: SecTone;
}

/** Expected (design) cell voltage at this load, per the electrolyzer current-voltage curve. */
export function designVoltageAt(currentKa: number | null | undefined): number | null {
  if (currentKa == null || !Number.isFinite(currentKa) || currentKa <= 0) return null;
  return DESIGN_V0 + DESIGN_SLOPE * (currentKa / DESIGN_RATED_KA);
}

export function secTone(diffPct: number): SecTone {
  if (diffPct <= 3) return "ok";
  if (diffPct <= 8) return "warning";
  return "danger";
}

/** Compares the measured (or standardized) voltage against the design load curve. */
export function secMatch(voltage: number | null | undefined, currentKa: number | null | undefined): SecMatch | null {
  const dv = designVoltageAt(currentKa);
  if (voltage == null || !Number.isFinite(voltage) || voltage <= 0 || dv == null) return null;
  const actualSec = voltage * SEC_K;
  const designSec = dv * SEC_K;
  if (!designSec) return null;
  const diffPct = (Math.abs(actualSec - designSec) / designSec) * 100;
  return {
    actualSec,
    designSec,
    designVoltage: dv,
    diffPct,
    matchPct: Math.max(0, 100 - diffPct),
    tone: secTone(diffPct),
  };
}
