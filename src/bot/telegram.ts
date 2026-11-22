/**
 * Клиент Telegram Bot API (разделы 6, 8, 9 ТЗ).
 * Используется и ботом-редактором (webhook), и публикацией в каналы.
 */

export interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

export class TelegramClient {
  constructor(private token: string) {}

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? "error"}`);
    return json.result as T;
  }

  sendMessage(chatId: number | string, text: string, extra: Record<string, unknown> = {}): Promise<TgMessage> {
    return this.call<TgMessage>("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
  }

  sendPhoto(chatId: number | string, photo: string, caption: string, extra: Record<string, unknown> = {}): Promise<TgMessage> {
    return this.call<TgMessage>("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra });
  }

  sendVideo(chatId: number | string, video: string, caption: string, extra: Record<string, unknown> = {}): Promise<TgMessage> {
    return this.call<TgMessage>("sendVideo", { chat_id: chatId, video, caption, parse_mode: "HTML", ...extra });
  }

  editMessageText(chatId: number | string, messageId: number, text: string): Promise<unknown> {
    return this.call("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" });
  }

  deleteMessage(chatId: number | string, messageId: number): Promise<boolean> {
    return this.call<boolean>("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.call<boolean>("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  }

  /** Загрузка файла (для черновиков Shorts в бот-редактор). */
  async sendDocument(chatId: number | string, file: Blob, filename: string, caption?: string): Promise<TgMessage> {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("document", file, filename);
    if (caption) form.append("caption", caption);
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, { method: "POST", body: form });
    const json = (await res.json()) as { ok: boolean; result?: TgMessage; description?: string };
    if (!json.ok) throw new Error(`Telegram sendDocument: ${json.description ?? "error"}`);
    return json.result as TgMessage;
  }
}

/** Подпись поста TG: HTML, до 1024 символов (раздел 6.1). */
export function buildTgCaption(input: {
  headline: string;
  recap: string;
  replies: string[];
  hashtags: string[];
  lang: "ru" | "en";
}): string {
  const { escapeHtml } = { escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") };
  const repliesLabel = input.lang === "ru" ? "💬 Лучшие ответы:" : "💬 Best replies:";
  const lines = [
    `<b>${escapeHtml(input.headline)}</b>`,
    "",
    escapeHtml(input.recap),
  ];
  if (input.replies.length > 0) {
    lines.push("", repliesLabel);
    for (const r of input.replies.slice(0, 3)) lines.push(`— «${escapeHtml(r)}»`);
  }
  if (input.hashtags.length > 0) {
    lines.push("", input.hashtags.map((h) => `#${escapeHtml(h.replace(/^#/, ""))}`).join(" "));
  }
  const caption = lines.join("\n");
  return caption.length > 1024 ? caption.slice(0, 1021) + "…" : caption;
}
