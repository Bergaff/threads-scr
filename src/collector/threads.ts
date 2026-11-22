/**
 * Разбор JSON из сетевых ответов Threads — раздел 4.3 ТЗ.
 * Основной путь — GraphQL / предзагруженные данные страницы (как в threadsviewer:
 * src/threadsFeed.ts, src/feedReplay.ts). Разбор HTML — запасной вариант
 * (см. parseHtmlFallback).
 *
 * Формы payload, которые умеем разбирать:
 *  1. Лента «Для вас»: data.xdt_api__v1__feed__timeline__connection.edges[].node.thread_items[].post
 *  2. Профиль: data.user.edge_threaded_timeline.edges[].node.thread_items[].post
 *  3. Поиск: data.search_results / data.xdt_api__v1__search__post__connection.edges[].node
 *  4. Ответы: data.xdt_api__v1__feed__replies__connection.edges[].node.thread_items[].post
 *  5. Упрощённый вид (тесты / API): { posts: [...] } или массив постов.
 */

export interface ParsedPost {
  code: string;
  url: string;
  authorUsername: string;
  authorName: string;
  avatarUrl: string;
  followers: number;
  isVerified: boolean;
  text: string;
  mediaType: "photo" | "video" | "carousel" | "none";
  mediaUrls: string[];
  takenAt: string; // ISO UTC
  isReply: boolean;
  isQuote: boolean;
  parentCode?: string;
  parentText?: string;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  views?: number;
  isPaidPartnership: boolean;
}

export type SourceKind = "feed" | "authors" | "search" | "trending" | "api";

const SITE = "https://www.threads.net";

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Рекурсивно найти все объекты-посты по характерным полям. */
function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  // Пост Threads: есть code + (caption | text) + user
  if (typeof obj.code === "string" && (obj.caption !== undefined || obj.text !== undefined || obj.user !== undefined)) {
    yield obj;
  }
  for (const v of Object.values(obj)) yield* walk(v);
}

function parseMedia(post: Record<string, unknown>): { type: ParsedPost["mediaType"]; urls: string[] } {
  const urls: string[] = [];
  const carousel = post.carousel_media as Array<Record<string, unknown>> | undefined;
  const video = post.video_versions as Array<Record<string, unknown>> | undefined;
  const image = post.image_versions2 as Record<string, unknown> | undefined;

  if (Array.isArray(carousel) && carousel.length > 0) {
    for (const item of carousel) {
      const iv = item.image_versions2 as Record<string, unknown> | undefined;
      const candidates = (iv?.candidates as Array<Record<string, unknown>>) ?? [];
      const vv = item.video_versions as Array<Record<string, unknown>> | undefined;
      const url = str(candidates[0]?.url) || str(vv?.[0]?.url);
      if (url) urls.push(url);
    }
    return { type: "carousel", urls };
  }
  if (Array.isArray(video) && video.length > 0) {
    const url = str(video[0]?.url);
    if (url) urls.push(url);
    return { type: "video", urls };
  }
  const candidates = (image?.candidates as Array<Record<string, unknown>>) ?? [];
  const url = str(candidates[0]?.url);
  if (url) urls.push(url);
  return { type: url ? "photo" : "none", urls };
}

function parseOne(raw: Record<string, unknown>): ParsedPost | null {
  const code = str(raw.code);
  if (!code) return null;

  const user = (raw.user ?? {}) as Record<string, unknown>;
  const username = str(user.username);
  if (!username) return null;

  const caption = raw.caption as Record<string, unknown> | undefined;
  const text = str(caption?.text) || str(raw.text) || str(raw.caption_text);

  const takenAtRaw = raw.taken_at;
  const takenAt =
    typeof takenAtRaw === "number"
      ? new Date(takenAtRaw * 1000).toISOString()
      : typeof takenAtRaw === "string"
        ? new Date(takenAtRaw).toISOString()
        : new Date().toISOString();

  const media = parseMedia(raw);

  const parent = raw.parent_post as Record<string, unknown> | undefined;
  const quoted = raw.quoted_post as Record<string, unknown> | undefined;

  return {
    code,
    url: `${SITE}/@${username}/post/${code}`,
    authorUsername: username,
    authorName: str(user.full_name) || username,
    avatarUrl: str(user.profile_pic_url),
    followers: num(user.follower_count ?? user.followers),
    isVerified: Boolean(user.is_verified),
    text,
    mediaType: media.type,
    mediaUrls: media.urls,
    takenAt,
    isReply: Boolean(raw.is_reply ?? parent),
    isQuote: Boolean(raw.is_quote ?? quoted),
    parentCode: parent ? str(parent.code) : quoted ? str(quoted.code) : undefined,
    parentText: parent ? str((parent.caption as Record<string, unknown>)?.text) : undefined,
    likes: num(raw.like_count ?? raw.likes),
    replies: num(raw.direct_reply_count ?? raw.reply_count ?? raw.replies),
    reposts: num(raw.repost_count ?? raw.reposts),
    quotes: num(raw.quote_count ?? raw.quotes),
    views: raw.view_count !== undefined ? num(raw.view_count) : undefined,
    isPaidPartnership: Boolean(raw.is_paid_partnership),
  };
}

/** Разобрать любой JSON-payload Threads в список постов (дедупликация по code). */
export function parseThreadsPayload(payload: unknown): ParsedPost[] {
  const seen = new Map<string, ParsedPost>();
  for (const raw of walk(payload)) {
    const post = parseOne(raw);
    if (post && !seen.has(post.code)) seen.set(post.code, post);
  }
  return [...seen.values()];
}

/** Ответы к треду: топ по лайкам, 10–30 штук (раздел 4.3). */
export function parseRepliesPayload(payload: unknown, limit = 30): ParsedPost[] {
  return parseThreadsPayload(payload)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, Math.min(Math.max(limit, 10), 30));
}

/**
 * Запасной вариант: извлечь JSON из HTML (window.__additionalDataLoaded /
 * <script type="application/json">). Полный HTML-парсинг в Workers не нужен —
 * основной путь всегда JSON.
 */
export function extractJsonFromHtml(html: string): unknown[] {
  const results: unknown[] = [];
  const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      results.push(JSON.parse(m[1]));
    } catch {
      /* пропускаем битый блок */
    }
  }
  return results;
}

export function parseHtmlFallback(html: string): ParsedPost[] {
  const posts: ParsedPost[] = [];
  for (const json of extractJsonFromHtml(html)) posts.push(...parseThreadsPayload(json));
  return posts;
}
