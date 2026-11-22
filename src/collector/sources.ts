/**
 * Источники И1–И4 — раздел 4.2 ТЗ. И5 (официальный API keyword_search) —
 * опционально, проверяется отдельно.
 */

export type SourceId = "feed" | "authors" | "search" | "trending" | "api";

export interface SourceDef {
  id: SourceId;
  label: string;
  enabled: boolean;
  intervalMinutes: number;
  description: string;
}

export const SOURCES: SourceDef[] = [
  { id: "feed", label: "Лента «Для вас»", enabled: true, intervalMinutes: 90, description: "И1: алгоритмически популярное под логином RU/EN" },
  { id: "authors", label: "Профили авторов", enabled: true, intervalMinutes: 150, description: "И2: seed-список; горячие — чаще" },
  { id: "search", label: "Поиск по словам", enabled: true, intervalMinutes: 240, description: "И3: вкладка «Популярное» по ключевым словам" },
  { id: "trending", label: "Тренды", enabled: true, intervalMinutes: 90, description: "И4: Trending now; недоступен — пропускать без ошибки" },
  { id: "api", label: "Threads API keyword_search", enabled: false, intervalMinutes: 240, description: "И5 (опционально): нужна проверка приложения в Meta" },
];

export const THREADS_BASE = "https://www.threads.net";

export function feedUrl(): string {
  return `${THREADS_BASE}/`;
}

export function profileUrl(username: string): string {
  return `${THREADS_BASE}/@${username}`;
}

export function searchUrl(query: string): string {
  return `${THREADS_BASE}/search?q=${encodeURIComponent(query)}&search_filter=posts`;
}

export function trendingUrl(): string {
  return `${THREADS_BASE}/search?q=&search_filter=trending`;
}

/** Приоритеты задач планировщика (раздел 4.8): меньше число = выше приоритет. */
export const JOB_PRIORITY = {
  remeasure: 10,
  feed: 20,
  hot_authors: 30,
  search: 40,
  cold_authors: 50,
} as const;
