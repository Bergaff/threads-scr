import { describe, it, expect } from "vitest";
import { detectLanguage, isTargetLanguage } from "../src/lib/language.js";

describe("language (раздел 4.6 ТЗ)", () => {
  it("определяет русский", () => {
    expect(detectLanguage("Сегодня отличный день, идём гулять в парк")).toBe("ru");
  });
  it("определяет английский", () => {
    expect(detectLanguage("This is a great day, let's go to the park and have fun")).toBe("en");
  });
  it("определяет украинский по специфичным буквам", () => {
    expect(detectLanguage("Сьогодні чудовий день, їдемо в Київ")).toBe("uk");
  });
  it("короткий текст — other", () => {
    expect(detectLanguage("ок")).toBe("other");
  });
  it("isTargetLanguage: EN-канал только en", () => {
    expect(isTargetLanguage("en", "en")).toBe(true);
    expect(isTargetLanguage("ru", "en")).toBe(false);
    expect(isTargetLanguage("en", "ru", true)).toBe(true);
    expect(isTargetLanguage("en", "ru", false)).toBe(false);
  });
});
