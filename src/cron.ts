/**
 * Cron-диспетчер — раздел 4.8 ТЗ.
 * Workers Cron запускается каждые 5 минут (см. wrangler.toml):
 *  - ставит задачи сбора в Queue по расписанию источников;
 *  - раз в сутки — «Топ-20 дня» и сводку.
 */

import type { Env } from "./env.js";
import { planJobs } from "./scheduler/planner.js";

export async function handleCron(env: Env, scheduledTime: number): Promise<void> {
  const now = new Date(scheduledTime);

  const accounts = await env.DB.prepare(
    "SELECT id, lang, enabled, status, pause_until, pages_today, pages_date FROM accounts",
  ).all<Record<string, unknown>>();

  const today = now.toISOString().slice(0, 10);
  const plannerAccounts = accounts.results.map((a) => ({
    id: String(a.id),
    lang: a.lang as "ru" | "en",
    enabled: Number(a.enabled) === 1,
    paused: String(a.status) !== "ok" || (a.pause_until != null && new Date(String(a.pause_until)) > now),
    pagesToday: String(a.pages_date ?? "") === today ? Number(a.pages_today ?? 0) : 0,
  }));

  // Треды младше 48ч без замера за последний час — кандидаты на remeasure.
  const remeasureRows = await env.DB.prepare(
    `SELECT p.code, p.lang, MAX(s.measured_at) AS last_at
     FROM posts p LEFT JOIN post_snapshots s ON s.post_code = p.code
     WHERE p.taken_at >= datetime('now','-48 hours')
     GROUP BY p.code
     HAVING last_at IS NULL OR last_at < datetime('now','-1 hour')
     LIMIT 50`,
  ).all<{ code: string; lang: string; last_at: string | null }>();

  const authors = await env.DB.prepare(
    "SELECT username, lang, is_hot, updated_at FROM authors WHERE in_seed = 1 AND in_stoplist = 0",
  ).all<{ username: string; lang: string; is_hot: number; updated_at: string }>();

  const jobs = planJobs({
    now,
    accounts: plannerAccounts,
    remeasureDue: remeasureRows.results.map((r) => ({
      code: r.code,
      lang: (r.lang === "en" ? "en" : "ru") as "ru" | "en",
      lastMeasuredAt: r.last_at ? new Date(r.last_at) : new Date(0),
    })),
    hotAuthors: authors.results.filter((a) => a.is_hot === 1).map((a) => ({
      username: a.username, lang: (a.lang === "en" ? "en" : "ru") as "ru" | "en",
      lastCollectedAt: new Date(a.updated_at),
    })),
    coldAuthors: authors.results.filter((a) => a.is_hot !== 1).map((a) => ({
      username: a.username, lang: (a.lang === "en" ? "en" : "ru") as "ru" | "en",
      lastCollectedAt: new Date(a.updated_at),
    })),
    keywords: [],
    dailyPageBudget: 400,
    hotIntervalMinutes: 150,
    coldIntervalMinutes: 1440,
    searchIntervalMinutes: 240,
    feedIntervalMinutes: 90,
    lastFeedAt: {},
  });

  for (const job of jobs.slice(0, 50)) {
    await env.JOBS.send({
      type: job.type as never,
      accountId: job.accountId,
      lang: job.lang,
      postCode: job.postCode,
      payload: { username: job.username, query: job.query, reason: job.reason },
    });
  }

  // Ежедневные задачи: скоринг кандидатов + «Топ-20 дня» (06:00 UTC ≈ 09:00 МСК).
  if (now.getUTCHours() === 6 && now.getUTCMinutes() < 5) {
    await env.JOBS.send({ type: "score_candidates" });
    await env.JOBS.send({ type: "daily_digest" });
  }
}
