/**
 * Определение языка — раздел 4.6 ТЗ.
 * Лёгкая эвристика без внешних зависимостей (cld3/franc в Workers недоступны
 * без WASM-бандла). Для спорных случаев вызывающий код может перепроверить
 * нейросетью (см. src/ai/provider.ts).
 */

export type Lang = "ru" | "en" | "uk" | "be" | "kk" | "other";

const UK_LETTERS = /[іїєґ]/i;
const BE_LETTERS = /[ў]/i;
// «і» общая для украинского и казахского — в KK только специфичные буквы.
const KK_LETTERS = /[әғқңөұүһ]/i;

export function detectLanguage(text: string): Lang {
  const letters = text.match(/[A-Za-zА-Яа-яЁёІіЇїЄєҐґЎўӘәҒғҚқҢңӨөҰұҮүҺһ]/g) ?? [];
  if (letters.length < 3) return "other";

  const cyrillic = letters.filter((c) => /[А-Яа-яЁёІіЇїЄєҐґЎўӘәҒғҚқҢңӨөҰұҮүҺһ]/.test(c)).length;
  const latin = letters.length - cyrillic;
  const cyrRatio = cyrillic / letters.length;

  if (cyrRatio < 0.5) {
    // Латиница: английский (или другой западный язык — помечаем other, если
    // явно не английский по частым словам).
    const lower = text.toLowerCase();
    const enMarkers = /\b(the|and|you|this|that|with|have|what|when|about|people|thread)\b/;
    if (enMarkers.test(lower) || latin >= 10) return "en";
    return "other";
  }

  // Кириллица: сначала специфичные буквы, затем русский по умолчанию.
  if (KK_LETTERS.test(text)) return "kk";
  if (BE_LETTERS.test(text)) return "be";
  if (UK_LETTERS.test(text)) return "uk";
  return "ru";
}

/** RU-площадки: ru (+ опционально en с переводом). EN-площадки: только en. */
export function isTargetLanguage(lang: Lang, channelLang: "ru" | "en", allowTranslatedEn = false): boolean {
  if (channelLang === "ru") return lang === "ru" || (allowTranslatedEn && lang === "en");
  return lang === "en";
}
