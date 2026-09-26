/** Rough print estimates for an FDM printer with typical PLA settings. */
export interface PrintEstimate {
  grams: number;
  hours: number;
  needsSupports: boolean;
}

export const PRINT_DEFAULTS = {
  wallMm: 1.2, // 3 perimeters × 0.4 mm nozzle
  infill: 0.15,
  densityGPerCm3: 1.24, // PLA
  flowMm3PerS: 7, // effective average including travel
  layerMm: 0.2,
  secondsPerLayer: 3, // layer changes, retractions
};

export function estimatePrint(volumeMm3: number, areaMm2: number, heightMm: number, overhangMm2: number): PrintEstimate {
  const d = PRINT_DEFAULTS;
  const shell = Math.min(volumeMm3, areaMm2 * d.wallMm);
  const printed = shell + (volumeMm3 - shell) * d.infill;
  const grams = (printed / 1000) * d.densityGPerCm3;
  const seconds = printed / d.flowMm3PerS + (heightMm / d.layerMm) * d.secondsPerLayer;
  return { grams, hours: seconds / 3600, needsSupports: overhangMm2 > areaMm2 * 0.03 };
}

export interface PricingInputs {
  filamentPerKg: number;
  machinePerHour: number;
  laborMinutes: number;
  laborPerHour: number;
  packaging: number;
  markupPercent: number;
  feePercent: number;
  quantity: number;
}

export const PRICING_DEFAULTS: PricingInputs = {
  filamentPerKg: 22,
  machinePerHour: 0.4,
  laborMinutes: 10,
  laborPerHour: 15,
  packaging: 0.75,
  markupPercent: 100,
  feePercent: 6.5,
  quantity: 10,
};

export interface Pricing {
  material: number;
  machine: number;
  labor: number;
  costPerUnit: number;
  pricePerUnit: number;
  profitPerUnit: number;
  batchHours: number;
  batchFilamentKg: number;
  batchProfit: number;
}

/** Price that covers cost plus markup after the marketplace takes its fee. */
export function price(est: PrintEstimate, p: PricingInputs): Pricing {
  const material = (est.grams / 1000) * p.filamentPerKg;
  const machine = est.hours * p.machinePerHour;
  const labor = (p.laborMinutes / 60) * p.laborPerHour;
  const costPerUnit = material + machine + labor + p.packaging;
  const beforeFee = costPerUnit * (1 + p.markupPercent / 100);
  const fee = Math.min(0.95, Math.max(0, p.feePercent / 100));
  const pricePerUnit = beforeFee / (1 - fee);
  const profitPerUnit = pricePerUnit * (1 - fee) - costPerUnit;
  const q = Math.max(1, Math.round(p.quantity));
  return {
    material,
    machine,
    labor,
    costPerUnit,
    pricePerUnit,
    profitPerUnit,
    batchHours: est.hours * q,
    batchFilamentKg: (est.grams * q) / 1000,
    batchProfit: profitPerUnit * q,
  };
}
