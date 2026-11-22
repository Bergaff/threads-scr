import { describe, it, expect } from "vitest";
import { applyFilters } from "../src/lib/filters.js";

const base = { text: "Интересная мысль про продуктивность и привычки", authorUsername: "someuser", authorFollowers: 5000, hasMedia: false };

describe("filters (раздел 4.5 ТЗ)", () => {
  it("пропускает обычный пост", () => {
    const r = applyFilters(base, { stoplist: new Set() });
    expect(r.pass).toBe(true);
  });

  it("отсекает рекламу и розыгрыши", () => {
    expect(applyFilters({ ...base, text: "Розыгрыш! Выиграй iPhone, пиши в директ" }, { stoplist: new Set() }).pass).toBe(false);
    expect(applyFilters({ ...base, isPaidPartnership: true }, { stoplist: new Set() }).reasons).toContain("paid_partnership");
  });

  it("отсекает политику, когда blockPolitics включён", () => {
    const r = applyFilters({ ...base, text: "Новости с фронта: война продолжается" }, { stoplist: new Set() });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("politics"))).toBe(true);
  });

  it("отсекает личные данные", () => {
    const r = applyFilters({ ...base, text: "Мой телефон +7 999 123-45-67" }, { stoplist: new Set() });
    expect(r.reasons).toContain("personal_data");
  });

  it("отсекает стоп-лист и короткие тексты", () => {
    expect(applyFilters(base, { stoplist: new Set(["someuser"]) }).reasons).toContain("stoplist_author");
    expect(applyFilters({ ...base, text: "ок" }, { stoplist: new Set() }).reasons).toContain("too_short");
  });

  it("отсекает повторное использование и частые публикации автора", () => {
    expect(applyFilters(base, { stoplist: new Set(), alreadyUsedOnChannel: true }).reasons).toContain("already_used");
    expect(applyFilters(base, { stoplist: new Set(), authorPostsOnChannel7d: 5 }).reasons).toContain("author_frequency_exceeded");
  });
});
