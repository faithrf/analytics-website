import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, codeFromBytes, formatCode, normaliseCode } from "@/lib/sync-code";

describe("sync codes", () => {
  it("builds 10 chars from the alphabet", () => {
    const code = codeFromBytes(Uint8Array.from({ length: 10 }, (_, i) => i * 37));
    expect(code).toHaveLength(10);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  });
  it("alphabet has 32 unique chars and no I L O U", () => {
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });
  it("formats with a dash", () => {
    expect(formatCode("ABCDE12345")).toBe("ABCDE-12345");
  });
  it("normalises case, spaces, dashes and lookalikes", () => {
    expect(normaliseCode("abcde-12345")).toBe("ABCDE12345");
    expect(normaliseCode(" abcde 12345 ")).toBe("ABCDE12345");
    expect(normaliseCode("OIL00-IL0OO")).toBe("0110011000");
  });
  it("rejects bad length or characters", () => {
    expect(normaliseCode("")).toBeNull();
    expect(normaliseCode("ABCDE-1234")).toBeNull();
    expect(normaliseCode("ABCDE-123456")).toBeNull();
    expect(normaliseCode("ABCDE-1234U")).toBeNull();
    expect(normaliseCode("ABCDE-1234!")).toBeNull();
  });
  it("round-trips format and normalise", () => {
    expect(normaliseCode(formatCode("ABCDE12345"))).toBe("ABCDE12345");
  });
});
