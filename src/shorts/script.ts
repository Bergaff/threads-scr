/**
 * Сценарий и тайминги Shorts — разделы 5 и 7 ТЗ.
 * Сам монтаж (ffmpeg) в Workers невозможен — Worker готовит сценарий,
 * субтитры и ассеты, а собирает ролик внешний рендерер (см. docs/ARCHITECTURE.md).
 */

import { estimateSpeechSeconds, stripMentions, normalizeNumbersForTts, wordCount } from "../lib/text.js";

export type SegmentType = "hook" | "post" | "reply" | "outro";

export interface ScriptSegment {
  type: SegmentType;
  text: string;
  startSec: number;
  endSec: number;
}

export interface ShortsScript {
  segments: ScriptSegment[];
  totalSec: number;
  totalWords: number;
}

export interface ScriptInput {
  hook: string;
  postText: string;
  replies: string[];
  outro: string;
  wpm?: number;
}

export function buildScript(input: ScriptInput): ShortsScript {
  const wpm = input.wpm ?? 165;
  const raw: Array<{ type: SegmentType; text: string }> = [
    { type: "hook", text: input.hook },
    { type: "post", text: input.postText },
    ...input.replies.slice(0, 5).map((t) => ({ type: "reply" as const, text: t })),
    { type: "outro", text: input.outro },
  ];

  const segments: ScriptSegment[] = [];
  let cursor = 0;
  for (const seg of raw) {
    const spoken = normalizeNumbersForTts(stripMentions(seg.text));
    const dur = Math.max(1.5, estimateSpeechSeconds(spoken, wpm));
    segments.push({ type: seg.type, text: spoken, startSec: cursor, endSec: cursor + dur });
    cursor += dur;
  }
  return {
    segments,
    totalSec: Math.round(cursor * 10) / 10,
    totalWords: segments.reduce((s, x) => s + wordCount(x.text), 0),
  };
}

export function validateScript(script: ShortsScript, minSec = 30, maxSec = 60, hardMaxSec = 90): { ok: boolean; reason?: string } {
  if (script.totalSec < minSec) return { ok: false, reason: `too short: ${script.totalSec}s < ${minSec}s` };
  if (script.totalSec > hardMaxSec) return { ok: false, reason: `too long: ${script.totalSec}s > ${hardMaxSec}s` };
  if (script.totalSec > maxSec) return { ok: true, reason: `longer than target ${maxSec}s` };
  return { ok: true };
}
