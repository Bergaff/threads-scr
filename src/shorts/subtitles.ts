/**
 * Субтитры ASS — раздел 7.5 ТЗ.
 * Крупные субтитры, 2–4 слова на экране, подсветка текущего слова,
 * позиция по центру между безопасными зонами (250px сверху, 420px снизу при 1920px).
 */

import type { ScriptSegment } from "./script.js";

export function formatAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** Разбить сегмент на события по 2–4 слова. */
export function segmentsToAss(segments: ScriptSegment[], wordsPerEvent = 3): string {
  const events: string[] = [];
  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const chunks: string[][] = [];
    for (let i = 0; i < words.length; i += wordsPerEvent) chunks.push(words.slice(i, i + wordsPerEvent));
    const span = seg.endSec - seg.startSec;
    chunks.forEach((chunk, i) => {
      const start = seg.startSec + (span * i) / chunks.length;
      const end = seg.startSec + (span * (i + 1)) / chunks.length;
      // Подсветка текущего слова через {\kf} (karaoke) — упрощённо: первое слово крупнее.
      const highlighted = chunk.map((w, j) => (j === 0 ? `{\\kf50}${w}` : w)).join(" ");
      events.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${highlighted}`);
    });
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Inter,72,&H00FFFFFF,&H000019FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,60,60,700,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}
