/**
 * Оценка популярности тредов — раздел 4.4 ТЗ.
 * Формулы и коэффициенты по умолчанию — из config/default.json.
 */

export interface Metrics {
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

export interface ScoringConfig {
  replyWeight: number;
  repostWeight: number;
  quoteWeight: number;
  ageOffsetHours: number;
  ageExponent: number;
  liftCap: number;
  liftExponent: number;
  discussWeight: number;
  discussCap: number;
  kContentWithReplies: number;
  kContentNormal: number;
  kContentPhotoOnly: number;
  kContentForbidden: number;
  minMedianEng: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  replyWeight: 3,
  repostWeight: 4,
  quoteWeight: 4,
  ageOffsetHours: 2,
  ageExponent: 1.5,
  liftCap: 10,
  liftExponent: 0.5,
  discussWeight: 0.5,
  discussCap: 1,
  kContentWithReplies: 1.2,
  kContentNormal: 1.0,
  kContentPhotoOnly: 0.5,
  kContentForbidden: 0,
  minMedianEng: 10,
};

/** eng = likes + 3·replies + 4·reposts + 4·quotes */
export function engagement(m: Metrics, cfg: ScoringConfig = DEFAULT_SCORING): number {
  return m.likes + cfg.replyWeight * m.replies + cfg.repostWeight * m.reposts + cfg.quoteWeight * m.quotes;
}

/** hot = eng / (age_h + 2)^1.5 — «горячесть», как на Hacker News */
export function hotness(eng: number, ageHours: number, cfg: ScoringConfig = DEFAULT_SCORING): number {
  const age = Math.max(0, ageHours);
  return eng / Math.pow(age + cfg.ageOffsetHours, cfg.ageExponent);
}

/** lift = eng / max(медиана eng автора, 10) */
export function lift(eng: number, authorMedianEng: number, cfg: ScoringConfig = DEFAULT_SCORING): number {
  return eng / Math.max(authorMedianEng, cfg.minMedianEng);
}

/** discuss = replies / max(likes, 1) */
export function discuss(m: Metrics): number {
  return m.replies / Math.max(m.likes, 1);
}

/** velocity = Δeng / Δчасов между двумя последними замерами */
export function velocity(prev: Metrics, curr: Metrics, deltaHours: number, cfg: ScoringConfig = DEFAULT_SCORING): number {
  if (deltaHours <= 0) return 0;
  return (engagement(curr, cfg) - engagement(prev, cfg)) / deltaHours;
}

export type ContentKind = "with_replies" | "normal" | "photo_only" | "forbidden";

export function kContent(kind: ContentKind, cfg: ScoringConfig = DEFAULT_SCORING): number {
  switch (kind) {
    case "with_replies": return cfg.kContentWithReplies;
    case "normal": return cfg.kContentNormal;
    case "photo_only": return cfg.kContentPhotoOnly;
    case "forbidden": return cfg.kContentForbidden;
  }
}

/**
 * score = hot · min(lift, 10)^0.5 · (1 + 0.5·min(discuss, 1)) · k_контента
 */
export interface ScoreInput {
  metrics: Metrics;
  ageHours: number;
  authorMedianEng: number;
  contentKind?: ContentKind;
  /** Множитель из обратной связи статистики (раздел 10 ТЗ), 0.7–1.5 */
  feedbackWeight?: number;
}

export interface ScoreBreakdown {
  eng: number;
  hot: number;
  lift: number;
  discuss: number;
  kContent: number;
  score: number;
}

export function computeScore(input: ScoreInput, cfg: ScoringConfig = DEFAULT_SCORING): ScoreBreakdown {
  const eng = engagement(input.metrics, cfg);
  const hot = hotness(eng, input.ageHours, cfg);
  const lf = lift(eng, input.authorMedianEng, cfg);
  const dc = discuss(input.metrics);
  const k = kContent(input.contentKind ?? "normal", cfg);
  const score =
    hot *
    Math.pow(Math.min(lf, cfg.liftCap), cfg.liftExponent) *
    (1 + cfg.discussWeight * Math.min(dc, cfg.discussCap)) *
    k *
    (input.feedbackWeight ?? 1);
  return { eng, hot, lift: lf, discuss: dc, kContent: k, score };
}

/** Определить k_контента по тексту и наличию ответов (раздел 4.4). */
export function classifyContent(text: string, hasGoodReplies: boolean, hasMedia: boolean, forbidden = false): ContentKind {
  if (forbidden) return "forbidden";
  const len = text.trim().length;
  if (len === 0 && hasMedia) return "photo_only";
  if (len >= 40 && len <= 600 && hasGoodReplies) return "with_replies";
  return "normal";
}

/** Приоритет для Shorts: высокий discuss + 5+ содержательных ответов (раздел 4.4). */
export function shortsPriority(m: Metrics, goodRepliesCount: number): boolean {
  return discuss(m) >= 0.3 && goodRepliesCount >= 5;
}
