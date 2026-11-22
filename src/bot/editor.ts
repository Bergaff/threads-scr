/**
 * Бот-редактор — раздел 8 ТЗ.
 * Отдельный Telegram-бот, отвечает только ADMIN_IDS.
 * Webhook: POST /webhook/telegram
 */

import type { Env } from "../env.js";
import { isAdmin } from "../env.js";
import { TelegramClient } from "./telegram.js";

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string };
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

export type EditorAction =
  | "publish_now"
  | "queue"
  | "edit_text"
  | "rewrite"
  | "toggle_photo"
  | "toggle_anon"
  | "reject"
  | "stoplist_author"
  | "download_file"
  | "other_voice"
  | "other_background";

export function parseCallback(data: string): { action: EditorAction; contentId: string } | null {
  const [action, contentId] = data.split(":");
  if (!action || !contentId) return null;
  const known: EditorAction[] = [
    "publish_now", "queue", "edit_text", "rewrite", "toggle_photo",
    "toggle_anon", "reject", "stoplist_author", "download_file", "other_voice", "other_background",
  ];
  if (!known.includes(action as EditorAction)) return null;
  return { action: action as EditorAction, contentId };
}

export function draftKeyboard(contentId: string, kind: "tg_post" | "shorts") {
  if (kind === "tg_post") {
    return {
      inline_keyboard: [
        [
          { text: "✅ Опубликовать сейчас", callback_data: `publish_now:${contentId}` },
          { text: "🕒 В очередь", callback_data: `queue:${contentId}` },
        ],
        [
          { text: "✏️ Изменить текст", callback_data: `edit_text:${contentId}` },
          { text: "🔁 Переписать", callback_data: `rewrite:${contentId}` },
        ],
        [
          { text: "🖼 Без фото / С фото", callback_data: `toggle_photo:${contentId}` },
          { text: "🙈 Анонимно / С ником", callback_data: `toggle_anon:${contentId}` },
        ],
        [
          { text: "🗑 Отклонить", callback_data: `reject:${contentId}` },
          { text: "🚫 Автор в стоп-лист", callback_data: `stoplist_author:${contentId}` },
        ],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "✅ Загрузить (YouTube)", callback_data: `publish_now:${contentId}` },
        { text: "🕒 В очередь", callback_data: `queue:${contentId}` },
      ],
      [
        { text: "✏️ Заголовок", callback_data: `edit_text:${contentId}` },
        { text: "🔁 Другая озвучка", callback_data: `other_voice:${contentId}` },
      ],
      [
        { text: "🔁 Другой фон", callback_data: `other_background:${contentId}` },
        { text: "⬇️ Скачать файл", callback_data: `download_file:${contentId}` },
      ],
      [{ text: "🗑 Отклонить", callback_data: `reject:${contentId}` }],
    ],
  };
}

export function draftMetaLine(input: { channel: string; score: number; source: string; url: string }): string {
  return `📍 ${input.channel} · score ${input.score.toFixed(2)} · источник: ${input.source}\n🔗 ${input.url}`;
}

export async function handleEditorUpdate(env: Env, update: TgUpdate): Promise<void> {
  const token = env.TELEGRAM_EDITOR_BOT_TOKEN;
  if (!token) return;
  const tg = new TelegramClient(token);

  const msg = update.message;
  if (msg) {
    const userId = msg.from?.id;
    if (!isAdmin(env, userId)) return; // бот отвечает только админам
    const text = msg.text ?? "";
    const [cmd, ...args] = text.split(/\s+/);
    switch (cmd) {
      case "/queue":
        await tg.sendMessage(msg.chat.id, await queueSummary(env));
        break;
      case "/top": {
        const lang = args[0] === "en" ? "en" : "ru";
        await tg.sendMessage(msg.chat.id, await topSummary(env, lang));
        break;
      }
      case "/accounts":
        await tg.sendMessage(msg.chat.id, await accountsSummary(env));
        break;
      case "/stats":
        await tg.sendMessage(msg.chat.id, await statsSummary(env));
        break;
      case "/takedown":
        await tg.sendMessage(msg.chat.id, await takedown(env, args.join(" ")));
        break;
      default:
        if (text.startsWith("/")) {
          await tg.sendMessage(
            msg.chat.id,
            "Команды: /queue · /top ru|en · /accounts · /stats · /takedown <код>",
          );
        }
        // Иначе: текст правки для состояния bot_states (edit_text) — обрабатывается
        // в jobs/handlers через bot_states; здесь просто подтверждаем.
    }
    return;
  }

  const cb = update.callback_query;
  if (cb) {
    if (!isAdmin(env, cb.from.id)) {
      await tg.answerCallbackQuery(cb.id, "Нет доступа");
      return;
    }
    const parsed = cb.data ? parseCallback(cb.data) : null;
    if (!parsed) {
      await tg.answerCallbackQuery(cb.id);
      return;
    }
    await tg.answerCallbackQuery(cb.id, actionLabel(parsed.action));
    // Само действие (смена статуса, постановка в очередь) — в jobs/handlers.ts,
    // чтобы webhook оставался лёгким. Здесь только подтверждение.
    await env.JOBS.send({
      type: "publish",
      contentId: parsed.contentId,
      payload: { action: parsed.action, adminId: cb.from.id },
    });
  }
}

function actionLabel(a: EditorAction): string {
  const map: Record<EditorAction, string> = {
    publish_now: "Публикую…",
    queue: "В очереди",
    edit_text: "Пришли новый текст следующим сообщением",
    rewrite: "Переписываю…",
    toggle_photo: "Переключено",
    toggle_anon: "Переключено",
    reject: "Отклонено",
    stoplist_author: "Автор в стоп-листе",
    download_file: "Отправляю файл…",
    other_voice: "Новая озвучка…",
    other_background: "Новый фон…",
  };
  return map[a];
}

async function queueSummary(env: Env): Promise<string> {
  const rows = await env.DB.prepare(
    "SELECT channel, COUNT(*) AS n FROM content_items WHERE status IN ('approved','queued') GROUP BY channel",
  ).all<{ channel: string; n: number }>();
  if (rows.results.length === 0) return "Очередь пуста.";
  return ["📋 Очередь:", ...rows.results.map((r) => `• ${r.channel}: ${r.n}`)].join("\n");
}

async function topSummary(env: Env, lang: "ru" | "en"): Promise<string> {
  const rows = await env.DB.prepare(
    `SELECT c.score, p.code, p.author_username, substr(p.text,1,80) AS snippet
     FROM candidates c JOIN posts p ON p.code = c.post_code
     WHERE c.lang = ? AND c.status = 'new'
     ORDER BY c.score DESC LIMIT 20`,
  )
    .bind(lang)
    .all<{ score: number; code: string; author_username: string; snippet: string }>();
  if (rows.results.length === 0) return `Топ ${lang.toUpperCase()}: кандидатов нет.`;
  const lines = rows.results.map(
    (r, i) => `${i + 1}. @${r.author_username} · score ${r.score.toFixed(2)}\n   ${r.snippet}…\n   ${env.SITE_URL}/@${r.author_username}/post/${r.code}`,
  );
  return `🏆 Топ-20 ${lang.toUpperCase()}:\n\n${lines.join("\n")}`;
}

async function accountsSummary(env: Env): Promise<string> {
  const rows = await env.DB.prepare("SELECT label, lang, status, last_error, pause_until FROM accounts").all<{
    label: string; lang: string; status: string; last_error: string | null; pause_until: string | null;
  }>();
  if (rows.results.length === 0) return "Аккаунты не настроены. Загрузите cookies через админку.";
  return ["🤖 Аккаунты-сборщики:", ...rows.results.map((r) => `• ${r.label} (${r.lang}): ${r.status}${r.last_error ? ` — ${r.last_error}` : ""}${r.pause_until ? ` · пауза до ${r.pause_until}` : ""}`)].join("\n");
}

async function statsSummary(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS published FROM publications WHERE status = 'published' AND published_at >= datetime('now','-7 days')",
  ).first<{ published: number }>();
  return `📊 Опубликовано за 7 дней: ${row?.published ?? 0}`;
}

async function takedown(env: Env, codeOrUrl: string): Promise<string> {
  const code = codeOrUrl.split("/").pop()?.split("?")[0] ?? "";
  if (!code) return "Укажите код треда: /takedown <код>";
  // Снятие публикации: пост из канала удаляется в jobs/handlers (нужен message_id),
  // здесь помечаем content_items и ставим автора в стоп-лист.
  await env.DB.prepare(
    `UPDATE publications SET status = 'taken_down'
     WHERE content_id IN (SELECT id FROM content_items WHERE post_code = ?)`,
  ).bind(code).run();
  await env.DB.prepare(
    `UPDATE authors SET in_stoplist = 1 WHERE username = (SELECT author_username FROM posts WHERE code = ?)`,
  ).bind(code).run();
  return `🛑 Takedown для ${code} выполнен: публикации сняты, автор в стоп-листе.`;
}
