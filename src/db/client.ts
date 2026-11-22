/**
 * Тонкий слой доступа к D1. Все запросы — параметризованные (bind).
 */

export interface PostRow {
  code: string;
  author_username: string;
  text: string;
  lang: string | null;
  media_type: string | null;
  media_urls: string | null;
  taken_at: string;
  source: string;
  is_paid_partnership: number;
  is_deleted: number;
}

export async function getPost(db: D1Database, code: string): Promise<PostRow | null> {
  return db.prepare("SELECT * FROM posts WHERE code = ?").bind(code).first<PostRow>();
}

export async function savePost(db: D1Database, post: {
  code: string; url: string; authorUsername: string; authorName: string; avatarUrl: string;
  followers: number; isVerified: boolean; text: string; lang: string | null;
  mediaType: string; mediaUrls: string[]; takenAt: string; source: string; accountId?: string;
  isPaidPartnership: boolean; filterReasons?: string[];
}): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO authors (username, display_name, avatar_url, followers, is_verified, lang, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name,
         avatar_url = excluded.avatar_url, followers = excluded.followers,
         is_verified = excluded.is_verified, updated_at = datetime('now')`,
    ).bind(post.authorUsername, post.authorName, post.avatarUrl, post.followers, post.isVerified ? 1 : 0, post.lang),
    db.prepare(
      `INSERT INTO posts (code, url, author_username, text, lang, media_type, media_urls, taken_at, source, account_id, is_paid_partnership, filter_reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET text = excluded.text, lang = excluded.lang,
         media_type = excluded.media_type, media_urls = excluded.media_urls,
         filter_reasons = excluded.filter_reasons`,
    ).bind(
      post.code, post.url, post.authorUsername, post.text, post.lang, post.mediaType,
      JSON.stringify(post.mediaUrls), post.takenAt, post.source, post.accountId ?? null,
      post.isPaidPartnership ? 1 : 0, JSON.stringify(post.filterReasons ?? []),
    ),
  ]);
}

export async function saveSnapshot(db: D1Database, postCode: string, m: { likes: number; replies: number; reposts: number; quotes: number; views?: number }): Promise<void> {
  await db.prepare(
    "INSERT INTO post_snapshots (post_code, likes, replies, reposts, quotes, views) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(postCode, m.likes, m.replies, m.reposts, m.quotes, m.views ?? null).run();
}

export async function log(db: D1Database, level: string, message: string): Promise<void> {
  await db.prepare("INSERT INTO logs (level, message) VALUES (?, ?)").bind(level, message.slice(0, 2000)).run();
}
