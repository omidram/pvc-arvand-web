/** DC power specific-consumption (SEC) formulas from PAPCO electrolyzer design notes.
 *
 * Actual        = electrolyzer voltage x K            (electrolyzer voltage = average cell voltage x cells)
 * Expected      = [V0 + slope x (current kA / ratedKa)] x cells x K   (design cell voltage at this load)
 * Standardized  = standardized_voltage (Un, already computed elsewhere) x K
 *
 * K is the plant's Faraday-based constant that turns a cell voltage into kWh per
 * ton NaOH 100%. The nameplate design target (RATED_SEC) is a fixed reference
 * value from the design document, independent of the live load.
 */

export const SEC_K = 4.277; // kWh / (V . ton NaOH 100%)
export const DESIGN_V0 = 2.39; // V, base voltage at zero load
export const DESIGN_SLOPE = 0.126; // V per unit load (currentKa / ratedKa)
export const DESIGN_CELLS = 163; // cells per electrolyzer in the design formula
export const DESIGN_RATED_KA = 14.85; // kA, reference/rated current used by the load curve
export const RATED_SEC_KWH_PER_TON = 2146; // kWh/ton NaOH 100%, nameplate design target (fixed)

export type SecTone = "ok" | "warning" | "danger";

export interface SecMatch {
  actualSec: number;
  designSec: number;
  designVoltage: number; // expected cell voltage at this load
  electrolyzerVoltage: number; // measured electrolyzer voltage = average cell voltage x cells
  designElectrolyzerVoltage: number; // expected electrolyzer voltage at this load
  deltaPct: number; // signed (actual - expected) / expected, in %
  diffPct: number; // |actual - design| / design, in %
  matchPct: number; // 100 - diffPct, clamped at 0
  tone: SecTone;
}

/** Expected (design) cell voltage at this load, per the electrolyzer current-voltage curve. */
export type SecFactors = {
  k: number;
  v0: number;
  slope: number;
  cells: number;
  ratedKa: number;
  okPct: number;
  warnPct: number;
};

export const SEC_DEFAULTS: SecFactors = {
  k: SEC_K,
  v0: DESIGN_V0,
  slope: DESIGN_SLOPE,
  cells: DESIGN_CELLS,
  ratedKa: DESIGN_RATED_KA,
  okPct: 3,
  warnPct: 8,
};

export function designVoltageAt(currentKa: number | null | undefined, factors: SecFactors = SEC_DEFAULTS): number | null {
  if (currentKa == null || !Number.isFinite(currentKa) || currentKa <= 0) return null;
  return factors.v0 + factors.slope * (currentKa / factors.ratedKa);
}

export function secTone(diffPct: number, factors: SecFactors = SEC_DEFAULTS): SecTone {
  if (diffPct <= factors.okPct) return "ok";
  if (diffPct <= factors.warnPct) return "warning";
  return "danger";
}

/** Compares the measured average cell voltage (scaled to the electrolyzer) with the design load curve. */
export function secMatch(voltage: number | null | undefined, currentKa: number | null | undefined, factors: SecFactors = SEC_DEFAULTS): SecMatch | null {
  const dv = designVoltageAt(currentKa, factors);
  if (voltage == null || !Number.isFinite(voltage) || voltage <= 0 || dv == null) return null;
  const electrolyzerVoltage = voltage * factors.cells;
  const designElectrolyzerVoltage = dv * factors.cells;
  const actualSec = electrolyzerVoltage * factors.k;
  const designSec = designElectrolyzerVoltage * factors.k;
  if (!designSec) return null;
  const diffPct = (Math.abs(actualSec - designSec) / designSec) * 100;
  return {
    actualSec,
    designSec,
    designVoltage: dv,
    electrolyzerVoltage,
    designElectrolyzerVoltage,
    deltaPct: ((actualSec - designSec) / designSec) * 100,
    diffPct,
    matchPct: Math.max(0, 100 - diffPct),
    tone: secTone(diffPct, factors),
  };
}
