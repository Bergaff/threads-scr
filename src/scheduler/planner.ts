/**
 * Планировщик — разделы 4.4 и 4.8 ТЗ.
 * Распределяет задачи по аккаунтам равномерно, с приоритетами:
 * повторные замеры → лента → горячие авторы → поиск → остальные авторы.
 * Цель: ≤300–500 загрузок страниц в сутки на аккаунт.
 */

import { JOB_PRIORITY } from "../collector/sources.js";

export interface PlannedJob {
  type: string;
  priority: number;
  accountId?: string;
  lang?: "ru" | "en";
  postCode?: string;
  username?: string;
  query?: string;
  reason: string;
}

export interface PlannerInput {
  now: Date;
  accounts: Array<{ id: string; lang: "ru" | "en"; enabled: boolean; paused: boolean; pagesToday: number }>;
  /** Треды младше 48ч, которым положен повторный замер */
  remeasureDue: Array<{ code: string; lang: "ru" | "en"; lastMeasuredAt: Date }>;
  hotAuthors: Array<{ username: string; lang: "ru" | "en"; lastCollectedAt: Date | null }>;
  coldAuthors: Array<{ username: string; lang: "ru" | "en"; lastCollectedAt: Date | null }>;
  keywords: Array<{ word: string; lang: "ru" | "en"; lastSearchedAt: Date | null }>;
  dailyPageBudget: number;
  hotIntervalMinutes: number;
  coldIntervalMinutes: number;
  searchIntervalMinutes: number;
  feedIntervalMinutes: number;
  lastFeedAt: Record<string, Date | null>;
}

function minutesSince(d: Date | null | undefined, now: Date): number {
  if (!d) return Infinity;
  return (now.getTime() - d.getTime()) / 60_000;
}

export function planJobs(input: PlannerInput): PlannedJob[] {
  const jobs: PlannedJob[] = [];
  const active = input.accounts.filter((a) => a.enabled && !a.paused && a.pagesToday < input.dailyPageBudget);
  if (active.length === 0) return jobs;

  // Равномерное распределение: round-robin по аккаунтам нужного языка.
  const byLang = new Map<string, typeof active>();
  for (const a of active) {
    const list = byLang.get(a.lang) ?? [];
    list.push(a);
    byLang.set(a.lang, list);
  }
  const counters = new Map<string, number>();
  const pickAccount = (lang: "ru" | "en"): string | undefined => {
    const list = byLang.get(lang);
    if (!list || list.length === 0) return undefined;
    const i = counters.get(lang) ?? 0;
    counters.set(lang, i + 1);
    return list[i % list.length].id;
  };

  // 1. Повторные замеры (высший приоритет)
  for (const r of input.remeasureDue) {
    const accountId = pickAccount(r.lang);
    if (!accountId) continue;
    jobs.push({
      type: "remeasure",
      priority: JOB_PRIORITY.remeasure,
      accountId,
      lang: r.lang,
      postCode: r.code,
      reason: "scheduled remeasure",
    });
  }

  // 2. Лента «Для вас» — каждый аккаунт по своему интервалу
  for (const a of active) {
    if (minutesSince(input.lastFeedAt[a.id], input.now) >= input.feedIntervalMinutes) {
      jobs.push({
        type: "collect_feed",
        priority: JOB_PRIORITY.feed,
        accountId: a.id,
        lang: a.lang,
        reason: "feed interval elapsed",
      });
    }
  }

  // 3. Горячие авторы
  for (const author of input.hotAuthors) {
    if (minutesSince(author.lastCollectedAt, input.now) >= input.hotIntervalMinutes) {
      const accountId = pickAccount(author.lang);
      if (!accountId) continue;
      jobs.push({
        type: "collect_authors",
        priority: JOB_PRIORITY.hot_authors,
        accountId,
        lang: author.lang,
        username: author.username,
        reason: "hot author interval",
      });
    }
  }

  // 4. Поиск по ключевым словам
  for (const kw of input.keywords) {
    if (minutesSince(kw.lastSearchedAt, input.now) >= input.searchIntervalMinutes) {
      const accountId = pickAccount(kw.lang);
      if (!accountId) continue;
      jobs.push({
        type: "collect_search",
        priority: JOB_PRIORITY.search,
        accountId,
        lang: kw.lang,
        query: kw.word,
        reason: "keyword interval",
      });
    }
  }

  // 5. Остальные авторы (раз в сутки)
  for (const author of input.coldAuthors) {
    if (minutesSince(author.lastCollectedAt, input.now) >= input.coldIntervalMinutes) {
      const accountId = pickAccount(author.lang);
      if (!accountId) continue;
      jobs.push({
        type: "collect_authors",
        priority: JOB_PRIORITY.cold_authors,
        accountId,
        lang: author.lang,
        username: author.username,
        reason: "cold author interval",
      });
    }
  }

  return jobs.sort((a, b) => a.priority - b.priority);
}

/** Следующий слот расписания канала (раздел 6.3): ближайший свободный слот. */
export function nextSlot(slots: string[], now: Date, timezone: string): Date | null {
  // Упрощённо: слоты в локальном времени канала; для точного TZ нужен Intl —
  // здесь возвращаем ближайший слот по UTC-часам как стартовую эвристику.
  void timezone;
  const sorted = [...slots].sort();
  for (const s of sorted) {
    const [h, m] = s.split(":").map(Number);
    const candidate = new Date(now);
    candidate.setUTCHours(h, m, 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  const [h, m] = sorted[0].split(":").map(Number);
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  tomorrow.setUTCHours(h, m, 0, 0);
  return tomorrow;
}
