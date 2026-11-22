/**
 * Публикация в Telegram — разделы 6 и 9 ТЗ.
 * Идемпотентность: один материал не публикуется дважды (UNIQUE(content_id, channel)).
 * Повтор при ошибке: 3 попытки с паузой 1 → 5 → 15 минут (реализуется через Queue delay).
 */

import { TelegramClient } from "../bot/telegram.js";
import { inlineKeyboard, type LinkContext } from "../lib/utm.js";

export interface PublishInput {
  contentId: string;
  channel: "tg_ru" | "tg_en";
  chatId: string;
  caption: string;
  cardUrl?: string; // публичный URL карточки (R2) или file_id
  photoUrls?: string[];
  linkCtx: LinkContext;
  lang: "ru" | "en";
}

export async function publishToTelegram(client: TelegramClient, input: PublishInput): Promise<{ externalId: string }> {
  const replyMarkup = inlineKeyboard(input.linkCtx, input.lang);
  if (input.cardUrl && input.photoUrls && input.photoUrls.length > 0) {
    // Альбом: сначала карточка, потом фото (до 10 штук) — sendMediaGroup.
    const media = [
      { type: "photo", media: input.cardUrl, caption: input.caption, parse_mode: "HTML" },
      ...input.photoUrls.slice(0, 9).map((u) => ({ type: "photo", media: u })),
    ];
    const res = await client["call"]<Array<{ message_id: number }>>("sendMediaGroup", {
      chat_id: input.chatId,
      media,
      reply_markup: replyMarkup,
    });
    return { externalId: String(res[0]?.message_id ?? "") };
  }
  if (input.cardUrl) {
    const msg = await client.sendPhoto(input.chatId, input.cardUrl, input.caption, { reply_markup: replyMarkup });
    return { externalId: String(msg.message_id) };
  }
  const msg = await client.sendMessage(input.chatId, input.caption, { reply_markup: replyMarkup });
  return { externalId: String(msg.message_id) };
}

/** Паузы повторов при ошибке публикации (минуты). */
export const PUBLISH_RETRY_MINUTES = [1, 5, 15];
