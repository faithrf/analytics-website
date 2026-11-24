import { describe, expect, it } from "vitest";
import { correlation, extractCeoQuotes, htmlToText, scoreText, terciles } from "@/lib/ceo-sentiment";

describe("scoreText", () => {
  it("is positive for upbeat text and negative for gloomy text", () => {
    expect(scoreText("We are thrilled with strong, record growth and excellent progress").score).toBeGreaterThan(0.5);
    expect(scoreText("Weak demand, losses and headwinds hurt us").score).toBeLessThan(-0.5);
  });
  it("is 0 with no lexicon words and counts uncertainty", () => {
    expect(scoreText("The table is blue").score).toBe(0);
    const s = scoreText("Results may vary and remain uncertain");
    expect(s.unc).toBe(3);
    expect(s.uncertainty).toBeCloseTo(3 / 6);
  });
});

describe("extractCeoQuotes", () => {
  const press =
    "SEATTLE &mdash; Net sales increased 22%. &ldquo;Prime membership keeps growing and customers love the faster delivery we are building,&rdquo; said Jeff Bezos, Amazon.com founder and CEO. " +
    "&ldquo;We are pleased with a strong quarter and the progress across every segment of the business,&rdquo; said Andy Jassy, CEO of Amazon. " +
    "&ldquo;Our team executed well in a tough environment and delivered a solid result overall,&rdquo; said Brian Olsavsky, Chief Financial Officer.";
  it("finds CEO quotes with speaker and ignores the CFO", () => {
    const q = extractCeoQuotes(htmlToText(press));
    expect(q.map((x) => x.speaker)).toEqual(["Jeff Bezos", "Andy Jassy"]);
    expect(q[0].text).toMatch(/^Prime membership/);
  });
  it("handles attribution before the quote", () => {
    const q = extractCeoQuotes('Tim Cook, Apple’s CEO, said, "We are thrilled to report our best quarter ever with record revenue."');
    expect(q[0]?.speaker).toBe("Tim Cook");
  });
});

describe("terciles", () => {
  it("splits by score", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ score: i, ex: i < 3 ? -1 : i > 5 ? 2 : 0 }));
    const t = terciles(rows);
    expect(t.low.mean).toBe(-1);
    expect(t.high.mean).toBe(2);
    expect(t.high.hit).toBe(100);
    expect(correlation(rows.map((r) => r.score), rows.map((r) => r.ex))).toBeGreaterThan(0.8);
  });
});
