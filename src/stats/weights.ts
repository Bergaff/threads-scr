/**
 * Обратная связь статистики в оценку — раздел 10 ТЗ.
 * Раз в неделю: темы/авторы с большими просмотрами получают множитель до ×1.5,
 * неудачные — до ×0.7.
 */

export interface AuthorStats {
  username: string;
  totalViews: number;
  publications: number;
}

export function computeFeedbackWeight(stats: AuthorStats, globalAvgViews: number, boostMax = 1.5, cutMin = 0.7): number {
  if (stats.publications === 0 || globalAvgViews <= 0) return 1;
  const avg = stats.totalViews / stats.publications;
  const ratio = avg / globalAvgViews;
  if (ratio >= 1) return Math.min(boostMax, 1 + (ratio - 1) * 0.5);
  return Math.max(cutMin, 1 - (1 - ratio) * 0.5);
}

export function weeklyReport(input: {
  collected: number;
  selected: number;
  published: number;
  aliveAccounts: number;
  totalAccounts: number;
  errors: string[];
  bestYesterday: Array<{ title: string; views: number }>;
}): string {
  const lines = [
    "📊 Threads Digest — сводка за неделю",
    "",
    `Собрано тредов: ${input.collected}`,
    `Отобрано кандидатов: ${input.selected}`,
    `Опубликовано: ${input.published}`,
    `Аккаунты живы: ${input.aliveAccounts}/${input.totalAccounts}`,
  ];
  if (input.errors.length > 0) {
    lines.push("", "⚠️ Ошибки:", ...input.errors.slice(0, 5).map((e) => `• ${e}`));
  }
  if (input.bestYesterday.length > 0) {
    lines.push("", "🏆 Лучшие вчера:", ...input.bestYesterday.slice(0, 3).map((b) => `• ${b.title} — ${b.views} просмотров`));
  }
  return lines.join("\n");
}
