import { describe, expect, it } from "vitest";
import {
  approvalUsageCeiling,
  estimateCostUsd,
  estimateCredits
} from "../src/credits.js";

describe("credit accounting", () => {
  it("keeps the first 500 credits free", () => {
    expect(estimateCredits(499, 1)).toMatchObject({ free: 1, paid: 0, estimatedCostUsd: 0 });
    expect(estimateCredits(499, 2)).toMatchObject({ free: 1, paid: 1, estimatedCostUsd: 0.009 });
  });

  it("applies progressive paid rates", () => {
    expect(estimateCostUsd(500, 2)).toBe(0.018);
    expect(estimateCostUsd(9_999, 2)).toBe(0.011);
    expect(estimateCostUsd(10_000, 3)).toBe(0.006);
  });

  it("creates an absolute account-usage ceiling for a per-run approval", () => {
    expect(approvalUsageCeiling(490, 5)).toBe(505);
    expect(approvalUsageCeiling(600, 5)).toBe(605);
  });
});
