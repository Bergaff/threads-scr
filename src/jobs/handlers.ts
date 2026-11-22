/**
 * Обработчики Queue — задачи планировщика (разделы 4, 5, 6, 9 ТЗ).
 * Cron только ставит задачи; вся тяжёлая работа — здесь.
 */

import type { Env, JobMessage } from "../env.js";
import { parseThreadsPayload, parseRepliesPayload } from "../collector/threads.js";
import { collectorFetch, CollectorError, backoffMinutes, type CollectorAccount } from "../collector/client.js";
import { feedUrl, profileUrl, searchUrl, trendingUrl } from "../collector/sources.js";
import { detectLanguage } from "../lib/language.js";
import { applyFilters } from "../lib/filters.js";
import { computeScore, classifyContent } from "../lib/scoring.js";
import { savePost, saveSnapshot, log } from "../db/client.js";
import { createProvider, parseJsonOutput } from "../ai/provider.js";
import { renderCardSvg } from "../cards/card.js";
import { buildScript } from "../shorts/script.js";
import { segmentsToAss } from "../shorts/subtitles.js";
import { buildTgCaption } from "../bot/telegram.js";
import { TelegramClient } from "../bot/telegram.js";
import { publishToTelegram } from "../publish/telegram.js";
import { buildYoutubeMeta } from "../publish/youtube.js";

async function loadAccount(env: Env, accountId?: string): Promise<CollectorAccount | null> {
  const row = accountId
    ? await env.DB.prepare("SELECT * FROM accounts WHERE id = ? AND enabled = 1").bind(accountId).first<Record<string, unknown>>()
    : await env.DB.prepare("SELECT * FROM accounts WHERE enabled = 1 AND status = 'ok' LIMIT 1").first<Record<string, unknown>>();
  if (!row) return null;
  let cookies: Record<string, string> = {};
  try {
    cookies = JSON.parse(String(row.cookies_enc)) as Record<string, string>;
  } catch {
    cookies = {};
  }
  return {
    id: String(row.id),
    label: String(row.label),
    lang: row.lang as "ru" | "en",
    cookies,
    userAgent: String(row.user_agent ?? "Mozilla/5.0"),
    locale: String(row.locale ?? "ru-RU"),
    timezone: String(row.timezone ?? "Europe/Moscow"),
  };
}

async function pauseAccount(env: Env, accountId: string, err: CollectorError): Promise<void> {
  const row = await env.DB.prepare("SELECT backoff_level FROM accounts WHERE id = ?").bind(accountId).first<{ backoff_level: number }>();
  const level = (row?.backoff_level ?? 0) + 1;
  const pauseUntil = new Date(Date.now() + backoffMinutes(level - 1) * 60_000).toISOString();
  await env.DB.prepare(
    "UPDATE accounts SET status = 'paused', pause_until = ?, backoff_level = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(pauseUntil, level, err.message.slice(0, 500), accountId).run();
  await log(env.DB, "warn", `Account ${accountId} paused: ${err.message}`);
  // Админам — сообщение в бот-редактор (раздел 4.1).
  const token = env.TELEGRAM_EDITOR_BOT_TOKEN;
  if (token) {
    const tg = new TelegramClient(token);
    for (const id of (env.ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      await tg.sendMessage(id, `⚠️ Аккаунт-сборщик ${accountId} на паузе до ${pauseUntil}\nПричина: ${err.message}`).catch(() => {});
    }
  }
}

async function collect(env: Env, account: CollectorAccount, url: string, source: string): Promise<void> {
  try {
    const { json, body } = await collectorFetch(account, url, { gatewayUrl: env.PROXY_GATEWAY_URL || undefined });
    const payload = json ?? body;
    const posts = typeof payload === "string" ? [] : parseThreadsPayload(payload);
    for (const p of posts) {
      const lang = detectLanguage(p.text);
      const filter = applyFilters(
        { text: p.text, authorUsername: p.authorUsername, authorFollowers: p.followers, hasMedia: p.mediaType !== "none", isPaidPartnership: p.isPaidPartnership },
        { stoplist: new Set() },
      );
      await savePost(env.DB, {
        code: p.code, url: p.url, authorUsername: p.authorUsername, authorName: p.authorName,
        avatarUrl: p.avatarUrl, followers: p.followers, isVerified: p.isVerified, text: p.text,
        lang, mediaType: p.mediaType, mediaUrls: p.mediaUrls, takenAt: p.takenAt, source,
        accountId: account.id, isPaidPartnership: p.isPaidPartnership, filterReasons: filter.reasons,
      });
      await saveSnapshot(env.DB, p.code, { likes: p.likes, replies: p.replies, reposts: p.reposts, quotes: p.quotes, views: p.views });
    }
    await env.DB.prepare(
      "UPDATE accounts SET status = 'ok', backoff_level = 0, last_ok_at = datetime('now'), pages_today = pages_today + 1, updated_at = datetime('now') WHERE id = ?",
    ).bind(account.id).run();
    await log(env.DB, "info", `Collected ${posts.length} posts via ${source} (${account.label})`);
  } catch (err) {
    if (err instanceof CollectorError) await pauseAccount(env, account.id, err);
    else await log(env.DB, "error", `Collect failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function handleJob(env: Env, job: JobMessage): Promise<void> {
  switch (job.type) {
    case "collect_feed": {
      const account = await loadAccount(env, job.accountId);
      if (account) await collect(env, account, feedUrl(), "feed");
      break;
    }
    case "collect_authors": {
      const account = await loadAccount(env, job.accountId);
      if (account && job.payload?.username) {
        await collect(env, account, profileUrl(String(job.payload.username)), "authors");
      }
      break;
    }
    case "collect_search": {
      const account = await loadAccount(env, job.accountId);
      if (account && job.payload?.query) {
        await collect(env, account, searchUrl(String(job.payload.query)), "search");
      }
      break;
    }
    case "collect_trending": {
      const account = await loadAccount(env, job.accountId);
      if (account) await collect(env, account, trendingUrl(), "trending");
      break;
    }
    case "remeasure": {
      // Повторный замер одного треда: тянем профиль автора и ищем код.
      const account = await loadAccount(env, job.accountId);
      if (account && job.postCode) {
        const post = await env.DB.prepare("SELECT author_username FROM posts WHERE code = ?").bind(job.postCode).first<{ author_username: string }>();
        if (post) await collect(env, account, profileUrl(post.author_username), "authors");
      }
      break;
    }
    case "score_candidates":
      await scoreCandidates(env);
      break;
    case "prepare_content":
      if (job.postCode && job.channel) await prepareContent(env, job.postCode, job.channel);
      break;
    case "render_card":
      if (job.contentId) await renderCard(env, job.contentId);
      break;
    case "render_shorts":
      if (job.contentId) await renderShorts(env, job.contentId);
      break;
    case "publish":
      if (job.contentId) await publish(env, job.contentId, job.payload);
      break;
    case "daily_digest":
      await dailyDigest(env);
      break;
    case "collect_stats":
      await log(env.DB, "info", "collect_stats: MTProto/Analytics сбор — см. docs/ARCHITECTURE.md");
      break;
  }
}

async function scoreCandidates(env: Env): Promise<void> {
  // Топ-N по score за последние 24 часа на каждый язык (раздел 4.4).
  const rows = await env.DB.prepare(
    `SELECT p.code, p.text, p.lang, p.media_type, p.taken_at, p.author_username,
            s.likes, s.replies, s.reposts, s.quotes, a.median_eng
     FROM posts p
     JOIN post_snapshots s ON s.post_code = p.code
     JOIN authors a ON a.username = p.author_username
     WHERE p.taken_at >= datetime('now','-24 hours')
       AND (p.filter_reasons IS NULL OR p.filter_reasons = '[]')
     ORDER BY s.measured_at DESC`,
  ).all<Record<string, unknown>>();
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of rows.results) {
    if (!latest.has(String(r.code))) latest.set(String(r.code), r);
  }
  for (const r of latest.values()) {
    const ageHours = (Date.now() - new Date(String(r.taken_at)).getTime()) / 3600_000;
    const metrics = {
      likes: Number(r.likes ?? 0), replies: Number(r.replies ?? 0),
      reposts: Number(r.reposts ?? 0), quotes: Number(r.quotes ?? 0),
    };
    const kind = classifyContent(String(r.text ?? ""), false, String(r.media_type ?? "none") !== "none");
    const breakdown = computeScore({ metrics, ageHours, authorMedianEng: Number(r.median_eng ?? 0), contentKind: kind });
    await env.DB.prepare(
      `INSERT INTO candidates (post_code, lang, score, score_parts, status)
       VALUES (?, ?, ?, ?, 'new')`,
    ).bind(String(r.code), String(r.lang ?? "other"), breakdown.score, JSON.stringify(breakdown)).run();
  }
  await log(env.DB, "info", `Scored ${latest.size} candidates`);
}

async function prepareContent(env: Env, postCode: string, channel: string): Promise<void> {
  const post = await env.DB.prepare("SELECT * FROM posts WHERE code = ?").bind(postCode).first<Record<string, unknown>>();
  if (!post) return;
  const provider = createProvider(env);
  const lang = channel.endsWith("_ru") ? "ru" : "en";
  const isShorts = channel.startsWith("yt_");

  // Ответы для кандидатов из топа (раздел 4.3): 10–30 лучших по лайкам.
  const replies = await env.DB.prepare(
    "SELECT text FROM replies WHERE post_code = ? ORDER BY likes DESC LIMIT 5",
  ).bind(postCode).all<{ text: string }>();

  const input = `Тред @${String(post.author_username)}: ${String(post.text ?? "")}\n\nЛучшие ответы:\n${replies.results.map((r) => `- ${r.text}`).join("\n")}`;

  if (isShorts) {
    const res = await provider.complete("shorts_script", "Составь сценарий Shorts по ТЗ.", input);
    const parsed = parseJsonOutput<{ segments: Array<{ type: string; text: string }> }>(res.text);
    const segments = parsed?.segments ?? [{ type: "post", text: String(post.text ?? "") }];
    const script = buildScript({
      hook: lang === "ru" ? "Человек спросил в Threads…" : "Someone asked on Threads…",
      postText: String(post.text ?? ""),
      replies: replies.results.map((r) => r.text),
      outro: lang === "ru" ? "Читай Threads без VPN — threadsviewer.online" : "Read Threads without VPN — threadsviewer.online",
    });
    void segments;
    const metaRes = await provider.complete("youtube_meta", "Метаданные YouTube.", JSON.stringify(script));
    const meta = parseJsonOutput<{ title: string; description: string; hashtags: string[] }>(metaRes.text);
    const ytMeta = buildYoutubeMeta({
      title: meta?.title ?? String(post.text ?? "").slice(0, 70),
      description: meta?.description ?? "",
      hashtags: meta?.hashtags ?? [],
      lang,
      auditPassed: false,
    });
    const id = `ci_${postCode}_${channel}_${Date.now()}`;
    await env.DB.prepare(
      `INSERT INTO content_items (id, post_code, channel, kind, script, title, description, hashtags, prompt_version, status)
       VALUES (?, ?, ?, 'shorts', ?, ?, ?, ?, ?, 'draft')`,
    ).bind(id, postCode, channel, JSON.stringify(script), ytMeta.title, ytMeta.description, JSON.stringify(ytMeta.hashtags), res.promptVersion).run();
  } else {
    const res = await provider.complete("tg_post", "Пост для Telegram по ТЗ.", input);
    const parsed = parseJsonOutput<{ headline: string; recap: string; replies: string[]; hashtags: string[] }>(res.text);
    const caption = buildTgCaption({
      headline: parsed?.headline ?? "Лучшее из Threads",
      recap: parsed?.recap ?? String(post.text ?? ""),
      replies: parsed?.replies ?? replies.results.map((r) => r.text),
      hashtags: parsed?.hashtags ?? [],
      lang,
    });
    const id = `ci_${postCode}_${channel}_${Date.now()}`;
    await env.DB.prepare(
      `INSERT INTO content_items (id, post_code, channel, kind, caption, prompt_version, status)
       VALUES (?, ?, ?, 'tg_post', ?, ?, 'draft')`,
    ).bind(id, postCode, channel, caption, res.promptVersion).run();
  }
}

async function renderCard(env: Env, contentId: string): Promise<void> {
  const item = await env.DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(contentId).first<Record<string, unknown>>();
  if (!item) return;
  const post = await env.DB.prepare("SELECT * FROM posts WHERE code = ?").bind(String(item.post_code)).first<Record<string, unknown>>();
  if (!post) return;
  const snap = await env.DB.prepare(
    "SELECT likes, replies, reposts FROM post_snapshots WHERE post_code = ? ORDER BY measured_at DESC LIMIT 1",
  ).bind(String(item.post_code)).first<{ likes: number; replies: number; reposts: number }>();
  const svg = renderCardSvg({
    authorName: String(post.author_username),
    username: String(post.author_username),
    text: String(post.text ?? ""),
    likes: snap?.likes ?? 0,
    replies: snap?.replies ?? 0,
    reposts: snap?.reposts ?? 0,
    dateLabel: new Date(String(post.taken_at)).toLocaleDateString("ru-RU"),
    anonymized: Boolean(item.anonymized),
  });
  const key = `cards/${contentId}.svg`;
  await env.MEDIA.put(key, svg, { httpMetadata: { contentType: "image/svg+xml" } });
  await env.DB.prepare("UPDATE content_items SET card_path = ?, updated_at = datetime('now') WHERE id = ?").bind(key, contentId).run();
}

async function renderShorts(env: Env, contentId: string): Promise<void> {
  const item = await env.DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(contentId).first<Record<string, unknown>>();
  if (!item?.script) return;
  const script = JSON.parse(String(item.script)) as ReturnType<typeof buildScript>;
  const ass = segmentsToAss(script.segments);
  await env.MEDIA.put(`shorts/${contentId}.ass`, ass, { httpMetadata: { contentType: "text/plain" } });
  // Сборка mp4 — внешний рендерер (ffmpeg вне Workers). Worker шлёт ему сценарий + ассеты.
  if (env.VIDEO_RENDERER_URL) {
    await fetch(env.VIDEO_RENDERER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId, script, assKey: `shorts/${contentId}.ass` }),
    }).catch(() => {});
  }
  await log(env.DB, "info", `Shorts assets ready for ${contentId} (render via external renderer)`);
}

async function publish(env: Env, contentId: string, payload?: Record<string, unknown>): Promise<void> {
  const item = await env.DB.prepare("SELECT * FROM content_items WHERE id = ?").bind(contentId).first<Record<string, unknown>>();
  if (!item) return;
  const action = String(payload?.action ?? "publish_now");
  if (action === "reject") {
    await env.DB.prepare("UPDATE content_items SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").bind(contentId).run();
    return;
  }
  if (action === "queue") {
    await env.DB.prepare("UPDATE content_items SET status = 'queued', updated_at = datetime('now') WHERE id = ?").bind(contentId).run();
    return;
  }
  if (action === "stoplist_author") {
    const post = await env.DB.prepare("SELECT author_username FROM posts WHERE code = ?").bind(String(item.post_code)).first<{ author_username: string }>();
    if (post) await env.DB.prepare("UPDATE authors SET in_stoplist = 1 WHERE username = ?").bind(post.author_username).run();
    await env.DB.prepare("UPDATE content_items SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").bind(contentId).run();
    return;
  }
  if (action !== "publish_now") {
    // edit_text / rewrite / toggle_* / other_* — переподготовка черновика.
    await env.JOBS.send({ type: "prepare_content", postCode: String(item.post_code), channel: String(item.channel) });
    return;
  }

  const channel = String(item.channel);
  if (channel.startsWith("tg_")) {
    const token = env.TELEGRAM_CHANNEL_BOT_TOKEN;
    const chatId = channel === "tg_ru" ? env.TG_CHANNEL_RU : env.TG_CHANNEL_EN;
    if (!token || !chatId) {
      await log(env.DB, "error", `TG publish skipped: no token/chat for ${channel}`);
      return;
    }
    const post = await env.DB.prepare("SELECT author_username FROM posts WHERE code = ?").bind(String(item.post_code)).first<{ author_username: string }>();
    const lang = channel === "tg_ru" ? "ru" : "en";
    const { externalId } = await publishToTelegram(new TelegramClient(token), {
      contentId,
      channel: channel as "tg_ru" | "tg_en",
      chatId,
      caption: String(item.caption ?? ""),
      linkCtx: {
        siteUrl: env.SITE_URL, botUsername: env.BOT_USERNAME, source: "tg",
        campaign: lang, username: post?.author_username ?? "", postCode: String(item.post_code),
      },
      lang,
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO publications (content_id, channel, external_id, status, published_at)
         VALUES (?, ?, ?, 'published', datetime('now'))`,
      ).bind(contentId, channel, externalId),
      env.DB.prepare("UPDATE content_items SET status = 'published', updated_at = datetime('now') WHERE id = ?").bind(contentId),
    ]);
  } else {
    await log(env.DB, "info", `YouTube publish for ${contentId}: загрузка через API с квотой ~6/сутки, до аудита — private (см. src/publish/youtube.ts)`);
  }
}

async function dailyDigest(env: Env): Promise<void> {
  // «Топ-20 дня» на каждый язык в бот-редактор (раздел 4.9).
  const token = env.TELEGRAM_EDITOR_BOT_TOKEN;
  if (!token) return;
  const tg = new TelegramClient(token);
  for (const lang of ["ru", "en"] as const) {
    const rows = await env.DB.prepare(
      `SELECT c.score, p.code, p.author_username, substr(p.text,1,80) AS snippet
       FROM candidates c JOIN posts p ON p.code = c.post_code
       WHERE c.lang = ? AND c.status = 'new' ORDER BY c.score DESC LIMIT 20`,
    ).bind(lang).all<{ score: number; code: string; author_username: string; snippet: string }>();
    const text = rows.results.length === 0
      ? `Топ-20 ${lang.toUpperCase()}: кандидатов нет.`
      : `🏆 Топ-20 ${lang.toUpperCase()}:\n\n` + rows.results.map((r, i) => `${i + 1}. @${r.author_username} · ${r.score.toFixed(2)}\n   ${r.snippet}…`).join("\n");
    for (const id of (env.ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      await tg.sendMessage(id, text).catch(() => {});
    }
  }
}

export { parseRepliesPayload };
