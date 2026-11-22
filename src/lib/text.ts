/** Текстовые утилиты: экранирование, обрезка, нормализация для TTS. */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeXml(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Обрезка с «…» по границе слов. */
export function truncate(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

/** Убрать упоминания/хэштеги/ссылки для озвучки (раздел 7.4 ТЗ). */
export function stripMentions(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@[\w.]+/g, "")
    .replace(/#[\wа-яё]+/gi, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Нормализация чисел для TTS: «1,2K» → «тысяча двести», «100%» → «сто процентов».
 * Упрощённая версия — полную делает провайдер TTS / нейросеть.
 */
export function normalizeNumbersForTts(text: string): string {
  return text
    .replace(/(\d+(?:[.,]\d+)?)\s*K\b/gi, (_, n: string) => expandThousands(Number(String(n).replace(",", "."))))
    .replace(/(\d+(?:[.,]\d+)?)\s*M\b/gi, (_, n: string) => `${expandThousands(Number(String(n).replace(",", ".")))} миллион`)
    .replace(/(\d+)%/g, (_, n: string) => `${n} процентов`);
}

function expandThousands(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    const rest = Math.round(n % 1000);
    const words = ["", "тысяча", "две тысячи", "три тысячи", "четыре тысячи", "пять тысяч", "шесть тысяч", "семь тысяч", "восемь тысяч", "девять тысяч", "десять тысяч"];
    const base = words[thousands] ?? `${thousands} тысяч`;
    return rest ? `${base} ${rest}` : base;
  }
  return String(Math.round(n));
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Оценка длительности озвучки в секундах при заданной скорости (слов/мин). */
export function estimateSpeechSeconds(text: string, wpm = 165): number {
  return (wordCount(text) / wpm) * 60;
}
