import { describe, expect, it } from "vitest";
import { MOMENTUM_RULES, MOMENTUM_STUDY } from "@/lib/momentum-rules";

describe("momentum rule card", () => {
  it("has a setting, a verdict and a reason for every rule", () => {
    expect(MOMENTUM_RULES.length).toBeGreaterThan(8);
    for (const r of MOMENTUM_RULES) {
      expect(r.rule && r.setting && r.why).toBeTruthy();
      expect(["matters", "small", "none", "hurts"]).toContain(r.verdict);
    }
  });
  it("records the holdout honestly", () => {
    expect(MOMENTUM_STUDY.holdout.n).toBeLessThan(30);
    expect(MOMENTUM_STUDY.holdout.hitLo).toBeLessThan(
      MOMENTUM_STUDY.holdout.hit,
    );
    expect(MOMENTUM_STUDY.holdout.hitHi).toBeGreaterThan(
      MOMENTUM_STUDY.holdout.hit,
    );
  });
});
