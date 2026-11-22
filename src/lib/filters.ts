/**
 * Фильтры кандидатов — раздел 4.5 ТЗ.
 * Каждый отказ записывается с причиной (поле posts.filter_reasons).
 */

export interface FilterablePost {
  text: string;
  authorUsername: string;
  authorFollowers: number;
  hasMedia: boolean;
  isPaidPartnership?: boolean;
  isDeleted?: boolean;
  lang?: string;
}

export interface FilterConfig {
  minTextLength: number;
  blockPolitics: boolean;
  blockAdult: boolean;
  authorMaxPostsPer7d: number;
}

export const DEFAULT_FILTERS: FilterConfig = {
  minTextLength: 15,
  blockPolitics: true,
  blockAdult: true,
  authorMaxPostsPer7d: 2,
};

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

const GIVEAWAY_RE = /(розыгрыш|giveaway|give away|конкурс|раздаю|выиграй|win\s+(a|an|the|this|that)|free\s+gift)/i;
const SHOP_RE = /(https?:\/\/(?:t\.me\/|shop|store|ozon|wildberries|aliexpress|amazon|ebay)[^\s]*|промокод|скидк[аи]\s+\d+\s*%|купить\s+по\s+ссылке)/i;
const PHONE_RE = /(\+?\d[\d\s\-()]{9,}\d)/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;

const ADULT_WORDS = [
  "18+", "порно", "porn", "xxx", "секс", "sex", "эротик", "erotic", "nude", "обнажён",
];
const VIOLENCE_WORDS = [
  "расстрел", "убийств", "кровь", "крови", "насили", "violence", "killed", "murder", "blood",
];
const POLITICS_WORDS = [
  "война", "war", "всу", "арми", "army", "ракет", "missile", "бомб", "bomb", "фронт", "front",
  "президент", "president", "парламент", "parliament", "выбор", "election", "санкци", "sanction",
  "мобилизац", "mobiliz", "украин", "ukrain", "российск", "russian", "белорус", "belarus",
];

function containsAny(text: string, words: string[]): string | undefined {
  const lower = text.toLowerCase();
  return words.find((w) => lower.includes(w));
}

export interface FilterContext {
  stoplist: Set<string>;
  /** Сколько раз автор уже публиковался на этой площадке за 7 дней */
  authorPostsOnChannel7d?: number;
  /** Тред уже использовался на этой площадке */
  alreadyUsedOnChannel?: boolean;
}

export function applyFilters(post: FilterablePost, ctx: FilterContext, cfg: FilterConfig = DEFAULT_FILTERS): FilterResult {
  const reasons: string[] = [];
  const text = post.text ?? "";

  if (post.isDeleted) reasons.push("deleted");
  if (post.isPaidPartnership) reasons.push("paid_partnership");
  if (GIVEAWAY_RE.test(text)) reasons.push("giveaway");
  if (SHOP_RE.test(text)) reasons.push("shop_link");
  if (PHONE_RE.test(text) || EMAIL_RE.test(text)) reasons.push("personal_data");
  if (ctx.stoplist.has(post.authorUsername.toLowerCase())) reasons.push("stoplist_author");

  if (cfg.blockAdult) {
    const w = containsAny(text, [...ADULT_WORDS, ...VIOLENCE_WORDS]);
    if (w) reasons.push(`adult_or_violence:${w}`);
  }
  if (cfg.blockPolitics) {
    const w = containsAny(text, POLITICS_WORDS);
    if (w) reasons.push(`politics:${w}`);
  }

  if (text.trim().length < cfg.minTextLength && !post.hasMedia) {
    reasons.push("too_short");
  }
  if (ctx.alreadyUsedOnChannel) reasons.push("already_used");
  if ((ctx.authorPostsOnChannel7d ?? 0) > cfg.authorMaxPostsPer7d) {
    reasons.push("author_frequency_exceeded");
  }

  return { pass: reasons.length === 0, reasons };
}
