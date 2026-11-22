import { describe, it, expect } from "vitest";
import { engagement, hotness, computeScore, classifyContent, velocity } from "../src/lib/scoring.js";

describe("scoring (раздел 4.4 ТЗ)", () => {
  it("eng = likes + 3·replies + 4·reposts + 4·quotes", () => {
    expect(engagement({ likes: 100, replies: 10, reposts: 5, quotes: 2 })).toBe(100 + 30 + 20 + 8);
  });

  it("hot убывает с возрастом", () => {
    const fresh = hotness(1000, 1);
    const old = hotness(1000, 24);
    expect(fresh).toBeGreaterThan(old);
  });

  it("score учитывает lift и discuss", () => {
    const base = computeScore({
      metrics: { likes: 100, replies: 10, reposts: 0, quotes: 0 },
      ageHours: 5,
      authorMedianEng: 100,
    });
    const viral = computeScore({
      metrics: { likes: 100, replies: 90, reposts: 20, quotes: 10 },
      ageHours: 5,
      authorMedianEng: 100,
    });
    expect(viral.score).toBeGreaterThan(base.score);
    expect(viral.discuss).toBeCloseTo(0.9);
  });

  it("k_контента: forbidden даёт 0", () => {
    const s = computeScore({
      metrics: { likes: 1000, replies: 100, reposts: 100, quotes: 100 },
      ageHours: 1,
      authorMedianEng: 10,
      contentKind: "forbidden",
    });
    expect(s.score).toBe(0);
  });

  it("classifyContent: 40–600 символов + ответы → with_replies", () => {
    expect(classifyContent("а".repeat(100), true, false)).toBe("with_replies");
    expect(classifyContent("", false, true)).toBe("photo_only");
    expect(classifyContent("коротко", false, false)).toBe("normal");
  });

  it("velocity считается между замерами", () => {
    const v = velocity(
      { likes: 10, replies: 1, reposts: 0, quotes: 0 },
      { likes: 110, replies: 11, reposts: 0, quotes: 0 },
      2,
    );
    expect(v).toBeCloseTo(((110 + 33) - (10 + 3)) / 2);
  });
});
