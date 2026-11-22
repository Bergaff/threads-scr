/**
 * Типы окружения Cloudflare Worker.
 * Секреты задаются через `wrangler secret put` / `.dev.vars` (не коммитятся).
 */
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  JOBS: Queue<JobMessage>;
  AI: Ai;
  // Рендер Shorts и прокси живут локально на ПК пользователя (см. local/),
  // а не в Cloudflare-контейнерах — чтобы не тратить общий бюджет контейнеров
  // аккаунта. Worker дёргает их по этим URL (объявлены ниже в блоке переменных).
  ENVIRONMENT: string;
  SITE_URL: string;
  BOT_USERNAME: string;
  LLM_PROVIDER: string;
  LLM_MODEL: string;
  TTS_PROVIDER: string;
  VIDEO_RENDERER_URL: string;
  PROXY_GATEWAY_URL: string;

  // ── Секреты ──
  TELEGRAM_EDITOR_BOT_TOKEN?: string;
  TELEGRAM_CHANNEL_BOT_TOKEN?: string;
  TG_CHANNEL_RU?: string; // chat_id канала RU
  TG_CHANNEL_EN?: string;
  ADMIN_IDS?: string; // "123,456"
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  YOUTUBE_OAUTH_TOKEN_RU?: string;
  YOUTUBE_OAUTH_TOKEN_EN?: string;
  ADMIN_API_KEY?: string;
  COOKIE_ENCRYPTION_KEY?: string; // base64, 32 байта
  // R2 S3-ключи: используются локальным рендерером (local/server.js) для чтения
  // карточек/аудио и записи готовых роликов. Можно задать в .dev.vars (→ Worker)
  // либо напрямую в local/.env у самого рендерера.
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
}

export interface JobMessage {
  type:
    | "collect_feed"
    | "collect_authors"
    | "collect_search"
    | "collect_trending"
    | "remeasure"
    | "score_candidates"
    | "prepare_content"
    | "render_card"
    | "render_shorts"
    | "publish"
    | "collect_stats"
    | "daily_digest";
  accountId?: string;
  lang?: "ru" | "en";
  postCode?: string;
  contentId?: string;
  channel?: string;
  payload?: Record<string, unknown>;
}

export function adminIds(env: Env): Set<number> {
  return new Set(
    (env.ADMIN_IDS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
}

export function isAdmin(env: Env, telegramUserId: number | undefined): boolean {
  if (!telegramUserId) return false;
  return adminIds(env).has(telegramUserId);
}
