/**
 * Ссылки с UTM-метками — разделы 6.1 и 10 ТЗ.
 * Источник: tg | youtube; campaign: ru | en; content: код треда.
 */

export interface LinkContext {
  siteUrl: string;
  botUsername: string;
  source: "tg" | "youtube";
  campaign: "ru" | "en";
  username: string;
  postCode: string;
}

export function threadUrl(ctx: LinkContext): string {
  const base = `${ctx.siteUrl.replace(/\/$/, "")}/@${ctx.username}/post/${ctx.postCode}`;
  const q = new URLSearchParams({
    utm_source: ctx.source,
    utm_medium: "channel",
    utm_campaign: ctx.campaign,
    utm_content: ctx.postCode,
  });
  return `${base}?${q.toString()}`;
}

export function botDeepLink(ctx: LinkContext): string {
  return `https://t.me/${ctx.botUsername}?start=ch_${ctx.campaign}_${ctx.postCode}`;
}

export function inlineKeyboard(ctx: LinkContext, lang: "ru" | "en") {
  const labels =
    lang === "ru"
      ? { thread: "Открыть тред и комментарии", bot: "Читать в боте" }
      : { thread: "Open thread & comments", bot: "Read in bot" };
  return {
    inline_keyboard: [
      [
        { text: labels.thread, url: threadUrl(ctx) },
        { text: labels.bot, url: botDeepLink(ctx) },
      ],
    ],
  };
}
