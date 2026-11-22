import { describe, it, expect } from "vitest";
import { threadUrl, botDeepLink } from "../src/lib/utm.js";
import { buildTgCaption } from "../src/bot/telegram.js";
import { renderCardSvg } from "../src/cards/card.js";
import { buildScript, validateScript } from "../src/shorts/script.js";
import { segmentsToAss, formatAssTime } from "../src/shorts/subtitles.js";
import { planJobs } from "../src/scheduler/planner.js";

const ctx = { siteUrl: "https://threadsviewer.online", botUsername: "threadsreaderbot", source: "tg" as const, campaign: "ru" as const, username: "alice", postCode: "ABC123" };

describe("UTM-ссылки (разделы 6.1, 10 ТЗ)", () => {
  it("строит ссылку на тред с UTM", () => {
    const u = threadUrl(ctx);
    expect(u).toContain("threadsviewer.online/@alice/post/ABC123");
    expect(u).toContain("utm_source=tg");
    expect(u).toContain("utm_campaign=ru");
    expect(u).toContain("utm_content=ABC123");
  });
  it("строит deep-link в бот", () => {
    expect(botDeepLink(ctx)).toBe("https://t.me/threadsreaderbot?start=ch_ru_ABC123");
  });
});

describe("подпись TG (раздел 6.1)", () => {
  it("собирает HTML-подпись до 1024 символов", () => {
    const cap = buildTgCaption({ headline: "Заголовок", recap: "Пересказ", replies: ["Ответ 1", "Ответ 2"], hashtags: ["тема"], lang: "ru" });
    expect(cap).toContain("<b>Заголовок</b>");
    expect(cap).toContain("Лучшие ответы");
    expect(cap.length).toBeLessThanOrEqual(1024);
  });
  it("экранирует HTML", () => {
    const cap = buildTgCaption({ headline: "<script>", recap: "a & b", replies: [], hashtags: [], lang: "ru" });
    expect(cap).not.toContain("<script>");
    expect(cap).toContain("&lt;script&gt;");
  });
});

describe("карточка SVG (раздел 6.2)", () => {
  it("генерирует SVG 1080×1350 с метриками", () => {
    const svg = renderCardSvg({ authorName: "Alice", username: "alice", text: "Привет, мир!", likes: 100, replies: 5, reposts: 2, dateLabel: "22.11.2026" });
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1350"');
    expect(svg).toContain("Alice");
    expect(svg).toContain("threadsviewer.online");
  });
  it("анонимизация скрывает ник", () => {
    const svg = renderCardSvg({ authorName: "Alice", username: "alice", text: "x", likes: 1, replies: 1, reposts: 1, dateLabel: "d", anonymized: true });
    expect(svg).toContain("Пользователь Threads");
    expect(svg).not.toContain("@alice");
  });
});

describe("Shorts: сценарий и субтитры (разделы 5, 7.5)", () => {
  it("строит сценарий с таймингами 30–60 с", () => {
    const script = buildScript({
      hook: "Человек спросил в Threads, как не выгорать",
      postText: "Как вы справляетесь с выгоранием на работе? Делитесь опытом, очень нужно",
      replies: ["Мне помогает спорт каждое утро", "Я просто беру выходной и сплю", "Медитация и прогулки без телефона"],
      outro: "Читай Threads без VPN — threadsviewer.online",
    });
    expect(script.segments[0].type).toBe("hook");
    expect(script.segments[script.segments.length - 1].type).toBe("outro");
    expect(script.totalSec).toBeGreaterThan(0);
    const v = validateScript(script, 1, 60, 90);
    expect(v.ok).toBe(true);
  });
  it("генерирует ASS с событиями", () => {
    const script = buildScript({ hook: "Крючок", postText: "Текст поста", replies: [], outro: "Финал" });
    const ass = segmentsToAss(script.segments);
    expect(ass).toContain("[Events]");
    expect(ass).toContain("Dialogue:");
    expect(formatAssTime(65.5)).toBe("0:01:05.50");
  });
});

describe("планировщик (раздел 4.8)", () => {
  it("ставит remeasure выше ленты", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    const jobs = planJobs({
      now,
      accounts: [{ id: "a1", lang: "ru", enabled: true, paused: false, pagesToday: 0 }],
      remeasureDue: [{ code: "X1", lang: "ru", lastMeasuredAt: new Date(now.getTime() - 3600_000) }],
      hotAuthors: [], coldAuthors: [], keywords: [],
      dailyPageBudget: 400, hotIntervalMinutes: 150, coldIntervalMinutes: 1440,
      searchIntervalMinutes: 240, feedIntervalMinutes: 90, lastFeedAt: { a1: null },
    });
    expect(jobs[0].type).toBe("remeasure");
    expect(jobs.some((j) => j.type === "collect_feed")).toBe(true);
  });
  it("не ставит задачи при превышении бюджета страниц", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    const jobs = planJobs({
      now,
      accounts: [{ id: "a1", lang: "ru", enabled: true, paused: false, pagesToday: 999 }],
      remeasureDue: [{ code: "X1", lang: "ru", lastMeasuredAt: new Date(0) }],
      hotAuthors: [], coldAuthors: [], keywords: [],
      dailyPageBudget: 400, hotIntervalMinutes: 150, coldIntervalMinutes: 1440,
      searchIntervalMinutes: 240, feedIntervalMinutes: 90, lastFeedAt: {},
    });
    expect(jobs).toEqual([]);
  });
});
