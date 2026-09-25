export const FREE_MONTHLY_CREDITS = 500;
export const STANDARD_TIER_END = 10_000;
export const STANDARD_RATE_USD = 0.009;
export const VOLUME_RATE_USD = 0.002;
export const PRICING_EFFECTIVE_DATE = "2026-09-24";
export const PRICING_URL = "https://tinify.com/pricing/api";

export interface CreditEstimate {
  used: number;
  planned: number;
  free: number;
  paid: number;
  estimatedCostUsd: number;
  pricingEffectiveDate: string;
  pricingUrl: string;
}

export function estimateCostUsd(startingUsage: number, credits: number): number {
  let cost = 0;
  for (let offset = 1; offset <= credits; offset += 1) {
    const ordinal = startingUsage + offset;
    if (ordinal <= FREE_MONTHLY_CREDITS) continue;
    cost += ordinal <= STANDARD_TIER_END ? STANDARD_RATE_USD : VOLUME_RATE_USD;
  }
  return Math.round((cost + Number.EPSILON) * 1000) / 1000;
}

export function estimateCredits(used: number, planned: number): CreditEstimate {
  const freeRemaining = Math.max(0, FREE_MONTHLY_CREDITS - used);
  const free = Math.min(freeRemaining, planned);
  const paid = Math.max(0, planned - free);
  return {
    used,
    planned,
    free,
    paid,
    estimatedCostUsd: estimateCostUsd(used, planned),
    pricingEffectiveDate: PRICING_EFFECTIVE_DATE,
    pricingUrl: PRICING_URL
  };
}

export function approvalUsageCeiling(initialUsage: number, approvedPaid: number): number {
  return Math.max(initialUsage, FREE_MONTHLY_CREDITS) + approvedPaid;
}
